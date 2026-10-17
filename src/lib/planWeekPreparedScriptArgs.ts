import { planWeekPreparationKey } from "@/lib/planWeekPreparation";

export interface PlanWeekPreparedScriptArgs {
  ownerId: string;
  channelId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
  manifestKey: string;
  manifestSha256: string;
  maxSeconds?: number;
  language?: string;
  style?: string;
  maxCostUsd: number;
}

function safePart(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)) {
    throw new Error(`weekly prepared script ${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value.trim().toLowerCase())) {
    throw new Error(`weekly prepared script ${label} is invalid`);
  }
  return value.trim().toLowerCase();
}

export function assertPlanWeekPreparedScriptArgs(value: unknown): PlanWeekPreparedScriptArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared script payload is invalid");
  const raw = value as Record<string, unknown>;
  const ownerId = safePart(raw.ownerId, "owner id");
  const channelId = safePart(raw.channelId, "channel id");
  const channelSlug = safePart(raw.channelSlug, "channel slug");
  const batchId = safePart(raw.batchId, "batch id");
  const itemId = safePart(raw.itemId, "item id");
  const manifestSha256 = digest(raw.manifestSha256, "manifest digest");
  const manifestKey = typeof raw.manifestKey === "string" ? raw.manifestKey : "";
  if (manifestKey !== planWeekPreparationKey({ ownerId, channelSlug, batchId, itemId })) {
    throw new Error("weekly prepared script manifest key is not canonical");
  }
  const maxSeconds = raw.maxSeconds === undefined ? 240 : raw.maxSeconds;
  if (typeof maxSeconds !== "number" || !Number.isFinite(maxSeconds) || maxSeconds < 30 || maxSeconds > 1_800) {
    throw new Error("weekly prepared script maxSeconds must be between 30 and 1800");
  }
  const maxCostUsd = raw.maxCostUsd;
  if (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 100) {
    throw new Error("weekly prepared script maxCostUsd must be greater than zero and no more than 100");
  }
  return {
    ownerId, channelId, channelSlug, batchId, itemId, manifestKey, manifestSha256,
    maxSeconds,
    ...(typeof raw.language === "string" && raw.language.trim() ? { language: raw.language.trim() } : {}),
    ...(typeof raw.style === "string" && raw.style.trim() ? { style: raw.style.trim() } : {}),
    maxCostUsd,
  };
}
