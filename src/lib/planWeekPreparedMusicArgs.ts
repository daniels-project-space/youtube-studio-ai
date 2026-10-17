import type { MusicProvider } from "@/lib/musicTypes";
import { planWeekPreparationKey } from "@/lib/planWeekPreparation";

export interface PlanWeekPreparedMusicArgs {
  ownerId: string;
  channelId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
  manifestKey: string;
  manifestSha256: string;
  maxCostUsd: number;
  provider?: MusicProvider;
  trackCount?: number;
  model?: string;
  preferWav?: boolean;
}

function safePart(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)) {
    throw new Error(`weekly prepared music ${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value.trim().toLowerCase())) {
    throw new Error(`weekly prepared music ${label} is invalid`);
  }
  return value.trim().toLowerCase();
}

export function assertPlanWeekPreparedMusicArgs(value: unknown): PlanWeekPreparedMusicArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared music payload is invalid");
  const raw = value as Record<string, unknown>;
  const ownerId = safePart(raw.ownerId, "owner id");
  const channelId = safePart(raw.channelId, "channel id");
  const channelSlug = safePart(raw.channelSlug, "channel slug");
  const batchId = safePart(raw.batchId, "batch id");
  const itemId = safePart(raw.itemId, "item id");
  const manifestSha256 = digest(raw.manifestSha256, "manifest digest");
  const manifestKey = typeof raw.manifestKey === "string" ? raw.manifestKey : "";
  if (manifestKey !== planWeekPreparationKey({ ownerId, channelSlug, batchId, itemId })) throw new Error("weekly prepared music manifest key is not canonical");
  if (typeof raw.maxCostUsd !== "number" || !Number.isFinite(raw.maxCostUsd) || raw.maxCostUsd <= 0 || raw.maxCostUsd > 100) throw new Error("weekly prepared music maxCostUsd must be greater than zero and no more than 100");
  const provider = raw.provider;
  if (provider !== undefined && provider !== "mureka" && provider !== "suno" && provider !== "minimax_music3") throw new Error("weekly prepared music provider is invalid");
  const trackCount = raw.trackCount === undefined ? undefined : Number(raw.trackCount);
  if (trackCount !== undefined && (!Number.isSafeInteger(trackCount) || trackCount < 1 || trackCount > 8)) throw new Error("weekly prepared music trackCount must be between 1 and 8");
  return {
    ownerId, channelId, channelSlug, batchId, itemId, manifestKey, manifestSha256, maxCostUsd: raw.maxCostUsd,
    ...(provider === undefined ? {} : { provider }), ...(trackCount === undefined ? {} : { trackCount }),
    ...(typeof raw.model === "string" && raw.model.trim() ? { model: raw.model.trim() } : {}),
    ...(raw.preferWav === true ? { preferWav: true } : {}),
  };
}
