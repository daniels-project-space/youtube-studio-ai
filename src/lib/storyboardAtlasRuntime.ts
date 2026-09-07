/**
 * Executable storyboard-atlas runtime for the direct Novita image route.
 *
 * One atlas worker output is cropped into exact, provenance-bound stills that
 * the existing asset QA and LTX I2V stages can consume. The production block
 * may call this only for a route whose human-reviewed qualification receipt is
 * present in QUALIFIED_STORYBOARD_ATLAS_ROUTES below. An empty registry means
 * the feature is built and testable but cannot spend or alter production.
 */
import { join } from "node:path";

import { canonicalJson } from "@/lib/canonicalJson";
import { makeRunTempDir, writeBytes } from "@/lib/files";
import { cropImageRegionToPng } from "@/lib/ffmpeg";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { getObjectBytes, putObject } from "@/lib/storage";
import { rasterImageDimensions } from "@/lib/imageDimensions";
import type { StillRenderManifest } from "@/engine/renderArtifacts";
import type { GenerationProfile } from "@/engine/generationProfiles";
import type {
  NovitaRenderResult,
  RenderedCandidate,
  Shot,
} from "@/lib/novitaRenderFarm";

export const STORYBOARD_ATLAS_RUNTIME_VERSION = "storyboard-atlas-runtime/v1" as const;
export const STORYBOARD_ATLAS_GRID_SIZES = [2, 4, 8, 16] as const;
export type StoryboardAtlasGridSize = (typeof STORYBOARD_ATLAS_GRID_SIZES)[number];

export interface StoryboardAtlasCell {
  readonly shotId: string;
  readonly candidateIndex: number;
  readonly sequenceIndex: number;
  readonly row: number;
  readonly column: number;
  readonly coordinate: string;
  readonly crop: Readonly<{ x: number; y: number; width: number; height: number }>;
}

export interface StoryboardAtlasJob {
  readonly shot: Shot;
  readonly cells: readonly StoryboardAtlasCell[];
}

export interface StoryboardAtlasRenderPlan {
  readonly version: typeof STORYBOARD_ATLAS_RUNTIME_VERSION;
  readonly gridSize: StoryboardAtlasGridSize;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly independentProviderCalls: number;
  readonly atlasProviderCalls: number;
  readonly jobs: readonly StoryboardAtlasJob[];
  readonly fingerprint: string;
}

export interface StoryboardAtlasQualifiedRoute {
  readonly runtimeVersion: typeof STORYBOARD_ATLAS_RUNTIME_VERSION;
  readonly profileId: GenerationProfile["id"];
  readonly imageModel: string;
  readonly imageRevision: string;
  readonly gridSize: StoryboardAtlasGridSize;
  readonly qualificationFingerprint: string;
}

/**
 * Deliberately empty until the blocked Novita comparison can render and the
 * owner records a real human verdict. This is the production activation gate,
 * not documentation: a requested atlas route throws unless it matches here.
 */
export const QUALIFIED_STORYBOARD_ATLAS_ROUTES: readonly StoryboardAtlasQualifiedRoute[] = Object.freeze([]);

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function gridSize(value: unknown): StoryboardAtlasGridSize {
  if (!STORYBOARD_ATLAS_GRID_SIZES.includes(value as StoryboardAtlasGridSize)) {
    throw new Error("storyboard atlas grid must be 2, 4, 8, or 16");
  }
  return value as StoryboardAtlasGridSize;
}

function coordinate(row: number, column: number): string {
  return `${String.fromCharCode(65 + row)}${column + 1}`;
}

function safeToken(value: string): string {
  const token = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
  if (!token) throw new Error("storyboard atlas received an unsafe empty shot id");
  return token;
}

function uniqueText(values: readonly (string | undefined)[]): string | undefined {
  const compact = [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
  return compact.length ? compact.join("; ") : undefined;
}

function candidateCountFor(shot: Shot): number {
  return positiveInteger(shot.candidateCount ?? 1, `storyboard atlas candidate count for ${shot.id}`);
}

function atlasPrompt(input: {
  grid: StoryboardAtlasGridSize;
  cells: readonly { coordinate: string; prompt: string }[];
}): string {
  const capacity = input.grid ** 2;
  const assigned = input.cells.map((cell) => `${cell.coordinate}: ${cell.prompt}`);
  const unused = Array.from({ length: capacity - input.cells.length }, (_, offset) => {
    const index = input.cells.length + offset;
    return `${coordinate(Math.floor(index / input.grid), index % input.grid)}: repeat the nearest assigned scene as a quiet continuity study`;
  });
  return [
    `Render ONE borderless ${input.grid} by ${input.grid} cinematic storyboard atlas on a single 16:9 canvas.`,
    `The canvas has exactly ${input.grid} equal columns and ${input.grid} equal rows; every cell is itself 16:9.`,
    "Keep recurring people, wardrobe, objects, locations, palette, era, materials, and line language identical across every cell.",
    "No gutters, frames, separators, contact-sheet labels, coordinates, captions, typography, logos, UI, or watermarks in the pixels.",
    "Each cell must be a complete cinematic frame with its own readable composition, not a collage inside a cell.",
    ...assigned,
    ...unused,
  ].join("\n\n");
}

/** Plan one-provider-output atlas sheets while preserving every shot candidate. */
export function createStoryboardAtlasRenderPlan(input: {
  readonly shots: readonly Shot[];
  readonly gridSize: StoryboardAtlasGridSize;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly minimumCellWidth?: number;
  readonly minimumCellHeight?: number;
}): StoryboardAtlasRenderPlan {
  if (!input.shots.length) throw new Error("storyboard atlas requires at least one shot");
  const grid = gridSize(input.gridSize);
  const canvasWidth = positiveInteger(input.canvasWidth, "storyboard atlas canvas width");
  const canvasHeight = positiveInteger(input.canvasHeight, "storyboard atlas canvas height");
  if (canvasWidth % grid !== 0 || canvasHeight % grid !== 0) {
    throw new Error(`storyboard atlas ${canvasWidth}x${canvasHeight} canvas is not divisible by ${grid}`);
  }
  const cellWidth = canvasWidth / grid;
  const cellHeight = canvasHeight / grid;
  const minimumCellWidth = positiveInteger(input.minimumCellWidth ?? 256, "storyboard atlas minimum cell width");
  const minimumCellHeight = positiveInteger(input.minimumCellHeight ?? 144, "storyboard atlas minimum cell height");
  if (cellWidth < minimumCellWidth || cellHeight < minimumCellHeight) {
    throw new Error(
      `${grid}x${grid} storyboard atlas yields ${cellWidth}x${cellHeight} cells below the ` +
      `${minimumCellWidth}x${minimumCellHeight} floor`,
    );
  }
  const ids = new Set<string>();
  for (const shot of input.shots) {
    if (ids.has(shot.id)) throw new Error(`storyboard atlas duplicates shot ${shot.id}`);
    ids.add(shot.id);
    candidateCountFor(shot);
    if (!shot.prompt.trim()) throw new Error(`storyboard atlas shot ${shot.id} has no prompt`);
  }

  const capacity = grid ** 2;
  const maximumCandidateCount = Math.max(...input.shots.map(candidateCountFor));
  const jobs: StoryboardAtlasJob[] = [];
  for (let candidateIndex = 0; candidateIndex < maximumCandidateCount; candidateIndex++) {
    const layer = input.shots
      .map((shot, sequenceIndex) => ({ shot, sequenceIndex }))
      .filter(({ shot }) => candidateCountFor(shot) > candidateIndex);
    for (let offset = 0; offset < layer.length; offset += capacity) {
      const group = layer.slice(offset, offset + capacity);
      const cells = group.map(({ shot, sequenceIndex }, localIndex): StoryboardAtlasCell => {
        const row = Math.floor(localIndex / grid);
        const column = localIndex % grid;
        return {
          shotId: shot.id,
          candidateIndex,
          sequenceIndex,
          row,
          column,
          coordinate: coordinate(row, column),
          crop: { x: column * cellWidth, y: row * cellHeight, width: cellWidth, height: cellHeight },
        };
      });
      const sheetIndex = Math.floor(offset / capacity);
      const id = `atlas-g${String(grid).padStart(2, "0")}-c${String(candidateIndex + 1).padStart(2, "0")}-s${String(sheetIndex + 1).padStart(3, "0")}`;
      jobs.push({
        cells,
        shot: {
          id,
          prompt: atlasPrompt({
            grid,
            cells: group.map(({ shot }, index) => ({
              coordinate: cells[index]!.coordinate,
              prompt: shot.prompt,
            })),
          }),
          negative: uniqueText([
            ...group.map(({ shot }) => shot.negative),
            "text, labels, letters, numbers, panel borders, gutters, UI, watermarks, inconsistent recurring characters",
          ]),
          cameraMove: "static",
          shotScale: "wide",
          lens: "locked storyboard atlas camera language",
          seconds: 1,
          motion: "Static multi-frame storyboard atlas; no motion render is requested.",
          candidateCount: 1,
          seed: Number.parseInt(sha256Hex(`${candidateIndex}:${group.map(({ shot }) => shot.id).join("|")}`).slice(0, 8), 16),
        },
      });
    }
  }
  const body = {
    version: STORYBOARD_ATLAS_RUNTIME_VERSION,
    gridSize: grid,
    canvasWidth,
    canvasHeight,
    cellWidth,
    cellHeight,
    independentProviderCalls: input.shots.reduce((total, shot) => total + candidateCountFor(shot), 0),
    atlasProviderCalls: jobs.length,
    jobs,
  };
  return Object.freeze({ ...body, fingerprint: sha256Hex(canonicalJson(body)) });
}

export function requestedQualifiedStoryboardAtlasGrid(input: {
  readonly value: unknown;
  readonly profile: GenerationProfile;
  readonly registry?: readonly StoryboardAtlasQualifiedRoute[];
}): StoryboardAtlasGridSize | undefined {
  if (input.value === undefined || input.value === null || input.value === false || input.value === "off") return undefined;
  const grid = gridSize(input.value);
  const registry = input.registry ?? QUALIFIED_STORYBOARD_ATLAS_ROUTES;
  const match = registry.find((route) =>
    route.runtimeVersion === STORYBOARD_ATLAS_RUNTIME_VERSION &&
    route.profileId === input.profile.id &&
    route.imageModel === input.profile.image.model &&
    route.imageRevision === input.profile.image.revision &&
    route.gridSize === grid &&
    /^[a-f0-9]{64}$/u.test(route.qualificationFingerprint)
  );
  if (!match) {
    throw new Error(
      `storyboard atlas ${grid}x${grid} is not qualified for ${input.profile.id}/` +
      `${input.profile.image.model}@${input.profile.image.revision}; run and owner-review the real comparison first`,
    );
  }
  return grid;
}

type AtlasManifestItem = StillRenderManifest["items"][number];

export interface StoryboardAtlasMaterializeRuntime {
  makeTempDir(prefix: string): Promise<string>;
  getObjectBytes(key: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  cropRegion(input: string, output: string, crop: StoryboardAtlasCell["crop"]): Promise<unknown>;
  readBytes(path: string): Promise<Uint8Array>;
  dimensions(bytes: Uint8Array): { width: number; height: number; contentType: string };
  putImmutable(
    key: string,
    bytes: Uint8Array,
    contentType: "application/json" | "image/png",
    metadata: Record<string, string>,
  ): Promise<string>;
}

const DEFAULT_MATERIALIZE_RUNTIME: StoryboardAtlasMaterializeRuntime = {
  makeTempDir: makeRunTempDir,
  getObjectBytes,
  writeBytes: async (path, bytes) => { await writeBytes(path, bytes); },
  cropRegion: cropImageRegionToPng,
  readBytes: async (path) => {
    const { readFile } = await import("node:fs/promises");
    return new Uint8Array(await readFile(path));
  },
  dimensions: rasterImageDimensions,
  putImmutable: async (key, bytes, contentType, metadata) => {
    try {
      return await putObject(key, bytes, { contentType, metadata, ifNoneMatch: "*" });
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = String((error as { name?: unknown })?.name ?? "");
      if (status !== 409 && status !== 412 && name !== "PreconditionFailed" && name !== "ConditionalRequestConflict") {
        throw error;
      }
      const existing = await getObjectBytes(key);
      if (sha256BytesHex(existing) !== sha256BytesHex(bytes)) {
        throw new Error(`storyboard atlas immutable derivative collision at ${key}`);
      }
      return key;
    }
  },
};

/** Crop provider sheets and bind every derivative to its exact paid source. */
export async function materializeStoryboardAtlasCrops(input: {
  readonly plan: StoryboardAtlasRenderPlan;
  readonly result: NovitaRenderResult;
  readonly keyPrefix: string;
  readonly runtime?: StoryboardAtlasMaterializeRuntime;
}): Promise<readonly AtlasManifestItem[]> {
  const runtime = input.runtime ?? DEFAULT_MATERIALIZE_RUNTIME;
  const candidates = input.result.candidates ?? [];
  if (candidates.length !== input.plan.jobs.length) {
    throw new Error("storyboard atlas render returned an incomplete exact sheet mapping");
  }
  const byShotId = new Map<string, RenderedCandidate>();
  for (const candidate of candidates) {
    if (byShotId.has(candidate.shotId)) throw new Error(`storyboard atlas returned duplicate sheet ${candidate.shotId}`);
    byShotId.set(candidate.shotId, candidate);
  }
  const tmp = await runtime.makeTempDir("storyboard-atlas-");
  const planKey = `${input.keyPrefix.replace(/\/$/u, "")}/atlas-plans/${input.plan.fingerprint}.json`;
  await runtime.putImmutable(
    planKey,
    new TextEncoder().encode(`${JSON.stringify(input.plan, null, 2)}\n`),
    "application/json",
    {
      atlasRuntime: STORYBOARD_ATLAS_RUNTIME_VERSION,
      atlasPlan: input.plan.fingerprint,
    },
  );
  const items: AtlasManifestItem[] = [];
  for (const job of input.plan.jobs) {
    const source = byShotId.get(job.shot.id);
    if (!source || source.candidateIndex !== 0 || source.outputId !== `${job.shot.id}-c01`) {
      throw new Error(`storyboard atlas lacks the exact provider output for ${job.shot.id}`);
    }
    const requestSha256 = input.result.requestSha256ByOutputId?.[source.outputId];
    const billingReceipt = input.result.billingReceiptsByOutputId?.[source.outputId];
    if (!requestSha256 || !billingReceipt?.receiptId) {
      throw new Error(`storyboard atlas source ${source.outputId} lacks its exact request/billing receipt`);
    }
    const sourceBytes = await runtime.getObjectBytes(source.key);
    if (!sourceBytes.length) throw new Error(`storyboard atlas source ${source.key} is empty`);
    const sourceDimensions = runtime.dimensions(sourceBytes);
    if (
      sourceDimensions.width !== input.plan.canvasWidth ||
      sourceDimensions.height !== input.plan.canvasHeight ||
      !/^image\/(?:png|jpeg|webp)$/u.test(sourceDimensions.contentType)
    ) {
      throw new Error(
        `storyboard atlas source ${source.outputId} returned ${sourceDimensions.contentType} ` +
        `${sourceDimensions.width}x${sourceDimensions.height}; expected an exact ` +
        `${input.plan.canvasWidth}x${input.plan.canvasHeight} raster`,
      );
    }
    const sourceContentSha256 = sha256BytesHex(sourceBytes);
    const sourcePath = join(tmp, `${safeToken(source.outputId)}.png`);
    await runtime.writeBytes(sourcePath, sourceBytes);
    for (const cell of job.cells) {
      const outputId = `${cell.shotId}-c${String(cell.candidateIndex + 1).padStart(2, "0")}`;
      const cropPath = join(tmp, `${safeToken(outputId)}-${cell.coordinate}.png`);
      await runtime.cropRegion(sourcePath, cropPath, cell.crop);
      const bytes = await runtime.readBytes(cropPath);
      if (!bytes.length) throw new Error(`storyboard atlas crop ${outputId} is empty`);
      const dimensions = runtime.dimensions(bytes);
      if (
        dimensions.width !== cell.crop.width ||
        dimensions.height !== cell.crop.height ||
        dimensions.contentType !== "image/png"
      ) {
        throw new Error(
          `storyboard atlas crop ${outputId} returned ${dimensions.contentType} ` +
          `${dimensions.width}x${dimensions.height}; expected exact PNG ${cell.crop.width}x${cell.crop.height}`,
        );
      }
      const contentSha256 = sha256BytesHex(bytes);
      const shotToken = `${safeToken(cell.shotId)}-${sha256Hex(cell.shotId).slice(0, 10)}`;
      const key = `${input.keyPrefix.replace(/\/$/u, "")}/atlas-crops/${shotToken}/` +
        `c${String(cell.candidateIndex + 1).padStart(2, "0")}-${requestSha256.slice(0, 12)}-` +
        `${sourceContentSha256.slice(0, 16)}-${cell.coordinate}.png`;
      await runtime.putImmutable(key, bytes, "image/png", {
        atlasRuntime: STORYBOARD_ATLAS_RUNTIME_VERSION,
        atlasPlan: input.plan.fingerprint,
        sourceOutput: source.outputId,
        sourceSha256: sourceContentSha256,
        cropSha256: contentSha256,
        coordinate: cell.coordinate,
      });
      items.push({
        shotId: cell.shotId,
        candidateIndex: cell.candidateIndex,
        outputId,
        stillKey: key,
        derivation: {
          version: "storyboard-atlas-crop/v1",
          planFingerprint: input.plan.fingerprint,
          planKey,
          sourceOutputId: source.outputId,
          sourceStillKey: source.key,
          sourceRequestSha256: requestSha256,
          sourceBillingReceiptId: billingReceipt.receiptId,
          sourceContentSha256,
          contentSha256,
          gridSize: input.plan.gridSize,
          coordinate: cell.coordinate,
          crop: cell.crop,
        },
      });
    }
  }
  return items.sort((left, right) => {
    const leftIndex = input.plan.jobs.flatMap((job) => job.cells).find((cell) => cell.shotId === left.shotId)?.sequenceIndex ?? 0;
    const rightIndex = input.plan.jobs.flatMap((job) => job.cells).find((cell) => cell.shotId === right.shotId)?.sequenceIndex ?? 0;
    return leftIndex - rightIndex || left.candidateIndex - right.candidateIndex;
  });
}
