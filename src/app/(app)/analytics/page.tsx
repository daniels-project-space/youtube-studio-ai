"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { Chart, compact, type ChartSeries } from "@/components/Chart";
import { IconAnalytics, IconChannels, IconExternal } from "@/components/icons";
import { fmtUsd } from "@/lib/format";

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

  const loading = overview === undefined || summary === undefined;
  const hasTrend = (trend?.length ?? 0) > 0;
  const anyChannelData =
    (summary?.some((s) => s.subscriberCount > 0 || s.totalViews > 0) ?? false);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={
          selected
            ? `Performance for ${selected.name}`
            : "Views, subscribers, revenue, and cost across your channels"
        }
      />

      {loading ? (
        <SkeletonList rows={4} />
      ) : (
        <div style={{ display: "grid", gap: "1.75rem" }}>
          {/* Rollup stat cards (global). */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "1rem",
            }}
          >
            <StatCard
              label="Subscribers"
              value={compact(overview?.totalSubscribers ?? 0)}
              hint={`${overview?.channelCount ?? 0} channels`}
              accent={C_SECONDARY}
              icon={<IconChannels width={18} height={18} />}
            />
            <StatCard
              label="Total views"
              value={compact(overview?.totalViews ?? 0)}
              hint="Latest snapshot"
              accent={C_ACCENT}
              icon={<IconAnalytics width={18} height={18} />}
            />
            <StatCard
              label="Total cost"
              value={fmtUsd(overview?.totalCost ?? 0)}
              hint="All runs to date"
              accent={C_AMBER}
            />
            <StatCard
              label="Videos"
              value={overview?.videoCount ?? 0}
              hint="Published"
              accent={C_OK}
            />
          </div>

          {/* Charts gate: nothing populated until stats-refresh has run. */}
          {!anyChannelData && !hasTrend ? (
            <EmptyState
              title="No analytics yet"
              description="Stats refresh pending. Once the stats-refresh task runs (every 6h, once the YouTube Data API key is provisioned), subscriber, view, revenue, and cost trends will appear here."
              icon={<IconAnalytics width={24} height={24} />}
            />
          ) : selected ? (
            <PerChannelCharts row={selected} trend={trend ?? []} />
          ) : (
            <GlobalCharts rows={summary ?? []} />
          )}

          {/* Competitors for the selected channel's niche. */}
          <CompetitorsSection ownerId={ownerId} selected={selected} />
        </div>
      )}
    </>
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
    name: "Videos",
    color: "var(--color-running)",
    points: trend.map((t) => ({ label: label(t.date), value: t.videoCount })),
  };

  return (
    <section>
      <SectionTitle>{row.name} — trends</SectionTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "1rem",
        }}
      >
        <Chart title="Subscribers" series={[subs]} />
        <Chart title="Subscriber delta / day" series={[delta]} />
        <Chart title="Views" series={[views]} />
        <Chart
          title="Estimated revenue / day"
          series={[revenue]}
          formatValue={(n) => `$${n.toFixed(0)}`}
        />
        <Chart title="Videos / day" series={[videos]} formatValue={(n) => `${Math.round(n)}`} />
      </div>
    </section>
  );
}

/** Global comparison across channels (one bar-like point per channel). */
function GlobalCharts({ rows }: { rows: SummaryRow[] }) {
  const subs: ChartSeries = {
    name: "Subscribers",
    color: C_SECONDARY,
    points: rows.map((r) => ({ label: short(r.name), value: r.subscriberCount })),
  };
  const views: ChartSeries = {
    name: "Views",
    color: C_ACCENT,
    points: rows.map((r) => ({ label: short(r.name), value: r.totalViews })),
  };
  const cost: ChartSeries = {
    name: "Cost",
    color: C_AMBER,
    points: rows.map((r) => ({ label: short(r.name), value: r.costTotal })),
  };
  const videos: ChartSeries = {
    name: "Videos",
    color: C_OK,
    points: rows.map((r) => ({ label: short(r.name), value: r.videoCount })),
  };

  return (
    <section>
      <SectionTitle>All channels — comparison</SectionTitle>
      <p
        style={{
          margin: "-0.4rem 0 0.85rem",
          color: "var(--color-faint)",
          fontSize: "0.82rem",
        }}
      >
        Select a channel in the top bar to see its day-by-day growth trends.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "1rem",
        }}
      >
        <Chart title="Subscribers by channel" series={[subs]} />
        <Chart title="Views by channel" series={[views]} />
        <Chart
          title="Cost by channel"
          series={[cost]}
          formatValue={(n) => `$${n.toFixed(0)}`}
        />
        <Chart title="Videos by channel" series={[videos]} formatValue={(n) => `${Math.round(n)}`} />
      </div>
    </section>
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
      <section>
        <SectionTitle>Competitors</SectionTitle>
        <EmptyState
          title="Select a channel"
          description="Pick a channel in the top bar to see competitor intelligence for its niche."
          icon={<IconExternal width={24} height={24} />}
        />
      </section>
    );
  }

  if (!niche) {
    return (
      <section>
        <SectionTitle>Competitors</SectionTitle>
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
    <section>
      <SectionTitle>Competitors — {niche}</SectionTitle>

      {loading ? (
        <SkeletonList rows={3} />
      ) : topVideos.length === 0 ? (
        <EmptyState
          title="No competitor data yet"
          description="Run research from the SEO page (or wait for the weekly refresh) to mine this niche's top competitor videos."
          icon={<IconExternal width={24} height={24} />}
        />
      ) : (
        <>
          {intel && (
            <div
              style={{
                display: "flex",
                gap: "1rem",
                flexWrap: "wrap",
                marginBottom: "1rem",
                fontSize: "0.84rem",
                color: "var(--color-muted)",
              }}
            >
              <span>
                Avg views (top 50):{" "}
                <strong style={{ color: "var(--color-fg)" }}>
                  {compact(intel.avgViewsTop50)}
                </strong>
              </span>
              <span>
                Median views:{" "}
                <strong style={{ color: "var(--color-fg)" }}>
                  {compact(intel.medianViewsTop50)}
                </strong>
              </span>
            </div>
          )}
          <div
            className="glass"
            style={{ padding: "0.5rem", display: "grid", gap: "0.25rem" }}
          >
            {topVideos.map((v) => (
              <a
                key={v.youtubeVideoId}
                href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="lift"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem",
                  padding: "0.6rem 0.7rem",
                  borderRadius: 10,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "0.88rem",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {v.title}
                  </div>
                  <div
                    style={{ fontSize: "0.74rem", color: "var(--color-faint)" }}
                  >
                    {v.channelName}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.82rem",
                    color: "var(--color-accent)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {compact(v.views)} views
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function short(name: string): string {
  return name.length > 10 ? `${name.slice(0, 9)}…` : name;
}
