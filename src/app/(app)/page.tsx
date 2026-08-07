"use client";

import Link from "next/link";
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
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { RecentVideos } from "@/components/RecentVideos";
import { StatusBanner } from "@/components/StatusBanner";
import {
  IconAnalytics,
  IconCalendar,
  IconChannels,
  IconRuns,
} from "@/components/icons";

type PlanRow = {
  _id: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  topic: string;
  title?: string;
  status: string;
  scheduledAt?: number;
  thumbnailKey?: string;
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const scheduleDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function nextLabel(value?: number) {
  return value ? scheduleDate.format(new Date(value)) : "Not scheduled";
}

export default function OverviewPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();

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

  const filterByChannel = <T extends { channelSlug: string }>(rows?: T[]) =>
    selectedSlug ? rows?.filter((row) => row.channelSlug === selectedSlug) : rows;

  const recentFiltered = filterByChannel(recent);
  const activeFiltered = filterByChannel(active);
  const planFiltered = filterByChannel(plan);
  const channelsFiltered = selectedSlug
    ? channels?.filter((channel) => channel.slug === selectedSlug)
    : channels;

  const terminal = recentFiltered?.filter(
    (run) => run.status === "ok" || run.status === "failed",
  );
  const successful = terminal?.filter((run) => run.status === "ok").length ?? 0;
  const failed = recentFiltered?.filter((run) => run.status === "failed") ?? [];
  const recordedSpend = (recentFiltered ?? []).reduce(
    (total, run) => total + (Number.isFinite(run.costTotal) ? run.costTotal : 0),
    0,
  );
  const successRate = terminal?.length
    ? Math.round((successful / terminal.length) * 100)
    : null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const overdue = (planFiltered ?? []).filter(
    (item) => item.scheduledAt !== undefined && item.scheduledAt < todayMs,
  );
  const upcoming = (planFiltered ?? [])
    .filter((item) => item.scheduledAt === undefined || item.scheduledAt >= todayMs)
    .sort((a, b) => (a.scheduledAt ?? Number.MAX_SAFE_INTEGER) - (b.scheduledAt ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 4);
  const attentionCount = failed.length + overdue.length;
  const loading =
    channels === undefined ||
    recent === undefined ||
    active === undefined ||
    plan === undefined;

  return (
    <div className="overview-dashboard">
      <PageHeader
        title="Control room"
        subtitle={
          selectedSlug
            ? "Live operating state for the selected channel"
            : "The decisions that need you, across every channel"
        }
        actions={
          <div className="page-actions">
            <Link href="/schedule" className="studio-action studio-action-secondary">
              <IconCalendar width={16} height={16} /> Schedule
            </Link>
            <Link href="/analytics" className="studio-action">
              <IconAnalytics width={16} height={16} /> Analytics
            </Link>
          </div>
        }
      />

      <StatusBanner />

      <section className="overview-hero glass glass-shine" aria-label="Live studio status">
        <div>
          <span className={`live-indicator ${attentionCount > 0 ? "live-indicator-warn" : ""}`}>
            <span aria-hidden="true" />
            {loading
              ? "Syncing live studio data"
              : attentionCount > 0
                ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention`
                : activeFiltered?.length
                  ? `${activeFiltered.length} pipeline${activeFiltered.length === 1 ? "" : "s"} in progress`
                  : "Studio ready"}
          </span>
          <h2>{activeFiltered?.length ? "Production is moving." : "Everything important, at a glance."}</h2>
          <p>
            {loading
              ? "Connecting to the current channel, run, plan and cost records."
              : `${channelsFiltered?.filter((channel) => channel.status === "active").length ?? 0} active channel${(channelsFiltered?.filter((channel) => channel.status === "active").length ?? 0) === 1 ? "" : "s"} · ${upcoming.length} upcoming plan item${upcoming.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="overview-hero-mark" aria-hidden="true">
          <span>{activeFiltered?.length ?? "—"}</span>
          <small>live</small>
        </div>
      </section>

      <section className="overview-metrics" aria-label="Current studio measures">
        <Metric
          label="Active channels"
          value={loading ? "—" : String(channelsFiltered?.filter((channel) => channel.status === "active").length ?? 0)}
          hint={`${channelsFiltered?.length ?? 0} visible`}
          icon={<IconChannels width={17} height={17} />}
        />
        <Metric
          label="In progress"
          value={active === undefined ? "—" : String(activeFiltered?.length ?? 0)}
          hint="Active or queued work"
          icon={<IconRuns width={17} height={17} />}
          tone="secondary"
        />
        <Metric
          label="Success rate"
          value={loading ? "—" : successRate === null ? "—" : `${successRate}%`}
          hint={`Latest ${terminal?.length ?? 0} completed runs`}
          tone={failed.length ? "warning" : "positive"}
        />
        <Metric
          label="Recorded spend"
          value={loading ? "—" : usd.format(recordedSpend)}
          hint={`Latest ${recentFiltered?.length ?? 0} runs`}
        />
      </section>

      <div className="overview-primary-grid">
        <section className="overview-panel overview-now glass">
          <PanelHeading
            eyebrow="Now"
            title="Running pipelines"
            href="/runs"
            action="All runs"
          />
          {active === undefined ? (
            <SkeletonList rows={2} />
          ) : activeFiltered && activeFiltered.length > 0 ? (
            <div className="active-run-list">
              {activeFiltered.slice(0, 4).map((run) => (
                <Link key={run._id} href={`/runs/${run._id}`} className="active-run-row">
                  <span className="active-run-pulse" aria-hidden="true" />
                  <span className="active-run-copy">
                    <strong>{run.channelName}</strong>
                    <small>{run.status === "running" ? "Rendering now" : "Queued to start"}</small>
                  </span>
                  <span className="active-run-time"><Elapsed from={run.startedAt} /></span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No pipeline is running"
              description="The next queued production will appear here automatically."
            />
          )}
        </section>

        <section className="overview-panel glass">
          <PanelHeading
            eyebrow="Next"
            title="Production queue"
            href="/schedule"
            action="Open schedule"
          />
          {plan === undefined ? (
            <SkeletonList rows={3} />
          ) : upcoming.length > 0 ? (
            <div className="production-queue">
              {upcoming.map((item) => (
                <Link key={item._id} href="/schedule" className="queue-row">
                  <time>{nextLabel(item.scheduledAt)}</time>
                  <span>
                    <strong>{item.title || item.topic}</strong>
                    <small>{item.channelName} · {item.status}</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="The queue is clear"
              description="Future plan items will appear here as soon as they are scheduled."
            />
          )}
        </section>
      </div>

      <div className="overview-secondary-grid">
        <section className="overview-panel glass">
          <PanelHeading
            eyebrow="Attention"
            title={attentionCount > 0 ? `${attentionCount} items to review` : "Nothing blocking production"}
            href={failed.length ? "/runs?status=failed" : "/schedule"}
            action="Review"
          />
          {loading ? (
            <SkeletonList rows={2} />
          ) : attentionCount === 0 ? (
            <div className="healthy-state">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>Clear right now</strong>
                <p>No recent failed runs or overdue plan items.</p>
              </div>
            </div>
          ) : (
            <div className="attention-list">
              {failed.slice(0, 3).map((run) => (
                <Link href={`/runs/${run._id}`} key={run._id}>
                  <span className="health-dot health-dot-danger" aria-hidden="true" />
                  <span><strong>{run.channelName}</strong><small>Recent run failed</small></span>
                  <StageBadge status="failed" size="sm" />
                </Link>
              ))}
              {overdue.length > 0 && (
                <Link href="/schedule">
                  <span className="health-dot health-dot-warning" aria-hidden="true" />
                  <span><strong>{overdue.length} overdue plan item{overdue.length === 1 ? "" : "s"}</strong><small>Scheduled date has passed</small></span>
                  <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          )}
        </section>

        <section className="overview-panel glass channel-health-panel">
          <PanelHeading
            eyebrow="Fleet"
            title="Channel health"
            href="/channels"
            action="All channels"
          />
          {channels === undefined ? (
            <SkeletonList rows={4} />
          ) : channelsFiltered && channelsFiltered.length > 0 ? (
            <div className="channel-health-list">
              {channelsFiltered.slice(0, 6).map((channel) => {
                const liveRun = active?.find((run) => run.channelSlug === channel.slug);
                const lastRun = recent?.find((run) => run.channelSlug === channel.slug);
                const next = plan
                  ?.filter((item) => item.channelSlug === channel.slug && item.scheduledAt && item.scheduledAt >= todayMs)
                  .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0))[0];
                const needsAttention = lastRun?.status === "failed";
                const state = liveRun
                  ? "running"
                  : channel.status !== "active"
                    ? channel.status
                    : needsAttention
                      ? "attention"
                      : "ready";
                return (
                  <Link href={`/channels/${channel.slug}`} key={channel._id} className="channel-health-row">
                    <span className={`health-dot health-dot-${state}`} aria-hidden="true" />
                    <span className="channel-health-name">
                      <strong>{channel.name}</strong>
                      <small>{next ? `Next ${nextLabel(next.scheduledAt)}` : channel.template}</small>
                    </span>
                    <span className="channel-health-state">{state}</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No channels" description="Create a channel to start building its production system." />
          )}
        </section>
      </div>

      <RecentVideos
        ownerId={ownerId}
        channelId={selectedSlug && channelsFiltered?.[0] ? (channelsFiltered[0]._id as unknown as Id<"channels">) : undefined}
        limit={4}
      />

      <section className="overview-activity">
        <PanelHeading
          eyebrow="History"
          title="Recent activity"
          href="/runs"
          action="See every run"
        />
        {recent === undefined ? (
          <SkeletonList rows={4} />
        ) : recentFiltered && recentFiltered.length > 0 ? (
          <div className="recent-run-list">
            {recentFiltered.slice(0, 5).map((run) => <RunCard key={run._id} run={run} />)}
          </div>
        ) : (
          <EmptyState title="No runs yet" description="Completed and failed productions will appear here." />
        )}
      </section>

      <Link href="/analytics" className="analytics-disclosure glass lift">
        <span>
          <small>Deeper reporting</small>
          <strong>Growth, performance and spend trends</strong>
        </span>
        <span aria-hidden="true">Open analytics →</span>
      </Link>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon?: React.ReactNode;
  tone?: "secondary" | "positive" | "warning";
}) {
  return (
    <article className={`overview-metric${tone ? ` overview-metric-${tone}` : ""}`}>
      <div><span>{label}</span>{icon}</div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function PanelHeading({
  eyebrow,
  title,
  href,
  action,
}: {
  eyebrow: string;
  title: string;
  href: string;
  action: string;
}) {
  return (
    <header className="panel-heading">
      <div><small>{eyebrow}</small><h2>{title}</h2></div>
      <Link href={href}>{action} <span aria-hidden="true">→</span></Link>
    </header>
  );
}
