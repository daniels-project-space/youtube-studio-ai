/**
 * Small process-local cache for public demand evidence.
 *
 * This is intentionally not a model-response cache: the values are public,
 * freshness-bound search results, and callers still own provider accounting.
 * In-flight promises are kept separately so equivalent concurrent planning
 * requests share one transport without turning a failed request into a cached
 * success.
 */
export interface PublicEvidenceCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  getInflight(key: string): Promise<T> | undefined;
  setInflight(key: string, request: Promise<T>): void;
  deleteInflight(key: string): void;
  clear(): void;
}

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 128;

/** Canonicalize equivalent public search seeds before cache lookup. */
export function normalizeEvidenceKey(seed: string): string {
  return seed.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function createPublicEvidenceCache<T>(
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
): PublicEvidenceCache<T> {
  const values = new Map<string, { expiresAt: number; value: T }>();
  const inflight = new Map<string, Promise<T>>();
  return {
    get(key) {
      const entry = values.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        values.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      values.delete(key);
      values.set(key, { expiresAt: Date.now() + ttlMs, value });
      while (values.size > maxEntries) {
        const oldest = values.keys().next().value;
        if (oldest === undefined) break;
        values.delete(oldest);
      }
    },
    delete(key) {
      values.delete(key);
    },
    getInflight(key) {
      return inflight.get(key);
    },
    setInflight(key, request) {
      inflight.set(key, request);
    },
    deleteInflight(key) {
      inflight.delete(key);
    },
    clear() {
      values.clear();
      inflight.clear();
    },
  };
}
