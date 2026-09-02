import type { PipelineEntry } from "@/engine/types";
import { comparablePipeline } from "@/engine/channelPipelineComparable";

/**
 * A module lock is deliberately independent from the channel-level "done"
 * lock.  It freezes one selected module's configuration *and* its pipeline
 * entry, while allowing the owner to keep improving unrelated modules.
 */
export const CHANNEL_MODULE_LOCK_VERSION = "channel-module-lock/v1" as const;

export type ChannelModuleLock = Readonly<{
  version: typeof CHANNEL_MODULE_LOCK_VERSION;
  lockedAt: number;
  lockedBy: string;
  moduleConfigFingerprint: string;
  pipelineEntryFingerprint: string;
}>;

export type ChannelModuleLocks = Readonly<Record<string, ChannelModuleLock>>;

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Parse persisted lock metadata defensively.  A malformed existing entry is
 * still treated as locked by `isChannelModuleLocked`, so data corruption can
 * never become an accidental unlock.
 */
export function channelModuleLockFor(
  moduleLocks: unknown,
  blockId: string,
): ChannelModuleLock | null {
  const locks = plainRecord(moduleLocks);
  const raw = locks?.[blockId];
  const lock = plainRecord(raw);
  const lockedAt = lock?.lockedAt;
  if (
    !lock ||
    lock.version !== CHANNEL_MODULE_LOCK_VERSION ||
    typeof lockedAt !== "number" ||
    !Number.isSafeInteger(lockedAt) ||
    lockedAt < 0 ||
    typeof lock.lockedBy !== "string" ||
    !lock.lockedBy ||
    typeof lock.moduleConfigFingerprint !== "string" ||
    typeof lock.pipelineEntryFingerprint !== "string"
  ) return null;
  return lock as ChannelModuleLock;
}

/** Fail closed: a present but malformed persisted lock is never ignored. */
export function isChannelModuleLocked(moduleLocks: unknown, blockId: string): boolean {
  const locks = plainRecord(moduleLocks);
  return Boolean(locks && Object.prototype.hasOwnProperty.call(locks, blockId));
}

/** Stable snapshot of the exact selected module entry or entries. */
export function modulePipelineEntryFingerprint(
  pipeline: readonly PipelineEntry[],
  blockId: string,
): string {
  return comparablePipeline(pipeline.filter((entry) => entry.block === blockId));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

/** Stable snapshot of the saved operator configuration for one module. */
export function moduleConfigFingerprint(
  moduleConfig: Record<string, unknown> | undefined,
  blockId: string,
): string {
  return JSON.stringify(canonicalValue(moduleConfig?.[blockId] ?? null));
}

export function createChannelModuleLock(input: {
  readonly blockId: string;
  readonly pipeline: readonly PipelineEntry[];
  readonly moduleConfig?: Record<string, unknown>;
  readonly lockedAt: number;
  readonly lockedBy: string;
}): ChannelModuleLock {
  return {
    version: CHANNEL_MODULE_LOCK_VERSION,
    lockedAt: input.lockedAt,
    lockedBy: input.lockedBy,
    moduleConfigFingerprint: moduleConfigFingerprint(input.moduleConfig, input.blockId),
    pipelineEntryFingerprint: modulePipelineEntryFingerprint(input.pipeline, input.blockId),
  };
}

/**
 * Returns the first locked module whose selected pipeline entry would change.
 * Order is deterministic to produce a stable audit trail and human message.
 */
export function firstLockedModulePipelineChange(input: {
  readonly moduleLocks: unknown;
  readonly currentPipeline: readonly PipelineEntry[];
  readonly nextPipeline: readonly PipelineEntry[];
}): string | null {
  const locks = plainRecord(input.moduleLocks);
  if (!locks) return null;
  for (const blockId of Object.keys(locks).sort((left, right) => left.localeCompare(right))) {
    if (
      modulePipelineEntryFingerprint(input.currentPipeline, blockId) !==
      modulePipelineEntryFingerprint(input.nextPipeline, blockId)
    ) return blockId;
  }
  return null;
}

/** The literal human confirmation needed to remove one durable module lock. */
export function channelModuleUnlockConfirmation(blockId: string): string {
  return `UNLOCK MODULE ${blockId}`;
}
