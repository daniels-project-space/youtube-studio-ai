/**
 * Async-context image-generation accounting.
 *
 * Every successful provider response is recorded in the block-local scope
 * installed by the runner. AsyncLocalStorage keeps concurrent Trigger jobs
 * isolated; process-global compatibility counters must never be used for
 * authoritative billing.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

export interface ImageUsageRecord {
  provider: string;
  model: string;
  /** Provider/model route used to select the request schema and price. */
  route: string;
  /** Number of billable images returned by this provider response. */
  images: number;
  /** Actual provider-reported output dimensions when available. */
  width?: number;
  height?: number;
  /** Exact known charge for this successful provider response. */
  costUsd: number;
}

export interface ImageUsageSummary {
  calls: number;
  cacheHits: number;
  images: number;
  megapixels: number;
  costUsd: number;
  records: ImageUsageRecord[];
}

interface ScopeState {
  records: ImageUsageRecord[];
  responses: Map<string, unknown>;
  cacheHits: number;
}

const storage = new AsyncLocalStorage<ScopeState>();

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/** Record one successful, billable image-provider response. */
export function recordImageUsage(record: ImageUsageRecord): ImageUsageRecord {
  const images = Math.max(1, Math.floor(finitePositive(record.images) ?? 1));
  const width = finitePositive(record.width);
  const height = finitePositive(record.height);
  if (!Number.isFinite(record.costUsd) || record.costUsd < 0) {
    throw new Error("image usage requires an exact non-negative cost");
  }
  const costUsd = record.costUsd;
  const normalized: ImageUsageRecord = {
    provider: record.provider.trim().toLowerCase(),
    model: record.model.trim().toLowerCase(),
    route: record.route.trim().toLowerCase(),
    images,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    costUsd,
  };
  storage.getStore()?.records.push(normalized);
  return normalized;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`)
    .join(",")}}`;
}

export function imageRequestCacheKey(
  provider: string,
  model: string,
  request: unknown,
): string {
  return createHash("sha256")
    .update(provider.trim().toLowerCase())
    .update("\u0000")
    .update(model.trim().toLowerCase())
    .update("\u0000")
    .update(stableJson(request))
    .digest("hex");
}

export function getCachedImageResponse<T>(key: string): T | undefined {
  const state = storage.getStore();
  if (!state || !state.responses.has(key)) return undefined;
  state.cacheHits++;
  return state.responses.get(key) as T;
}

/** Persist a paid provider receipt before any downstream CDN transport. */
export function cacheImageResponse(key: string, value: unknown): void {
  storage.getStore()?.responses.set(key, value);
}

function snapshot(state: ScopeState): ImageUsageSummary {
  const records = state.records.map((record) => ({ ...record }));
  return records.reduce<ImageUsageSummary>(
    (summary, record) => ({
      calls: summary.calls + 1,
      cacheHits: summary.cacheHits,
      images: summary.images + record.images,
      megapixels:
        summary.megapixels +
        (record.width !== undefined && record.height !== undefined
          ? (record.width * record.height * record.images) / 1_000_000
          : 0),
      costUsd: summary.costUsd + record.costUsd,
      records,
    }),
    {
      calls: 0,
      cacheHits: state.cacheHits,
      images: 0,
      megapixels: 0,
      costUsd: 0,
      records,
    },
  );
}

export function createImageUsageScope(): {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  snapshot: () => ImageUsageSummary;
} {
  const state: ScopeState = { records: [], responses: new Map(), cacheHits: 0 };
  return {
    run: <T>(fn: () => Promise<T>) => storage.run(state, fn),
    snapshot: () => snapshot(state),
  };
}
