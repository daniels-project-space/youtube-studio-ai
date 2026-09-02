/**
 * Production channel-art generation.
 *
 * Avatar and banner are independent, versioned jobs. Both use sealed Fal-hosted
 * Nano Banana routes with their own geometry and evidence contracts. Every
 * candidate is durable in R2 before it is judged, and there is no provider
 * fallback. Only an accepted candidate is returned.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { produceAndCritique } from "@/engine/critiqueLoop";
import { generateFalNanoBananaAvatarImageWithReceipt } from "@/lib/falNanoBananaAvatar";
import { makeRunTempDir } from "@/lib/files";
import { cropCenterImageToJpeg, imageToJpeg } from "@/lib/ffmpeg";
import { generateFalNanoBananaBannerWithReceipt } from "@/lib/falNanoBananaBanner";
import {
  FAL_NANO_BANANA_BANNER_PROFILE,
  type FalNanoBananaBannerReceipt,
} from "@/lib/falNanoBananaBannerContract";
import { parseJsonLoose } from "@/lib/gemini";
import {
  NANO_BANANA_AVATAR_PROFILE,
  type NanoBananaAvatarReceipt,
} from "@/lib/nanoBananaAvatarContract";
import { channelKey, putObject } from "@/lib/storage";
import { hasVisionKey, visionLocal, VISION_GATE_MAX_TOKENS } from "@/lib/vision";

export interface ArtIdentity {
  name: string;
  persona?: string;
  styleGrammar?: string;
  palette?: string[];
  niche?: string;
  /** Show Bible iconic motif — the recurring visual signature to build around. */
  iconicMotif?: string;
  /** Show Bible vibe — the emotional/tonal signature. */
  vibe?: string;
  /** Frozen Style DNA setting; banners must live in this actual channel world. */
  worldSetting?: string;
  /** Frozen Style DNA composition so channel artwork does not collapse to a generic genre scene. */
  worldComposition?: string;
  /** Small, repeatable Style DNA anchors that distinguish one channel from another. */
  worldMotifs?: string[];
  /** Channel-specific visual exclusions retained by the art prompt. */
  visualAvoid?: string[];
}

export interface ChannelArtResult {
  imageKey: string;
  bannerKey: string;
}

export interface ChannelAvatarRenderRequest {
  prompt: string;
  idempotencyContext: string;
}

export interface ChannelArtRuntime {
  hasJudge(): boolean;
  renderBanner(request: { prompt: string; idempotencyContext: string }): Promise<{
    bytes: Uint8Array;
    receipt: FalNanoBananaBannerReceipt;
  }>;
  renderAvatar(request: ChannelAvatarRenderRequest): Promise<{
    bytes: Uint8Array;
    receipt: NanoBananaAvatarReceipt;
  }>;
  makeTempDir(prefix: string): Promise<string>;
  toJpeg(input: string, output: string, width: number, height: number): Promise<unknown>;
  cropCenter(input: string, output: string, width: number, height: number): Promise<unknown>;
  judge(request: { kind: ArtKind; prompt: string; imagePaths: string[] }): Promise<unknown>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  putImmutable(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  createVersion(kind: ArtKind): string;
}

export interface ChannelArtOptions {
  /** Generate or resolve the avatar. Defaults to true. */
  avatar?: boolean;
  /** Generate or resolve the banner. Defaults to true. */
  banner?: boolean;
  /**
   * Keep supplied existing keys instead of generating replacements. This can be
   * set globally or per asset, e.g. `{ avatar: true, banner: false }`.
   */
  preserveExisting?: boolean | { avatar?: boolean; banner?: boolean };
  existing?: Partial<ChannelArtResult>;
  /** Stable checkpoint namespace, or independent namespaces per asset. */
  version?: string | { avatar?: string; banner?: string };
  maxAttempts?: number;
  /** Explicit aggregate admission for one generated asset. */
  maxProviderSpendUsd?: number;
  /** Explicit dependency seam for deterministic tests; production omits it. */
  runtime?: ChannelArtRuntime;
}

type Logger = (msg: string, extra?: Record<string, unknown>) => void;
export type ArtKind = "avatar" | "banner";

interface ArtCandidate {
  key: string;
  url: string;
  sourcePath: string;
  judgedPaths: string[];
  attempt: number;
}

interface AcceptedArt {
  key: string;
  sourceKey: string;
  score: number;
  attempts: number;
}

const SCORE_THRESHOLD: Record<ArtKind, number> = {
  avatar: 0.86,
  banner: 0.84,
};

const DEFAULT_RUNTIME: ChannelArtRuntime = {
  // Channel art is rendered on Fal and independently graded by the configured
  // non-Google vision provider. Requiring a Gemini key here made a fully
  // non-Google route impossible despite having a real grader.
  hasJudge: hasVisionKey,
  renderBanner: generateFalNanoBananaBannerWithReceipt,
  renderAvatar: generateFalNanoBananaAvatarImageWithReceipt,
  makeTempDir: makeRunTempDir,
  toJpeg: imageToJpeg,
  cropCenter: cropCenterImageToJpeg,
  judge: async ({ prompt, imagePaths }) => {
    const raw = await visionLocal({
      prompt,
      imagePaths,
      json: true,
      maxTokens: VISION_GATE_MAX_TOKENS,
    });
    return parseJsonLoose(raw);
  },
  readBytes: async (path) => {
    const { readFile } = await import("node:fs/promises");
    return new Uint8Array(await readFile(path));
  },
  writeBytes: async (path, bytes) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, bytes);
  },
  putImmutable: (key, bytes, contentType) =>
    putObject(key, bytes, { contentType, ifNoneMatch: "*" }),
  createVersion: (kind) => {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    return `${timestamp}-${kind}-${randomUUID().slice(0, 12)}`;
  },
};

function paletteClause(palette?: string[]): string {
  return palette && palette.length
    ? `color palette ${palette.slice(0, 5).join(", ")}`
    : "cohesive cinematic color palette";
}

function worldDirectionClauses(id: ArtIdentity): string[] {
  return [
    id.worldSetting ? `LOCKED CHANNEL WORLD: ${id.worldSetting}` : "",
    id.worldComposition ? `COMPOSITIONAL LANGUAGE: ${id.worldComposition}` : "",
    id.worldMotifs?.length
      ? `RECURRING WORLD ANCHORS: ${id.worldMotifs.slice(0, 6).join("; ")}`
      : "",
    id.visualAvoid?.length
      ? `DO NOT INTRODUCE: ${id.visualAvoid.slice(0, 6).join("; ")}`
      : "",
  ].filter(Boolean);
}

export function avatarPrompt(id: ArtIdentity, notes: string[] = []): string {
  return [
    `Premium YouTube channel PROFILE-PICTURE icon for "${id.name}"`,
    id.niche ? `a ${id.niche} channel` : "",
    id.iconicMotif
      ? `ICONIC MOTIF (make this the single subject): ${id.iconicMotif}`
      : (id.persona ?? ""),
    id.vibe ? `mood: ${id.vibe}` : "",
    id.styleGrammar ?? "",
    paletteClause(id.palette),
    "CRITICAL IDENTITY COMPOSITION: this is not a scene, banner, thumbnail, room, landscape, desk, " +
      "or establishing shot. Use one bold emblem or one iconic portrait only. Keep it perfectly centered; " +
      "let the subject occupy 68-78% of the square; keep every essential feature inside the central " +
      "circular crop; use no more than three dominant shapes; preserve strong silhouette, simple " +
      "negative space, and high contrast at 32-48px. Bespoke editorial identity mark with restrained " +
      "material character, never a generic glossy app icon. No text, letters, words, initials, border " +
      "ring, watermark, miniature objects, or background storytelling",
    notes.length ? `FIX every issue from the prior attempt: ${notes.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function bannerPrompt(
  id: ArtIdentity,
  notes: string[] = [],
  extra: string[] = [],
): string {
  return [
    `Wide cinematic YouTube channel banner artwork for "${id.name}"`,
    id.niche ? `a ${id.niche} channel` : "",
    id.iconicMotif ? `featuring the channel motif: ${id.iconicMotif}` : "",
    id.styleGrammar ?? id.persona ?? "",
    paletteClause(id.palette),
    ...worldDirectionClauses(id),
    ...extra,
    "YOUTUBE SAFE AREA: keep the focal subject and every essential detail inside the centered " +
      "1546x423 safe area of a 2560x1440 canvas; outer edges are atmospheric extension only",
    "DEVICE-SAFE PLACEMENT: make the complete hero intentionally compact: fit all of it inside the " +
      "central, horizontally wide middle strip, with the head no higher than 35% and the base no lower than " +
      "65% of canvas height. Leave generous breathing room above the head and below the subject; do not crop " +
      "the hero at any edge",
    "full-frame composition: artwork must fill every pixel of the canvas edge-to-edge; " +
      "no letterbox bars, pillarbox bars, black matte, empty framing strips, image-in-image frame, " +
      "or border. Cinematic depth, clear focal hierarchy, high production value, absolutely no text, " +
      "no letters, no words, no typography, no watermark",
    notes.length ? `FIX every issue from the prior attempt: ${notes.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function judgePrompt(kind: ArtKind, id: ArtIdentity): string {
  if (kind === "avatar") {
    return [
      `Judge this YouTube avatar for "${id.name}". Image 1 is the centered square crop; image 2 is`,
      "the same art downsampled to 48px and enlarged for inspection. YouTube displays it as a circle.",
      "Pass only when the subject remains instantly recognizable at tiny size, its face/front is",
      "centered with all essential detail inside the circular crop, contrast is strong, and there is",
      "no visible text or lettering. Reject miniature scenes, rooms, desks, landscapes, city views,",
      "multi-object storytelling, generic glossy app icons, and any mark that needs fine detail to",
      "explain itself. Return strict JSON:",
      '{"score":0..1,"circleSafe":boolean,"tinyLegible":boolean,"singleMark":boolean,"noScene":boolean,"noText":boolean,"issues":string[]}',
    ].join(" ");
  }
  return [
    `Judge this YouTube banner for "${id.name}". Image 1 is the full 16:9 banner; image 2 is the`,
    "centered 1546x423-equivalent safe-area crop seen across devices. Pass only when the focal",
    "subject and all essential information survive inside that crop, the composition is clean and",
    "channel-specific, and artwork fills the canvas edge-to-edge without letterbox/pillarbox bars, a",
    "black matte, empty framing strips, or image-in-image framing. Neither image may contain text,",
    "letters, watermarking, or fake typography.",
    "Return strict JSON:",
    '{"score":0..1,"safeArea":boolean,"edgeToEdge":boolean,"noText":boolean,"issues":string[]}',
  ].join(" ");
}

function parseCritique(kind: ArtKind, raw: unknown): {
  score: number;
  pass: boolean;
  issues: string[];
} {
  const parsed = typeof raw === "string" ? parseJsonLoose(raw) : raw;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`channelArt: ${kind} judge returned no structured verdict`);
  }
  const verdict = parsed as Record<string, unknown>;
  if (typeof verdict.score !== "number" || !Number.isFinite(verdict.score)) {
    throw new Error(`channelArt: ${kind} judge returned an invalid score`);
  }
  const score = Math.max(0, Math.min(1, verdict.score));
  const checks = kind === "avatar"
    ? (["circleSafe", "tinyLegible", "singleMark", "noScene", "noText"] as const)
    : (["safeArea", "edgeToEdge", "noText"] as const);
  const failedChecks = checks.filter((check) => verdict[check] !== true);
  const issues = Array.isArray(verdict.issues)
    ? verdict.issues.filter((issue): issue is string => typeof issue === "string").slice(0, 6)
    : [];
  for (const check of failedChecks) issues.push(`${check} check failed or was omitted`);
  const pass = failedChecks.length === 0 && score >= SCORE_THRESHOLD[kind];
  return { score, pass, issues };
}

function cleanVersion(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) throw new Error("channelArt: version must contain a letter or number");
  return cleaned.slice(0, 96);
}

function versionFor(kind: ArtKind, options: ChannelArtOptions, runtime: ChannelArtRuntime): string {
  const configured = typeof options.version === "string"
    ? options.version
    : options.version?.[kind];
  return cleanVersion(configured ?? runtime.createVersion(kind));
}

function preserves(kind: ArtKind, option: ChannelArtOptions["preserveExisting"]): boolean {
  return typeof option === "boolean" ? option : option?.[kind] === true;
}

function manifestBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function prepareCandidate(
  kind: ArtKind,
  candidate: ArtCandidate,
  runtime: ChannelArtRuntime,
): Promise<ArtCandidate> {
  if (kind === "avatar") {
    const square = candidate.sourcePath.replace(/\.png$/, "-square.jpg");
    const tiny = candidate.sourcePath.replace(/\.png$/, "-tiny48.jpg");
    const shown = candidate.sourcePath.replace(/\.png$/, "-tiny-shown.jpg");
    await runtime.toJpeg(candidate.sourcePath, square, 1024, 1024);
    await runtime.toJpeg(square, tiny, 48, 48);
    await runtime.toJpeg(tiny, shown, 256, 256);
    return { ...candidate, judgedPaths: [square, shown] };
  }

  const full = candidate.sourcePath.replace(/\.png$/, "-full.jpg");
  const safe = candidate.sourcePath.replace(/\.png$/, "-safe-area.jpg");
  await runtime.toJpeg(candidate.sourcePath, full, 1280, 720);
  // Crop the physical 1546/2560 x 423/1440 device-safe region from the
  // normalized full canvas. Resizing directly to this ratio would grade a
  // much taller central band than YouTube actually shows on every device.
  await runtime.cropCenter(full, safe, 773, 212);
  return { ...candidate, judgedPaths: [full, safe] };
}

async function directNanoBananaBanner(args: {
  ownerId: string;
  slug: string;
  identity: ArtIdentity;
  version: string;
  maxAttempts: number;
  prompt: (issues: string[]) => string;
  runtime: ChannelArtRuntime;
  log: Logger;
}): Promise<AcceptedArt> {
  const { ownerId, slug, identity, version, runtime, log } = args;
  if (!runtime.hasJudge()) throw new Error("channelArt: banner quality judge is unavailable; refusing to generate");

  const prefix = channelKey(ownerId, slug, `art/banner/${version}`);
  const temp = await runtime.makeTempDir(`channel-art-${slug}-banner`);
  const candidates: Array<ArtCandidate & { receipt: FalNanoBananaBannerReceipt }> = [];

  let loop: Awaited<ReturnType<typeof produceAndCritique<ArtCandidate & {
    receipt: FalNanoBananaBannerReceipt;
  }>>>;
  try {
    loop = await produceAndCritique<ArtCandidate & { receipt: FalNanoBananaBannerReceipt }>({
      label: "channel-art-banner",
      threshold: SCORE_THRESHOLD.banner,
      maxIters: args.maxAttempts,
      log,
      produce: async (priorIssues, attempt) => {
        const id = `banner-candidate-${String(attempt).padStart(2, "0")}`;
        const generated = await runtime.renderBanner({
          prompt: args.prompt(priorIssues),
          idempotencyContext: `${ownerId}/${slug}/art/banner/${version}/${id}`,
        });
        const sourceKey = `${prefix}/${id}.source`;
        await runtime.putImmutable(sourceKey, generated.bytes, generated.receipt.sourceContentType);
        await runtime.putImmutable(`${prefix}/${id}.receipt.json`, manifestBytes(generated.receipt), "application/json");
        const sourcePath = join(temp, `${id}.png`);
        await runtime.writeBytes(sourcePath, generated.bytes);
        const candidate = {
          ...(await prepareCandidate("banner", {
            key: sourceKey,
            url: "",
            sourcePath,
            judgedPaths: [],
            attempt,
          }, runtime)),
          receipt: generated.receipt,
        };
        candidates.push(candidate);
        return candidate;
      },
      critique: async (candidate) => parseCritique("banner", await runtime.judge({
        kind: "banner",
        prompt: judgePrompt("banner", identity),
        imagePaths: candidate.judgedPaths,
      })),
    });
  } catch (error) {
    if (candidates.length > 0) {
      await runtime.putImmutable(`${prefix}/rejection.json`, manifestBytes({
        schemaVersion: 2,
        status: "rejected",
        kind: "banner",
        contractVersion: FAL_NANO_BANANA_BANNER_PROFILE.contractVersion,
        providerRoute: FAL_NANO_BANANA_BANNER_PROFILE.route,
        version,
        error: error instanceof Error ? error.message : String(error),
        candidates: candidates.map(({ key, attempt, receipt }) => ({ key, attempt, responseSha256: receipt.responseSha256 })),
      }), "application/json");
    }
    throw error;
  }

  if (!loop.accepted) {
    await runtime.putImmutable(`${prefix}/rejection.json`, manifestBytes({
      schemaVersion: 2,
      status: "rejected",
      kind: "banner",
      contractVersion: FAL_NANO_BANANA_BANNER_PROFILE.contractVersion,
      providerRoute: FAL_NANO_BANANA_BANNER_PROFILE.route,
      version,
      threshold: SCORE_THRESHOLD.banner,
      candidates: candidates.map((candidate, index) => ({
        key: candidate.key,
        attempt: candidate.attempt,
        responseSha256: candidate.receipt.responseSha256,
        critique: loop.history[index],
      })),
    }), "application/json");
    throw new Error(`channelArt: banner rejected after ${loop.iterations} attempts (best score ${loop.critique.score.toFixed(2)})`);
  }

  const selectedKey = `${prefix}/approved.jpg`;
  await runtime.putImmutable(selectedKey, await runtime.readBytes(loop.value.judgedPaths[0]), "image/jpeg");
  await runtime.putImmutable(`${prefix}/approval.json`, manifestBytes({
    schemaVersion: 2,
    status: "approved",
    kind: "banner",
    contractVersion: FAL_NANO_BANANA_BANNER_PROFILE.contractVersion,
    providerRoute: FAL_NANO_BANANA_BANNER_PROFILE.route,
    version,
    threshold: SCORE_THRESHOLD.banner,
    score: loop.critique.score,
    attempts: loop.iterations,
    sourceKey: loop.value.key,
    outputKey: selectedKey,
    providerReceipt: loop.value.receipt,
    candidates: candidates.map((candidate, index) => ({
      key: candidate.key,
      attempt: candidate.attempt,
      responseSha256: candidate.receipt.responseSha256,
      critique: loop.history[index],
    })),
  }), "application/json");

  log("channelArt: banner approved", {
    version,
    providerRoute: FAL_NANO_BANANA_BANNER_PROFILE.route,
    score: loop.critique.score,
    attempts: loop.iterations,
    sourceKey: loop.value.key,
    outputKey: selectedKey,
  });
  return { key: selectedKey, sourceKey: loop.value.key, score: loop.critique.score, attempts: loop.iterations };
}

async function directNanoBananaAvatar(args: {
  ownerId: string;
  slug: string;
  identity: ArtIdentity;
  version: string;
  maxAttempts: number;
  runtime: ChannelArtRuntime;
  log: Logger;
}): Promise<AcceptedArt> {
  const { ownerId, slug, identity, version, runtime, log } = args;
  if (!runtime.hasJudge()) {
    throw new Error("channelArt: avatar quality judge is unavailable; refusing to generate");
  }

  const prefix = channelKey(ownerId, slug, `art/avatar/${version}`);
  const temp = await runtime.makeTempDir(`channel-art-${slug}-avatar`);
  const candidates: Array<ArtCandidate & { receipt: NanoBananaAvatarReceipt }> = [];

  let loop: Awaited<ReturnType<typeof produceAndCritique<ArtCandidate & {
    receipt: NanoBananaAvatarReceipt;
  }>>>;
  try {
    loop = await produceAndCritique<ArtCandidate & { receipt: NanoBananaAvatarReceipt }>({
      label: "channel-art-avatar",
      threshold: SCORE_THRESHOLD.avatar,
      maxIters: args.maxAttempts,
      log,
      produce: async (priorIssues, attempt) => {
        const id = `avatar-candidate-${String(attempt).padStart(2, "0")}`;
        const generated = await runtime.renderAvatar({
          prompt: avatarPrompt(identity, priorIssues),
          idempotencyContext: `${ownerId}/${slug}/art/avatar/${version}/${id}`,
        });
        const sourceKey = `${prefix}/${id}.source`;
        const receiptKey = `${prefix}/${id}.receipt.json`;
        await runtime.putImmutable(
          sourceKey,
          generated.bytes,
          generated.receipt.sourceContentType,
        );
        await runtime.putImmutable(
          receiptKey,
          manifestBytes(generated.receipt),
          "application/json",
        );
        const sourcePath = join(temp, `${id}.png`);
        await runtime.writeBytes(sourcePath, generated.bytes);
        const candidate = {
          ...(await prepareCandidate("avatar", {
            key: sourceKey,
            url: "",
            sourcePath,
            judgedPaths: [],
            attempt,
          }, runtime)),
          receipt: generated.receipt,
        };
        candidates.push(candidate);
        return candidate;
      },
      critique: async (candidate) => parseCritique("avatar", await runtime.judge({
        kind: "avatar",
        prompt: judgePrompt("avatar", identity),
        imagePaths: candidate.judgedPaths,
      })),
    });
  } catch (error) {
    if (candidates.length > 0) {
      await runtime.putImmutable(
        `${prefix}/rejection.json`,
        manifestBytes({
          schemaVersion: 2,
          status: "rejected",
          kind: "avatar",
          providerRoute: NANO_BANANA_AVATAR_PROFILE.route,
          version,
          error: error instanceof Error ? error.message : String(error),
          candidates: candidates.map(({ key, attempt, receipt }) => ({
            key,
            attempt,
            responseSha256: receipt.responseSha256,
          })),
        }),
        "application/json",
      );
    }
    throw error;
  }

  if (!loop.accepted) {
    await runtime.putImmutable(
      `${prefix}/rejection.json`,
      manifestBytes({
        schemaVersion: 2,
        status: "rejected",
        kind: "avatar",
        providerRoute: NANO_BANANA_AVATAR_PROFILE.route,
        version,
        threshold: SCORE_THRESHOLD.avatar,
        candidates: candidates.map((candidate, index) => ({
          key: candidate.key,
          attempt: candidate.attempt,
          responseSha256: candidate.receipt.responseSha256,
          critique: loop.history[index],
        })),
      }),
      "application/json",
    );
    throw new Error(
      `channelArt: avatar rejected after ${loop.iterations} attempts (best score ${loop.critique.score.toFixed(2)})`,
    );
  }

  const selectedKey = `${prefix}/approved.jpg`;
  await runtime.putImmutable(
    selectedKey,
    await runtime.readBytes(loop.value.judgedPaths[0]),
    "image/jpeg",
  );
  await runtime.putImmutable(
    `${prefix}/approval.json`,
    manifestBytes({
      schemaVersion: 2,
      status: "approved",
      kind: "avatar",
      contractVersion: NANO_BANANA_AVATAR_PROFILE.contractVersion,
      providerRoute: NANO_BANANA_AVATAR_PROFILE.route,
      version,
      threshold: SCORE_THRESHOLD.avatar,
      score: loop.critique.score,
      attempts: loop.iterations,
      sourceKey: loop.value.key,
      outputKey: selectedKey,
      providerReceipt: loop.value.receipt,
      candidates: candidates.map((candidate, index) => ({
        key: candidate.key,
        attempt: candidate.attempt,
        responseSha256: candidate.receipt.responseSha256,
        critique: loop.history[index],
      })),
    }),
    "application/json",
  );

  log("channelArt: avatar approved", {
    version,
    providerRoute: NANO_BANANA_AVATAR_PROFILE.route,
    score: loop.critique.score,
    attempts: loop.iterations,
    sourceKey: loop.value.key,
    outputKey: selectedKey,
  });
  return {
    key: selectedKey,
    sourceKey: loop.value.key,
    score: loop.critique.score,
    attempts: loop.iterations,
  };
}

function validateSelection(options: ChannelArtOptions): void {
  if (options.avatar === false && !options.existing?.imageKey) {
    throw new Error("channelArt: avatar=false requires existing.imageKey");
  }
  if (options.banner === false && !options.existing?.bannerKey) {
    throw new Error("channelArt: banner=false requires existing.bannerKey");
  }
}

function nanoBananaProviderAdmission(args: {
  kind: "avatar" | "banner";
  maxAttempts: number;
  options: ChannelArtOptions;
  runtime: ChannelArtRuntime;
}): void {
  if (args.runtime !== DEFAULT_RUNTIME) return;
  if (args.options.maxProviderSpendUsd === undefined) {
    throw new Error(`channelArt: ${args.kind} requires an explicit aggregate provider budget before paid generation`);
  }
  const ceiling = args.kind === "avatar"
    ? NANO_BANANA_AVATAR_PROFILE.admissionCeilingUsd
    : FAL_NANO_BANANA_BANNER_PROFILE.admissionCeilingUsd;
  const required = Number((
    args.maxAttempts * ceiling
  ).toFixed(9));
  if (args.options.maxProviderSpendUsd + Number.EPSILON < required) {
    throw new Error(
      `channelArt: ${args.kind} budget $${args.options.maxProviderSpendUsd.toFixed(3)} is below ` +
        `the ${args.maxAttempts}-attempt Nano Banana ceiling $${required.toFixed(3)}`,
    );
  }
}

/**
 * Generate one independently leased art asset. Channel Inception uses this so
 * avatar and banner provider spend is checkpointed under the correct stage.
 */
export async function generateChannelArtAsset(
  ownerId: string,
  slug: string,
  kind: ArtKind,
  identity: ArtIdentity,
  log: Logger = () => {},
  options: ChannelArtOptions = {},
): Promise<string> {
  const existingKey = kind === "avatar" ? options.existing?.imageKey : options.existing?.bannerKey;
  if (preserves(kind, options.preserveExisting) && existingKey) return existingKey;
  const runtime = options.runtime ?? DEFAULT_RUNTIME;
  if (!runtime.hasJudge()) {
    throw new Error("channelArt: quality judge is unavailable; refusing paid generation");
  }
  const version = versionFor(kind, options, runtime);
  const maxAttempts = Math.max(1, Math.min(4, options.maxAttempts ?? 3));
  if (kind === "avatar") {
    nanoBananaProviderAdmission({ kind, maxAttempts, options, runtime });
    log("channelArt: generating versioned avatar through Fal Nano Banana", { version });
    return (await directNanoBananaAvatar({
      ownerId,
      slug,
      identity,
      version,
      maxAttempts,
      runtime,
      log,
    })).key;
  }
  nanoBananaProviderAdmission({ kind, maxAttempts, options, runtime });
  log("channelArt: generating versioned banner through Fal Nano Banana", { version });
  return (await directNanoBananaBanner({
    ownerId,
    slug,
    identity,
    version,
    maxAttempts,
    prompt: (issues) => bannerPrompt(identity, issues),
    runtime,
    log,
  })).key;
}

export async function generateChannelArt(
  ownerId: string,
  slug: string,
  identity: ArtIdentity,
  log: Logger = () => {},
  options: ChannelArtOptions = {},
): Promise<ChannelArtResult> {
  validateSelection(options);
  const runtime = options.runtime ?? DEFAULT_RUNTIME;
  const maxAttempts = Math.max(1, Math.min(4, options.maxAttempts ?? 3));
  const existing = options.existing ?? {};

  const generateAvatar = options.avatar !== false && !(
    preserves("avatar", options.preserveExisting) && existing.imageKey
  );
  const generateBanner = options.banner !== false && !(
    preserves("banner", options.preserveExisting) && existing.bannerKey
  );

  // Validate the judge before making either paid request. Preserved-only calls do
  // not need a judge and are safe even during provider outages.
  if ((generateAvatar || generateBanner) && !runtime.hasJudge()) {
    throw new Error("channelArt: quality judge is unavailable; refusing paid generation");
  }

  let imageKey = existing.imageKey;
  let bannerKey = existing.bannerKey;

  // Sequential by design: if the avatar fails closed, do not spend on a banner.
  if (generateAvatar) {
    const version = versionFor("avatar", options, runtime);
    log("channelArt: generating versioned avatar through Fal Nano Banana", { version });
    nanoBananaProviderAdmission({ kind: "avatar", maxAttempts, options, runtime });
    imageKey = (await directNanoBananaAvatar({
      ownerId,
      slug,
      identity,
      version,
      maxAttempts,
      runtime,
      log,
    })).key;
  }

  if (generateBanner) {
    const version = versionFor("banner", options, runtime);
    log("channelArt: generating versioned banner through Fal Nano Banana", { version });
    nanoBananaProviderAdmission({ kind: "banner", maxAttempts, options, runtime });
    bannerKey = (await directNanoBananaBanner({
      ownerId,
      slug,
      identity,
      version,
      maxAttempts,
      prompt: (issues) => bannerPrompt(identity, issues),
      runtime,
      log,
    })).key;
  }

  if (!imageKey || !bannerKey) {
    throw new Error("channelArt: generation completed without both avatar and banner keys");
  }
  return { imageKey, bannerKey };
}

/** Generate a localized banner without touching the channel avatar. */
export async function generateFlagBanner(
  ownerId: string,
  slug: string,
  identity: ArtIdentity,
  country: string,
  log: Logger = () => {},
  options: Pick<ChannelArtOptions, "version" | "maxAttempts" | "runtime" | "maxProviderSpendUsd"> = {},
): Promise<string> {
  const runtime = options.runtime ?? DEFAULT_RUNTIME;
  if (!runtime.hasJudge()) {
    throw new Error("channelArt: banner quality judge is unavailable; refusing paid generation");
  }
  const version = versionFor("banner", options, runtime);
  const maxAttempts = Math.max(1, Math.min(4, options.maxAttempts ?? 3));
  nanoBananaProviderAdmission({ kind: "banner", maxAttempts, options, runtime });
  const result = await directNanoBananaBanner({
    ownerId,
    slug,
    identity,
    version,
    maxAttempts,
    prompt: (issues) => bannerPrompt(identity, issues, [
      `a softly defocused waving flag of ${country} extending through the atmospheric background`,
      "keep flag detail subtle so the centered channel motif remains dominant and safe-area legible",
    ]),
    runtime,
    log,
  });
  return result.key;
}
