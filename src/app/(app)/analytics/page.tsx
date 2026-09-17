"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { Chart, compact, type ChartSeries } from "@/components/Chart";
import { IconAnalytics, IconExternal } from "@/components/icons";
import { fmtUsd } from "@/lib/format";
import { QualityLearningPanel } from "@/components/QualityLearningPanel";
import {
  qualityLearningInsightsFromUnknown,
  type QualityLearningInsight,
} from "@/lib/qualityLearningPresentation";
import {
  analyticsRefreshFleetHealth,
  analyticsRefreshHealth,
  type AnalyticsRefreshHealthInput,
} from "@/lib/analyticsRefreshPresentation";
import {
  analyticsDataFreshness,
  type AnalyticsDataFreshness,
} from "@/lib/analyticsDataFreshness";
import {
  ANALYTICS_FLEET_PAGE_SIZE,
  nextAnalyticsFleetLimit,
} from "@/lib/analyticsFleetPresentation";
import { layoutAnalyticsEfficiencyField } from "@/lib/analyticsEfficiencyField";
import styles from "./analytics.module.css";

/** Per-channel summary row shape returned by analytics.channelSummary. */
type SummaryRow = {
  channelId: string;
  name: string;
  slug: string;
  niche: string | null;
  subscriberCount: number;
  totalViews: number;
  videoCount: number;
  costTotal: number;
};

/** Daily trend row shape returned by analytics.channelTrend. */
type TrendRow = {
  date: string;
  totalViews: number;
  subscriberCount: number;
  subscriberDelta: number;
  videoCount: number;
  estimatedRevenueUsd?: number;
};

type RefreshStatusRow = AnalyticsRefreshHealthInput & {
  channelId: string;
  name: string;
  slug: string;
  latestSnapshotDate: string | null;
  connection: null | (NonNullable<AnalyticsRefreshHealthInput["connection"]> & {
    validatedAt: number | null;
    updatedAt: number;
  });
  refresh: null | (NonNullable<AnalyticsRefreshHealthInput["refresh"]> & {
    historyCompletedAt: number | null;
    freshnessNextAt: number | null;
    updatedAt: number;
  });
};

type AnalyticsDashboardSnapshot = {
  overview: {
    totalSubscribers: number;
    totalViews: number;
    totalCost: number;
    planningCost: number;
    videoCount: number;
    channelCount: number;
  };
  summary: SummaryRow[];
  refreshStatus: RefreshStatusRow[];
};

const C_ACCENT = "var(--color-accent)";
const C_SECONDARY = "var(--color-secondary)";
const C_OK = "var(--color-ok)";
const C_AMBER = "var(--color-amber)";

export default function AnalyticsPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();

  const dashboard = useQuery(api.analytics.dashboardSnapshot, { ownerId }) as
    | AnalyticsDashboardSnapshot
    | undefined;
  const overview = dashboard?.overview;
  const summary = dashboard?.summary;
  const refreshStatus = dashboard?.refreshStatus;

  // Resolve the selected channel (if any) → drives the per-channel trend query.
  const selected = useMemo(
    () => summary?.find((s) => s.slug === selectedSlug) ?? null,
    [summary, selectedSlug],
  );
  const trend = useQuery(
    api.analytics.channelTrend,
    selected
      ? {
          ownerId,
          channelId: selected.channelId as Id<"channels">,
          days: 90,
        }
      : "skip",
  ) as TrendRow[] | undefined;
  const [qualityLearning, setQualityLearning] = useState<{
    state: "loading" | "locked" | "ready" | "unavailable";
    insights: readonly QualityLearningInsight[];
  }>({ state: "loading", insights: [] });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const accessResponse = await fetch("/api/operations/elevation", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const access = await accessResponse.json().catch(() => ({})) as {
          elevated?: boolean;
          role?: string;
        };
        if (!accessResponse.ok) throw new Error(`operations access request failed (${accessResponse.status})`);
        if (access.elevated !== true || access.role !== "owner") {
          if (!controller.signal.aborted) setQualityLearning({ state: "locked", insights: [] });
          return;
        }

        const response = await fetch("/api/learning-recommendations", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`quality learning request failed (${response.status})`);
        const payload = await response.json() as { recommendations?: unknown };
        if (!controller.signal.aborted) {
          setQualityLearning({ state: "ready", insights: qualityLearningInsightsFromUnknown(payload.recommendations) });
        }
      } catch {
        if (!controller.signal.aborted) setQualityLearning({ state: "unavailable", insights: [] });
      }
    })();
    return () => controller.abort();
  }, []);

  const loading = overview === undefined || summary === undefined || refreshStatus === undefined;
  const hasTrend = (trend?.length ?? 0) > 0;
  const anyChannelData =
    (summary?.some((s) => s.subscriberCount > 0 || s.totalViews > 0) ?? false);
  const analyticsScope = useMemo(() => {
    if (!refreshStatus) return [];
    return selected
      ? refreshStatus.filter((row) => row.channelId === selected.channelId)
      : refreshStatus;
  }, [refreshStatus, selected]);
  const dataFreshness = useMemo(
    () => analyticsDataFreshness(analyticsScope),
    [analyticsScope],
  );

  return (
    <div className={styles.dashboard}>
      <AnalyticsHero
        loading={loading}
        selected={selected}
        totalSubscribers={overview?.totalSubscribers ?? 0}
        totalViews={overview?.totalViews ?? 0}
        totalCost={overview?.totalCost ?? 0}
        videoCount={overview?.videoCount ?? 0}
        channelCount={overview?.channelCount ?? 0}
        freshness={dataFreshness}
      />

      {loading ? (
        <div className={styles.loadingRoom}>
          <span>Binding YouTube observations, retained artifacts, and refresh receipts…</span>
          <SkeletonList rows={4} />
        </div>
      ) : (
        <>
          <AnalyticsRefreshHealth rows={refreshStatus ?? []} selectedSlug={selected?.slug ?? null} />

          {!selected && (
            <AnalyticsSnapshotMap
              rows={summary ?? []}
              freshness={dataFreshness}
            />
          )}

          {/* Charts gate: nothing populated until stats-refresh has run. */}
          {!anyChannelData && !hasTrend ? (
            <EmptyState
              title="No analytics yet"
              description={emptyAnalyticsDetail(refreshStatus ?? [], selected?.slug ?? null)}
              icon={<IconAnalytics width={24} height={24} />}
            />
          ) : selected ? (
            <PerChannelCharts row={selected} trend={trend ?? []} freshness={dataFreshness} />
          ) : (
            <FleetComparison rows={summary ?? []} freshness={dataFreshness} />
          )}

          <QualityLearningPanel
            state={qualityLearning.state}
            insights={qualityLearning.insights}
            channelNames={new Map((summary ?? []).map((row) => [row.channelId, row.name]))}
            {...(selected ? { selectedChannelId: selected.channelId } : {})}
          />

          {/* Competitors for the selected channel's niche. */}
          <CompetitorsSection ownerId={ownerId} selected={selected} />
        </>
      )}
    </div>
  );
}

function AnalyticsHero({
  loading,
  selected,
  totalSubscribers,
  totalViews,
  totalCost,
  videoCount,
  channelCount,
  freshness,
}: {
  loading: boolean;
  selected: SummaryRow | null;
  totalSubscribers: number;
  totalViews: number;
  totalCost: number;
  videoCount: number;
  channelCount: number;
  freshness: AnalyticsDataFreshness;
}) {
  const scoped = selected ?? {
    subscriberCount: totalSubscribers,
    totalViews,
    costTotal: totalCost,
    videoCount,
  };
  return (
    <section className={styles.learningHero} aria-busy={loading}>
      <div className={styles.heroLead}>
        <span className={styles.eyebrow}>YouTube analytics</span>
        <h1>{selected ? selected.name : "Portfolio analytics"}</h1>
        <p>{freshness.state === "current"
          ? "Observed reach, committed spend, and released inventory."
          : `${freshness.detail} Spend and released inventory remain current records.`}</p>
      </div>

      <div className={styles.metricRail}>
        <HeroMetric
          index="01"
          label={freshness.state === "current" ? "Observed views" : "Recorded views"}
          value={loading ? "—" : compact(scoped.totalViews)}
          hint={freshness.state === "current"
            ? (selected ? "Latest channel snapshot" : "Latest fleet snapshots")
            : freshness.detail}
        />
        <HeroMetric
          index="02"
          label={freshness.state === "current" ? "Subscribers" : "Recorded subscribers"}
          value={loading ? "—" : compact(scoped.subscriberCount)}
          hint={freshness.state === "current"
            ? (selected ? "Current observed audience" : `${channelCount} channels in scope`)
            : freshness.detail}
          tone="live"
        />
        <HeroMetric
          index="03"
          label="Production spend"
          value={loading ? "—" : fmtUsd(scoped.costTotal)}
          hint="Persisted run cost, not revenue"
          tone="spend"
        />
        <HeroMetric
          index="04"
          label="Published inventory"
          value={loading ? "—" : scoped.videoCount}
          hint="Observed released videos"
        />
      </div>
    </section>
  );
}

/**
 * Persisted snapshots remain useful, but they must never outrank the operator's
 * connection health. Current observations open the map by default; a recorded
 * fleet keeps the same precise map available without presenting it as live.
 */
function AnalyticsSnapshotMap({ rows, freshness }: { rows: SummaryRow[]; freshness: AnalyticsDataFreshness }) {
  const open = freshness.state === "current";
  return (
    <details className={styles.snapshotMap} open={open}>
      <summary>
        <span>{open ? "Reach / spend map" : "Recorded snapshot map"}</span>
        <small>{open ? "Current channel observations" : "Open stored channel snapshots"}</small>
      </summary>
      <FleetEfficiencyField rows={rows} selectedChannelId={null} freshness={freshness} />
    </details>
  );
}

function HeroMetric({
  index,
  label,
  value,
  hint,
  tone,
}: {
  index: string;
  label: string;
  value: string | number;
  hint: string;
  tone?: "live" | "spend";
}) {
  return (
    <div className={styles.heroMetric} data-tone={tone}>
      <span>{index}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{hint}</em>
      </div>
    </div>
  );
}

function FleetEfficiencyField({
  rows,
  selectedChannelId,
  freshness,
}: {
  rows: SummaryRow[];
  selectedChannelId: string | null;
  freshness: AnalyticsDataFreshness;
}) {
  const nodes = layoutAnalyticsEfficiencyField(rows, selectedChannelId);

  return (
    <figure className={styles.efficiencyField}>
      <figcaption>
        <span>{freshness.state === "current" ? "Reach / spend field" : "Recorded reach / spend"}</span>
        <small>Node size = published inventory</small>
      </figcaption>
      <div className={styles.fieldPlot}>
        <svg viewBox="0 0 720 255" role="img" aria-label={`${freshness.label}: channel reach compared with production spend`}>
          <defs>
            <pattern id="analytics-field-grid" width="48" height="42" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 42" fill="none" stroke="currentColor" strokeWidth="1" opacity=".08" />
            </pattern>
            <radialGradient id="analytics-node" cx="35%" cy="30%">
              <stop offset="0" stopColor="var(--color-secondary)" />
              <stop offset="1" stopColor="rgba(125, 211, 192, .2)" />
            </radialGradient>
          </defs>
          <rect x="42" y="18" width="652" height="190" rx="8" fill="url(#analytics-field-grid)" />
          <line x1="42" y1="208" x2="694" y2="208" className={styles.fieldAxis} />
          <line x1="42" y1="18" x2="42" y2="208" className={styles.fieldAxis} />
          <text x="43" y="232" className={styles.fieldLabel}>LOWER SPEND</text>
          <text x="694" y="232" textAnchor="end" className={styles.fieldLabel}>HIGHER SPEND</text>
          <text x="28" y="110" textAnchor="middle" transform="rotate(-90 28 110)" className={styles.fieldLabel}>
            MORE {freshness.state === "current" ? "OBSERVED" : "RECORDED"} REACH
          </text>
          {nodes.map((node) => (
            <g key={node.channelId} data-selected={node.selected || undefined} className={styles.fieldNode}>
              {node.displaced ? (
                <line x1={node.rawX} y1={node.rawY} x2={node.x} y2={node.y} className={styles.fieldTruthLine} />
              ) : null}
              {node.label ? (
                <line x1={node.x} y1={node.y} x2={node.label.x} y2={node.label.y - 3} className={styles.fieldLeader} />
              ) : null}
              <circle cx={node.x} cy={node.y} r={node.radius + (node.selected ? 5 : 2)} className={styles.fieldNodeHalo} />
              <circle cx={node.x} cy={node.y} r={node.radius} fill="url(#analytics-node)">
                <title>{`${node.name}: ${compact(node.totalViews)} ${freshness.state === "current" ? "observed" : "recorded"} views · ${fmtUsd(node.costTotal)} spend · ${node.videoCount} videos.`}</title>
              </circle>
              {node.label ? (
                <text x={node.label.x} y={node.label.y} textAnchor={node.label.anchor} className={styles.fieldNodeLabel}>
                  {node.name.length > 18 ? `${node.name.slice(0, 17)}…` : node.name}
                </text>
              ) : null}
            </g>
          ))}
          {!rows.length && <text x="368" y="122" textAnchor="middle" className={styles.fieldEmpty}>No observed channel snapshots yet</text>}
        </svg>
        <div className={styles.fieldNodeActions} aria-label="Open channel analytics from the reach and spend field">
          {nodes.map((node) => (
            <Link
              key={node.channelId}
              href={`/channels/${node.slug}?tab=analytics`}
              className={styles.fieldNodeAction}
              style={{ left: `${(node.x / 720) * 100}%`, top: `${(node.y / 255) * 100}%` }}
              aria-label={`Open ${node.name} analytics`}
              title={`Open ${node.name} analytics`}
            />
          ))}
        </div>
      </div>
      <details className={styles.fieldMobileDirectory}>
        <summary>Open a channel from this graph <span>{nodes.length}</span></summary>
        <div>
          {nodes.map((node) => (
            <Link key={node.channelId} href={`/channels/${node.slug}?tab=analytics`}>
              <span>{node.name}</span>
              <small>{compact(node.totalViews)} {freshness.state === "current" ? "views" : "recorded views"} · {fmtUsd(node.costTotal)}</small>
            </Link>
          ))}
        </div>
      </details>
      <div className={styles.fieldLegend}>
        <span><i /> {freshness.state === "current" ? "Observed channel" : "Stored channel snapshot"}</span>
        <span>Open a node for channel analytics. Tied values fan out from their exact anchor.</span>
      </div>
    </figure>
  );
}

function emptyAnalyticsDetail(rows: RefreshStatusRow[], selectedSlug: string | null): string {
  const scoped = selectedSlug ? rows.find((row) => row.slug === selectedSlug) : rows[0];
  return scoped
    ? analyticsRefreshHealth(scoped).detail
    : "Create a channel and connect it to YouTube to begin scheduled analytics ingestion.";
}

function AnalyticsRefreshHealth({ rows, selectedSlug }: { rows: RefreshStatusRow[]; selectedSlug: string | null }) {
  const selectedRow = selectedSlug ? rows.find((row) => row.slug === selectedSlug) : null;
  if (!rows.length || (selectedSlug && !selectedRow)) return null;
  const fleet = selectedRow ? null : analyticsRefreshFleetHealth(rows);
  const healthRows = rows.map((row) => ({ row, health: analyticsRefreshHealth(row) }));
  const current = healthRows.filter(({ health }) => health.state === "current").length;
  const connected = healthRows.filter(({ health }) => health.state !== "not_connected").length;
  const actionableRows = healthRows.filter(({ health }) => health.state !== "current");
  const attention = actionableRows.filter(({ health }) => [
    "manual_reconciliation_required",
    "reconnect_required",
    "stale",
  ].includes(health.state)).length;
  return (
    <section className={styles.healthRoom}>
      <AnalyticsSectionHeading
        eyebrow="Data health"
        title="YouTube connection"
        detail="Refresh status and access scope."
      />
      <div className={styles.healthBand}>
        {selectedRow ? [selectedRow].map((row) => {
          const health = analyticsRefreshHealth(row);
          return (
            <article key={row.channelId} className={styles.healthCopy} data-tone={health.tone}>
              <span className={styles.healthGlyph} aria-hidden="true"><i /></span>
              <div>
                <small>{row.name}</small>
                <strong>{health.label}</strong>
                <p>{health.detail}</p>
                <em>
                  {row.refresh?.lastCompletedAt
                    ? `Last completed ${new Date(row.refresh.lastCompletedAt).toLocaleString()}`
                    : row.latestSnapshotDate
                      ? `Latest snapshot ${row.latestSnapshotDate}`
                      : "No completed snapshot yet"}
                </em>
              </div>
              {(health.state === "not_connected" || health.state === "reconnect_required") && (
                <Link href={`/channels/${row.slug}?tab=settings`}>Repair YouTube setup →</Link>
              )}
            </article>
          );
        }) : (
          <>
            <article className={styles.healthCopy} data-tone={fleet!.tone}>
              <span className={styles.healthGlyph} aria-hidden="true"><i /></span>
              <div>
                <small>Fleet refresh ledger</small>
                <strong>{fleet!.label}</strong>
                <p>{fleet!.detail}</p>
                <em>Connected channels refresh every six hours; ambiguous provider responses stop replay.</em>
              </div>
              {fleet!.needsAttention && <span className={styles.healthActionHint}>Choose a channel below</span>}
            </article>
            <div className={styles.healthMeasures}>
              <span><small>Current</small><strong>{current}</strong><em>trusted now</em></span>
              <span><small>Connected</small><strong>{connected}</strong><em>of {rows.length}</em></span>
              <span data-tone={attention ? "warn" : undefined}><small>Intervene</small><strong>{attention}</strong><em>stopped or overdue</em></span>
            </div>
          </>
        )}
      </div>
      {!selectedRow && actionableRows.length > 0 && (
        <nav className={styles.healthRepairLinks} aria-label="Repair channel connections">
          <span>Repair</span>
          {actionableRows.map(({ row, health }) => (
            <Link key={row.channelId} href={`/channels/${row.slug}?tab=settings`} title={health.detail}>
              {row.name}
            </Link>
          ))}
        </nav>
      )}
    </section>
  );
}

/** Per-channel time-series (subs, delta, views/day, revenue/day, videos/day). */
function PerChannelCharts({
  row,
  trend,
  freshness,
}: {
  row: SummaryRow;
  trend: TrendRow[];
  freshness: AnalyticsDataFreshness;
}) {
  const label = (d: string) => d.slice(5); // MM-DD
  const subs: ChartSeries = {
    name: "Subscribers",
    color: C_SECONDARY,
    points: trend.map((t) => ({ label: label(t.date), value: t.subscriberCount })),
  };
  const delta: ChartSeries = {
    name: "Subscriber delta",
    color: C_OK,
    points: trend.map((t) => ({ label: label(t.date), value: t.subscriberDelta })),
  };
  const views: ChartSeries = {
    name: "Views",
    color: C_ACCENT,
    points: trend.map((t) => ({ label: label(t.date), value: t.totalViews })),
  };
  const revenue: ChartSeries = {
    name: "Revenue / day",
    color: C_AMBER,
    points: trend.map((t) => ({
      label: label(t.date),
      value: t.estimatedRevenueUsd ?? 0,
    })),
  };
  const videos: ChartSeries = {
    name: "Published inventory",
    color: "var(--color-running)",
    points: trend.map((t) => ({ label: label(t.date), value: t.videoCount })),
  };
  const first = trend[0];
  const latest = trend.at(-1);
  const viewChange = (latest?.totalViews ?? 0) - (first?.totalViews ?? 0);
  const subscriberChange = (latest?.subscriberCount ?? 0) - (first?.subscriberCount ?? 0);

  return (
    <section className={styles.trendRoom}>
      <AnalyticsSectionHeading
        eyebrow="90 days"
        title={`${row.name}${freshness.state === "current" ? " trend" : " recorded trend"}`}
        detail={freshness.state === "current" ? "Daily and cumulative signals." : freshness.detail}
      />
      <div className={styles.trendSummary}>
        <span><small>Observed view change</small><strong>{viewChange >= 0 ? "+" : ""}{compact(viewChange)}</strong><em>first to latest snapshot</em></span>
        <span><small>Subscriber change</small><strong>{subscriberChange >= 0 ? "+" : ""}{compact(subscriberChange)}</strong><em>first to latest snapshot</em></span>
        <span><small>Evidence points</small><strong>{trend.length}</strong><em>persisted daily rows</em></span>
        <span><small>Latest observation</small><strong>{latest?.date ?? "—"}</strong><em>not a forecast</em></span>
      </div>
      <div className={styles.chartGrid}>
        <Chart title="Cumulative subscribers" series={[subs]} />
        <Chart title="Subscriber delta / day" series={[delta]} />
        <Chart title="Cumulative views" series={[views]} />
        <Chart
          title="Estimated revenue / day"
          series={[revenue]}
          formatValue={(n) => `$${n.toFixed(0)}`}
        />
        <Chart title="Published inventory" series={[videos]} formatValue={(n) => `${Math.round(n)}`} />
      </div>
    </section>
  );
}

type FleetMetric = "totalViews" | "subscriberCount" | "videoCount" | "costTotal";

const FLEET_METRICS: readonly { key: FleetMetric; label: string }[] = [
  { key: "totalViews", label: "Views" },
  { key: "subscriberCount", label: "Subscribers" },
  { key: "videoCount", label: "Published" },
  { key: "costTotal", label: "Spend" },
];

/** A categorical fleet comparison must use ranked bars, not a line that falsely
 * suggests the channels form a time sequence. */
function FleetComparison({ rows, freshness }: { rows: SummaryRow[]; freshness: AnalyticsDataFreshness }) {
  const [metric, setMetric] = useState<FleetMetric>("totalViews");
  const [visibleLimit, setVisibleLimit] = useState(ANALYTICS_FLEET_PAGE_SIZE);
  const ranked = [...rows].sort((left, right) => right[metric] - left[metric]);
  const visible = ranked.slice(0, visibleLimit);
  const remaining = Math.max(0, ranked.length - visible.length);
  const peak = Math.max(1, ...ranked.map((row) => row[metric]));
  const formatMetric = (value: number) => metric === "costTotal" ? fmtUsd(value) : compact(value);

  return (
    <section className={styles.comparisonRoom}>
      <AnalyticsSectionHeading
        eyebrow={freshness.state === "current" ? "Channels" : "Stored snapshots"}
        title={freshness.state === "current" ? "Performance comparison" : "Recorded comparison"}
        detail={freshness.state === "current" ? "Select a channel for its daily trend." : freshness.detail}
      />
      <div className={styles.metricTabs} role="tablist" aria-label="Fleet comparison metric">
        {FLEET_METRICS.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={metric === item.key}
            data-active={metric === item.key || undefined}
            key={item.key}
            onClick={() => {
              setMetric(item.key);
              setVisibleLimit(ANALYTICS_FLEET_PAGE_SIZE);
            }}
          >
            {item.key === "totalViews" && freshness.state !== "current" ? "Recorded views" : item.label}
          </button>
        ))}
      </div>
      <div className={styles.rankingGrid}>
        {visible.map((row, index) => (
          <Link className={styles.rankingRow} href={`/channels/${row.slug}?tab=analytics`} key={row.channelId}>
            <span className={styles.rankingIndex}>{String(index + 1).padStart(2, "0")}</span>
            <span className={styles.rankingIdentity}>
              <strong>{row.name}</strong>
              <small>{row.niche ?? "Niche not set"} · {row.videoCount} published</small>
            </span>
            <span className={styles.rankingBar} aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.max(0.015, row[metric] / peak)})` }} />
            </span>
            <strong className={styles.rankingValue}>{formatMetric(row[metric])}</strong>
            <span className={styles.rankingArrow}>↗</span>
          </Link>
        ))}
      </div>
      {remaining > 0 ? (
        <div className={styles.comparisonPaging}>
          <span>Showing {visible.length} of {ranked.length}</span>
          <button type="button" onClick={() => setVisibleLimit((current) => nextAnalyticsFleetLimit(current, ranked.length))}>
            Show next {Math.min(ANALYTICS_FLEET_PAGE_SIZE, remaining)}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function AnalyticsSectionHeading({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.sectionHeading}>
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <p>{detail}</p>
      {action}
    </header>
  );
}

/** Competitor top videos for the selected channel's niche. */
function CompetitorsSection({
  ownerId,
  selected,
}: {
  ownerId: string;
  selected: SummaryRow | null;
}) {
  const niche = selected?.niche ?? null;

  const competitors = useQuery(
    api.competitors.listCompetitors,
    niche ? { ownerId, niche } : "skip",
  );
  const intel = useQuery(
    api.seo.getNiche,
    niche ? { ownerId, niche } : "skip",
  );

  if (!selected) {
    return (
      <section className={styles.competitorRoom}>
        <AnalyticsSectionHeading
          eyebrow="Market"
          title="Competitor signals"
          detail="Select a channel to compare its niche."
        />
        <CompetitorPrompt title="Choose a channel" detail="Use the fleet selector above to load its niche comparison." />
      </section>
    );
  }

  if (!niche) {
    return (
      <section className={styles.competitorRoom}>
        <AnalyticsSectionHeading
          eyebrow="Market"
          title="Competitor signals"
          detail="Add a niche to compare channels."
        />
        <CompetitorPrompt
          title="No niche set"
          detail={`Add a niche to ${selected.name} before comparing its market.`}
          action={<Link href={`/channels/${selected.slug}?tab=identity`}>Open identity ↗</Link>}
        />
      </section>
    );
  }

  const loading = competitors === undefined || intel === undefined;

  // Flatten + sort top competitor videos by views.
  const topVideos =
    competitors
      ?.flatMap((c) =>
        c.topVideos.map((v) => ({ ...v, channelName: c.channelName })),
      )
      .sort((a, b) => b.views - a.views)
      .slice(0, 12) ?? [];

  return (
    <section className={styles.competitorRoom}>
      <AnalyticsSectionHeading
        eyebrow="Market"
        title={`Competitors — ${niche}`}
        detail="Top videos in this niche."
        action={<Link href="/seo">Open packaging research ↗</Link>}
      />

      {loading ? (
        <SkeletonList rows={3} />
      ) : topVideos.length === 0 ? (
        <CompetitorPrompt
          title="No competitor data yet"
          detail="Run packaging research to collect comparable videos."
          action={<Link href="/seo">Open research ↗</Link>}
        />
      ) : (
        <>
          {intel && (
            <div className={styles.competitorBenchmarks}>
              <span>
                Avg views (top 50):{" "}
                <strong>{compact(intel.avgViewsTop50)}</strong>
              </span>
              <span>
                Median views:{" "}
                <strong>{compact(intel.medianViewsTop50)}</strong>
              </span>
            </div>
          )}
          <div className={styles.competitorLedger}>
            {topVideos.map((v, index) => (
              <a
                key={v.youtubeVideoId}
                href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.competitorRow}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>
                    {v.title}
                  </strong>
                  <small>{v.channelName}</small>
                </div>
                <em>
                  {compact(v.views)} views
                </em>
                <i>↗</i>
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CompetitorPrompt({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.competitorPrompt}>
      <span aria-hidden="true"><IconExternal width={15} height={15} /></span>
      <div><strong>{title}</strong><small>{detail}</small></div>
      {action}
    </div>
  );
}
