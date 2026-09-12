import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import { planWeekReservation, type PlanWeekReservation } from "@/lib/planWeekBatch";

/** Shared admission contract for one owner/week fan-out across channels. */
export const PLAN_WEEK_BULK_CONTRACT_VERSION = "plan-week-bulk/v1" as const;
export const MAX_PLAN_WEEK_BULK_CHANNELS = 12;
/** Five episodes per channel is the normal weekly slate; keep a hard bound. */
export const MAX_PLAN_WEEK_BULK_ITEMS = 60;

export interface PlanWeekBulkRequest {
  ownerId: string;
  channelIds: string[];
  count: number;
  requestKey: string;
  budgetCapUsd?: number;
}

export interface PlanWeekBulkChannelOrder {
  channelId: string;
  count: number;
  requestKey: string;
  idempotencySeed: string;
  reservation: PlanWeekReservation;
}

export interface PlanWeekBulkOrder {
  contractVersion: typeof PLAN_WEEK_BULK_CONTRACT_VERSION;
  ownerId: string;
  requestKey: string;
  count: number;
  channels: PlanWeekBulkChannelOrder[];
  totalItems: number;
  reservedCostUsd: number;
  fingerprint: string;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`plan-week bulk ${label} is required`);
  }
  return value.trim();
}

function safeIdentifier(value: unknown, label: string): string {
  const id = requiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    throw new Error(`plan-week bulk ${label}s must be single safe identifiers`);
  }
  return id;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

function fingerprintPayload(order: Omit<PlanWeekBulkOrder, "fingerprint">): string {
  return createHash("sha256").update(canonicalJson(order)).digest("hex");
}

/**
 * Normalize one owner/week request into deterministic per-channel work. The
 * caller's order is never allowed to change idempotency or reservation math;
 * all channel IDs are sorted before the fingerprint is produced.
 */
export function buildPlanWeekBulkOrder(input: PlanWeekBulkRequest): PlanWeekBulkOrder {
  const ownerId = safeIdentifier(input.ownerId, "owner id");
  const requestKey = requiredText(input.requestKey, "request key");
  if (requestKey.length > 160) throw new Error("plan-week bulk request key is too long");
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 12) {
    throw new Error("plan-week bulk count must be an integer from 1 to 12");
  }
  if (!Array.isArray(input.channelIds) || input.channelIds.length < 1 ||
      input.channelIds.length > MAX_PLAN_WEEK_BULK_CHANNELS) {
    throw new Error(`plan-week bulk channel ids must contain 1..${MAX_PLAN_WEEK_BULK_CHANNELS} channels`);
  }
  const channelIds = input.channelIds.map((value) => safeIdentifier(value, "channel id")).sort();
  if (new Set(channelIds).size !== channelIds.length) {
    throw new Error("plan-week bulk channel ids must be unique");
  }
  const totalItems = channelIds.length * input.count;
  if (totalItems > MAX_PLAN_WEEK_BULK_ITEMS) {
    throw new Error(`plan-week bulk cannot exceed ${MAX_PLAN_WEEK_BULK_ITEMS} planned items`);
  }
  if (input.budgetCapUsd !== undefined &&
      (!Number.isFinite(input.budgetCapUsd) || input.budgetCapUsd <= 0)) {
    throw new Error("plan-week bulk budget cap must be a finite positive number");
  }
  const channels = channelIds.map((channelId) => {
    const reservation = planWeekReservation(input.count);
    return {
      channelId,
      count: input.count,
      requestKey: `${requestKey}:channel:${channelId}`,
      idempotencySeed: `plan-week-ahead:${ownerId}:${requestKey}:${channelId}`,
      reservation,
    };
  });
  const reservedCostUsd = roundUsd(channels.reduce((sum, channel) => sum + channel.reservation.totalUsd, 0));
  if (input.budgetCapUsd !== undefined && reservedCostUsd > input.budgetCapUsd + Number.EPSILON) {
    throw new Error(
      `plan-week bulk reservation $${reservedCostUsd.toFixed(4)} exceeds caller cap $${input.budgetCapUsd}`,
    );
  }
  const payload = {
    contractVersion: PLAN_WEEK_BULK_CONTRACT_VERSION as typeof PLAN_WEEK_BULK_CONTRACT_VERSION,
    ownerId,
    requestKey,
    count: input.count,
    channels,
    totalItems,
    reservedCostUsd,
  };
  return { ...payload, fingerprint: fingerprintPayload(payload) };
}

export function assertPlanWeekBulkOrder(value: unknown): PlanWeekBulkOrder {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("plan-week bulk order is invalid");
  }
  const order = value as PlanWeekBulkOrder;
  const rebuilt = buildPlanWeekBulkOrder({
    ownerId: order.ownerId,
    channelIds: Array.isArray(order.channels) ? order.channels.map((channel) => channel.channelId) : [],
    count: order.count,
    requestKey: order.requestKey,
  });
  if (
    order.contractVersion !== PLAN_WEEK_BULK_CONTRACT_VERSION ||
    !Array.isArray(order.channels) ||
    !Number.isSafeInteger(order.totalItems) ||
    !Number.isFinite(order.reservedCostUsd) ||
    order.totalItems !== rebuilt.totalItems ||
    Math.abs(order.reservedCostUsd - rebuilt.reservedCostUsd) > Number.EPSILON ||
    order.fingerprint !== rebuilt.fingerprint ||
    canonicalJson(order.channels) !== canonicalJson(rebuilt.channels)
  ) {
    throw new Error("plan-week bulk order fingerprint or reservation mismatch");
  }
  return rebuilt;
}
