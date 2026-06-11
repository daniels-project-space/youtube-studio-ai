"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Chart, type ChartSeries } from "./Chart";
import { SectionTitle } from "./PageHeader";

type Trend = {
  date: string;
  channelId: string;
  channelName: string;
  subscriberCount: number;
  totalViews: number;
  totalWatchHours: number;
  estimatedRevenueUsd: number;
};

// YouTube Partner Program thresholds.
const SUB_GOAL = 1000;
const WATCH_GOAL = 4000; // public watch hours (rolling 12mo)
const RPM = 2; // $ per 1000 views — fallback revenue estimate when no real RPM
const COLORS = ["var(--color-accent)", "var(--color-secondary)", "#34d399", "#f59e0b", "#f472b6", "#60a5fa"];
const short = (d: string) => d.slice(5); // MM-DD

export function GrowthCharts({ ownerId }: { ownerId: string }) {
  const rows = useQuery(api.analytics.ownerTrends, { ownerId, days: 60 }) as Trend[] | undefined;

  const built = useMemo(() => {
    const r = rows ?? [];
    const dates = [...new Set(r.map((x) => x.date))].sort();
    const channels = [...new Map(r.map((x) => [x.channelId, x.channelName])).entries()];

    // latest row per channel (for monetization + current totals)
    const latestByCh = new Map<string, Trend>();
    for (const x of r) {
      const cur = latestByCh.get(x.channelId);
      if (!cur || x.date > cur.date) latestByCh.set(x.channelId, x);
    }

    // Subscriber growth: one line per channel + a TOTAL line (sum across channels per date).
    const subSeries: ChartSeries[] = channels.map(([id, name], i) => ({
      name,
      color: COLORS[(i + 1) % COLORS.length],
      points: dates.map((d) => ({ label: short(d), value: r.find((x) => x.channelId === id && x.date === d)?.subscriberCount ?? NaN })).filter((p) => !Number.isNaN(p.value)),
    }));
    const totalSubs: ChartSeries = {
      name: "All channels",
      color: COLORS[0],
      points: dates.map((d) => ({ label: short(d), value: r.filter((x) => x.date === d).reduce((s, x) => s + x.subscriberCount, 0) })),
    };

    // Estimated revenue per date (use real estimatedRevenueUsd if any, else views×RPM).
    const anyRev = r.some((x) => x.estimatedRevenueUsd > 0);
    const revSeries: ChartSeries = {
      name: anyRev ? "Est. revenue" : "Est. revenue (views×RPM)",
      color: "#34d399",
      points: dates.map((d) => {
        const dayRows = r.filter((x) => x.date === d);
        const v = anyRev
          ? dayRows.reduce((s, x) => s + x.estimatedRevenueUsd, 0)
          : (dayRows.reduce((s, x) => s + x.totalViews, 0) * RPM) / 1000;
        return { label: short(d), value: Number(v.toFixed(2)) };
      }),
    };

    const mon = channels.map(([id, name]) => {
      const l = latestByCh.get(id);
      return {
        name,
        subs: l?.subscriberCount ?? 0,
        watch: l?.totalWatchHours ?? 0,
      };
    });

    return { hasData: r.length > 0, subSeries: [totalSubs, ...subSeries], revSeries: [revSeries], mon };
  }, [rows]);

  return (
    <section style={{ marginBottom: "1.8rem" }}>
      <SectionTitle>Growth &amp; monetization</SectionTitle>
      {!built.hasData ? (
        <div className="glass" style={{ padding: "1.1rem 1.2rem", color: "var(--color-muted)", fontSize: "0.86rem" }}>
          No analytics yet — subscriber, watch-time and revenue numbers populate once the YouTube Analytics connection is live (the daily stats-refresh writes them).
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "0.9rem" }}>
            <Chart title="Subscriber growth" series={built.subSeries} formatValue={(n) => String(Math.round(n))} />
            <Chart title="Estimated revenue" series={built.revSeries} formatValue={(n) => `$${n.toFixed(2)}`} />
          </div>
          <div className="glass" style={{ padding: "1.1rem 1.2rem", marginTop: "0.9rem" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.9rem" }}>Goal toward monetization (1,000 subs · 4,000 watch hrs)</div>
            <div style={{ display: "grid", gap: "1rem" }}>
              {built.mon.map((m) => (
                <div key={m.name} style={{ display: "grid", gap: "0.45rem" }}>
                  <div style={{ fontSize: "0.82rem", fontWeight: 500 }}>{m.name}</div>
                  <GoalBar label="Subscribers" value={m.subs} goal={SUB_GOAL} color="var(--color-accent)" />
                  <GoalBar label="Watch hours" value={m.watch} goal={WATCH_GOAL} color="var(--color-secondary)" />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function GoalBar({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / goal) * 100));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px 1fr 120px", alignItems: "center", gap: "0.6rem", fontSize: "0.76rem" }}>
      <span style={{ color: "var(--color-muted)" }}>{label}</span>
      <span style={{ height: 9, borderRadius: 5, background: "var(--color-surface)", overflow: "hidden", display: "block" }}>
        <span style={{ display: "block", height: "100%", width: `${pct}%`, background: color, minWidth: value > 0 ? 3 : 0 }} />
      </span>
      <span style={{ textAlign: "right", color: "var(--color-fg)" }}>
        {value.toLocaleString()} / {goal.toLocaleString()} ({pct.toFixed(pct < 10 ? 1 : 0)}%)
      </span>
    </div>
  );
}
