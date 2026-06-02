"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import type { ChannelIdentity, RunRow, VideoRow } from "@/lib/types";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { RunCard } from "@/components/RunCard";
import { StageBadge } from "@/components/StageBadge";
import { StatCard } from "@/components/StatCard";
import { Chart, compact, type ChartSeries } from "@/components/Chart";
import { VideoGrid } from "@/components/VideoGrid";
import { Lightbox } from "@/components/Lightbox";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { ChannelAvatar, ChannelBanner } from "@/components/ChannelArt";
import { fmtUsd } from "@/lib/format";

type ChannelDoc = {
  _id: string;
  ownerId: string;
  name: string;
  slug: string;
  status: string;
  template: string;
  budget: number;
  identity?: ChannelIdentity;
  pipeline?: { block: string; params?: unknown }[];
};

type RawRun = {
  _id: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  costTotal: number;
  youtubeVideoId?: string;
  error?: string;
};

type TrendRow = {
  date: string;
  subscriberCount: number;
  totalViews: number;
  videoCount: number;
};

const TABS = [
  "Overview",
  "Analytics",
  "Library",
  "SEO",
  "Pipeline",
  "Identity",
] as const;
type Tab = (typeof TABS)[number];

export default function ChannelHubPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const ownerId = useOwnerId();
  const [tab, setTab] = useState<Tab>("Overview");

  const channel = useQuery(api.channels.getChannelBySlug, {
    ownerId,
    slug,
  }) as ChannelDoc | null | undefined;

  const channelId = channel?._id as Id<"channels"> | undefined;
  const runs = useQuery(
    api.runs.listRunsByChannel,
    channelId ? { channelId } : "skip",
  ) as RawRun[] | undefined;

  if (channel === undefined) {
    return (
      <>
        <PageHeader title="Channel" />
        <SkeletonList rows={3} />
      </>
    );
  }
  if (channel === null) {
    return (
      <>
        <PageHeader title="Channel" />
        <EmptyState
          title="Channel not found"
          description={
            <>
              No channel with slug <code>{slug}</code>.{" "}
              <Link href="/channels" style={{ color: "var(--color-accent)" }}>
                Back to channels
              </Link>
            </>
          }
        />
      </>
    );
  }

  const id = channel.identity ?? {};
  const allRuns = runs ?? [];
  const videoRuns = allRuns.filter((r) => r.youtubeVideoId);
  const okRuns = allRuns.filter((r) => r.status === "ok");
  const failedRuns = allRuns.filter((r) => r.status === "failed");
  const totalCost = allRuns.reduce((s, r) => s + (r.costTotal ?? 0), 0);
  const costPerVideo = videoRuns.length > 0 ? totalCost / videoRuns.length : null;

  return (
    <>
      {/* Banner + identity header */}
      <ChannelBanner
        bannerKey={id.bannerKey}
        name={channel.name}
        palette={id.palette}
        height={170}
      >
        <div
          style={{
            position: "absolute",
            left: "1.4rem",
            right: "1.4rem",
            bottom: "1.1rem",
            display: "flex",
            alignItems: "flex-end",
            gap: "1rem",
          }}
        >
          <ChannelAvatar
            imageKey={id.imageKey}
            name={channel.name}
            palette={id.palette}
            size={76}
            radius={18}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "1.9rem",
                fontWeight: 600,
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              {channel.name}
            </h1>
            <div
              style={{
                marginTop: "0.3rem",
                fontSize: "0.82rem",
                color: "var(--color-muted)",
                display: "flex",
                gap: "0.7rem",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              {id.niche && <span>{id.niche}</span>}
              <span style={{ fontFamily: "var(--font-mono)" }}>{channel.slug}</span>
              <span>template {channel.template}</span>
            </div>
          </div>
          <StageBadge status={channel.status === "active" ? "ok" : "queued"} />
        </div>
      </ChannelBanner>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.3rem",
          margin: "1.2rem 0 1.5rem",
          borderBottom: "1px solid var(--color-border)",
          flexWrap: "wrap",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: "0.88rem",
              fontWeight: tab === t ? 600 : 500,
              color: tab === t ? "var(--color-fg)" : "var(--color-muted)",
              padding: "0.55rem 0.85rem",
              borderBottom:
                tab === t
                  ? "2px solid var(--color-accent)"
                  : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <OverviewTab
          channel={channel}
          runs={runs}
          kpis={{
            runs: allRuns.length,
            videos: videoRuns.length,
            completed: okRuns.length,
            failed: failedRuns.length,
            totalCost,
            costPerVideo,
          }}
        />
      )}
      {tab === "Analytics" && (
        <AnalyticsTab
          ownerId={ownerId}
          channelId={channelId}
          totalCost={totalCost}
          costPerVideo={costPerVideo}
          runs={allRuns}
        />
      )}
      {tab === "Library" && (
        <LibraryTab ownerId={ownerId} channelId={channelId} />
      )}
      {tab === "SEO" && <SeoTab ownerId={ownerId} niche={id.niche} />}
      {tab === "Pipeline" && <PipelineTab pipeline={channel.pipeline ?? []} />}
      {tab === "Identity" && <IdentityTab id={id} budget={channel.budget} />}
    </>
  );
}

/* ------------------------------- Overview ------------------------------- */

function OverviewTab({
  channel,
  runs,
  kpis,
}: {
  channel: ChannelDoc;
  runs: RawRun[] | undefined;
  kpis: {
    runs: number;
    videos: number;
    completed: number;
    failed: number;
    totalCost: number;
    costPerVideo: number | null;
  };
}) {
  const recent: RunRow[] = (runs ?? [])
    .map((r) => ({ ...r, channelName: channel.name, channelSlug: channel.slug }))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, 8);

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "0.9rem",
          marginBottom: "1.8rem",
        }}
      >
        <StatCard label="Runs" value={kpis.runs} />
        <StatCard label="Videos" value={kpis.videos} accent="var(--color-secondary)" />
        <StatCard label="Completed" value={kpis.completed} accent="var(--color-ok)" />
        <StatCard
          label="Total spend"
          value={fmtUsd(kpis.totalCost)}
          accent="var(--color-accent)"
        />
        <StatCard
          label="Cost / video"
          value={kpis.costPerVideo === null ? "—" : fmtUsd(kpis.costPerVideo)}
          accent="var(--color-accent)"
          hint={kpis.costPerVideo === null ? "no measured runs yet" : "measured from runs"}
        />
      </div>

      {channel.identity?.persona && (
        <section style={{ marginBottom: "1.6rem" }}>
          <SectionTitle>Persona</SectionTitle>
          <p
            className="glass"
            style={{
              padding: "1rem 1.2rem",
              fontSize: "0.92rem",
              color: "var(--color-muted)",
              lineHeight: 1.6,
            }}
          >
            {channel.identity.persona}
          </p>
        </section>
      )}

      <section>
        <SectionTitle>Recent runs</SectionTitle>
        {runs === undefined ? (
          <SkeletonList rows={3} />
        ) : recent.length > 0 ? (
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {recent.map((r) => (
              <RunCard key={r._id} run={r} />
            ))}
          </div>
        ) : (
          <EmptyState title="No runs for this channel yet" />
        )}
      </section>
    </>
  );
}

/* ------------------------------- Analytics ------------------------------ */

function AnalyticsTab({
  ownerId,
  channelId,
  totalCost,
  costPerVideo,
  runs,
}: {
  ownerId: string;
  channelId?: Id<"channels">;
  totalCost: number;
  costPerVideo: number | null;
  runs: RawRun[];
}) {
  const trend = useQuery(
    api.analytics.channelTrend,
    channelId ? { ownerId, channelId, days: 90 } : "skip",
  ) as TrendRow[] | undefined;

  const growth: ChartSeries[] = [
    {
      name: "Subscribers",
      color: "var(--color-accent)",
      points: (trend ?? []).map((r) => ({
        label: r.date.slice(5),
        value: r.subscriberCount,
      })),
    },
    {
      name: "Views",
      color: "var(--color-secondary)",
      points: (trend ?? []).map((r) => ({
        label: r.date.slice(5),
        value: r.totalViews,
      })),
    },
  ];

  // Cost per run over time (real, from runStages.cost rollup).
  const costSeries: ChartSeries[] = [
    {
      name: "Cost / run",
      color: "var(--color-accent)",
      points: runs
        .filter((r) => r.startedAt)
        .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
        .map((r) => ({
          label: new Date(r.startedAt ?? 0).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          value: r.costTotal ?? 0,
        })),
    },
  ];

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "0.9rem",
          marginBottom: "1.6rem",
        }}
      >
        <StatCard label="Total spend" value={fmtUsd(totalCost)} accent="var(--color-accent)" />
        <StatCard
          label="Cost / video"
          value={costPerVideo === null ? "—" : fmtUsd(costPerVideo)}
          accent="var(--color-accent)"
        />
      </div>

      <div style={{ display: "grid", gap: "1.2rem" }}>
        <Chart title="Audience growth (90d)" series={growth} formatValue={(n) => compact(n)} />
        <Chart title="Cost per run" series={costSeries} formatValue={(n) => `$${n.toFixed(2)}`} />
      </div>

      {trend !== undefined && trend.length === 0 && (
        <p style={{ marginTop: "1rem", fontSize: "0.82rem", color: "var(--color-faint)" }}>
          Audience metrics populate once the stats-refresh task runs (needs the
          YouTube Data API enabled). Cost is live from your runs.
        </p>
      )}
    </>
  );
}

/* ------------------------------- Library -------------------------------- */

function LibraryTab({
  ownerId,
  channelId,
}: {
  ownerId: string;
  channelId?: Id<"channels">;
}) {
  const videos = useQuery(
    api.videos.listVideos,
    channelId ? { ownerId, channelId, limit: 500 } : "skip",
  ) as VideoRow[] | undefined;
  const [index, setIndex] = useState<number | null>(null);

  if (videos === undefined) return <SkeletonList rows={3} />;
  if (videos.length === 0)
    return (
      <EmptyState
        title="No videos yet"
        description="Finished and published videos for this channel will appear here."
      />
    );

  return (
    <>
      <VideoGrid
        videos={videos}
        onOpen={(v) => setIndex(videos.findIndex((x) => x._id === v._id))}
      />
      {index !== null && index >= 0 && (
        <Lightbox
          videos={videos}
          index={index}
          onIndex={setIndex}
          onClose={() => setIndex(null)}
        />
      )}
    </>
  );
}

/* --------------------------------- SEO ---------------------------------- */

function SeoTab({ ownerId, niche }: { ownerId: string; niche?: string }) {
  const intel = useQuery(
    api.seo.getNiche,
    niche ? { ownerId, niche } : "skip",
  ) as
    | {
        powerWords?: { word: string; count: number }[];
        optimalTitleLen?: number;
        avgViewsTop50?: number;
        medianViewsTop50?: number;
        thumbnailStyleGuide?: { notes?: string };
      }
    | null
    | undefined;
  const databank = useQuery(
    api.seo.getDatabank,
    niche ? { ownerId, niche } : "skip",
  ) as
    | {
        titleTemplates?: string[];
        hookPatterns?: string[];
        competitorGaps?: string[];
      }
    | null
    | undefined;

  if (!niche)
    return (
      <EmptyState
        title="No niche set"
        description="Set this channel's niche (Identity tab) to unlock competitor research and SEO intelligence."
      />
    );
  if (intel === undefined) return <SkeletonList rows={3} />;
  if (!intel)
    return (
      <EmptyState
        title="No research yet"
        description={`Niche "${niche}" hasn't been researched. Run the research task (needs the YouTube Data API enabled) to populate competitor intelligence.`}
      />
    );

  return (
    <div style={{ display: "grid", gap: "1.4rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "0.9rem",
        }}
      >
        <StatCard label="Optimal title length" value={intel.optimalTitleLen ?? "—"} />
        <StatCard
          label="Avg views (top 50)"
          value={intel.avgViewsTop50 ? compact(intel.avgViewsTop50) : "—"}
          accent="var(--color-secondary)"
        />
        <StatCard
          label="Median views (top 50)"
          value={intel.medianViewsTop50 ? compact(intel.medianViewsTop50) : "—"}
          accent="var(--color-secondary)"
        />
      </div>

      {intel.powerWords && intel.powerWords.length > 0 && (
        <section>
          <SectionTitle>Power words</SectionTitle>
          <ChipRow
            items={intel.powerWords.slice(0, 24).map((p) => `${p.word} ·${p.count}`)}
            tone="accent"
          />
        </section>
      )}
      {databank?.titleTemplates && databank.titleTemplates.length > 0 && (
        <section>
          <SectionTitle>Title templates</SectionTitle>
          <List items={databank.titleTemplates} />
        </section>
      )}
      {databank?.hookPatterns && databank.hookPatterns.length > 0 && (
        <section>
          <SectionTitle>Hook patterns</SectionTitle>
          <List items={databank.hookPatterns} />
        </section>
      )}
      {databank?.competitorGaps && databank.competitorGaps.length > 0 && (
        <section>
          <SectionTitle>Competitor gaps</SectionTitle>
          <List items={databank.competitorGaps} />
        </section>
      )}
    </div>
  );
}

/* ------------------------------- Pipeline ------------------------------- */

function PipelineTab({
  pipeline,
}: {
  pipeline: { block: string; params?: unknown }[];
}) {
  if (pipeline.length === 0)
    return <EmptyState title="No pipeline configured" />;
  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {pipeline.map((p, i) => {
        const params = p.params as Record<string, unknown> | undefined;
        const hasParams = params && Object.keys(params).length > 0;
        return (
          <div
            key={`${p.block}-${i}`}
            className="glass"
            style={{
              padding: "0.8rem 1rem",
              display: "flex",
              alignItems: "center",
              gap: "0.8rem",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.78rem",
                color: "var(--color-faint)",
                width: 24,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem" }}>
              {p.block}
            </span>
            {hasParams && (
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem",
                  color: "var(--color-muted)",
                }}
              >
                {Object.entries(params!)
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join("  ")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- Identity ------------------------------- */

function IdentityTab({
  id,
  budget,
}: {
  id: ChannelIdentity;
  budget: number;
}) {
  return (
    <div style={{ display: "grid", gap: "1.4rem" }}>
      <div
        className="glass glass-shine"
        style={{
          padding: "1.25rem 1.4rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "1.1rem",
        }}
      >
        <Field label="Niche" value={id.niche ?? "—"} />
        <Field label="Cadence" value={id.cadence ?? "—"} />
        <Field label="Voice" value={id.voiceId ?? "—"} mono />
        <Field label="Thumbnail" value={id.thumbnailTemplate ?? "—"} />
        <Field label="Per-run budget" value={fmtUsd(budget)} mono />
      </div>

      {id.palette && id.palette.length > 0 && (
        <section>
          <SectionTitle>Palette</SectionTitle>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {id.palette.map((c) => (
              <div key={c} style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 10,
                    background: c,
                    border: "1px solid var(--color-border)",
                  }}
                />
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.65rem",
                    color: "var(--color-faint)",
                    marginTop: "0.25rem",
                  }}
                >
                  {c}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {id.styleGrammar && (
        <section>
          <SectionTitle>Style grammar</SectionTitle>
          <p
            className="glass"
            style={{ padding: "1rem 1.2rem", fontSize: "0.88rem", color: "var(--color-muted)", lineHeight: 1.6 }}
          >
            {id.styleGrammar}
          </p>
        </section>
      )}
      {id.topicPool && id.topicPool.length > 0 && (
        <section>
          <SectionTitle>Topic pool</SectionTitle>
          <ChipRow items={id.topicPool} tone="secondary" />
        </section>
      )}
      {id.bannedWords && id.bannedWords.length > 0 && (
        <section>
          <SectionTitle>Banned words</SectionTitle>
          <ChipRow items={id.bannedWords} tone="muted" />
        </section>
      )}
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.7rem",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-faint)",
          marginBottom: "0.3rem",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "0.95rem", fontFamily: mono ? "var(--font-mono)" : undefined }}>
        {value}
      </div>
    </div>
  );
}

function ChipRow({
  items,
  tone,
}: {
  items: string[];
  tone: "accent" | "secondary" | "muted";
}) {
  const color =
    tone === "accent"
      ? "var(--color-accent)"
      : tone === "secondary"
        ? "var(--color-secondary)"
        : "var(--color-muted)";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
      {items.map((it, i) => (
        <span
          key={`${it}-${i}`}
          style={{
            fontSize: "0.76rem",
            padding: "0.25rem 0.6rem",
            borderRadius: 8,
            color,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {items.map((it, i) => (
        <div
          key={i}
          className="glass"
          style={{ padding: "0.7rem 0.95rem", fontSize: "0.86rem", color: "var(--color-muted)" }}
        >
          {it}
        </div>
      ))}
    </div>
  );
}
