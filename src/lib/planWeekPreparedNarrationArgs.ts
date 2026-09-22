import { planWeekPreparationKey } from "./planWeekPreparation";

export interface PlanWeekPreparedNarrationArgs {
  ownerId: string;
  channelId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
  manifestKey: string;
  manifestSha256: string;
  maxCostUsd: number;
  provider?: "fish" | "elevenlabs" | "qwen3";
  speaker?: string;
  language?: string;
  speed?: number;
  baseGapSec?: number;
  jitterSec?: number;
}

function safePart(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)) {
    throw new Error(`weekly prepared narration ${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value.trim().toLowerCase())) {
    throw new Error(`weekly prepared narration ${label} is invalid`);
  }
  return value.trim().toLowerCase();
}

function safeNumber(value: unknown, label: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`weekly prepared narration ${label} is invalid`);
  }
  return value;
}

export function assertPlanWeekPreparedNarrationArgs(value: unknown): PlanWeekPreparedNarrationArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared narration payload is invalid");
  const raw = value as Record<string, unknown>;
  const ownerId = safePart(raw.ownerId, "owner id");
  const channelId = safePart(raw.channelId, "channel id");
  const channelSlug = safePart(raw.channelSlug, "channel slug");
  const batchId = safePart(raw.batchId, "batch id");
  const itemId = safePart(raw.itemId, "item id");
  const manifestSha256 = digest(raw.manifestSha256, "manifest digest");
  const manifestKey = typeof raw.manifestKey === "string" ? raw.manifestKey : "";
  if (manifestKey !== planWeekPreparationKey({ ownerId, channelSlug, batchId, itemId })) {
    throw new Error("weekly prepared narration manifest key is not canonical");
  }
  const maxCostUsd = raw.maxCostUsd;
  if (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 100) {
    throw new Error("weekly prepared narration maxCostUsd must be greater than zero and no more than 100");
  }
  const provider = raw.provider === undefined ? undefined : raw.provider;
  if (provider !== undefined && provider !== "fish" && provider !== "elevenlabs" && provider !== "qwen3") {
    throw new Error("weekly prepared narration provider is invalid");
  }
  const speed = safeNumber(raw.speed, "speed", 0.85, 1.15);
  const baseGapSec = safeNumber(raw.baseGapSec, "base gap", 0.2, 2.1);
  const jitterSec = safeNumber(raw.jitterSec, "gap jitter", 0, 0.35);
  return {
    ownerId, channelId, channelSlug, batchId, itemId, manifestKey, manifestSha256, maxCostUsd,
    ...(provider === undefined ? {} : { provider }),
    ...(typeof raw.speaker === "string" && raw.speaker.trim() ? { speaker: raw.speaker.trim() } : {}),
    ...(typeof raw.language === "string" && raw.language.trim() ? { language: raw.language.trim() } : {}),
    ...(speed === undefined ? {} : { speed }),
    ...(baseGapSec === undefined ? {} : { baseGapSec }),
    ...(jitterSec === undefined ? {} : { jitterSec }),
  };
}
