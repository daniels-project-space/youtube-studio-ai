import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertPlanWeekThumbnailSource,
  type PlanWeekThumbnailSource,
} from "@/lib/planWeekThumbnailSource";
import type { CraftedHook } from "@/lib/hookcraft";
import type { Script } from "@/lib/scriptGen";
import { sha256Hex } from "@/lib/sha256";

/**
 * The provider-free first stage of weekly batch preparation.  It is deliberately
 * not called a render: it freezes the exact editorial and channel inputs that
 * later script, shot-list, ERNIE and LTX work must consume.
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
