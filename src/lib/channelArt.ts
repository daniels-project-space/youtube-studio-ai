/**
 * Production channel-art generation.
 *
 * Avatar and banner are independent, versioned Imagecraft jobs. Every generated
 * candidate is durable in R2 before it is judged; only an accepted candidate is
 * returned. The selected avatar is additionally center-cropped to a square and
 * written with an immutable key after it passes both the full-size and tiny-icon
 * checks. There is deliberately no provider fallback in this module.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { produceAndCritique } from "@/engine/critiqueLoop";
import { PRICE } from "@/engine/pricing";
import { downloadTo, makeRunTempDir } from "@/lib/files";
import { imageToJpeg } from "@/lib/ffmpeg";
import { parseJsonLoose } from "@/lib/gemini";
import { renderNovitaImage, type NovitaRenderLifecycle } from "@/lib/novitaMedia";
import { novitaCostEnvelope } from "@/lib/novitaCostEnvelope";
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
}

export interface ChannelArtResult {
  imageKey: string;
  bannerKey: string;
}

export interface ChannelArtRenderRequest {
  prefix: string;
  id: string;
  prompt: string;
  negativePrompt: string;
  profileId: "production";
  /** Exact one-image worker ceiling; never a channel or stage aggregate. */
  maxCostUsd: number;
  lifecycle?: NovitaRenderLifecycle;
}

export interface ChannelArtRuntime {
  hasJudge(): boolean;
  renderImage(request: ChannelArtRenderRequest): Promise<{ url: string; key: string }>;
  download(url: string, path: string): Promise<unknown>;
  makeTempDir(prefix: string): Promise<string>;
  toJpeg(input: string, output: string, width: number, height: number): Promise<unknown>;
  judge(request: { kind: ArtKind; prompt: string; imagePaths: string[] }): Promise<unknown>;
  readBytes(path: string): Promise<Uint8Array>;
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
  /**
   * Explicit aggregate admission for one generated asset. The default Novita
   * runtime reserves every potential critique iteration before its first
   * image worker; a missing/undersized envelope is a zero-spend failure.
   */
  maxProviderSpendUsd?: number;
  /** Durable owner/run/stage identity required by the direct Novita worker. */
  providerLifecycle?: NovitaRenderLifecycle;
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

const NEGATIVE_PROMPT: Record<ArtKind, string> = {
  avatar:
    "text, words, letters, logo typography, watermark, multiple subjects, off-center subject, " +
    "wide shot, full body, tiny face, cropped face, clutter, murky lighting, low contrast",
  banner:
    "text, words, letters, captions, logo typography, watermark, busy center, important subject " +
    "outside the central safe area, clutter, low contrast, collage, split screen",
};

const DEFAULT_RUNTIME: ChannelArtRuntime = {
  // Channel art is rendered on Novita and independently graded by the
  // configured non-Google vision provider. Requiring a Gemini key here made a
  // fully non-Google route impossible despite having a real grader.
  hasJudge: hasVisionKey,
  renderImage: async (request) => {
    const rendered = await renderNovitaImage(request);
    return { url: rendered.url, key: rendered.key };
  },
  download: downloadTo,
  makeTempDir: makeRunTempDir,
  toJpeg: imageToJpeg,
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
    "CRITICAL COMPOSITION: one bold subject, face/front perfectly centered, symmetrical, tight " +
      "head-and-shoulders framing, all essential detail inside the central circular crop, strong " +
      "silhouette and contrast at 48px, bright legible focal lighting, no text, no letters, no words",
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
    ...extra,
    "YOUTUBE SAFE AREA: keep the focal subject and every essential detail inside the centered " +
      "1546x423 safe area of a 2560x1440 canvas; outer edges are atmospheric extension only",
    "wide 16:9 establishing composition, cinematic depth, clear focal hierarchy, high production " +
      "value, absolutely no text, no letters, no words, no typography, no watermark",
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
      "no visible text or lettering. Return strict JSON:",
      '{"score":0..1,"circleSafe":boolean,"tinyLegible":boolean,"noText":boolean,"issues":string[]}',
    ].join(" ");
  }
  return [
    `Judge this YouTube banner for "${id.name}". Image 1 is the full 16:9 banner; image 2 is the`,
    "centered 1546x423-equivalent safe-area crop seen across devices. Pass only when the focal",
    "subject and all essential information survive inside that crop, the composition is clean and",
    "channel-specific, and neither image contains text, letters, watermarking, or fake typography.",
    "Return strict JSON:",
    '{"score":0..1,"safeArea":boolean,"noText":boolean,"issues":string[]}',
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
    ? (["circleSafe", "tinyLegible", "noText"] as const)
    : (["safeArea", "noText"] as const);
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
  // 1546/2560 x 423/1440, scaled onto a 1280x720 working canvas.
  await runtime.toJpeg(candidate.sourcePath, safe, 773, 212);
  return { ...candidate, judgedPaths: [full, safe] };
}

async function directArt(args: {
  ownerId: string;
  slug: string;
  kind: ArtKind;
  identity: ArtIdentity;
  version: string;
  maxAttempts: number;
  prompt: (issues: string[]) => string;
  runtime: ChannelArtRuntime;
  imageWorkerMaxCostUsd: number;
  lifecycle?: NovitaRenderLifecycle;
  log: Logger;
}): Promise<AcceptedArt> {
  const { ownerId, slug, kind, identity, version, runtime, log } = args;
  if (!runtime.hasJudge()) {
    throw new Error(`channelArt: ${kind} quality judge is unavailable; refusing to generate`);
  }

  const prefix = channelKey(ownerId, slug, `art/${kind}/${version}`);
  const expectedKeyPrefix = `imagecraft/${prefix.replace(/^\/+|\/+$/g, "")}/`;
  const temp = await runtime.makeTempDir(`channel-art-${slug}-${kind}`);
  const candidates: ArtCandidate[] = [];

  let loop: Awaited<ReturnType<typeof produceAndCritique<ArtCandidate>>>;
  try {
    loop = await produceAndCritique<ArtCandidate>({
      label: `channel-art-${kind}`,
      threshold: SCORE_THRESHOLD[kind],
      maxIters: args.maxAttempts,
      log,
      produce: async (priorIssues, attempt) => {
        const id = `${kind}-candidate-${String(attempt).padStart(2, "0")}`;
        const rendered = await runtime.renderImage({
          prefix,
          id,
          prompt: args.prompt(priorIssues),
          negativePrompt: NEGATIVE_PROMPT[kind],
          profileId: "production",
          maxCostUsd: args.imageWorkerMaxCostUsd,
          lifecycle: args.lifecycle,
        });
        if (!rendered.key.startsWith(expectedKeyPrefix)) {
          throw new Error(`channelArt: ${kind} renderer escaped its versioned Imagecraft namespace`);
        }
        const sourcePath = join(temp, `${id}.png`);
        await runtime.download(rendered.url, sourcePath);
        const candidate = await prepareCandidate(kind, {
          key: rendered.key,
          url: rendered.url,
          sourcePath,
          judgedPaths: [],
          attempt,
        }, runtime);
        candidates.push(candidate);
        return candidate;
      },
      critique: async (candidate) => parseCritique(kind, await runtime.judge({
        kind,
        prompt: judgePrompt(kind, identity),
        imagePaths: candidate.judgedPaths,
      })),
    });
  } catch (error) {
    if (candidates.length > 0) {
      await runtime.putImmutable(
        channelKey(ownerId, slug, `art/${kind}/${version}/rejection.json`),
        manifestBytes({
          schemaVersion: 1,
          status: "rejected",
          kind,
          version,
          error: error instanceof Error ? error.message : String(error),
          candidates: candidates.map(({ key, attempt }) => ({ key, attempt })),
        }),
        "application/json",
      );
    }
    throw error;
  }

  if (!loop.accepted) {
    await runtime.putImmutable(
      channelKey(ownerId, slug, `art/${kind}/${version}/rejection.json`),
      manifestBytes({
        schemaVersion: 1,
        status: "rejected",
        kind,
        version,
        threshold: SCORE_THRESHOLD[kind],
        candidates: candidates.map((candidate, index) => ({
          key: candidate.key,
          attempt: candidate.attempt,
          critique: loop.history[index],
        })),
      }),
      "application/json",
    );
    throw new Error(
      `channelArt: ${kind} rejected after ${loop.iterations} attempts (best score ${loop.critique.score.toFixed(2)})`,
    );
  }

  let selectedKey = loop.value.key;
  if (kind === "avatar") {
    const squarePath = loop.value.judgedPaths[0];
    selectedKey = channelKey(ownerId, slug, `art/avatar/${version}/approved.jpg`);
    await runtime.putImmutable(
      selectedKey,
      await runtime.readBytes(squarePath),
      "image/jpeg",
    );
  }

  await runtime.putImmutable(
    channelKey(ownerId, slug, `art/${kind}/${version}/approval.json`),
    manifestBytes({
      schemaVersion: 1,
      status: "approved",
      kind,
      version,
      threshold: SCORE_THRESHOLD[kind],
      score: loop.critique.score,
      attempts: loop.iterations,
      sourceKey: loop.value.key,
      outputKey: selectedKey,
      candidates: candidates.map((candidate, index) => ({
        key: candidate.key,
        attempt: candidate.attempt,
        critique: loop.history[index],
      })),
    }),
    "application/json",
  );

  log(`channelArt: ${kind} approved`, {
    version,
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

/**
 * The default runtime owns real Novita workers. A fake/injected test runtime
 * is deliberately excluded so deterministic unit tests need not manufacture a
 * cloud lease, while every production call must carry a stage-signed envelope.
 */
function providerAdmission(
  args: {
    kind: ArtKind;
    maxAttempts: number;
    options: ChannelArtOptions;
    runtime: ChannelArtRuntime;
  },
): { imageWorkerMaxCostUsd: number; lifecycle?: NovitaRenderLifecycle } {
  if (args.runtime !== DEFAULT_RUNTIME) {
    return { imageWorkerMaxCostUsd: PRICE.novitaImageMaxUsd };
  }
  if (!args.options.providerLifecycle) {
    throw new Error(`channelArt: ${args.kind} requires an explicit provider lifecycle before paid generation`);
  }
  if (args.options.maxProviderSpendUsd === undefined) {
    throw new Error(`channelArt: ${args.kind} requires an explicit aggregate provider budget before paid generation`);
  }
  novitaCostEnvelope({
    label: `channel art ${args.kind}`,
    imageJobs: args.maxAttempts,
    maxCostUsd: args.options.maxProviderSpendUsd,
  });
  return {
    imageWorkerMaxCostUsd: PRICE.novitaImageMaxUsd,
    lifecycle: args.options.providerLifecycle,
  };
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
  const admission = providerAdmission({ kind, maxAttempts, options, runtime });
  log(`channelArt: generating versioned ${kind} through Novita Imagecraft`, { version });
  return (await directArt({
    ownerId,
    slug,
    kind,
    identity,
    version,
    maxAttempts,
    prompt: (issues) => kind === "avatar"
      ? avatarPrompt(identity, issues)
      : bannerPrompt(identity, issues),
    runtime,
    ...admission,
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
    log("channelArt: generating versioned avatar through Novita Imagecraft", { version });
    const admission = providerAdmission({ kind: "avatar", maxAttempts, options, runtime });
    imageKey = (await directArt({
      ownerId,
      slug,
      kind: "avatar",
      identity,
      version,
      maxAttempts,
      prompt: (issues) => avatarPrompt(identity, issues),
      runtime,
      ...admission,
      log,
    })).key;
  }

  if (generateBanner) {
    const version = versionFor("banner", options, runtime);
    log("channelArt: generating versioned banner through Novita Imagecraft", { version });
    const admission = providerAdmission({ kind: "banner", maxAttempts, options, runtime });
    bannerKey = (await directArt({
      ownerId,
      slug,
      kind: "banner",
      identity,
      version,
      maxAttempts,
      prompt: (issues) => bannerPrompt(identity, issues),
      runtime,
      ...admission,
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
  options: Pick<ChannelArtOptions, "version" | "maxAttempts" | "runtime" | "maxProviderSpendUsd" | "providerLifecycle"> = {},
): Promise<string> {
  const runtime = options.runtime ?? DEFAULT_RUNTIME;
  if (!runtime.hasJudge()) {
    throw new Error("channelArt: banner quality judge is unavailable; refusing paid generation");
  }
  const version = versionFor("banner", options, runtime);
  const maxAttempts = Math.max(1, Math.min(4, options.maxAttempts ?? 3));
  const admission = providerAdmission({ kind: "banner", maxAttempts, options, runtime });
  const result = await directArt({
    ownerId,
    slug,
    kind: "banner",
    identity,
    version,
    maxAttempts,
    prompt: (issues) => bannerPrompt(identity, issues, [
      `a softly defocused waving flag of ${country} extending through the atmospheric background`,
      "keep flag detail subtle so the centered channel motif remains dominant and safe-area legible",
    ]),
    runtime,
    ...admission,
    log,
  });
  return result.key;
}
