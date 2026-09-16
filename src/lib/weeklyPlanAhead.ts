import { MAX_PLAN_WEEK_BULK_CHANNELS } from "@/lib/planWeekBulk";

export const DEFAULT_WEEKLY_PLAN_COUNT = 5;

export function parseWeeklyPlanCount(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_WEEKLY_PLAN_COUNT;
  if (!/^\d+$/.test(value)) throw new Error("STUDIO_WEEKLY_PLAN_COUNT must be an integer from 1 to 12");
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > 12) {
    throw new Error("STUDIO_WEEKLY_PLAN_COUNT must be an integer from 1 to 12");
  }
  return count;
}

export function currentUtcWeekStart(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("weekly plan timestamp is invalid");
  const date = new Date(now);
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
}

export function chunkWeeklyPlanChannels(channelIds: readonly string[]): string[][] {
  const normalized = [...new Set(channelIds.map((id) => id.trim()).filter(Boolean))].sort();
  const chunks: string[][] = [];
  for (let index = 0; index < normalized.length; index += MAX_PLAN_WEEK_BULK_CHANNELS) {
    chunks.push(normalized.slice(index, index + MAX_PLAN_WEEK_BULK_CHANNELS));
  }
  return chunks;
}
