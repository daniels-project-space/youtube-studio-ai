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
import { SkeletonList } from "@/components/Skeleton";
import { RecentVideos } from "@/components/RecentVideos";
import { StatusBanner } from "@/components/StatusBanner";
import { IconCalendar } from "@/components/icons";
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
  return value ? scheduleDate.format(new Date(value)) : "Unscheduled";
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
  const readyPlan = (planFiltered ?? []).filter((item) => item.status === "ready");
  const overdue = readyPlan.filter(
    (item) => item.scheduledAt !== undefined && item.scheduledAt < todayMs,
  );
  const upcoming = readyPlan
    .filter((item) => item.scheduledAt === undefined || item.scheduledAt >= todayMs)
    .sort(
      (a, b) =>
        (a.scheduledAt ?? Number.MAX_SAFE_INTEGER) -
        (b.scheduledAt ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, 3);
  const activeChannelCount =
    channelsFiltered?.filter((channel) => channel.status === "active").length ?? 0;
  const loading =
    channels === undefined ||
    recent === undefined ||
    active === undefined ||
    plan === undefined;

  return (
    <div className={styles.dashboard}>
      <PageHeader
        title="Overview"
        actions={
          <Link href="/schedule" className="studio-action studio-action-secondary">
            <IconCalendar width={16} height={16} /> Schedule
          </Link>
        }
      />

      <section className={`${styles.statusBar} glass`} aria-label="Studio summary">
        <div className={styles.statusLead}>
          <span
            className={styles.statusDot}
            aria-hidden="true"
          />
          <div>
            <strong>
              {loading
                ? "Syncing studio"
                : activeFiltered?.length
                  ? "Production is moving"
                  : readyPlan.length
                    ? `${readyPlan.length} ready to publish`
                    : "Studio ready"}
            </strong>
            <small>
              {selectedSlug
                ? channelsFiltered?.[0]?.name ?? "Selected channel"
                : "All channels"}
            </small>
          </div>
        </div>

        <div className={styles.metrics} role="list" aria-label="Key measures">
          <CompactMetric label="Active" value={loading ? "—" : activeChannelCount} />
          <CompactMetric label="Running" value={active === undefined ? "—" : activeFiltered?.length ?? 0} />
          <CompactMetric
            label="Success"
            value={loading || successRate === null ? "—" : `${successRate}%`}
          />
        </div>

        <StatusBanner overdueCount={overdue.length} channelSlug={selectedSlug} />
      </section>

      <div className={styles.productionGrid}>
        <section className={`${styles.panel} glass`}>
          <PanelHeading title="In production" href="/runs" action="Open runs" />
          {active === undefined ? (
            <SkeletonList rows={2} />
          ) : activeFiltered && activeFiltered.length > 0 ? (
            <div className={styles.activeList}>
              {activeFiltered.slice(0, 3).map((run) => (
                <Link key={run._id} href={`/runs/${run._id}`} className={styles.activeRow}>
                  <StageBadge status={run.status} size="sm" />
                  <span>
                    <strong>{run.channelName}</strong>
                    <small>{run.status === "running" ? "Rendering" : "Queued"}</small>
                  </span>
                  <Elapsed from={run.startedAt} />
                </Link>
              ))}
            </div>
          ) : (
            <CompactEmpty title="No active runs" detail="The next queued production will appear here." />
          )}
        </section>

        <section className={`${styles.panel} glass`}>
          <PanelHeading title="Up next" href="/schedule" action="Open schedule" />
          {plan === undefined ? (
            <SkeletonList rows={3} />
          ) : upcoming.length > 0 ? (
            <div className={styles.queueList}>
              {upcoming.map((item) => (
                <Link key={item._id} href="/schedule" className={styles.queueRow}>
                  <time>{nextLabel(item.scheduledAt)}</time>
                  <span>
                    <strong>{item.title || item.topic}</strong>
                    <small>{item.channelName}</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <CompactEmpty title="Queue clear" detail="Scheduled work will appear here." />
          )}
        </section>
      </div>

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
          <span>
            <strong>Recent runs</strong>
            <small>{recentFiltered?.length ?? 0} tracked</small>
          </span>
          <span className={styles.runSummaryMeta}>
            {failed.length > 0 && <em>{failed.length} failed</em>}
            <small>{usd.format(recordedSpend)}</small>
          </span>
        </summary>
        <div className={styles.runsBody}>
          <div className={styles.runsBodyHeader}>
            <span>Latest activity</span>
            <Link href="/runs">Open full history →</Link>
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
            <CompactEmpty title="No runs yet" detail="Production history will appear here." />
          )}
        </div>
      </details>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <span className={styles.metric} role="listitem">
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
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
      <Link href={href}>{action} <span aria-hidden="true">→</span></Link>
    </header>
  );
}

function CompactEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={styles.empty}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}
