import { AsyncLocalStorage } from "node:async_hooks";

export type ConvexUsageCounts = Readonly<{ reads: number; writes: number; actions: number }>;

type MutableConvexUsageCounts = { reads: number; writes: number; actions: number };

const usageStorage = new AsyncLocalStorage<MutableConvexUsageCounts>();

/** Count Convex HTTP calls only inside an active module scope. */
export function recordConvexHttpRequest(input: RequestInfo | URL): void {
  const counts = usageStorage.getStore();
  if (!counts) return;
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let pathname: string;
  try {
    pathname = new URL(href, "http://convex.local").pathname;
  } catch {
    return;
  }
  if (["/api/query", "/api/query_ts", "/api/query_at_ts"].includes(pathname)) {
    counts.reads += 1;
  } else if (pathname === "/api/mutation") {
    counts.writes += 1;
  } else if (pathname === "/api/action") {
    counts.actions += 1;
  }
}

export function createConvexUsageScope(): {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  snapshot: () => ConvexUsageCounts;
} {
  const counts: MutableConvexUsageCounts = { reads: 0, writes: 0, actions: 0 };
  return {
    run: <T>(fn: () => Promise<T>) => usageStorage.run(counts, fn),
    snapshot: () => ({ ...counts }),
  };
}
