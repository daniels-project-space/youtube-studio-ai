"use client";

import { useMemo } from "react";
import { Chart } from "./Chart";
import { SectionTitle } from "./PageHeader";
import { dailyBuckets, hasBucketActivity, outcomeTally, runsByChannel, type StatRun } from "@/lib/runStats";
import styles from "./StatsCharts.module.css";

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
  const hasRecentActivity = hasBucketActivity(buckets);

  if (runs.length === 0) return null;

  return (
    <section className={styles.section} data-recent-activity={hasRecentActivity}>
      {hasRecentActivity ? (
        <>
          <SectionTitle>{days}-day activity</SectionTitle>
          <div className={styles.charts}>
            <Chart title="Renders / day" series={renders} formatValue={(n) => String(Math.round(n))} />
            <Chart title="Spend / day (USD)" series={spend} formatValue={(n) => `$${n.toFixed(2)}`} />
          </div>
        </>
      ) : null}

      <div className={styles.outcomes} data-by-channel={showByChannel} data-after-charts={hasRecentActivity}>
        <OutcomeCard ok={tally.ok} failed={tally.failed} other={tally.other} total={tally.total} />
        {showByChannel && byChannel.length > 0 && <ByChannelCard rows={byChannel} />}
      </div>
    </section>
  );
}

function OutcomeCard({ ok, failed, other, total }: { ok: number; failed: number; other: number; total: number }) {
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div className={`glass ${styles.card}`}>
      <div className={styles.cardTitle}>Outcomes <span>{total} runs</span></div>
      <div className={styles.outcomeBar}>
        {ok > 0 && <div style={{ width: `${pct(ok)}%`, background: "var(--color-ok)" }} aria-label={`${ok} completed`} />}
        {failed > 0 && <div style={{ width: `${pct(failed)}%`, background: "var(--color-failed)" }} aria-label={`${failed} failed`} />}
        {other > 0 && <div style={{ width: `${pct(other)}%`, background: "var(--color-queued, #888)" }} aria-label={`${other} other`} />}
      </div>
      <div className={styles.legendRow}>
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
    <div className={`glass ${styles.card}`}>
      <div className={styles.cardTitle}>Runs by channel</div>
      <div className={styles.channelRows}>
        {rows.slice(0, 6).map((r) => (
          <div key={r.name} className={styles.channelRow}>
            <span>{r.name}</span>
            <span className={styles.channelBar} style={{ width: `${(r.count / max) * 100}%` }} />
            <strong>{r.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <span className={styles.legend}>
      <span style={{ background: color }} />
      {label} <strong>{n}</strong>
    </span>
  );
}
