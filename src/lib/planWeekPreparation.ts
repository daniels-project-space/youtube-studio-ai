import { canonicalJson } from "@/lib/canonicalJson";
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
  const clean = (value: string, label: string) =>
    requiredText(value, label).replace(/^\/+|\/+$/g, "");
  return `owner/${clean(args.ownerId, "owner id")}/channel/${clean(args.channelSlug, "channel slug")}` +
    `/plan-batches/${clean(args.batchId, "batch id")}/items/${clean(args.itemId, "item id")}` +
    "/preparation/inputs.json";
}

export function planWeekPreparationManifestSha256(manifest: PlanWeekPreparationManifest): string {
  return sha256Hex(canonicalJson(manifest));
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
    manifest.plan.thumbnailKey !== args.thumbnailKey
  ) {
    throw new Error("plan-week preparation manifest binding mismatch");
  }
  return manifest;
}
