"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import type { ChannelRow, RunRow } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { RunCard } from "@/components/RunCard";
import { StageBadge } from "@/components/StageBadge";
import { Elapsed } from "@/components/Elapsed";
import { SkeletonList } from "@/components/Skeleton";
import { RecentVideos } from "@/components/RecentVideos";
import { ChannelAvatar, ChannelBanner } from "@/components/ChannelArt";
import {
  IconCalendar,
  IconAnalytics,
  IconChannels,
  IconLibrary,
  IconRuns,
  IconSpark,
} from "@/components/icons";
import {
  buildStudioOverview,
  planWorkspaceHref,
  type StudioOverviewSnapshot,
} from "@/lib/studioOverviewModel";
import styles from "./Overview.module.css";

type PlanRow = {
  _id: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  topic: string;
  title?: string;
  status: string;
  scheduledAt?: number;
};

type AnalyticsOverview = {
  totalSubscribers: number;
  totalViews: number;
  totalCost: number;
  planningCost: number;
  videoCount: number;
  channelCount: number;
};

type YoutubeLinkRow = {
  channelId: string;
  status: string;
  scopeHealth?: string;
  ytChannelId?: string;
};

type ChannelSummaryRow = {
  channelId: string;
  name: string;
  slug: string;
  subscriberCount: number;
  totalViews: number;
  videoCount: number;
  costTotal: number;
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const scheduleDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function nextLabel(value?: number) {
  return value ? scheduleDate.format(new Date(value)) : "Open slot";
}

export default function OverviewPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();
  const [overviewAt] = useState(() => Date.now());

  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | ChannelRow[]
    | undefined;
  const recent = useQuery(api.runs.listRecent, { ownerId, limit: 50 }) as
    | RunRow[]
    | undefined;
  const active = useQuery(api.runs.listActive, { ownerId }) as
    | RunRow[]
    | undefined;
  const plan = useQuery(api.contentPlan.listPlanByOwner, { ownerId }) as
    | PlanRow[]
    | undefined;
  const analyticsOverview = useQuery(api.analytics.overview, { ownerId }) as
    | AnalyticsOverview
    | undefined;
  const channelSummaries = useQuery(api.analytics.channelSummary, { ownerId }) as
    | ChannelSummaryRow[]
    | undefined;
  const youtubeLinks = useQuery(api.youtubeAuth.linkStatus, { ownerId }) as
    | YoutubeLinkRow[]
    | undefined;

  const activeChannelSlugs = new Set(
    (channels ?? [])
      .filter((channel) => channel.status === "active")
      .map((channel) => channel.slug),
  );
  const filterByOperatingChannel = <T extends { channelSlug: string }>(rows?: T[]) =>
    selectedSlug
      ? rows?.filter((row) => row.channelSlug === selectedSlug)
      : rows?.filter((row) => activeChannelSlugs.has(row.channelSlug));

  const recentFiltered = filterByOperatingChannel(recent);
  const activeFiltered = filterByOperatingChannel(active);
  const planFiltered = filterByOperatingChannel(plan);
  const channelsFiltered = selectedSlug
    ? channels?.filter((channel) => channel.slug === selectedSlug)
    : channels;
  const operatingChannels = selectedSlug
    ? channelsFiltered
    : channels?.filter((channel) => channel.status === "active");

  const loading =
    channels === undefined ||
    recent === undefined ||
    active === undefined ||
    plan === undefined ||
    youtubeLinks === undefined;
  const selectedSummary = selectedSlug
    ? channelSummaries?.find((row) => row.slug === selectedSlug)
    : undefined;
  const effectiveAnalytics = selectedSlug
    ? selectedSummary
      ? {
          totalSubscribers: selectedSummary.subscriberCount,
          totalViews: selectedSummary.totalViews,
          totalCost: selectedSummary.costTotal,
          videoCount: selectedSummary.videoCount,
        }
      : undefined
    : analyticsOverview;
  const visibleSummaries = selectedSlug
    ? channelSummaries?.filter((row) => row.slug === selectedSlug)
    : channelSummaries;
  const overview = buildStudioOverview({
    channels: operatingChannels ?? [],
    recentRuns: recentFiltered ?? [],
    activeRuns: activeFiltered ?? [],
    plan: planFiltered ?? [],
    youtubeLinks: youtubeLinks ?? [],
    now: overviewAt,
    publishedCount: effectiveAnalytics?.videoCount,
  });
  const selectedName = selectedSlug
    ? channelsFiltered?.[0]?.name ?? "Selected channel"
    : loading
      ? "Loading fleet"
      : `${overview.activeChannelCount} active · ${overview.activeRunCount} in production`;

  return (
    <div className={styles.dashboard}>
      <PageHeader
        eyebrow="Live studio"
        title="Studio"
        subtitle={selectedName}
        actions={
          <div className={styles.headerActions}>
            <Link href="/schedule" className="studio-action studio-action-secondary">
              <IconCalendar width={15} height={15} /> Schedule
            </Link>
            <Link href="/channels/new" className="studio-action">
              <IconSpark width={15} height={15} /> New channel
            </Link>
          </div>
        }
      />

      <CommandCenter
        overview={overview}
        loading={loading}
        analytics={effectiveAnalytics}
        analyticsLoading={selectedSlug ? channelSummaries === undefined : analyticsOverview === undefined}
        channelSummaries={visibleSummaries}
      />

      <ChannelRelay channels={channelsFiltered} loading={channels === undefined} />

      <section className={styles.workbench} aria-label="Current production and release queue">
        <div className={`${styles.workPanel} glass`}>
          <PanelHeading kicker="Now making" title="In production" href="/runs" action="Open production" />
          {active === undefined ? (
            <SkeletonList rows={3} />
          ) : activeFiltered && activeFiltered.length > 0 ? (
            <div className={styles.activeList}>
              {activeFiltered.slice(0, 4).map((run, index) => (
                <Link key={run._id} href={`/runs/${run._id}`} className={styles.activeRow}>
                  <span className={styles.rowIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.activePulse} data-status={run.status} aria-hidden="true"><i /></span>
                  <span className={styles.rowCopy}>
                    <strong>{run.channelName}</strong>
                    <small>{run.status === "running" ? "Rendering through the pipeline" : "Queued for a production worker"}</small>
                  </span>
                  <StageBadge status={run.status} size="sm" />
                  <Elapsed from={run.startedAt} />
                </Link>
              ))}
            </div>
          ) : (
            <CompactEmpty icon={<IconRuns width={20} height={20} />} title="No active runs" detail="New runs appear here." />
          )}
        </div>

        <div className={`${styles.workPanel} glass`}>
          <PanelHeading kicker="Release horizon" title="Up next" href="/schedule" action="Open calendar" />
          {plan === undefined ? (
            <SkeletonList rows={3} />
          ) : overview.upcomingPlans.length > 0 ? (
            <div className={styles.queueList}>
              {overview.upcomingPlans.slice(0, 4).map((item, index) => (
                <Link key={item._id} href={planWorkspaceHref(item)} className={styles.queueRow}>
                  <span className={styles.rowIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <time>{nextLabel(item.scheduledAt)}</time>
                  <span className={styles.rowCopy}>
                    <strong>{item.title || item.topic}</strong>
                    <small>{item.channelName}</small>
                  </span>
                  <span className={styles.queueArrow} aria-hidden="true">↗</span>
                </Link>
              ))}
            </div>
          ) : (
            <CompactEmpty icon={<IconCalendar width={20} height={20} />} title="The horizon is clear" detail="Planned releases will appear here in chronological order." />
          )}
        </div>
      </section>

      <RecentVideos
        ownerId={ownerId}
        channelId={
          selectedSlug && channelsFiltered?.[0]
            ? (channelsFiltered[0]._id as unknown as Id<"channels">)
            : undefined
        }
        limit={12}
      />

      <details className={`${styles.runsWidget} glass`}>
        <summary>
          <span className={styles.runsSummaryMark} aria-hidden="true"><IconRuns width={17} height={17} /></span>
          <span>
            <small>Runs</small>
            <strong>Recent runs</strong>
          </span>
          <span className={styles.runSummaryMeta}>
            {overview.failedRuns.length > 0 && <em>{overview.failedRuns.length} require inspection</em>}
            <small>{recentFiltered?.length ?? 0} shown</small>
          </span>
          <i aria-hidden="true" />
        </summary>
        <div className={styles.runsBody}>
          <div className={styles.runsBodyHeader}>
            <span>Latest run activity</span>
            <Link href="/runs">All runs <span aria-hidden="true">↗</span></Link>
          </div>
          {recent === undefined ? (
            <SkeletonList rows={4} />
          ) : recentFiltered && recentFiltered.length > 0 ? (
            <div className={styles.runList}>
              {recentFiltered.slice(0, 8).map((run) => (
                <RunCard key={run._id} run={run} />
              ))}
            </div>
          ) : (
            <CompactEmpty icon={<IconRuns width={20} height={20} />} title="No runs yet" detail="Active and completed runs appear here." />
          )}
        </div>
      </details>
    </div>
  );
}

function CommandCenter({
  overview,
  loading,
  analytics,
  analyticsLoading,
  channelSummaries,
}: {
  overview: StudioOverviewSnapshot;
  loading: boolean;
  analytics?: Pick<AnalyticsOverview, "totalSubscribers" | "totalViews" | "totalCost" | "videoCount">;
  analyticsLoading: boolean;
  channelSummaries?: ChannelSummaryRow[];
}) {
  const decision = overview.decision;
  const distinctIssues = overview.issues.filter((issue, index, rows) =>
    rows.findIndex((candidate) =>
      candidate.kind === issue.kind && candidate.title === issue.title,
    ) === index,
  ).slice(0, 4);
  return (
    <section className={styles.commandCenter} aria-label="Studio control overview">
      <article className={`${styles.decisionCard} glass`} data-tone={decision.tone}>
        <div className={styles.decisionTopline}>
          <span data-live={overview.activeRunCount > 0 ? "true" : undefined}><i aria-hidden="true" />{loading ? "Syncing" : decision.eyebrow}</span>
          <small>{loading ? "—" : `${overview.issues.length} open`}</small>
        </div>
        <div className={styles.decisionCopy} aria-live="polite">
          <h2>{loading ? "Reading studio state…" : decision.title}</h2>
          <p>{loading ? "" : decision.detail}</p>
        </div>
        <div className={styles.decisionActions}>
          <Link href={loading ? "/runs" : decision.href} className="studio-button" data-variant="signal">
            {decision.action} <span aria-hidden="true">↗</span>
          </Link>
          <Link href="/schedule" className={styles.textAction}>Calendar</Link>
        </div>
        <div className={styles.decisionMetrics} aria-label="Current studio measures">
          <span><small>Runs</small><strong>{loading ? "—" : overview.activeRunCount}</strong></span>
          <span><small>Ready</small><strong>{loading ? "—" : overview.readyPlanCount}</strong></span>
          <span><small>Success</small><strong>{loading || overview.successRate === null ? "—" : `${overview.successRate}%`}</strong></span>
          <span><small>50-run spend</small><strong>{loading ? "—" : usd.format(overview.recordedSpend)}</strong></span>
        </div>
      </article>

      <ProductionMap overview={overview} loading={loading} />

      <div className={styles.widgetGrid}>
        <details className={`${styles.dataWidget} ${styles.issueWidget} glass`}>
          <summary>
            <WidgetMark tone={overview.issues.length ? "attention" : "ready"} />
            <span><small>Issues</small><strong>{loading ? "—" : overview.issues.length || "Clear"}</strong></span>
            <i aria-hidden="true" />
          </summary>
          <div className={styles.issueList}>
            {loading ? <SkeletonList rows={3} /> : overview.issues.length ? (
              distinctIssues.map((issue) => (
                <Link key={issue.key} href={issue.href}>
                  <span><strong>{issue.title}</strong><small>{issue.detail}</small></span>
                  <b aria-hidden="true">↗</b>
                </Link>
              ))
            ) : (
              <span className={styles.widgetEmpty}>No failed runs, overdue releases, or connection issues.</span>
            )}
          </div>
        </details>

        <section className={`${styles.dataWidget} ${styles.runWidget} glass`} aria-labelledby="run-widget-title">
          <header>
            <WidgetMark tone={overview.activeRunCount ? "live" : "quiet"} icon={<IconRuns width={17} height={17} />} />
            <span><small>Runs</small><strong id="run-widget-title">{loading ? "—" : overview.activeRunCount}</strong></span>
            <Link href="/runs" aria-label="Open all production runs">↗</Link>
          </header>
          <div className={styles.runSplit}>
            <span><i data-tone="live" /><small>Rendering</small><strong>{loading ? "—" : overview.runningCount}</strong></span>
            <span><i /><small>Queued</small><strong>{loading ? "—" : overview.queuedCount}</strong></span>
            <span><i data-tone="attention" /><small>Failed</small><strong>{loading ? "—" : overview.failedRuns.length}</strong></span>
          </div>
        </section>

        <section className={`${styles.dataWidget} ${styles.channelWidget} glass`} aria-labelledby="channel-widget-title">
          <header>
            <WidgetMark tone="channel" icon={<IconChannels width={17} height={17} />} />
            <span><small>Channels</small><strong id="channel-widget-title">{loading ? "—" : overview.activeChannelCount}</strong></span>
            <Link href="/channels" aria-label="Open all channels">↗</Link>
          </header>
          <div className={styles.channelSignal}>
            <div aria-hidden="true">
              {Array.from({ length: Math.max(overview.activeChannelCount, 1) }, (_, index) => (
                <i key={index} data-ready={index < overview.activeChannelCount - overview.disconnectedChannels.length ? "true" : undefined} />
              ))}
            </div>
            <span><strong>{loading ? "—" : overview.activeChannelCount - overview.disconnectedChannels.length}</strong><small>YouTube ready</small></span>
            <span><strong>{loading ? "—" : overview.disconnectedChannels.length}</strong><small>Need link</small></span>
          </div>
        </section>

        <details className={`${styles.dataWidget} ${styles.analyticsWidget} glass`}>
          <summary>
            <WidgetMark tone="analytics" icon={<IconAnalytics width={17} height={17} />} />
            <span><small>Audience</small><strong>{analyticsLoading ? "—" : compact.format(analytics?.totalViews ?? 0)}</strong></span>
            <i aria-hidden="true" />
          </summary>
          <div className={styles.analyticsBody}>
            <div className={styles.analyticsTotals}>
              <span><small>Subscribers</small><strong>{analyticsLoading ? "—" : compact.format(analytics?.totalSubscribers ?? 0)}</strong></span>
              <span><small>Published</small><strong>{analyticsLoading ? "—" : analytics?.videoCount ?? 0}</strong></span>
              <span><small>Recorded cost</small><strong>{analyticsLoading ? "—" : usd.format(analytics?.totalCost ?? 0)}</strong></span>
            </div>
            <AudienceBars rows={channelSummaries ?? []} loading={channelSummaries === undefined} />
            <Link href="/analytics" className={styles.widgetOpen}>Open analytics <b aria-hidden="true">↗</b></Link>
          </div>
        </details>
      </div>

      <section className={`${styles.masterWidget} glass`} aria-labelledby="master-controls-title">
        <header><small>Master controls</small><strong id="master-controls-title">Go directly</strong></header>
        <nav aria-label="Master studio controls">
          <Link href="/runs"><IconRuns width={16} height={16} /><span>Production</span></Link>
          <Link href="/schedule"><IconCalendar width={16} height={16} /><span>Schedule</span></Link>
          <Link href="/channels"><IconChannels width={16} height={16} /><span>Channels</span></Link>
          <Link href="/library"><IconLibrary width={16} height={16} /><span>Library</span></Link>
          <Link href="/analytics"><IconAnalytics width={16} height={16} /><span>Analytics</span></Link>
          <Link href="/channels/new"><IconSpark width={16} height={16} /><span>New channel</span></Link>
        </nav>
      </section>
    </section>
  );
}

function WidgetMark({
  tone,
  icon,
}: {
  tone: "attention" | "ready" | "live" | "quiet" | "channel" | "analytics";
  icon?: React.ReactNode;
}) {
  return <span className={styles.widgetGlyph} data-tone={tone} aria-hidden="true">{icon ?? <i />}</span>;
}

function ProductionMap({ overview, loading }: { overview: StudioOverviewSnapshot; loading: boolean }) {
  const stages = [
    { label: "Channels", value: overview.activeChannelCount },
    { label: "Planning", value: overview.planBuildingCount },
    { label: "Runs", value: overview.activeRunCount },
    { label: "Ready", value: overview.readyPlanCount },
    { label: "Published", value: overview.publishedCount },
  ];
  return (
    <figure className={`${styles.productionMap} glass`} aria-label="Live production map">
      <figcaption>
        <span><small>Production map</small><strong>Flow</strong></span>
        <Link href="/runs">Open production <b aria-hidden="true">↗</b></Link>
      </figcaption>
      <div className={styles.mapGraphic} aria-hidden="true" data-live={overview.activeRunCount > 0 ? "true" : undefined}>
        <svg viewBox="0 0 640 150" preserveAspectRatio="none">
          <defs>
            <linearGradient id="overview-flow-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--color-blueprint)" />
              <stop offset=".48" stopColor="var(--color-secondary)" />
              <stop offset="1" stopColor="var(--color-accent)" />
            </linearGradient>
          </defs>
          <path className={styles.mapGhost} d="M20 104C106 104 110 42 194 42S278 118 364 118 452 60 620 60" />
          <path className={styles.mapLine} d="M20 104C106 104 110 42 194 42S278 118 364 118 452 60 620 60" />
          {[20, 170, 320, 470, 620].map((x, index) => <circle key={x} className={styles.mapNode} data-index={index} cx={x} cy={[104, 46, 111, 78, 60][index]} r="5" />)}
        </svg>
      </div>
      <ol className={styles.mapLegend}>
        {stages.map((stage, index) => (
          <li key={stage.label}><span>{String(index + 1).padStart(2, "0")}</span><small>{stage.label}</small><strong>{loading ? "—" : stage.value}</strong></li>
        ))}
      </ol>
    </figure>
  );
}

function AudienceBars({ rows, loading }: { rows: ChannelSummaryRow[]; loading: boolean }) {
  const visible = rows.slice().sort((left, right) => right.totalViews - left.totalViews).slice(0, 4);
  const max = Math.max(...visible.map((row) => row.totalViews), 1);
  if (loading) return <div className={styles.audienceLoading} aria-label="Loading channel analytics" />;
  if (!visible.length) return <span className={styles.widgetEmpty}>No persisted YouTube analytics yet.</span>;
  return (
    <div className={styles.audienceBars} aria-label="Views by channel">
      {visible.map((row) => (
        <Link href={`/channels/${encodeURIComponent(row.slug)}`} key={row.channelId}>
          <span><small>{row.name}</small><b>{compact.format(row.totalViews)}</b></span>
          <i><b style={{ "--bar-width": `${Math.max(3, (row.totalViews / max) * 100)}%` } as CSSProperties} /></i>
        </Link>
      ))}
    </div>
  );
}

function ChannelRelay({
  channels,
  loading,
}: {
  channels?: ChannelRow[];
  loading: boolean;
}) {
  const relayChannels = channels ?? [];
  return (
    <section className={styles.relay} aria-labelledby="channel-relay-title">
      <header className={styles.sectionHeading}>
        <div>
          <span>Channels</span>
          <h2 id="channel-relay-title">Channel overview</h2>
        </div>
        <p>Open a channel to manage its identity and production.</p>
        <Link href="/channels">All channels <span aria-hidden="true">↗</span></Link>
      </header>

      <div className={styles.relayViewport} data-static={relayChannels.length < 2 ? "true" : undefined}>
        {loading ? (
          <div className={styles.relaySkeletons} aria-label="Loading channels">
            {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
          </div>
        ) : relayChannels.length > 0 ? (
          <div className={styles.relayTrack}>
            <div className={styles.relaySet}>
              {relayChannels.map((channel) => <RelayCard channel={channel} key={channel._id} />)}
            </div>
            {relayChannels.length > 1 ? (
              <div className={styles.relaySet} aria-hidden="true">
                {relayChannels.map((channel) => <RelayCard channel={channel} key={`clone-${channel._id}`} clone />)}
              </div>
            ) : null}
          </div>
        ) : (
          <Link href="/channels/new" className={styles.emptyRelay}>
            <IconChannels width={25} height={25} />
            <span><strong>Create the first channel</strong><small>Set its identity, format, and test render.</small></span>
            <i aria-hidden="true">↗</i>
          </Link>
        )}
      </div>
    </section>
  );
}

function RelayCard({ channel, clone = false }: { channel: ChannelRow; clone?: boolean }) {
  const identity = channel.identity;
  return (
    <Link
      href={`/channels/${channel.slug}`}
      className={styles.relayCard}
      tabIndex={clone ? -1 : undefined}
    >
      <ChannelBanner
        bannerKey={identity?.bannerKey}
        fallbackKeys={[identity?.imageKey]}
        name={channel.name}
        palette={identity?.palette}
        aspectRatio="16 / 7.5"
      />
      <div className={styles.relayCardBody}>
        <span className={styles.relayNumber}>{channel.status === "active" ? "ON AIR" : channel.status.toUpperCase()}</span>
        <div className={styles.relayIdentity}>
          <ChannelAvatar imageKey={identity?.imageKey} name={channel.name} palette={identity?.palette} size={42} radius={11} />
          <span>
            <strong>{channel.name}</strong>
            <small>{identity?.niche || identity?.persona || channel.template}</small>
          </span>
        </div>
        <span className={styles.relayOpen}>Open channel <i aria-hidden="true">↗</i></span>
      </div>
    </Link>
  );
}

function PanelHeading({
  kicker,
  title,
  href,
  action,
}: {
  kicker: string;
  title: string;
  href: string;
  action: string;
}) {
  return (
    <header className={styles.panelHeading}>
      <div><span>{kicker}</span><h2>{title}</h2></div>
      <Link href={href}>{action} <span aria-hidden="true">↗</span></Link>
    </header>
  );
}

function CompactEmpty({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className={styles.empty}>
      <span aria-hidden="true">{icon}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
    </div>
  );
}
