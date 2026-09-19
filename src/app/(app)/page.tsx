"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import { blockLabel } from "@/lib/blocks";
import type { ChannelRow, RunRow } from "@/lib/types";
import { RunCard } from "@/components/RunCard";
import { StageBadge } from "@/components/StageBadge";
import { Elapsed } from "@/components/Elapsed";
import { SkeletonList } from "@/components/Skeleton";
import { RecentVideos } from "@/components/RecentVideos";
import { ChannelAvatar, ChannelBanner } from "@/components/ChannelArt";
import {
  IconCalendar,
  IconAnalytics,
  IconRuns,
  IconSpark,
} from "@/components/icons";
import {
  buildStudioOverview,
  planWorkspaceHref,
  type StudioOverviewSnapshot,
} from "@/lib/studioOverviewModel";
import { isMainFleetChannel } from "./channels/channelCardVisibility";
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
  return value !== undefined ? scheduleDate.format(new Date(value)) : "Needs a date";
}

export default function OverviewPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();
  const [overviewAt, setOverviewAt] = useState(() => Date.now());
  useEffect(() => {
    // Local clock only: stable query arguments avoid re-fetching the fleet.
    const refresh = () => setOverviewAt(Date.now());
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);

  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | (ChannelRow & { folder?: string })[]
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
  const visibleSummaries = channels === undefined ? undefined : channelSummaries?.filter(row =>
    selectedSlug ? row.slug === selectedSlug : activeChannelSlugs.has(row.slug));
  const effectiveAnalytics = visibleSummaries?.reduce((total, row) => ({
    totalSubscribers: total.totalSubscribers + row.subscriberCount,
    totalViews: total.totalViews + row.totalViews,
    totalCost: total.totalCost + row.costTotal,
    videoCount: total.videoCount + row.videoCount,
  }), { totalSubscribers: 0, totalViews: 0, totalCost: 0, videoCount: 0 });
  const relayChannels = selectedSlug ? channelsFiltered : channels?.filter(isMainFleetChannel);
  const overview = buildStudioOverview({
    channels: operatingChannels ?? [],
    recentRuns: recentFiltered ?? [],
    activeRuns: activeFiltered ?? [],
    plan: planFiltered ?? [],
    youtubeLinks: youtubeLinks ?? [],
    now: overviewAt,
  });
  const selectedName = selectedSlug
    ? channelsFiltered?.[0]?.name ?? "Selected channel"
    : loading
      ? "Loading fleet"
      : `${overview.activeChannelCount} active · ${overview.activeRunCount} in production`;

  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeading}>
        <div><h1>Studio</h1><p>{selectedName}</p></div>
          <div className={styles.headerActions}>
            <Link href="/schedule" className="studio-action studio-action-secondary">
              <IconCalendar width={15} height={15} /> Schedule
            </Link>
            <Link href="/channels/new" className="studio-action">
              <IconSpark width={15} height={15} /> New channel
            </Link>
          </div>
      </header>

      <CommandCenter
        overview={overview}
        loading={loading}
        analytics={effectiveAnalytics}
        analyticsLoading={visibleSummaries === undefined}
        channelSummaries={visibleSummaries}
      />

      <section className={styles.workbench} aria-label="Current production and release queue">
        <div className={`${styles.workPanel} glass`} data-idle={activeFiltered?.length === 0 || undefined}>
          <PanelHeading title="In production" href="/runs" action="Open production" />
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
                    <ActiveRunProgress run={run} recent={recentFiltered} />
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
          <PanelHeading title="Planned videos" href="/schedule" action="Open calendar" />
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
            <CompactEmpty icon={<IconCalendar width={20} height={20} />} title="No upcoming plans" detail="Add a plan from the calendar." />
          )}
        </div>
      </section>

      <ChannelRelay channels={relayChannels} loading={channels === undefined} />

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
            <small>{loading ? "Loading…" : `${overview.recentRunCount} recent · ${usd.format(overview.recordedSpend)}`}</small>
          </span>
          <i aria-hidden="true" />
        </summary>
        <div className={styles.runsBody}>
          <div className={styles.runsBodyHeader}>
            <span>{loading ? "Loading run history…" : `${overview.successRate === null ? "No completed runs" : `${overview.successRate}% success · ${overview.terminalRunCount} completed`} · Latest 50 fleet runs, filtered to this view`}</span>
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

function ActiveRunProgress({ run, recent }: { run: RunRow; recent?: RunRow[] }) {
  // listRecent already subscribes to frozen invocation + persisted stage rows.
  // Join by run ID; never use another run's progress or manufacture a total.
  const progress = recent?.find(row => row._id === run._id)?.stageProgress;
  return <>
    <small>{progress?.currentBlock
      ? `${blockLabel(progress.currentBlock)} · ${progress.currentStatus ?? run.status}`
      : run.status === "running" ? "Running · open for stage details" : "Waiting for a worker"}</small>
    {progress?.totalKnown && progress.total > 0 ? <span className={styles.stageProgress}>
      <progress max={progress.total} value={progress.completed} aria-label={`${run.channelName} completed stages`} />
      <small>{progress.completed}/{progress.total} stages</small>
    </span> : progress && <small>{progress.completed} stages completed · total unavailable</small>}
  </>;
}

function CommandCenter({
  overview, loading, analytics, analyticsLoading, channelSummaries,
}: {
  overview: StudioOverviewSnapshot;
  loading: boolean;
  analytics?: { totalSubscribers: number; totalViews: number; totalCost: number; videoCount: number };
  analyticsLoading: boolean;
  channelSummaries?: ChannelSummaryRow[];
}) {
  const decision = overview.decision;
  return (
    <section className={styles.commandCenter} aria-label="Studio control overview">
      <article className={`${styles.decisionCard} glass`} data-tone={decision.tone}>
        <div className={styles.decisionCopy} aria-live="polite">
          <span className={styles.eyebrow}>{loading ? "Syncing" : decision.eyebrow}</span>
          <h2>{loading ? "Reading studio state…" : decision.title}</h2>
          <p>{loading ? "" : decision.detail}</p>
        </div>
        <Link href={loading ? "/runs" : decision.href} className="studio-button" data-variant="signal">
          {loading ? "Open production" : decision.action} <span aria-hidden="true">↗</span>
        </Link>
      </article>

      <div className={styles.widgetGrid}>
        <details className={`${styles.dataWidget} ${styles.issueWidget} glass`} data-overview-widget="issues">
          <summary>
            <WidgetMark tone={overview.issues.length ? "attention" : "ready"} />
            <span><small>Needs attention</small><strong>{loading ? "—" : overview.issues.length || "Clear"}</strong></span>
            <i aria-hidden="true" />
          </summary>
          <div className={styles.issueList}>
            {loading ? <SkeletonList rows={3} /> : overview.issues.length ? overview.issues.map(issue => (
              <Link key={issue.key} href={issue.href} data-issue-key={issue.key}>
                <span><strong>{issue.title}</strong><small>{issue.detail}</small></span>
                <b aria-hidden="true">↗</b>
              </Link>
            )) : <span className={styles.widgetEmpty}>No failed runs, overdue plans, or connection issues.</span>}
          </div>
        </details>

        <section className={`${styles.dataWidget} glass`} data-overview-widget="plans" aria-label="Plan status">
          <header>
            <WidgetMark tone="channel" icon={<IconCalendar width={18} height={18} />} />
            <span><small>Plans ready</small><strong>{loading ? "—" : overview.readyPlanCount}</strong></span>
            <Link href="/schedule" aria-label="Open calendar">↗</Link>
          </header>
          <div className={styles.planSplit}>
            <span><strong>{loading ? "—" : overview.scheduledPlanCount}</strong> dated</span>
            <span><strong>{loading ? "—" : overview.unscheduledPlanCount}</strong> need a date</span>
            {overview.planBuildingCount > 0 && <span>{overview.planBuildingCount} being prepared</span>}
          </div>
        </section>

        <details className={`${styles.dataWidget} ${styles.analyticsWidget} glass`} data-overview-widget="analytics">
          <summary>
            <WidgetMark tone="analytics" icon={<IconAnalytics width={18} height={18} />} />
            <span><small>Recorded views</small><strong>{analyticsLoading ? "—" : compact.format(analytics?.totalViews ?? 0)}</strong></span>
            <i aria-hidden="true" />
          </summary>
          <div className={styles.analyticsBody}>
            <div className={styles.analyticsTotals}>
              <span><small>Subscribers</small><strong>{analyticsLoading ? "—" : compact.format(analytics?.totalSubscribers ?? 0)}</strong></span>
              <span><small>YouTube uploads</small><strong>{analyticsLoading ? "—" : analytics?.videoCount ?? 0}</strong></span>
              <span><small>Recorded cost</small><strong>{analyticsLoading ? "—" : usd.format(analytics?.totalCost ?? 0)}</strong></span>
            </div>
            <AudienceBars rows={channelSummaries ?? []} loading={channelSummaries === undefined} />
            <Link href="/analytics" className={styles.widgetOpen}>Open analytics <b aria-hidden="true">↗</b></Link>
            <Link href="/library" className={styles.widgetOpen}>Saved videos <b aria-hidden="true">↗</b></Link>
          </div>
        </details>
      </div>
    </section>
  );
}

function WidgetMark({ tone, icon }: {
  tone: "attention" | "ready" | "channel" | "analytics";
  icon?: React.ReactNode;
}) {
  return <span className={styles.widgetGlyph} data-tone={tone} aria-hidden="true">{icon ?? <i />}</span>;
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
          <i><b style={{ "--bar-width": `${Math.max(0, (row.totalViews / max) * 100)}%` } as CSSProperties} /></i>
        </Link>
      ))}
    </div>
  );
}

function ChannelRelay({ channels, loading }: { channels?: ChannelRow[]; loading: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const relayChannels = channels ?? [];
  const move = (direction: number) => {
    const node = track.current;
    if (node) node.scrollBy({
      left: direction * node.clientWidth * 0.85,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  };
  return (
    <section className={styles.relay} aria-labelledby="channel-relay-title">
      <header className={styles.sectionHeading}>
        <h2 id="channel-relay-title">Channels</h2>
        <div className={styles.relayControls}>
          <Link href="/channels">All channels <span aria-hidden="true">↗</span></Link>
          {relayChannels.length > 1 && <>
            <button type="button" onClick={() => move(-1)} aria-label="Previous channels">‹</button>
            <button type="button" onClick={() => move(1)} aria-label="Next channels">›</button>
          </>}
        </div>
      </header>
      <div ref={track} className={styles.relayViewport} data-channel-rail>
        {loading ? <div className={styles.relaySkeletons} aria-label="Loading channels"><span /><span /><span /></div>
          : relayChannels.length ? relayChannels.map(channel => <RelayCard channel={channel} key={channel._id} />)
          : <Link href="/channels" className={styles.emptyRelay}>Open channels and language rooms ↗</Link>}
      </div>
    </section>
  );
}

function RelayCard({ channel }: { channel: ChannelRow }) {
  const identity = channel.identity;
  return (
    <Link href={`/channels/${encodeURIComponent(channel.slug)}`} className={styles.relayCard} data-channel-slug={channel.slug}>
      <ChannelBanner bannerKey={identity?.bannerKey} fallbackKeys={[identity?.imageKey]}
        name={channel.name} palette={identity?.palette} aspectRatio="16 / 6" />
      <div className={styles.relayCardBody}>
        <ChannelAvatar imageKey={identity?.imageKey} name={channel.name} palette={identity?.palette} size={32} radius={9} />
        <span><strong>{channel.name}</strong><small>{channel.status}</small></span>
        <i aria-hidden="true">↗</i>
      </div>
    </Link>
  );
}

function PanelHeading({
  title,
  href,
  action,
}: {
  title: string;
  href: string;
  action: string;
}) {
  return (
    <header className={styles.panelHeading}>
      <h2>{title}</h2>
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
