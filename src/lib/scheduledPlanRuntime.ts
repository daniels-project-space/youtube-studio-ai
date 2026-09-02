import { SCHEDULED_UPLOAD_MIN_LEAD_MS } from "./publishTiming";
import {
  assertPlanWeekPreparationPointer,
  type PlanWeekPreparationPointer,
} from "./planWeekPreparation";

const HOUR_MS = 60 * 60 * 1_000;

export const DEFAULT_PLAN_GENERATION_LEAD_MS = 24 * HOUR_MS;
export const MIN_PLAN_RENDER_LEAD_MS = 2 * HOUR_MS;
export const MIN_SCHEDULED_PUBLISH_LEAD_MS = SCHEDULED_UPLOAD_MIN_LEAD_MS;

export interface ScheduledPlanRunPayload {
  planItemId: string;
  topic: string;
  title: string;
  thumbnailKey: string;
  scheduledAt?: number;
  /** Absent only for historic plans created before weekly preparation v1. */
  preparation?: PlanWeekPreparationPointer;
}

export interface ScheduledPlanCandidate extends ScheduledPlanRunPayload {
  status: string;
  order: number;
  scheduledRunId?: string;
}

function requiredText(value: string, label: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`scheduled plan ${label} is empty`);
  return clean;
}

function scheduledTimestamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("scheduled plan timestamp is invalid");
  }
  return Math.trunc(value);
}

export function parsePlanGenerationLeadMs(raw?: string): number {
  if (!raw?.trim()) return DEFAULT_PLAN_GENERATION_LEAD_MS;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
    throw new Error("STUDIO_PLAN_GENERATION_LEAD_HOURS must be between 1 and 168");
  }
  return Math.round(hours * HOUR_MS);
}

export function selectDueScheduledPlanItem<T extends ScheduledPlanCandidate>(
  items: readonly T[],
  dueBefore: number,
): T | undefined {
  const cutoff = scheduledTimestamp(dueBefore);
  return items
    .filter((item) =>
      item.status === "ready" &&
      Boolean(item.thumbnailKey.trim()) &&
      Number.isFinite(item.scheduledAt) &&
      (item.scheduledAt ?? 0) > 0 &&
      (item.scheduledAt ?? Number.POSITIVE_INFINITY) <= cutoff,
    )
    .sort((a, b) =>
      (a.scheduledAt ?? Number.POSITIVE_INFINITY) - (b.scheduledAt ?? Number.POSITIVE_INFINITY) ||
      a.order - b.order ||
      a.planItemId.localeCompare(b.planItemId),
    )[0];
}

export function selectUnpinnedPlanItem<T extends ScheduledPlanCandidate>(
  items: readonly T[],
): T | undefined {
  return items
    .filter((item) =>
      item.status === "ready" &&
      Boolean(item.thumbnailKey.trim()) &&
      item.scheduledAt === undefined,
    )
    .sort((a, b) => a.order - b.order || a.planItemId.localeCompare(b.planItemId))[0];
}

export function normalizeScheduledPlanPayload(
  value: ScheduledPlanRunPayload,
): ScheduledPlanRunPayload {
  const normalized: ScheduledPlanRunPayload = {
    planItemId: requiredText(value.planItemId, "item id"),
    topic: requiredText(value.topic, "topic"),
    title: requiredText(value.title, "title"),
    thumbnailKey: requiredText(value.thumbnailKey, "thumbnail key"),
  };
  if (value.scheduledAt !== undefined) {
    normalized.scheduledAt = scheduledTimestamp(value.scheduledAt);
  }
  if (value.preparation !== undefined) {
    normalized.preparation = assertPlanWeekPreparationPointer(value.preparation);
  }
  return normalized;
}

export function assertScheduledPlanPayloadMatches(
  carried: ScheduledPlanRunPayload,
  durable: ScheduledPlanRunPayload,
): ScheduledPlanRunPayload {
  const left = normalizeScheduledPlanPayload(carried);
  const right = normalizeScheduledPlanPayload(durable);
  for (const key of [
    "planItemId",
    "topic",
    "title",
    "thumbnailKey",
    "scheduledAt",
  ] as const) {
    if (left[key] !== right[key]) {
      throw new Error(`scheduled plan payload mismatch: ${key}`);
    }
  }
  const leftPreparation = left.preparation;
  const rightPreparation = right.preparation;
  if (
    (leftPreparation === undefined) !== (rightPreparation === undefined) ||
    (leftPreparation && rightPreparation && (
      leftPreparation.version !== rightPreparation.version ||
      leftPreparation.manifestKey !== rightPreparation.manifestKey ||
      leftPreparation.manifestSha256 !== rightPreparation.manifestSha256
    ))
  ) {
    throw new Error("scheduled plan payload mismatch: preparation");
  }
  return right;
}

export function scheduledPlanSeed(value: ScheduledPlanRunPayload): Record<string, unknown> {
  const plan = normalizeScheduledPlanPayload(value);
  return {
    planItemId: plan.planItemId,
    plannedTopic: plan.topic,
    plannedTitle: plan.title,
    plannedThumbnailKey: plan.thumbnailKey,
    ...(plan.scheduledAt !== undefined ? { scheduledPublishAt: plan.scheduledAt } : {}),
    ...(plan.preparation !== undefined ? { planWeekPreparation: plan.preparation } : {}),
  };
}

export function resolveScheduledPublishAtMs(args: {
  publishMode: string;
  pinnedScheduledAt?: number;
  runStartedAt: number;
  runId: string;
  publishOffsetHours?: number;
  publishJitterHours?: number;
}): number | undefined {
  if (args.publishMode !== "scheduled") return undefined;
  if (args.pinnedScheduledAt !== undefined) {
    return scheduledTimestamp(args.pinnedScheduledAt);
  }

  const offsetHours = args.publishOffsetHours ?? 6;
  const jitterMaxHours = args.publishJitterHours ?? 4;
  if (!Number.isFinite(offsetHours) || offsetHours < 0) {
    throw new Error("scheduled publish offset is invalid");
  }
  if (!Number.isFinite(jitterMaxHours) || jitterMaxHours < 0) {
    throw new Error("scheduled publish jitter is invalid");
  }
  const runHash = [...args.runId].reduce(
    (hash, char) => (hash * 33 + char.charCodeAt(0)) >>> 0,
    5381,
  );
  const jitterHours = (runHash / 0xffff_ffff) * jitterMaxHours;
  return Math.trunc(args.runStartedAt + (offsetHours + jitterHours) * HOUR_MS);
}

export function assertScheduledPublishIsFuture(
  publishAt: number,
  now: number,
  minimumLeadMs = MIN_SCHEDULED_PUBLISH_LEAD_MS,
): void {
  const timestamp = scheduledTimestamp(publishAt);
  if (!Number.isFinite(now) || !Number.isFinite(minimumLeadMs) || minimumLeadMs < 0) {
    throw new Error("scheduled publish validation inputs are invalid");
  }
  if (timestamp < now + minimumLeadMs) {
    throw new Error("pinned scheduled publish time is no longer safely in the future");
  }
}
