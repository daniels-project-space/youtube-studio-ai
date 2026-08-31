import type { RenderBlockMachineClass } from "./pipelineInvocationSnapshot";

/** Trigger task wall-clock ceiling shared by both remote render workers. */
export const RENDER_CHILD_TASK_MAX_DURATION_SECONDS = 5_400;
export const RENDER_CHILD_TASK_MAX_DURATION_MS =
  RENDER_CHILD_TASK_MAX_DURATION_SECONDS * 1_000;

/** Heavy work has no automatic replay while paid provider receipts are partial. */
export const RENDER_CHILD_HEAVY_MAX_ATTEMPTS = 1;
/** Offloaded GPU work has a bounded second attempt with durable provider recovery. */
export const RENDER_CHILD_OFFLOADED_MAX_ATTEMPTS = 2;

// Allows a child to enter Trigger's queue and preserves a small failure/cleanup
// margin, but never lets a waiting parent lease become unbounded.
export const RENDER_CHILD_WAIT_DISPATCH_GRACE_MS = 10 * 60_000;

/**
 * The live child receipt is deliberately short and renewable. A checkpointed
 * Novita controller renews it while it is actually observing a worker; a lost
 * child stops renewing and the normal run reaper can recover promptly.
 */
export const RENDER_CHILD_HEARTBEAT_LEASE_MS = 20 * 60_000;
/** Polls can be frequent and concurrent; one durable renewal per minute is ample. */
export const RENDER_CHILD_HEARTBEAT_RENEW_INTERVAL_MS = 60_000;

/**
 * Direct Novita workers have an immutable two-hour lifetime. Its admitted
 * remote stages may checkpoint through up to three queued waves, so allow six
 * hours of real work plus the bounded dispatch margin. This is an absolute
 * deadline, not a static wait: only a token-fenced active child can occupy it.
 */
export const RENDER_CHILD_OFFLOADED_MAX_WORK_MS = 6 * 60 * 60_000;

/** One immutable direct-Novita worker can occupy its sealed two-hour lease. */
export const RENDER_CHILD_OFFLOADED_PROVIDER_WINDOW_MS = 2 * 60 * 60_000;

/** Heavy local composite children do not use checkpointed provider polling. */
export const RENDER_CHILD_HEAVY_MAX_WORK_MS =
  RENDER_CHILD_TASK_MAX_DURATION_MS + RENDER_CHILD_WAIT_DISPATCH_GRACE_MS;

/** Largest permitted absolute remote-child work window. */
export const MAX_REMOTE_CHILD_WAIT_LEASE_MS =
  RENDER_CHILD_OFFLOADED_MAX_WORK_MS + RENDER_CHILD_WAIT_DISPATCH_GRACE_MS;

export function renderChildAttemptLeaseMs(): number {
  return RENDER_CHILD_TASK_MAX_DURATION_MS;
}

export function renderChildWaitLeaseMs(machineClass: RenderBlockMachineClass): number {
  return machineClass === "heavy"
    ? RENDER_CHILD_HEAVY_MAX_WORK_MS
    : RENDER_CHILD_HEARTBEAT_LEASE_MS;
}

/** Immutable upper bound for one authenticated remote-child dispatch. */
export function renderChildWorkDeadlineMs(machineClass: RenderBlockMachineClass): number {
  return machineClass === "heavy"
    ? RENDER_CHILD_HEAVY_MAX_WORK_MS
    : RENDER_CHILD_OFFLOADED_MAX_WORK_MS + RENDER_CHILD_WAIT_DISPATCH_GRACE_MS;
}

/** Remaining time required before a new provider worker may be started. */
export function renderChildProviderWorkWindowMs(machineClass: RenderBlockMachineClass): number {
  return machineClass === "heavy"
    ? RENDER_CHILD_TASK_MAX_DURATION_MS
    : RENDER_CHILD_OFFLOADED_PROVIDER_WINDOW_MS;
}
