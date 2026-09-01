"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
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
  IconChannels,
  IconRuns,
  IconSpark,
} from "@/components/icons";
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
  return value ? scheduleDate.format(new Date(value)) : "Open slot";
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
    .slice(0, 4);
  const activeChannelCount =
    channelsFiltered?.filter((channel) => channel.status === "active").length ?? 0;
  const loading =
    channels === undefined ||
    recent === undefined ||
    active === undefined ||
    plan === undefined;
  const activeCount = activeFiltered?.length ?? 0;
  const selectedName = selectedSlug
    ? channelsFiltered?.[0]?.name ?? "Selected channel"
    : "the full channel fleet";

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

      <section className={`${styles.signalHero} glass`} aria-labelledby="studio-signal-title">
        <div className={styles.signalCopy}>
          <span className={styles.liveKicker} data-live={activeCount > 0 ? "true" : undefined}>
            <i aria-hidden="true" />
            {loading ? "Reading the floor" : activeCount > 0 ? "Production moving" : "Floor ready"}
          </span>
          <h2 id="studio-signal-title">
            {loading
              ? "Loading studio status…"
              : activeCount > 0
                ? `${activeCount} ${activeCount === 1 ? "run" : "runs"} in progress`
                : readyPlan.length > 0
                  ? `${readyPlan.length} ready to schedule`
                  : "Ready for the next run"}
          </h2>
          <p>
            {overdue.length > 0
              ? `${overdue.length} scheduled ${overdue.length === 1 ? "item needs" : "items need"} attention before the release rhythm slips.`
              : failed.length > 0
                ? `${failed.length} recent ${failed.length === 1 ? "run has" : "runs have"} a traceable failure to review.`
                : "No failures or overdue releases."}
          </p>
          <div className={styles.heroActions}>
            <Link href={activeCount > 0 ? "/runs" : "/schedule"} className="studio-button" data-variant="signal">
              <IconRuns width={15} height={15} />
              {activeCount > 0 ? "View runs" : "Open schedule"}
            </Link>
            <Link href="/channels" className={styles.textAction}>
              View channels <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>

        <SignalDial
          successRate={successRate}
          activeCount={activeCount}
          readyCount={readyPlan.length}
          loading={loading}
        />
      </section>

      <section className={styles.metricRail} aria-label="Studio measures">
        <Metric index="01" label="Active channels" value={loading ? "—" : activeChannelCount} note="able to produce" />
        <Metric index="02" label="In motion" value={loading ? "—" : activeCount} note="queued or rendering" tone="live" />
        <Metric index="03" label="Release ready" value={loading ? "—" : readyPlan.length} note={overdue.length ? `${overdue.length} overdue` : "cadence on track"} tone={overdue.length ? "warn" : undefined} />
        <Metric index="04" label="Recorded spend" value={loading ? "—" : usd.format(recordedSpend)} note="latest 50 runs" />
      </section>

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
          ) : upcoming.length > 0 ? (
            <div className={styles.queueList}>
              {upcoming.map((item, index) => (
                <Link key={item._id} href="/schedule" className={styles.queueRow}>
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
            <small>Production ledger</small>
            <strong>Recent runs</strong>
          </span>
          <span className={styles.runSummaryMeta}>
            {failed.length > 0 && <em>{failed.length} require inspection</em>}
            <small>{recentFiltered?.length ?? 0} retained</small>
          </span>
          <i aria-hidden="true" />
        </summary>
        <div className={styles.runsBody}>
          <div className={styles.runsBodyHeader}>
            <span>Newest production receipts</span>
            <Link href="/runs">Open full ledger <span aria-hidden="true">↗</span></Link>
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
            <CompactEmpty icon={<IconRuns width={20} height={20} />} title="No run receipts yet" detail="Every real production will leave an inspectable record here." />
          )}
        </div>
      </details>
    </div>
  );
}

function SignalDial({
  successRate,
  activeCount,
  readyCount,
  loading,
}: {
  successRate: number | null;
  activeCount: number;
  readyCount: number;
  loading: boolean;
}) {
  const progress = successRate ?? 0;
  return (
    <figure className={styles.signalDial} aria-label={loading ? "Loading production signal" : `${progress}% recent terminal-run success rate`}>
      <div
        className={styles.dialGraphic}
        style={{ "--dial-progress": `${progress * 3.6}deg` } as CSSProperties}
      >
        <span className={styles.dialOrbit} />
        <span className={styles.dialNode} data-node="one" />
        <span className={styles.dialNode} data-node="two" />
        <span className={styles.dialNode} data-node="three" />
        <div className={styles.dialCore}>
          <small>Recent success</small>
          <strong>{loading || successRate === null ? "—" : `${successRate}%`}</strong>
          <span>{activeCount ? `${activeCount} live` : `${readyCount} ready`}</span>
        </div>
      </div>
      <figcaption>
        <span>Signal integrity</span>
        <strong>{loading ? "Calibrating" : successRate === null ? "Awaiting history" : successRate >= 90 ? "Stable" : "Review advised"}</strong>
      </figcaption>
    </figure>
  );
}

function Metric({
  index,
  label,
  value,
  note,
  tone,
}: {
  index: string;
  label: string;
  value: string | number;
  note: string;
  tone?: "live" | "warn";
}) {
  return (
    <article className={styles.metric} data-tone={tone}>
      <span>{index}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </article>
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
          <span>Identity in motion</span>
          <h2 id="channel-relay-title">Channel relay</h2>
        </div>
        <p>The fleet moves slowly; hover or focus to hold it.</p>
        <Link href="/channels">Explore every channel <span aria-hidden="true">↗</span></Link>
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
            <span><strong>Build the first channel identity</strong><small>Opportunity, art direction, pipeline, and a QC-reviewed test render.</small></span>
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
        aspectRatio="16 / 8.2"
      >
        <div className={styles.relayCardScrim}>
          <span className={styles.relayNumber}>{channel.status === "active" ? "ON AIR" : channel.status.toUpperCase()}</span>
          <div className={styles.relayIdentity}>
            <ChannelAvatar imageKey={identity?.imageKey} name={channel.name} palette={identity?.palette} size={46} radius={12} />
            <span>
              <strong>{channel.name}</strong>
              <small>{identity?.niche || identity?.persona || channel.template}</small>
            </span>
          </div>
          <span className={styles.relayOpen}>Open show <i aria-hidden="true">↗</i></span>
        </div>
      </ChannelBanner>
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
