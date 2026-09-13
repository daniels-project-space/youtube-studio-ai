import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertPlanWeekThumbnailSource,
  type PlanWeekThumbnailSource,
} from "@/lib/planWeekThumbnailSource";
import type { CraftedHook } from "@/lib/hookcraft";
import {
  assertNarrationPerformanceEvidence,
  type NarrationPerformanceEvidence,
} from "@/lib/narrationPerformance";
import type { Script } from "@/lib/scriptGen";
import { sha256Hex } from "@/lib/sha256";
import {
  ChannelMusicProgramSchema,
  type ChannelMusicProgram,
} from "@/engine/channelMusicProgram";
import {
  GeneratedFootageSceneManifestSchema,
  type GeneratedFootageSceneManifest,
} from "@/engine/generatedFootageManifest";
import {
  MINIMAX_H3_WORKER_CONTRACT,
  MINIMAX_H3_MANIFEST_SHA256,
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
  miniMaxH3RequestKey,
  type MiniMaxH3Receipt,
  type MiniMaxH3Provider,
  type MiniMaxH3Execution,
} from "@/lib/minimaxH3";
import { SALAD_HIGH_FALLBACK_PRIORITY } from "@/lib/saladCloud";

/**
 * The provider-free first stage of weekly batch preparation.  It is deliberately
 * not called a render: it freezes the exact editorial and channel inputs that
 * later script, shot-list, ERNIE and H3 visual work must consume.
 */
export const PLAN_WEEK_PREPARATION_VERSION = "plan-week-preparation/inputs-v1" as const;

export interface PlanWeekPreparationManifest {
  version: typeof PLAN_WEEK_PREPARATION_VERSION;
  ownerId: string;
  channelId: string;
  batchId: string;
  itemId: string;
  itemKey: string;
  requestKey: string;
  channelSlug: string;
  frozenAt: number;
  plan: {
    topic: string;
    title: string;
    description: string;
    sceneSeed: string;
    thumbnailKey: string;
    /**
     * `rendered_video_frame` deliberately reserves the eventual artifact path
     * without pretending that artwork exists before the final video does.
     */
    thumbnailSource: PlanWeekThumbnailSource;
  };
  /**
   * This is the non-secret input surface actually available to the execution
   * graph. Publish credentials and live YouTube policy intentionally remain
   * outside the packet and are rechecked at their side-effect boundary.
   */
  execution: {
    pipeline: unknown[];
    moduleConfig: Record<string, Record<string, unknown>>;
    seedStore: Record<string, unknown>;
  };
  /** Deterministic hand-off prompts for later, receipt-backed batch workers. */
  prompts: {
    script: string;
    narration: string;
    shotlist: string;
    visual: string;
  };
}

export interface PlanWeekPreparationPointer {
  version: typeof PLAN_WEEK_PREPARATION_VERSION;
  manifestKey: string;
  manifestSha256: string;
}

export const PLAN_WEEK_PREPARED_SCRIPT_VERSION = "plan-week-prepared-script/v1" as const;

/**
 * A separately written, content-addressed output of the week-ahead script
 * worker. It is deliberately a sidecar rather than a mutable field on the
 * frozen preparation manifest: the manifest freezes what may be made, while
 * this receipt proves the exact completed result before scheduled execution
 * is permitted to reuse it.
 */
export interface PlanWeekPreparedScript {
  version: typeof PLAN_WEEK_PREPARED_SCRIPT_VERSION;
  manifestSha256: string;
  ownerId: string;
  channelId: string;
  batchId: string;
  itemId: string;
  requestKey: string;
  topic: string;
  script: Script;
  scriptSha256: string;
  createdAt: number;
}

export const PLAN_WEEK_PREPARED_NARRATION_VERSION = "plan-week-prepared-narration/v1" as const;

export interface PlanWeekPreparedNarration {
  version: typeof PLAN_WEEK_PREPARED_NARRATION_VERSION;
  manifestSha256: string;
  ownerId: string;
  channelId: string;
  batchId: string;
  itemId: string;
  requestKey: string;
  topic: string;
  /** Canonical normalized Script digest, not merely an equivalent topic. */
  scriptSha256: string;
  narrationKey: string;
  audioSha256: string;
  audioByteLength: number;
  narrationDurationSec: number;
  narrationTranscriptText: string;
  narrationTranscriptSha256: string;
  narrationPerformanceEvidence: NarrationPerformanceEvidence;
  sentenceTimings: Array<{ text: string; start: number; end: number }>;
  chapterPlan: Array<{ kind: "footage" | "card"; durSec: number; heading?: string }>;
  createdAt: number;
}

export const PLAN_WEEK_PREPARED_MUSIC_VERSION = "plan-week-prepared-music/v1" as const;

/**
 * A week-ahead music receipt is not the language-sibling `reuseMusicKey`
 * shortcut. It binds the exact scheduled episode, sealed sound program,
 * retained master bytes, and—where required—the MiniMax release evidence.
 */
export interface PlanWeekPreparedMusic {
  version: typeof PLAN_WEEK_PREPARED_MUSIC_VERSION;
  manifestSha256: string;
  ownerId: string;
  channelId: string;
  batchId: string;
  itemId: string;
  requestKey: string;
  topic: string;
  musicKey: string;
  audioSha256: string;
  audioByteLength: number;
  musicDurationSec: number;
  provider: "mureka" | "suno" | "minimax_music3";
  musicProgram: ChannelMusicProgram;
  /** Required only for MiniMax Music 3, and always scoped to this weekly item. */
  minimax?: {
    nativeWavKey: string;
    runtimeReceiptKey: string;
    qualityReceiptKey: string;
  };
  createdAt: number;
}

export const PLAN_WEEK_PREPARED_FOOTAGE_VERSION = "plan-week-prepared-footage/v1" as const;

/**
 * The prepared visual result keeps the renderer's ordered manifest and every
 * clip's byte identity. A bare list of R2 keys is not enough: cinematic
 * source-proof/review records and the scene order are release inputs too.
 */
export interface PlanWeekPreparedFootage {
  version: typeof PLAN_WEEK_PREPARED_FOOTAGE_VERSION;
  manifestSha256: string;
  ownerId: string;
  channelId: string;
  batchId: string;
  itemId: string;
  requestKey: string;
  topic: string;
  generatedFootageSceneManifest: GeneratedFootageSceneManifest;
  clips: Array<{
    r2Key: string;
    sha256: string;
    byteLength: number;
    durationSec: number;
  }>;
  /** Legacy field retained only for v1 LTX receipts; H3 receipts omit it. */
  ltxStyleId?: string;
  /** Explicit renderer identity prevents an H3 receipt being mistaken for LTX. */
  renderer?:
    | { kind: "ltx"; styleId: string }
    | {
        kind: "minimax-h3";
        provider: MiniMaxH3Provider;
        execution: MiniMaxH3Execution;
        runtimeId: typeof MINIMAX_H3_RUNTIME_ID;
        profileId: typeof MINIMAX_H3_PROFILE.id;
        modelManifestSha256: typeof MINIMAX_H3_MANIFEST_SHA256;
      };
  /** H3's exact first-frame/input identity for each ordered scene. */
  h3Jobs?: Array<{
    sceneId: string;
    prompt: string;
    seed: number;
    firstFrame: { r2Key: string; sha256: string };
    output: { r2Key: string };
    maxCostUsd: number;
    requestKey: string;
  }>;
  /** Worker receipts bind runtime, output bytes, and actual cost per scene. */
  h3Receipts?: MiniMaxH3Receipt[];
  createdAt: number;
}

export type PlanWeekPreparationPromptKey = keyof PlanWeekPreparationManifest["prompts"];

/**
 * Reads one prompt from the fully verified weekly packet that `runPipeline`
 * places in the invocation snapshot. A pointer-only scheduled-plan seed does
 * not contain prompts and is intentionally treated as absent; an object that
 * claims to be a packet but has a malformed prompt is a hard failure rather
 * than an invitation for a paid module to improvise a new brief.
 */
export function planWeekPreparationPrompt(
  value: unknown,
  key: PlanWeekPreparationPromptKey,
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prompts = (value as Record<string, unknown>).prompts;
  if (prompts === undefined) return undefined;
  const record = requiredRecord(prompts, "prompt packet");
  return requiredText(record[key], `${key} prompt`);
}

/**
 * R2 paths are part of the weekly item's identity, not presentation data.
 * Keep every dynamic segment a single safe path component so a malformed
 * owner/channel/item value cannot escape its canonical namespace or create a
 * second spelling of the same destination.
 */
function pathSegment(value: string, label: string): string {
  const segment = requiredText(value, label);
  if (
    segment === "." ||
    segment === ".." ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(segment)
  ) {
    throw new Error(`plan-week preparation ${label} must be one safe path segment`);
  }
  return segment;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`plan-week preparation ${label} is invalid`);
  }
  return value.trim();
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`plan-week preparation ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function jsonSafe(value: unknown, label: string): void {
  try {
    JSON.stringify(value);
  } catch (error) {
    throw new Error(
      `plan-week preparation ${label} is not JSON-safe: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function planWeekPreparationKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `${planWeekPreparationPrefix(args)}/inputs.json`;
}

/** Canonical prepared-script sidecar destination for the exact weekly item. */
export function planWeekPreparedScriptKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `${planWeekPreparationPrefix(args)}/prepared/script.json`;
}

/** Immutable receipt and audio locations for a weekly prepared narration. */
export function planWeekPreparedNarrationKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `${planWeekPreparationPrefix(args)}/prepared/narration.json`;
}

export function planWeekPreparedNarrationAudioKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `${planWeekPreparationPrefix(args)}/prepared/narration.mp3`;
}

export function planWeekPreparedMusicKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `${planWeekPreparationPrefix(args)}/prepared/music.json`;
}

export function planWeekPreparedMusicAudioKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `${planWeekPreparationPrefix(args)}/prepared/music.mp3`;
}

export function planWeekPreparedMusicNativeWavKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `${planWeekPreparationPrefix(args)}/prepared/music-native.wav`;
}

export function planWeekPreparedMusicRuntimeReceiptKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `${planWeekPreparationPrefix(args)}/prepared/music-runtime.json`;
}

export function planWeekPreparedMusicQualityReceiptKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `${planWeekPreparationPrefix(args)}/prepared/music-quality.json`;
}

export function planWeekPreparedFootageKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `${planWeekPreparationPrefix(args)}/prepared/footage.json`;
}

export function planWeekPreparedFootageClipKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
  index: number;
}): string {
  if (!Number.isSafeInteger(args.index) || args.index < 0 || args.index >= 2_000) {
    throw new Error("plan-week preparation footage clip index is invalid");
  }
  return `${planWeekPreparationPrefix(args)}/prepared/footage/clip-${String(args.index + 1).padStart(4, "0")}.mp4`;
}

/** Canonical H3 first-frame input for a prepared weekly footage item. */
export function planWeekPreparedH3FirstFrameKey(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
  index: number;
}): string {
  if (!Number.isSafeInteger(args.index) || args.index < 0 || args.index >= 2_000) {
    throw new Error("plan-week preparation H3 first-frame index is invalid");
  }
  return `${planWeekPreparationPrefix(args)}/prepared/h3/first-frame-${String(args.index + 1).padStart(4, "0")}.png`;
}

function planWeekPreparationPrefix(args: {
  ownerId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
}): string {
  return `owner/${pathSegment(args.ownerId, "owner id")}/channel/${pathSegment(args.channelSlug, "channel slug")}` +
    `/plan-batches/${pathSegment(args.batchId, "batch id")}/items/${pathSegment(args.itemId, "item id")}` +
    "/preparation";
}

/** Canonical future thumbnail destination for every weekly plan item. */
export function planWeekThumbnailKey(args: {
  ownerId: string;
  channelSlug: string;
  itemId: string;
}): string {
  return `owner/${pathSegment(args.ownerId, "owner id")}/channel/${pathSegment(args.channelSlug, "channel slug")}` +
    `/plan/${pathSegment(args.itemId, "item id")}.jpg`;
}

export function planWeekPreparationManifestSha256(manifest: PlanWeekPreparationManifest): string {
  return sha256Hex(canonicalJson(manifest));
}

function normalizedScript(value: unknown): Script {
  const script = requiredRecord(value, "prepared script");
  const sections = script.sections;
  if (!Array.isArray(sections) || !sections.length || sections.length > 128) {
    throw new Error("plan-week prepared script sections are invalid");
  }
  const normalizeOptionalText = (input: unknown, label: string, max: number): string | undefined => {
    if (input === undefined) return undefined;
    const text = requiredText(input, label);
    if (text.length > max) throw new Error(`plan-week prepared script ${label} is too long`);
    return text;
  };
  const crafted = normalizedCraftedHook(script.crafted);
  const normalized: Script = {
    hook: normalizeOptionalText(script.hook, "hook", 10_000) as string,
    sections: sections.map((section, index) => {
      const row = requiredRecord(section, `section ${index + 1}`);
      const role = row.role;
      if (role !== undefined && role !== "intro" && role !== "body" && role !== "outro") {
        throw new Error("plan-week prepared script section role is invalid");
      }
      return {
        heading: normalizeOptionalText(row.heading, `section ${index + 1} heading`, 1_000) as string,
        narration: normalizeOptionalText(row.narration, `section ${index + 1} narration`, 50_000) as string,
        ...(role !== undefined ? { role } : {}),
      };
    }),
    narrationText: normalizeOptionalText(script.narrationText, "narration text", 200_000) as string,
    estDurationSec: (() => {
      const duration = script.estDurationSec;
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > 28_800) {
        throw new Error("plan-week prepared script duration is invalid");
      }
      return duration;
    })(),
    ...(normalizeOptionalText(script.closingLine, "closing line", 1_000) !== undefined
      ? { closingLine: normalizeOptionalText(script.closingLine, "closing line", 1_000) }
      : {}),
    ...(normalizeOptionalText(script.hookLoop, "hook loop", 10_000) !== undefined
      ? { hookLoop: normalizeOptionalText(script.hookLoop, "hook loop", 10_000) }
      : {}),
    ...(normalizeOptionalText(script.programRouteFingerprint, "route fingerprint", 128) !== undefined
      ? { programRouteFingerprint: normalizeOptionalText(script.programRouteFingerprint, "route fingerprint", 128) }
      : {}),
    ...(normalizeOptionalText(script.serializedProgramEpisodeContextFingerprint, "episode fingerprint", 128) !== undefined
      ? { serializedProgramEpisodeContextFingerprint: normalizeOptionalText(script.serializedProgramEpisodeContextFingerprint, "episode fingerprint", 128) }
      : {}),
    ...(crafted !== undefined ? { crafted } : {}),
  };
  if (normalized.hook.length + normalized.narrationText.length > 210_000) {
    throw new Error("plan-week prepared script is too large");
  }
  return normalized;
}

/**
 * A prepared script may retain the hookcraft receipt produced with it.  It is
 * not re-run by scheduled execution, but preserving its admitted verdict is
 * important both for auditability and for keeping the sidecar's content hash
 * faithful to a normal script_gen output.
 */
function normalizedCraftedHook(value: unknown): CraftedHook | undefined {
  if (value === undefined) return undefined;
  const crafted = requiredRecord(value, "prepared script crafted hook");
  const text = (field: string, max: number) => {
    const result = requiredText(crafted[field], `prepared script crafted hook ${field}`);
    if (result.length > max) {
      throw new Error(`plan-week prepared script crafted hook ${field} is too long`);
    }
    return result;
  };
  const verdict = requiredRecord(crafted.verdict, "prepared script crafted hook verdict");
  const lint = requiredRecord(verdict.lint, "prepared script crafted hook lint");
  const count = (field: string) => {
    const result = lint[field];
    if (!Number.isSafeInteger(result) || (result as number) < 0 || (result as number) > 1_000_000) {
      throw new Error(`plan-week prepared script crafted hook lint ${field} is invalid`);
    }
    return result as number;
  };
  const lines = (field: string, maxItems: number, maxLength: number) => {
    const result = lint[field];
    if (!Array.isArray(result) || result.length > maxItems) {
      throw new Error(`plan-week prepared script crafted hook lint ${field} is invalid`);
    }
    return result.map((item, index) => {
      const line = requiredText(item, `prepared script crafted hook lint ${field} ${index + 1}`);
      if (line.length > maxLength) {
        throw new Error(`plan-week prepared script crafted hook lint ${field} is too long`);
      }
      return line;
    });
  };
  if (typeof lint.pass !== "boolean") {
    throw new Error("plan-week prepared script crafted hook lint pass is invalid");
  }
  const score = (field: "punch" | "specificity" | "curiosity" | "voiceMatch" | "promise") => {
    const result = verdict[field];
    if (result === undefined) return undefined;
    if (typeof result !== "number" || !Number.isFinite(result) || result < 1 || result > 10) {
      throw new Error(`plan-week prepared script crafted hook verdict ${field} is invalid`);
    }
    return result;
  };
  if (verdict.honest !== undefined && typeof verdict.honest !== "boolean") {
    throw new Error("plan-week prepared script crafted hook verdict honest is invalid");
  }
  let note: string | undefined;
  if (verdict.note !== undefined) {
    note = requiredText(verdict.note, "prepared script crafted hook verdict note");
    if (note.length > 240) {
      throw new Error("plan-week prepared script crafted hook verdict note is too long");
    }
  }
  if (
    (verdict.factCheck !== "verified" && verdict.factCheck !== "skipped" && verdict.factCheck !== "unchecked") ||
    typeof verdict.judged !== "boolean"
  ) {
    throw new Error("plan-week prepared script crafted hook verdict is invalid");
  }
  return {
    hook: text("hook", 10_000),
    opening: text("opening", 20_000),
    coldOpen: text("coldOpen", 30_000),
    device: text("device", 1_000),
    loop: text("loop", 10_000),
    verdict: {
      ...(score("punch") !== undefined ? { punch: score("punch") } : {}),
      ...(score("specificity") !== undefined ? { specificity: score("specificity") } : {}),
      ...(score("curiosity") !== undefined ? { curiosity: score("curiosity") } : {}),
      ...(score("voiceMatch") !== undefined ? { voiceMatch: score("voiceMatch") } : {}),
      ...(score("promise") !== undefined ? { promise: score("promise") } : {}),
      ...(verdict.honest !== undefined ? { honest: verdict.honest } : {}),
      ...(note !== undefined ? { note } : {}),
      lint: {
        pass: lint.pass,
        firstSentenceWords: count("firstSentenceWords"),
        estHookSeconds: count("estHookSeconds"),
        hookSentences: count("hookSentences"),
        openingWords: count("openingWords"),
        bannedHits: lines("bannedHits", 128, 1_000),
        issues: lines("issues", 128, 1_000),
      },
      factCheck: verdict.factCheck as "verified" | "skipped" | "unchecked",
      judged: verdict.judged,
    },
  };
}

export function assertPlanWeekPreparedScriptBinding(args: {
  prepared: unknown;
  manifest: PlanWeekPreparationManifest;
}): PlanWeekPreparedScript {
  const prepared = requiredRecord(args.prepared, "prepared script receipt");
  if (prepared.version !== PLAN_WEEK_PREPARED_SCRIPT_VERSION) {
    throw new Error("plan-week prepared script version is unsupported");
  }
  const script = normalizedScript(prepared.script);
  const manifestSha256 = requiredText(prepared.manifestSha256, "prepared script manifest digest").toLowerCase();
  const scriptSha256 = requiredText(prepared.scriptSha256, "prepared script digest").toLowerCase();
  const createdAt = prepared.createdAt;
  if (!/^[a-f0-9]{64}$/.test(manifestSha256) || !/^[a-f0-9]{64}$/.test(scriptSha256) ||
      typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt <= 0) {
    throw new Error("plan-week prepared script receipt is invalid");
  }
  const normalized: PlanWeekPreparedScript = {
    version: PLAN_WEEK_PREPARED_SCRIPT_VERSION,
    manifestSha256,
    ownerId: requiredText(prepared.ownerId, "prepared script owner id"),
    channelId: requiredText(prepared.channelId, "prepared script channel id"),
    batchId: requiredText(prepared.batchId, "prepared script batch id"),
    itemId: requiredText(prepared.itemId, "prepared script item id"),
    requestKey: requiredText(prepared.requestKey, "prepared script request key"),
    topic: requiredText(prepared.topic, "prepared script topic"),
    script,
    scriptSha256,
    createdAt,
  };
  const routeSeed = args.manifest.execution.seedStore.channelProgramRoute;
  const routeFingerprint = routeSeed && typeof routeSeed === "object" && !Array.isArray(routeSeed)
    ? (routeSeed as Record<string, unknown>).routeFingerprint
    : undefined;
  if (
    normalized.manifestSha256 !== planWeekPreparationManifestSha256(args.manifest) ||
    normalized.ownerId !== args.manifest.ownerId ||
    normalized.channelId !== args.manifest.channelId ||
    normalized.batchId !== args.manifest.batchId ||
    normalized.itemId !== args.manifest.itemId ||
    normalized.requestKey !== args.manifest.requestKey ||
    normalized.topic !== args.manifest.plan.topic ||
    (typeof routeFingerprint === "string" && normalized.script.programRouteFingerprint !== routeFingerprint) ||
    normalized.scriptSha256 !== sha256Hex(canonicalJson(normalized.script))
  ) {
    throw new Error("plan-week prepared script binding mismatch");
  }
  return normalized;
}

function normalizedPreparedNarrationTimings(value: unknown, durationSec: number) {
  if (!Array.isArray(value) || !value.length || value.length > 20_000) {
    throw new Error("plan-week prepared narration sentence timings are invalid");
  }
  let priorEnd = 0;
  return value.map((raw, index) => {
    const timing = requiredRecord(raw, `prepared narration sentence ${index + 1}`);
    const text = requiredText(timing.text, `prepared narration sentence ${index + 1} text`);
    const start = timing.start;
    const end = timing.end;
    if (
      text.length > 20_000 ||
      typeof start !== "number" || !Number.isFinite(start) || start < 0 ||
      typeof end !== "number" || !Number.isFinite(end) || end <= start ||
      end > durationSec + 0.25 ||
      start < priorEnd - 0.08
    ) {
      throw new Error("plan-week prepared narration sentence timings are invalid");
    }
    priorEnd = end;
    return { text, start, end };
  });
}

function normalizedPreparedNarrationChapterPlan(value: unknown, durationSec: number) {
  if (!Array.isArray(value) || value.length > 2_000) {
    throw new Error("plan-week prepared narration chapter plan is invalid");
  }
  let total = 0;
  return value.map((raw, index) => {
    const window = requiredRecord(raw, `prepared narration chapter window ${index + 1}`);
    const kind = window.kind;
    const durSec = window.durSec;
    if (
      (kind !== "footage" && kind !== "card") ||
      typeof durSec !== "number" || !Number.isFinite(durSec) || durSec <= 0 || durSec > durationSec
    ) {
      throw new Error("plan-week prepared narration chapter plan is invalid");
    }
    const heading = window.heading === undefined
      ? undefined
      : requiredText(window.heading, `prepared narration chapter window ${index + 1} heading`);
    if ((kind === "card" && !heading) || (heading && heading.length > 1_000)) {
      throw new Error("plan-week prepared narration chapter plan is invalid");
    }
    total += durSec;
    if (total > durationSec + 0.5) {
      throw new Error("plan-week prepared narration chapter plan exceeds narration duration");
    }
    return { kind, durSec, ...(heading ? { heading } : {}) };
  }) as PlanWeekPreparedNarration["chapterPlan"];
}

/**
 * Validates a durable narration sidecar before it may reach the paid TTS
 * block. The audio bytes are re-hashed by narration_tts immediately before
 * use; this contract binds the frozen episode, script, delivery evidence and
 * canonical audio destination without trusting a key alone.
 */
export function assertPlanWeekPreparedNarrationBinding(args: {
  prepared: unknown;
  manifest: PlanWeekPreparationManifest;
}): PlanWeekPreparedNarration {
  const prepared = requiredRecord(args.prepared, "prepared narration receipt");
  if (prepared.version !== PLAN_WEEK_PREPARED_NARRATION_VERSION) {
    throw new Error("plan-week prepared narration version is unsupported");
  }
  const manifestSha256 = requiredText(prepared.manifestSha256, "prepared narration manifest digest").toLowerCase();
  const scriptSha256 = requiredText(prepared.scriptSha256, "prepared narration script digest").toLowerCase();
  const audioSha256 = requiredText(prepared.audioSha256, "prepared narration audio digest").toLowerCase();
  const narrationTranscriptSha256 = requiredText(
    prepared.narrationTranscriptSha256,
    "prepared narration transcript digest",
  ).toLowerCase();
  const audioByteLength = typeof prepared.audioByteLength === "number"
    ? prepared.audioByteLength
    : Number.NaN;
  const narrationDurationSec = typeof prepared.narrationDurationSec === "number"
    ? prepared.narrationDurationSec
    : Number.NaN;
  const createdAt = typeof prepared.createdAt === "number" ? prepared.createdAt : Number.NaN;
  if (
    !/^[a-f0-9]{64}$/.test(manifestSha256) ||
    !/^[a-f0-9]{64}$/.test(scriptSha256) ||
    !/^[a-f0-9]{64}$/.test(audioSha256) ||
    !/^[a-f0-9]{64}$/.test(narrationTranscriptSha256) ||
    !Number.isSafeInteger(audioByteLength) || audioByteLength < 1_000 || audioByteLength > 100_000_000 ||
    !Number.isFinite(narrationDurationSec) || narrationDurationSec < 1.5 || narrationDurationSec > 86_400 ||
    !Number.isSafeInteger(createdAt) || createdAt <= 0
  ) {
    throw new Error("plan-week prepared narration receipt is invalid");
  }
  const narrationKey = requiredText(prepared.narrationKey, "prepared narration key");
  const narrationTranscriptText = requiredText(prepared.narrationTranscriptText, "prepared narration transcript");
  if (narrationTranscriptText.length > 250_000) {
    throw new Error("plan-week prepared narration transcript is too long");
  }
  if (narrationTranscriptSha256 !== sha256Hex(narrationTranscriptText)) {
    throw new Error("plan-week prepared narration transcript does not match its immutable receipt");
  }
  const narrationPerformanceEvidence = assertNarrationPerformanceEvidence(prepared.narrationPerformanceEvidence);
  if (Math.abs(narrationPerformanceEvidence.durationSec - narrationDurationSec) > 0.001) {
    throw new Error("plan-week prepared narration duration does not bind its performance evidence");
  }
  const scope = {
    ownerId: args.manifest.ownerId,
    channelSlug: args.manifest.channelSlug,
    batchId: args.manifest.batchId,
    itemId: args.manifest.itemId,
  };
  const sentenceTimings = normalizedPreparedNarrationTimings(prepared.sentenceTimings, narrationDurationSec);
  const chapterPlan = normalizedPreparedNarrationChapterPlan(prepared.chapterPlan, narrationDurationSec);
  const normalized: PlanWeekPreparedNarration = {
    version: PLAN_WEEK_PREPARED_NARRATION_VERSION,
    manifestSha256,
    ownerId: requiredText(prepared.ownerId, "prepared narration owner id"),
    channelId: requiredText(prepared.channelId, "prepared narration channel id"),
    batchId: requiredText(prepared.batchId, "prepared narration batch id"),
    itemId: requiredText(prepared.itemId, "prepared narration item id"),
    requestKey: requiredText(prepared.requestKey, "prepared narration request key"),
    topic: requiredText(prepared.topic, "prepared narration topic"),
    scriptSha256,
    narrationKey,
    audioSha256,
    audioByteLength,
    narrationDurationSec,
    narrationTranscriptText,
    narrationTranscriptSha256,
    narrationPerformanceEvidence,
    sentenceTimings,
    chapterPlan,
    createdAt,
  };
  const qwenSource = normalized.narrationPerformanceEvidence.qwenProviderEvidence?.source;
  if (
    normalized.manifestSha256 !== planWeekPreparationManifestSha256(args.manifest) ||
    normalized.ownerId !== args.manifest.ownerId ||
    normalized.channelId !== args.manifest.channelId ||
    normalized.batchId !== args.manifest.batchId ||
    normalized.itemId !== args.manifest.itemId ||
    normalized.requestKey !== args.manifest.requestKey ||
    normalized.topic !== args.manifest.plan.topic ||
    normalized.narrationKey !== planWeekPreparedNarrationAudioKey(scope) ||
    (qwenSource !== undefined && (
      qwenSource.narrationKey !== normalized.narrationKey ||
      qwenSource.sha256 !== normalized.audioSha256 ||
      qwenSource.byteLength !== normalized.audioByteLength ||
      Math.abs(qwenSource.durationSec - normalized.narrationDurationSec) > 0.001
    ))
  ) {
    throw new Error("plan-week prepared narration binding mismatch");
  }
  return normalized;
}

/**
 * Admit the receipt before it can seed the paid music stage. The stage itself
 * re-reads and hashes every retained object immediately before reuse; this
 * boundary makes sure no foreign episode or arbitrary R2 location can reach
 * that later check in the first place.
 */
export function assertPlanWeekPreparedMusicBinding(args: {
  prepared: unknown;
  manifest: PlanWeekPreparationManifest;
}): PlanWeekPreparedMusic {
  const prepared = requiredRecord(args.prepared, "prepared music receipt");
  if (prepared.version !== PLAN_WEEK_PREPARED_MUSIC_VERSION) {
    throw new Error("plan-week prepared music version is unsupported");
  }
  const manifestSha256 = requiredText(prepared.manifestSha256, "prepared music manifest digest").toLowerCase();
  const audioSha256 = requiredText(prepared.audioSha256, "prepared music audio digest").toLowerCase();
  const audioByteLength = typeof prepared.audioByteLength === "number" ? prepared.audioByteLength : Number.NaN;
  const musicDurationSec = typeof prepared.musicDurationSec === "number" ? prepared.musicDurationSec : Number.NaN;
  const createdAt = typeof prepared.createdAt === "number" ? prepared.createdAt : Number.NaN;
  const provider = prepared.provider;
  if (
    !/^[a-f0-9]{64}$/.test(manifestSha256) ||
    !/^[a-f0-9]{64}$/.test(audioSha256) ||
    !Number.isSafeInteger(audioByteLength) || audioByteLength < 1_000 || audioByteLength > 250_000_000 ||
    !Number.isFinite(musicDurationSec) || musicDurationSec < 1.5 || musicDurationSec > 86_400 ||
    !Number.isSafeInteger(createdAt) || createdAt <= 0 ||
    (provider !== "mureka" && provider !== "suno" && provider !== "minimax_music3")
  ) {
    throw new Error("plan-week prepared music receipt is invalid");
  }
  const scope = {
    ownerId: args.manifest.ownerId,
    channelSlug: args.manifest.channelSlug,
    batchId: args.manifest.batchId,
    itemId: args.manifest.itemId,
  };
  const musicProgram = ChannelMusicProgramSchema.parse(prepared.musicProgram);
  const minimaxRaw = prepared.minimax;
  let minimax: PlanWeekPreparedMusic["minimax"];
  if (provider === "minimax_music3") {
    const record = requiredRecord(minimaxRaw, "prepared MiniMax music receipt");
    minimax = {
      nativeWavKey: requiredText(record.nativeWavKey, "prepared MiniMax native WAV key"),
      runtimeReceiptKey: requiredText(record.runtimeReceiptKey, "prepared MiniMax runtime receipt key"),
      qualityReceiptKey: requiredText(record.qualityReceiptKey, "prepared MiniMax quality receipt key"),
    };
  } else if (minimaxRaw !== undefined) {
    throw new Error("plan-week prepared non-MiniMax music may not carry MiniMax evidence");
  }
  const normalized: PlanWeekPreparedMusic = {
    version: PLAN_WEEK_PREPARED_MUSIC_VERSION,
    manifestSha256,
    ownerId: requiredText(prepared.ownerId, "prepared music owner id"),
    channelId: requiredText(prepared.channelId, "prepared music channel id"),
    batchId: requiredText(prepared.batchId, "prepared music batch id"),
    itemId: requiredText(prepared.itemId, "prepared music item id"),
    requestKey: requiredText(prepared.requestKey, "prepared music request key"),
    topic: requiredText(prepared.topic, "prepared music topic"),
    musicKey: requiredText(prepared.musicKey, "prepared music key"),
    audioSha256,
    audioByteLength,
    musicDurationSec,
    provider,
    musicProgram,
    ...(minimax ? { minimax } : {}),
    createdAt,
  };
  if (
    normalized.manifestSha256 !== planWeekPreparationManifestSha256(args.manifest) ||
    normalized.ownerId !== args.manifest.ownerId ||
    normalized.channelId !== args.manifest.channelId ||
    normalized.batchId !== args.manifest.batchId ||
    normalized.itemId !== args.manifest.itemId ||
    normalized.requestKey !== args.manifest.requestKey ||
    normalized.topic !== args.manifest.plan.topic ||
    normalized.musicKey !== planWeekPreparedMusicAudioKey(scope) ||
    normalized.musicProgram.channelId !== args.manifest.channelId ||
    normalized.musicProgram.topic !== args.manifest.plan.topic ||
    (normalized.provider === "minimax_music3" && (
      normalized.musicProgram.generation.providerPreference !== "minimax_music3" ||
      normalized.minimax?.nativeWavKey !== planWeekPreparedMusicNativeWavKey(scope) ||
      normalized.minimax.runtimeReceiptKey !== planWeekPreparedMusicRuntimeReceiptKey(scope) ||
      normalized.minimax.qualityReceiptKey !== planWeekPreparedMusicQualityReceiptKey(scope)
    ))
  ) {
    throw new Error("plan-week prepared music binding mismatch");
  }
  return normalized;
}

/**
 * Admission for a completed weekly visual/source-proof footage order. Actual
 * execution must still read and hash every clip immediately before it skips
 * Novita; this boundary rejects cross-episode manifests and alternate object
 * paths before the result can enter an invocation snapshot.
 */
export function assertPlanWeekPreparedFootageBinding(args: {
  prepared: unknown;
  manifest: PlanWeekPreparationManifest;
}): PlanWeekPreparedFootage {
  const prepared = requiredRecord(args.prepared, "prepared footage receipt");
  if (prepared.version !== PLAN_WEEK_PREPARED_FOOTAGE_VERSION) {
    throw new Error("plan-week prepared footage version is unsupported");
  }
  const manifestSha256 = requiredText(prepared.manifestSha256, "prepared footage manifest digest").toLowerCase();
  const createdAt = typeof prepared.createdAt === "number" ? prepared.createdAt : Number.NaN;
  if (!/^[a-f0-9]{64}$/.test(manifestSha256) || !Number.isSafeInteger(createdAt) || createdAt <= 0) {
    throw new Error("plan-week prepared footage receipt is invalid");
  }
  const generatedFootageSceneManifest = GeneratedFootageSceneManifestSchema.parse(
    prepared.generatedFootageSceneManifest,
  );
  if (!Array.isArray(prepared.clips) || prepared.clips.length !== generatedFootageSceneManifest.items.length) {
    throw new Error("plan-week prepared footage clips do not match the ordered scene manifest");
  }
  const scope = {
    ownerId: args.manifest.ownerId,
    channelSlug: args.manifest.channelSlug,
    batchId: args.manifest.batchId,
    itemId: args.manifest.itemId,
  };
  const clips = prepared.clips.map((raw, index) => {
    const clip = requiredRecord(raw, `prepared footage clip ${index + 1}`);
    const r2Key = requiredText(clip.r2Key, `prepared footage clip ${index + 1} key`);
    const sha256 = requiredText(clip.sha256, `prepared footage clip ${index + 1} digest`).toLowerCase();
    const byteLength = typeof clip.byteLength === "number" ? clip.byteLength : Number.NaN;
    const durationSec = typeof clip.durationSec === "number" ? clip.durationSec : Number.NaN;
    if (
      r2Key !== planWeekPreparedFootageClipKey({ ...scope, index }) ||
      generatedFootageSceneManifest.items[index]?.clipKey !== r2Key ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      !Number.isSafeInteger(byteLength) || byteLength < 1_024 || byteLength > 5_000_000_000 ||
      !Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 3_600
    ) {
      throw new Error("plan-week prepared footage clip binding mismatch");
    }
    return { r2Key, sha256, byteLength, durationSec };
  });
  const rawRenderer = prepared.renderer;
  let renderer: PlanWeekPreparedFootage["renderer"];
  let ltxStyleId: string | undefined;
  if (rawRenderer === undefined) {
    ltxStyleId = requiredText(prepared.ltxStyleId, "prepared footage LTX style id");
    if (ltxStyleId.length > 160) throw new Error("plan-week prepared footage LTX style id is invalid");
    renderer = { kind: "ltx", styleId: ltxStyleId };
  } else {
    const rendererRecord = requiredRecord(rawRenderer, "prepared footage renderer");
    if (rendererRecord.kind !== "minimax-h3") {
      throw new Error("prepared footage renderer must be the explicit minimax-h3 contract");
    }
    if (
      rendererRecord.provider !== "salad" && rendererRecord.provider !== "novita" ||
      rendererRecord.execution !== "weekly-batch" && rendererRecord.execution !== "on-demand" ||
      (rendererRecord.provider === "salad") !== (rendererRecord.execution === "weekly-batch") ||
      rendererRecord.runtimeId !== MINIMAX_H3_RUNTIME_ID ||
      rendererRecord.profileId !== MINIMAX_H3_PROFILE.id ||
      rendererRecord.modelManifestSha256 !== MINIMAX_H3_MANIFEST_SHA256
    ) {
      throw new Error("prepared footage H3 renderer binding is invalid");
    }
    renderer = {
      kind: "minimax-h3",
      provider: rendererRecord.provider as MiniMaxH3Provider,
      execution: rendererRecord.execution as MiniMaxH3Execution,
      runtimeId: MINIMAX_H3_RUNTIME_ID,
      profileId: MINIMAX_H3_PROFILE.id,
      modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
    };
    const rawJobs = prepared.h3Jobs;
    const rawReceipts = prepared.h3Receipts;
    if (!Array.isArray(rawJobs) || rawJobs.length !== clips.length || !Array.isArray(rawReceipts) || rawReceipts.length !== clips.length) {
      throw new Error("prepared footage H3 jobs and receipts must match the ordered clip count");
    }
    const nativeDurationSec = MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps;
    for (let index = 0; index < clips.length; index++) {
      const clip = clips[index]!;
      if (Math.abs(clip.durationSec - nativeDurationSec) > 0.08) {
        throw new Error("prepared footage H3 clip duration must match the native H3 profile");
      }
      const item = generatedFootageSceneManifest.items[index];
      const job = requiredRecord(rawJobs[index], `prepared H3 job ${index + 1}`);
      const firstFrame = requiredRecord(job.firstFrame, `prepared H3 job ${index + 1} first frame`);
      const output = requiredRecord(job.output, `prepared H3 job ${index + 1} output`);
      const prompt = requiredText(job.prompt, `prepared H3 job ${index + 1} prompt`);
      const seed = Number(job.seed);
      const maxCostUsd = Number(job.maxCostUsd);
      const firstFrameKey = requiredText(firstFrame.r2Key, `prepared H3 job ${index + 1} first-frame key`);
      const firstFrameSha256 = requiredText(firstFrame.sha256, `prepared H3 job ${index + 1} first-frame digest`).toLowerCase();
      const outputKey = requiredText(output.r2Key, `prepared H3 job ${index + 1} output key`);
      const requestKey = requiredText(job.requestKey, `prepared H3 job ${index + 1} request key`);
      if (
        !item || job.sceneId !== item.sceneId ||
        firstFrameKey !== planWeekPreparedH3FirstFrameKey({ ...scope, index }) ||
        !/^[a-f0-9]{64}$/.test(firstFrameSha256) ||
        outputKey !== clip.r2Key ||
        !Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647 ||
        !Number.isFinite(maxCostUsd) || maxCostUsd < 0 || maxCostUsd > 100 ||
        requestKey !== miniMaxH3RequestKey({
          provider: renderer.provider,
          execution: renderer.execution,
          prompt,
          seed,
          firstFrame: { r2Key: firstFrameKey, sha256: firstFrameSha256 },
          output: { r2Key: outputKey },
          maxCostUsd,
        })
      ) {
        throw new Error("prepared footage H3 job binding mismatch");
      }
      const receipt = requiredRecord(rawReceipts[index], `prepared H3 receipt ${index + 1}`);
      const receiptOutput = requiredRecord(receipt.output, `prepared H3 receipt ${index + 1} output`);
      const receiptRuntime = requiredRecord(receipt.runtime, `prepared H3 receipt ${index + 1} runtime`);
      if (
        receipt.schema !== MINIMAX_H3_WORKER_CONTRACT ||
        receipt.requestKey !== requestKey ||
        receipt.execution !== renderer.execution ||
        receiptOutput.r2Key !== outputKey ||
        receiptOutput.contentSha256 !== clip.sha256 ||
        Number(receiptOutput.byteLength) !== clip.byteLength ||
        receiptRuntime.provider !== renderer.provider ||
        receiptRuntime.gpuModel !== "RTX 5090" ||
        receiptRuntime.runtimeId !== MINIMAX_H3_RUNTIME_ID ||
        receiptRuntime.modelManifestSha256 !== MINIMAX_H3_MANIFEST_SHA256 ||
        (renderer.provider === "salad"
          ? receiptRuntime.capacityMode !== "medium" && receiptRuntime.capacityMode !== SALAD_HIGH_FALLBACK_PRIORITY
          : receiptRuntime.capacityMode !== "spot") ||
        canonicalJson(receipt.profile) !== canonicalJson(MINIMAX_H3_PROFILE)
      ) {
        throw new Error("prepared footage H3 receipt binding mismatch");
      }
    }
  }
  const normalized: PlanWeekPreparedFootage = {
    version: PLAN_WEEK_PREPARED_FOOTAGE_VERSION,
    manifestSha256,
    ownerId: requiredText(prepared.ownerId, "prepared footage owner id"),
    channelId: requiredText(prepared.channelId, "prepared footage channel id"),
    batchId: requiredText(prepared.batchId, "prepared footage batch id"),
    itemId: requiredText(prepared.itemId, "prepared footage item id"),
    requestKey: requiredText(prepared.requestKey, "prepared footage request key"),
    topic: requiredText(prepared.topic, "prepared footage topic"),
    generatedFootageSceneManifest,
    clips,
    ...(ltxStyleId ? { ltxStyleId } : {}),
    ...(renderer ? { renderer } : {}),
    ...(Array.isArray(prepared.h3Jobs) ? { h3Jobs: prepared.h3Jobs as PlanWeekPreparedFootage["h3Jobs"] } : {}),
    ...(Array.isArray(prepared.h3Receipts) ? { h3Receipts: prepared.h3Receipts as MiniMaxH3Receipt[] } : {}),
    createdAt,
  };
  if (
    normalized.manifestSha256 !== planWeekPreparationManifestSha256(args.manifest) ||
    normalized.ownerId !== args.manifest.ownerId ||
    normalized.channelId !== args.manifest.channelId ||
    normalized.batchId !== args.manifest.batchId ||
    normalized.itemId !== args.manifest.itemId ||
    normalized.requestKey !== args.manifest.requestKey ||
    normalized.topic !== args.manifest.plan.topic
  ) {
    throw new Error("plan-week prepared footage binding mismatch");
  }
  return normalized;
}

export function normalizePlanWeekPreparationManifest(value: unknown): PlanWeekPreparationManifest {
  const manifest = requiredRecord(value, "manifest");
  if (manifest.version !== PLAN_WEEK_PREPARATION_VERSION) {
    throw new Error("plan-week preparation manifest version is unsupported");
  }
  const frozenAt = manifest.frozenAt;
  if (typeof frozenAt !== "number" || !Number.isSafeInteger(frozenAt) || frozenAt <= 0) {
    throw new Error("plan-week preparation frozen timestamp is invalid");
  }
  const plan = requiredRecord(manifest.plan, "plan");
  const execution = requiredRecord(manifest.execution, "execution");
  const prompts = requiredRecord(manifest.prompts, "prompts");
  if (!Array.isArray(execution.pipeline)) {
    throw new Error("plan-week preparation pipeline is invalid");
  }
  const moduleConfig = requiredRecord(execution.moduleConfig, "module config") as Record<string, Record<string, unknown>>;
  for (const [blockId, config] of Object.entries(moduleConfig)) {
    requiredText(blockId, "module config block");
    requiredRecord(config, `module config for ${blockId}`);
  }
  const normalized: PlanWeekPreparationManifest = {
    version: PLAN_WEEK_PREPARATION_VERSION,
    ownerId: requiredText(manifest.ownerId, "owner id"),
    channelId: requiredText(manifest.channelId, "channel id"),
    batchId: requiredText(manifest.batchId, "batch id"),
    itemId: requiredText(manifest.itemId, "item id"),
    itemKey: requiredText(manifest.itemKey, "item key"),
    requestKey: requiredText(manifest.requestKey, "request key"),
    channelSlug: requiredText(manifest.channelSlug, "channel slug"),
    frozenAt,
    plan: {
      topic: requiredText(plan.topic, "plan topic"),
      title: requiredText(plan.title, "plan title"),
      description: requiredText(plan.description, "plan description"),
      sceneSeed: requiredText(plan.sceneSeed, "scene seed"),
      thumbnailKey: requiredText(plan.thumbnailKey, "thumbnail key"),
      // v1 manifests written before this field existed were all paid planner
      // artwork. Keep them executable while every new manifest is explicit.
      thumbnailSource: assertPlanWeekThumbnailSource(
        plan.thumbnailSource ?? "planner_artwork",
      ),
    },
    execution: {
      pipeline: execution.pipeline,
      moduleConfig,
      seedStore: requiredRecord(execution.seedStore, "seed store"),
    },
    prompts: {
      script: requiredText(prompts.script, "script prompt"),
      narration: requiredText(prompts.narration, "narration prompt"),
      shotlist: requiredText(prompts.shotlist, "shot-list prompt"),
      visual: requiredText(prompts.visual, "visual prompt"),
    },
  };
  jsonSafe(normalized, "manifest");
  return normalized;
}

export function assertPlanWeekPreparationPointer(value: unknown): PlanWeekPreparationPointer {
  const pointer = requiredRecord(value, "pointer");
  if (pointer.version !== PLAN_WEEK_PREPARATION_VERSION) {
    throw new Error("plan-week preparation pointer version is unsupported");
  }
  const manifestSha256 = requiredText(pointer.manifestSha256, "manifest digest").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(manifestSha256)) {
    throw new Error("plan-week preparation manifest digest is invalid");
  }
  return {
    version: PLAN_WEEK_PREPARATION_VERSION,
    manifestKey: requiredText(pointer.manifestKey, "manifest key"),
    manifestSha256,
  };
}

export function assertPlanWeekPreparationManifestBinding(args: {
  manifest: unknown;
  pointer: unknown;
  ownerId: string;
  channelId: string;
  batchId: string;
  itemId: string;
  itemKey: string;
  requestKey: string;
  channelSlug: string;
  topic: string;
  title: string;
  thumbnailKey: string;
  thumbnailSource?: PlanWeekThumbnailSource;
}): PlanWeekPreparationManifest {
  const manifest = normalizePlanWeekPreparationManifest(args.manifest);
  const pointer = assertPlanWeekPreparationPointer(args.pointer);
  const expectedKey = planWeekPreparationKey(args);
  if (
    pointer.manifestKey !== expectedKey ||
    pointer.manifestSha256 !== planWeekPreparationManifestSha256(manifest) ||
    manifest.ownerId !== args.ownerId ||
    manifest.channelId !== args.channelId ||
    manifest.batchId !== args.batchId ||
    manifest.itemId !== args.itemId ||
    manifest.itemKey !== args.itemKey ||
    manifest.requestKey !== args.requestKey ||
    manifest.channelSlug !== args.channelSlug ||
    manifest.plan.topic !== args.topic ||
    manifest.plan.title !== args.title ||
    manifest.plan.thumbnailKey !== args.thumbnailKey ||
    manifest.plan.thumbnailSource !== (args.thumbnailSource ?? "planner_artwork")
  ) {
    throw new Error("plan-week preparation manifest binding mismatch");
  }
  return manifest;
}
