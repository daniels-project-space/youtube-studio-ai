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
import type { VideoRow } from "@/lib/types";
import { ArtifactWorkRail } from "@/components/ArtifactWorkRail";
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

const C_ACCENT = "var(--color-accent)";
const C_SECONDARY = "var(--color-secondary)";
const C_OK = "var(--color-ok)";
const C_AMBER = "var(--color-amber)";

export default function AnalyticsPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();

  const overview = useQuery(api.analytics.overview, { ownerId });
  const summary = useQuery(api.analytics.channelSummary, { ownerId }) as
    | SummaryRow[]
    | undefined;
  const refreshStatus = useQuery(api.analytics.refreshStatus, { ownerId }) as
    | RefreshStatusRow[]
    | undefined;

  // Resolve the selected channel (if any) → drives the per-channel trend query.
  const selected = useMemo(
    () => summary?.find((s) => s.slug === selectedSlug) ?? null,
    [summary, selectedSlug],
  );
  const recentWork = useQuery(
    api.videos.listVideos,
    selected
      ? {
          ownerId,
          channelId: selected.channelId as Id<"channels">,
          limit: 12,
        }
      : { ownerId, limit: 12 },
  ) as VideoRow[] | undefined;

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

  return (
    <div className={styles.dashboard}>
      <AnalyticsHero
        loading={loading}
        selected={selected}
        rows={summary ?? []}
        totalSubscribers={overview?.totalSubscribers ?? 0}
        totalViews={overview?.totalViews ?? 0}
        totalCost={overview?.totalCost ?? 0}
        videoCount={overview?.videoCount ?? 0}
        channelCount={overview?.channelCount ?? 0}
        refreshRows={refreshStatus ?? []}
      />

      {loading ? (
        <div className={styles.loadingRoom}>
          <span>Binding YouTube observations, retained artifacts, and refresh receipts…</span>
          <SkeletonList rows={4} />
        </div>
      ) : (
        <>
          <AnalyticsRefreshHealth rows={refreshStatus ?? []} selectedSlug={selected?.slug ?? null} />

          {/* Charts gate: nothing populated until stats-refresh has run. */}
          {!anyChannelData && !hasTrend ? (
            <EmptyState
              title="No analytics yet"
              description={emptyAnalyticsDetail(refreshStatus ?? [], selected?.slug ?? null)}
              icon={<IconAnalytics width={24} height={24} />}
            />
          ) : selected ? (
            <PerChannelCharts row={selected} trend={trend ?? []} />
          ) : (
            <FleetComparison rows={summary ?? []} />
          )}

          <QualityLearningPanel
            state={qualityLearning.state}
            insights={qualityLearning.insights}
            channelNames={new Map((summary ?? []).map((row) => [row.channelId, row.name]))}
            {...(selected ? { selectedChannelId: selected.channelId } : {})}
          />

          <ArtifactWorkRail
            videos={recentWork}
            title={selected ? `${selected.name} — visible work` : "Visible work behind the numbers"}
            description={selected
              ? "Persisted thumbnails and release provenance for the current channel—separate from forecasts and rollup metrics."
              : "The latest persisted video artifacts across your channels, so the analytics rollup stays connected to the work viewers actually see."}
            action={<Link href="/library">Open Library ↗</Link>}
            emptyMessage="No rendered or uploaded video artifacts match this analytics scope yet."
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
  rows,
  totalSubscribers,
  totalViews,
  totalCost,
  videoCount,
  channelCount,
  refreshRows,
}: {
  loading: boolean;
  selected: SummaryRow | null;
  rows: SummaryRow[];
  totalSubscribers: number;
  totalViews: number;
  totalCost: number;
  videoCount: number;
  channelCount: number;
  refreshRows: RefreshStatusRow[];
}) {
  const scoped = selected ?? {
    subscriberCount: totalSubscribers,
    totalViews,
    costTotal: totalCost,
    videoCount,
  };
  const observations = refreshRows.map((row) => analyticsRefreshHealth(row));
  const current = observations.filter((health) => health.state === "current").length;
  const refreshing = observations.filter((health) => health.state === "refreshing").length;
  const intervention = observations.filter((health) => [
    "manual_reconciliation_required",
    "reconnect_required",
    "stale",
  ].includes(health.state)).length;
  const fleet = refreshRows.length ? analyticsRefreshFleetHealth(refreshRows) : null;

  return (
    <section className={styles.learningHero} aria-busy={loading}>
      <div className={styles.heroLead}>
        <span className={styles.eyebrow}>YouTube analytics</span>
        <h1>{selected ? selected.name : "Channel performance"}</h1>
        <div className={styles.observationState} data-tone={fleet?.tone ?? "quiet"}>
          <span aria-hidden="true"><i /></span>
          <div>
            <small>{selected ? "Channel status" : "Data status"}</small>
            <strong>
              {loading
                ? "Loading YouTube data…"
                : selected
                  ? "Channel selected"
                  : fleet?.label ?? "No refresh ledger yet"}
            </strong>
            <em>
              {loading
                ? ""
                : `${current} current · ${refreshing} refreshing · ${intervention} need intervention`}
            </em>
          </div>
        </div>
      </div>

      <FleetEfficiencyField rows={rows} selectedChannelId={selected?.channelId ?? null} />

      <div className={styles.metricRail}>
        <HeroMetric
          index="01"
          label="Observed views"
          value={loading ? "—" : compact(scoped.totalViews)}
          hint={selected ? "Latest channel snapshot" : "Latest fleet snapshots"}
        />
        <HeroMetric
          index="02"
          label="Subscribers"
          value={loading ? "—" : compact(scoped.subscriberCount)}
          hint={selected ? "Current observed audience" : `${channelCount} channels in scope`}
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
}: {
  rows: SummaryRow[];
  selectedChannelId: string | null;
}) {
  const maxCost = Math.max(1, ...rows.map((row) => row.costTotal));
  const maxViews = Math.max(1, ...rows.map((row) => row.totalViews));
  const maxVideos = Math.max(1, ...rows.map((row) => row.videoCount));
  const labelled = new Set(
    [...rows]
      .sort((left, right) => right.totalViews - left.totalViews)
      .slice(0, 5)
      .map((row) => row.channelId),
  );

  return (
    <figure className={styles.efficiencyField}>
      <figcaption>
        <span>Reach / spend field</span>
        <small>Node size = published inventory</small>
      </figcaption>
      <svg viewBox="0 0 720 255" role="img" aria-label="Channel reach compared with production spend">
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
        <text x="28" y="110" textAnchor="middle" transform="rotate(-90 28 110)" className={styles.fieldLabel}>MORE OBSERVED REACH</text>
        {rows.map((row) => {
          const x = 58 + (row.costTotal / maxCost) * 614;
          const y = 194 - (row.totalViews / maxViews) * 156;
          const radius = 5 + Math.sqrt(row.videoCount / maxVideos) * 10;
          const selected = row.channelId === selectedChannelId;
          return (
            <g key={row.channelId} data-selected={selected || undefined} className={styles.fieldNode}>
              <circle cx={x} cy={y} r={radius + (selected ? 5 : 2)} className={styles.fieldNodeHalo} />
              <circle cx={x} cy={y} r={radius} fill="url(#analytics-node)">
                <title>{`${row.name}: ${compact(row.totalViews)} views · ${fmtUsd(row.costTotal)} spend · ${row.videoCount} videos`}</title>
              </circle>
              {(labelled.has(row.channelId) || selected) && (
                <text x={x} y={y - radius - 7} textAnchor="middle" className={styles.fieldNodeLabel}>
                  {row.name.length > 18 ? `${row.name.slice(0, 17)}…` : row.name}
                </text>
              )}
            </g>
          );
        })}
        {!rows.length && <text x="368" y="122" textAnchor="middle" className={styles.fieldEmpty}>No observed channel snapshots yet</text>}
      </svg>
      <div className={styles.fieldLegend}>
        <span><i /> Observed channel</span>
        <span>Axes use persisted totals; neither axis estimates revenue.</span>
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
  const attention = healthRows.filter(({ health }) => [
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
              {fleet!.needsAttention && <Link href="/channels">Review connections →</Link>}
            </article>
            <div className={styles.healthMeasures}>
              <span><small>Current</small><strong>{current}</strong><em>trusted now</em></span>
              <span><small>Connected</small><strong>{connected}</strong><em>of {rows.length}</em></span>
              <span data-tone={attention ? "warn" : undefined}><small>Intervene</small><strong>{attention}</strong><em>stopped or overdue</em></span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** Per-channel time-series (subs, delta, views/day, revenue/day, videos/day). */
function PerChannelCharts({
  row,
  trend,
}: {
  row: SummaryRow;
  trend: TrendRow[];
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
        title={`${row.name} trend`}
        detail="Daily and cumulative signals."
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
  { key: "totalViews", label: "Observed views" },
  { key: "subscriberCount", label: "Subscribers" },
  { key: "videoCount", label: "Published" },
  { key: "costTotal", label: "Spend" },
];

/** A categorical fleet comparison must use ranked bars, not a line that falsely
 * suggests the channels form a time sequence. */
function FleetComparison({ rows }: { rows: SummaryRow[] }) {
  const [metric, setMetric] = useState<FleetMetric>("totalViews");
  const ranked = [...rows].sort((left, right) => right[metric] - left[metric]);
  const peak = Math.max(1, ...ranked.map((row) => row[metric]));
  const formatMetric = (value: number) => metric === "costTotal" ? fmtUsd(value) : compact(value);

  return (
    <section className={styles.comparisonRoom}>
      <AnalyticsSectionHeading
        eyebrow="Channels"
        title="Performance comparison"
        detail="Select a channel for its daily trend."
      />
      <div className={styles.metricTabs} role="tablist" aria-label="Fleet comparison metric">
        {FLEET_METRICS.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={metric === item.key}
            data-active={metric === item.key || undefined}
            key={item.key}
            onClick={() => setMetric(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.rankingGrid}>
        {ranked.map((row, index) => (
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
        <EmptyState
          title="Select a channel"
          description="Choose a channel above."
          icon={<IconExternal width={24} height={24} />}
        />
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
        <EmptyState
          title="No niche set"
          description={`Set a niche for "${selected.name}" (in its identity) to unlock competitor intelligence.`}
          icon={<IconExternal width={24} height={24} />}
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
        <EmptyState
          title="No competitor data yet"
          description="Run SEO research to collect competitor videos."
          icon={<IconExternal width={24} height={24} />}
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
