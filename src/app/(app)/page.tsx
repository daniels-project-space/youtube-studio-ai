"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import { blockLabel } from "@/lib/blocks";
import type { ChannelRow, RunRow } from "@/lib/types";
import { StageBadge } from "@/components/StageBadge";
import { Elapsed } from "@/components/Elapsed";
import { SkeletonList } from "@/components/Skeleton";
import { RecentVideos } from "@/components/RecentVideos";
import { ChannelAvatar } from "@/components/ChannelArt";
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
  order?: number;
  scheduledAt?: number;
  cadence?: string;
  frequency?: string;
  days?: number[];
  timezone?: string;
  localTime?: string;
  scheduleEnabled?: boolean;
  projectedAt?: number;
  automaticSchedule?: boolean;
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
  hasAnalytics?: boolean;
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
  return value !== undefined ? scheduleDate.format(new Date(value)) : "Not scheduled";
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
  const overviewRuns = useQuery(api.runs.listOverviewRuns, { ownerId }) as
    | { recent: RunRow[]; active: RunRow[] }
    | undefined;
  const recent = overviewRuns?.recent;
  const active = overviewRuns?.active;
  const plan = useQuery(api.contentPlan.listPlanByOwner, { ownerId }) as
    | PlanRow[]
    | undefined;
  const channelSummaries = useQuery(api.analytics.channelSummary, { ownerId }) as
    | ChannelSummaryRow[]
    | undefined;
  const youtubeLinks = useQuery(api.youtubeAuth.linkStatus, { ownerId }) as
    | YoutubeLinkRow[]
    | undefined;

  const activeFiltered = selectedSlug ? active?.filter((run) => run.channelSlug === selectedSlug) : active;
  const recentFiltered = selectedSlug ? recent?.filter((run) => run.channelSlug === selectedSlug)
    : recent;
  const planFiltered = selectedSlug ? plan?.filter((item) => item.channelSlug === selectedSlug) : plan;
  const channelsFiltered = selectedSlug
    ? channels?.filter((channel) => channel.slug === selectedSlug)
    : channels;

  // `contentPlan.listPlanByOwner` intentionally returns compact rows. Join
  // the live channel policy here so the overview can show the same automatic
  // cadence date that the calendar projects, without adding another query.
  const overviewPlans = planFiltered?.map((item) => {
    const channel = channels?.find((candidate) => candidate._id === item.channelId);
    return {
      ...item,
      channelStatus: channel?.status,
      cadence: channel?.identity?.cadence,
      frequency: channel?.schedule?.frequency,
      days: channel?.schedule?.days,
      timezone: channel?.schedule?.timezone,
      localTime: channel?.schedule?.localTime,
      scheduleEnabled: channel?.schedule?.enabled,
    };
  });

  const loading =
    channels === undefined ||
    recent === undefined ||
    active === undefined ||
    plan === undefined ||
    youtubeLinks === undefined;
  const visibleSummaries = channels === undefined ? undefined : channelSummaries?.filter(row =>
    selectedSlug ? row.slug === selectedSlug : true);
  const effectiveAnalytics = visibleSummaries?.reduce((total, row) => ({
    totalSubscribers: total.totalSubscribers + (row.hasAnalytics ? row.subscriberCount : 0),
    totalViews: total.totalViews + (row.hasAnalytics ? row.totalViews : 0),
    totalCost: total.totalCost + row.costTotal,
    videoCount: total.videoCount + row.videoCount,
    analyticsChannels: total.analyticsChannels + (row.hasAnalytics ? 1 : 0),
    totalChannels: total.totalChannels + 1,
  }), { totalSubscribers: 0, totalViews: 0, totalCost: 0, videoCount: 0, analyticsChannels: 0, totalChannels: 0 });
  const relayChannels = selectedSlug ? channelsFiltered : channels?.filter(isMainFleetChannel);
  const overview = buildStudioOverview({
    channels: channelsFiltered ?? [],
    recentRuns: recentFiltered ?? [],
    activeRuns: activeFiltered ?? [],
    plan: overviewPlans ?? [],
    youtubeLinks: youtubeLinks ?? [],
    now: overviewAt,
  });
  const selectedName = selectedSlug
    ? channelsFiltered?.[0]?.name ?? "Selected channel"
    : loading
      ? "Loading fleet"
      : `${overview.activeChannelCount} active · ${overview.activeRunCount} in production`;
  const recurringSchedulesEnabled = channelsFiltered?.filter(channel => channel.schedule?.enabled === true).length;

  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeading}>
        <div><h1>Channel overview</h1><p>{selectedName}</p></div>
          <div className={styles.headerActions}>
            <Link href="/schedule" className="studio-action studio-action-secondary">
              <IconCalendar width={15} height={15} /> Schedule
            </Link>
            <Link href={selectedSlug ? `/channels/${encodeURIComponent(selectedSlug)}#private-video` : "/channels"} className="studio-action studio-action-secondary" title={selectedSlug ? "Open the selected channel's private video control" : "Select a channel to generate a private video"}>
              <IconSpark width={15} height={15} /> Generate video
            </Link>
            <Link href="/channels/new" className="studio-action">
              <IconSpark width={15} height={15} /> New channel
            </Link>
          </div>
      </header>

      {channelsFiltered && channelsFiltered.length > 0 && (
        <section className={styles.schedulePosture} aria-label="Recurring schedule status">
          <IconCalendar width={19} height={19} />
          <div>
            <strong>{recurringSchedulesEnabled ? `${recurringSchedulesEnabled} recurring schedule${recurringSchedulesEnabled === 1 ? "" : "s"} enabled` : "Recurring schedules paused"}</strong>
            <small>Individual queued items are managed separately.</small>
          </div>
          <Link href="/schedule">Open calendar <span aria-hidden="true">↗</span></Link>
        </section>
      )}

      <ChannelRelay channels={relayChannels} loading={channels === undefined} />

      <div className={styles.mediaActivity}>
      {selectedSlug && !channelsFiltered?.[0] ? (
        <section aria-label="Recent renders" data-recent-renders>
          <h2>Recent renders</h2>
          <p>{channels === undefined ? "Loading channel..." : "Selected channel is unavailable."}</p>
        </section>
      ) : (
        <RecentVideos
          key={selectedSlug ? `channel:${selectedSlug}` : "fleet"}
          ownerId={ownerId}
          channelId={selectedSlug ? (channelsFiltered![0]!._id as unknown as Id<"channels">) : undefined}
          limit={12}
        />
      )}
      <section className={`${styles.activityPanel} glass`} aria-label="Recent production activity">
        <PanelHeading title="Production activity" href="/runs" action="All runs" />
        {recent === undefined ? <SkeletonList rows={3} /> : recentFiltered && recentFiltered.length > 0 ? (
          <div className={styles.activityList}>
            {recentFiltered.slice(0, 5).map(run => (
              <Link key={run._id} href={`/runs/${run._id}`} className={styles.activityRow}>
                <span className={styles.activityIcon}><IconRuns width={17} height={17} /></span>
                <span className={styles.rowCopy}><strong>{run.channelName}</strong><small>{run.error || (run.pipelineSource === "legacy_inferred" ? "Legacy run" : "Production run")}</small></span>
                <StageBadge status={run.status} size="sm" />
              </Link>
            ))}
          </div>
        ) : <CompactEmpty icon={<IconRuns width={20} height={20} />} title="No runs yet" detail="Production activity appears here." />}
        <div className={styles.activityFoot}>{loading ? "Loading..." : `${overview.recentRunCount} recent runs · ${usd.format(overview.recordedSpend)} recorded`}</div>
      </section>
      </div>

      <CommandCenter
        overview={overview}
        loading={loading}
        analytics={effectiveAnalytics}
        analyticsLoading={visibleSummaries === undefined}
        channelSummaries={visibleSummaries}
      />

      <section className={styles.workbench} aria-label="Current production and release queue">
        {(active === undefined || (activeFiltered?.length ?? 0) > 0) && (
          <div className={`${styles.workPanel} glass`}>
            <PanelHeading title="In production" href="/runs" action="Open production" />
            {active === undefined ? (
              <SkeletonList rows={3} />
            ) : (
              <div className={styles.activeList}>
                {activeFiltered!.slice(0, 4).map((run, index) => (
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
            )}
          </div>
        )}

        <div className={`${styles.workPanel} glass`}>
          <PanelHeading title="Planned videos" href="/schedule" action="Open calendar" />
          {plan === undefined ? (
            <SkeletonList rows={3} />
          ) : overview.upcomingPlans.length > 0 ? (
            <div className={styles.queueList}>
              {overview.upcomingPlans.slice(0, 4).map((item, index) => (
                <Link key={item._id} href={planWorkspaceHref(item)} className={styles.queueRow}>
                  <span className={styles.rowIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <time>
                    {item.automaticSchedule && item.scheduledAt === undefined ? "Auto · " : ""}
                    {nextLabel(item.scheduledAt ?? item.projectedAt)}
                  </time>
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
  analytics?: { totalSubscribers: number; totalViews: number; totalCost: number; videoCount: number; analyticsChannels: number; totalChannels: number };
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
            <WidgetMark tone={overview.issues.length || overview.legacyFailedRuns.length ? "attention" : "ready"} />
            <span><small>Needs attention</small><strong>{loading ? "—" : overview.issues.length + overview.legacyFailedRuns.length || "Clear"}</strong></span>
            <i aria-hidden="true" />
          </summary>
          <div className={styles.issueList}>
            {loading ? <SkeletonList rows={3} /> : overview.issues.length || overview.legacyFailedRuns.length ? <>
              {overview.issues.map(issue => (
                <Link key={issue.key} href={issue.href} data-issue-key={issue.key}>
                  <span><strong>{issue.title}</strong><small>{issue.detail}</small></span>
                  <b aria-hidden="true">↗</b>
                </Link>
              ))}
              {overview.legacyFailedRuns.map(run => (
                <Link key={`legacy:${run._id}`} href={`/runs/${run._id}`}>
                  <span><strong>{run.channelName}</strong><small>Legacy failure: inspect run details</small></span>
                  <b aria-hidden="true">↗</b>
                </Link>
              ))}
            </> : <span className={styles.widgetEmpty}>No failed runs, overdue plans, or active-channel connection issues in this view.</span>}
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
            <span><strong>{loading ? "—" : overview.automaticPlanCount}</strong> auto cadence</span>
            {overview.manualSchedulingPlanCount > 0 && (
              <span><strong>{overview.manualSchedulingPlanCount}</strong> need setup</span>
            )}
            {overview.planBuildingCount > 0 && <span>{overview.planBuildingCount} being prepared</span>}
          </div>
        </section>

        <details className={`${styles.dataWidget} ${styles.analyticsWidget} glass`} data-overview-widget="analytics">
          <summary>
            <WidgetMark tone="analytics" icon={<IconAnalytics width={18} height={18} />} />
            <span><small>Recorded views{analytics && analytics.analyticsChannels > 0 && analytics.analyticsChannels < analytics.totalChannels ? " · partial" : ""}</small><strong>{analyticsLoading || !analytics?.analyticsChannels ? "—" : compact.format(analytics.totalViews)}</strong></span>
            <i aria-hidden="true" />
          </summary>
          <div className={styles.analyticsBody}>
            <div className={styles.analyticsTotals}>
              <span><small>Subscribers</small><strong>{analyticsLoading || !analytics?.analyticsChannels ? "—" : compact.format(analytics.totalSubscribers)}</strong></span>
              <span><small>Recorded upload IDs</small><strong>{analyticsLoading ? "—" : analytics?.videoCount ?? 0}</strong></span>
              <span><small>Recorded cost</small><strong>{analyticsLoading ? "—" : usd.format(analytics?.totalCost ?? 0)}</strong></span>
            </div>
            <small>Upload IDs are counted on runs with saved pipeline receipts; visibility is not verified.</small>
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
  const visible = rows.filter(row => row.hasAnalytics).sort((left, right) => right.totalViews - left.totalViews).slice(0, 4);
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
  const relayChannels = channels ?? [];
  return (
    <section className={styles.relay} aria-labelledby="channel-relay-title">
      <header className={styles.sectionHeading}>
        <h2 id="channel-relay-title">Channels</h2>
        <div className={styles.relayControls}>
          <Link href="/channels">All channels <span aria-hidden="true">↗</span></Link>
        </div>
      </header>
      <div className={styles.relayViewport} data-channel-rail>
        {loading ? <div className={styles.relaySkeletons} aria-label="Loading channels"><span /><span /><span /></div>
          : relayChannels.length ? relayChannels.slice(0, 8).map(channel => <RelayCard channel={channel} key={channel._id} />)
          : <Link href="/channels" className={styles.emptyRelay}>Open channels and language rooms ↗</Link>}
      </div>
    </section>
  );
}

function RelayCard({ channel }: { channel: ChannelRow }) {
  const identity = channel.identity;
  return (
    <Link href={`/channels/${encodeURIComponent(channel.slug)}`} className={styles.relayCard} data-channel-slug={channel.slug}>
      <div className={styles.relayCardBody}>
        <ChannelAvatar imageKey={identity?.imageKey} name={channel.name} niche={identity?.niche} palette={identity?.palette} size={56} radius={6} />
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
