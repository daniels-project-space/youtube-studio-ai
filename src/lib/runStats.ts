/**
 * Client-side run aggregation for the dashboard charts. Pure functions over the
 * run rows the Convex queries already return (startedAt / status / costTotal) —
 * no extra round-trips. Used by the all-channels Overview and the channel hub.
 */
export interface StatRun {
  status: string;
  startedAt?: number;
  finishedAt?: number;
  costTotal?: number;
  channelName?: string;
}

export interface DayBucket {
  label: string; // "M/D"
  count: number;
  cost: number;
  ok: number;
  failed: number;
}

/** Bucket runs into the last `days` calendar days (oldest → newest). */
export function dailyBuckets(runs: StatRun[], days = 14, now = Date.now()): DayBucket[] {
  const DAY = 86_400_000;
  const startDay = new Date(now);
  startDay.setHours(0, 0, 0, 0);
  const start = startDay.getTime() - (days - 1) * DAY;
  const buckets: DayBucket[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * DAY);
    buckets.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0, cost: 0, ok: 0, failed: 0 });
  }
  for (const r of runs) {
    const t = r.startedAt ?? r.finishedAt ?? 0;
    if (t < start) continue;
    const idx = Math.floor((t - start) / DAY);
    if (idx < 0 || idx >= days) continue;
    const b = buckets[idx];
    b.count++;
    b.cost += r.costTotal ?? 0;
    if (r.status === "ok") b.ok++;
    else if (r.status === "failed") b.failed++;
  }
  return buckets;
}

/** Outcome tally across the supplied runs. */
export function outcomeTally(runs: StatRun[]): { ok: number; failed: number; other: number; total: number } {
  const ok = runs.filter((r) => r.status === "ok").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  return { ok, failed, other: runs.length - ok - failed, total: runs.length };
}

/** Count runs per channel name (desc), for the all-channels breakdown. */
export function runsByChannel(runs: StatRun[]): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of runs) {
    const n = r.channelName ?? "(unknown)";
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
