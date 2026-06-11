"use client";

import { useMemo } from "react";
import { Chart } from "./Chart";
import { SectionTitle } from "./PageHeader";
import { dailyBuckets, outcomeTally, runsByChannel, type StatRun } from "@/lib/runStats";

/**
 * Dashboard analytics panel built from real run data (no extra round-trips):
 *  - Renders per day (14d)
 *  - Spend per day (14d)
 *  - Outcomes breakdown (ok / failed / other)
 *  - optional Runs-by-channel bars (all-channels overview)
 */
export function StatsCharts({ runs, showByChannel = false }: { runs: StatRun[]; showByChannel?: boolean }) {
  const days = 14;
  const buckets = useMemo(() => dailyBuckets(runs, days), [runs]);
  const tally = useMemo(() => outcomeTally(runs), [runs]);
  const byChannel = useMemo(() => (showByChannel ? runsByChannel(runs) : []), [runs, showByChannel]);

  const renders = [{ name: "Renders", color: "var(--color-accent)", points: buckets.map((b) => ({ label: b.label, value: b.count })) }];
  const spend = [{ name: "Spend", color: "var(--color-secondary)", points: buckets.map((b) => ({ label: b.label, value: Number(b.cost.toFixed(2)) })) }];

  return (
    <section style={{ marginBottom: "1.6rem" }}>
      <SectionTitle>Activity (last {days} days)</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "0.9rem" }}>
        <Chart title="Renders / day" series={renders} formatValue={(n) => String(Math.round(n))} />
        <Chart title="Spend / day (USD)" series={spend} formatValue={(n) => `$${n.toFixed(2)}`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: showByChannel ? "1fr 1fr" : "1fr", gap: "0.9rem", marginTop: "0.9rem" }}>
        <OutcomeCard ok={tally.ok} failed={tally.failed} other={tally.other} total={tally.total} />
        {showByChannel && byChannel.length > 0 && <ByChannelCard rows={byChannel} />}
      </div>
    </section>
  );
}

function OutcomeCard({ ok, failed, other, total }: { ok: number; failed: number; other: number; total: number }) {
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div className="glass" style={{ padding: "1.1rem 1.2rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.8rem" }}>Outcomes ({total} runs)</div>
      <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "var(--color-surface)" }}>
        {ok > 0 && <div style={{ width: `${pct(ok)}%`, background: "var(--color-ok)" }} />}
        {failed > 0 && <div style={{ width: `${pct(failed)}%`, background: "var(--color-failed)" }} />}
        {other > 0 && <div style={{ width: `${pct(other)}%`, background: "var(--color-queued, #888)" }} />}
      </div>
      <div style={{ display: "flex", gap: "1.2rem", marginTop: "0.8rem", fontSize: "0.8rem", color: "var(--color-muted)" }}>
        <Legend color="var(--color-ok)" label="Completed" n={ok} />
        <Legend color="var(--color-failed)" label="Failed" n={failed} />
        {other > 0 && <Legend color="var(--color-queued, #888)" label="Other" n={other} />}
      </div>
    </div>
  );
}

function ByChannelCard({ rows }: { rows: { name: string; count: number }[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="glass" style={{ padding: "1.1rem 1.2rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.8rem" }}>Runs by channel</div>
      <div style={{ display: "grid", gap: "0.55rem" }}>
        {rows.slice(0, 6).map((r) => (
          <div key={r.name} style={{ display: "grid", gridTemplateColumns: "120px 1fr 28px", alignItems: "center", gap: "0.6rem", fontSize: "0.8rem" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-muted)" }}>{r.name}</span>
            <span style={{ height: 8, borderRadius: 4, background: "var(--color-accent)", width: `${(r.count / max) * 100}%`, minWidth: 4 }} />
            <span style={{ textAlign: "right", color: "var(--color-fg)" }}>{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
      {label} <strong style={{ color: "var(--color-fg)" }}>{n}</strong>
    </span>
  );
}
