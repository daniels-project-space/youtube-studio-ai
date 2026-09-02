"use client";

import { use, useEffect, useState, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import type { ChannelIdentity, RunRow, VideoRow } from "@/lib/types";
import type { ReleaseEvidenceStatus } from "@/lib/releaseEvidenceStatus";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { ModuleConfigSection, type ModuleConfigMap } from "@/components/ModuleConfigSection";
import { RunCard } from "@/components/RunCard";
import { StageBadge } from "@/components/StageBadge";
import { StatCard } from "@/components/StatCard";
import { Chart, compact, type ChartSeries } from "@/components/Chart";
import { VideoGrid } from "@/components/VideoGrid";
import { Lightbox } from "@/components/Lightbox";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { ChannelAvatar, ChannelBanner } from "@/components/ChannelArt";
import { LatestVideoWidget } from "@/components/LatestVideoWidget";
import { StatsCharts } from "@/components/StatsCharts";
import {
  IconAnalytics,
  IconChannels,
  IconOverview,
  IconSettings,
} from "@/components/icons";
import { fmtUsd } from "@/lib/format";
import { blockLabel } from "@/lib/blocks";
import {
  LIVE_PIPELINE_PHASE_LABEL,
  livePipelinePhaseForBlock,
} from "@/lib/livePipelinePresentation";
import { VOICES } from "@/lib/voices";
import { useAssetUrl, useAssetUrlState } from "@/lib/asset-url";
import { assessYouTubeSetup } from "@/lib/youtubeSetupStatus";
import { NICHE_CATALOG_EVIDENCE, NICHES, subcategoryTags } from "@/lib/nicheCatalog";
import {
  formatZonedScheduleTimestamp,
  nextProjectedPlanItem,
} from "@/lib/scheduleCalendar";
import seoStyles from "./seo.module.css";
import styles from "./channelHub.module.css";

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
  moduleConfig?: Record<string, Record<string, unknown>>;
  schedule?: {
    frequency: string;
    days?: number[];
    timezone?: string;
    localTime?: string;
    enabled?: boolean;
    approvalMode?: "manual" | "private_auto";
    dailyQuota?: number;
    maxConcurrent?: number;
    retryMaxAttempts?: number;
    retryBaseMinutes?: number;
    madeForKids?: boolean;
  };
  groupId?: string;
  language?: string;
  groupRole?: string;
  youtubeCreated?: { ytChannelId?: string; handle?: string; url?: string; createdAt: number; status?: string };
  inception?: {
    status: "planned" | "running" | "complete" | "blocked";
    updatedAt: number;
    stages: Record<
      string,
      {
        moduleKey: string;
        status: "pending" | "running" | "accepted" | "complete" | "failed" | "blocked";
        error?: string;
      }
    >;
  };
};

type RawRun = {
  _id: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  costTotal: number;
  youtubeVideoId?: string;
  error?: string;
  releaseEvidenceStatus?: ReleaseEvidenceStatus;
  releaseEvidenceCertificateFingerprint?: string;
  releaseEvidenceCertificateKey?: string;
  releaseEvidenceUpdatedAt?: number;
  libraryState?: "active" | "archived";
};

type TrendRow = {
  date: string;
  subscriberCount: number;
  totalViews: number;
  videoCount: number;
};

type ChannelCardDetail = {
  channelId: string;
  channelSlug: string;
  latestThumbnailKey: string | null;
  recentRunCount: number;
  recentPublishedCount: number;
  recentSpend: number;
  lastRunStatus: string | null;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const INCEPTION_STAGE_LABELS = [
  ["channel-inception-research", "Research"],
  ["channel-inception-positioning", "Identity"],
  ["channel-inception-seo", "SEO"],
  ["channel-inception-voice", "Voice"],
  ["channel-inception-avatar", "Avatar"],
  ["channel-inception-banner", "Banner"],
  ["channel-inception-thumbnails", "Topics + covers"],
  ["channel-inception-pipeline", "Pipeline"],
  ["channel-inception-probe", "Probe"],
  ["channel-inception-readiness", "Ready"],
] as const;

type Tab =
  | "Overview"
  | "Week ahead"
  | "Analytics"
  | "Library"
  | "SEO"
  | "Pipeline"
  | "Identity"
  | "Settings";
const TAB_GROUPS = [
  { label: "Overview", detail: "Now", icon: IconOverview, tabs: ["Overview"] },
  { label: "Content", detail: "Queue + masters", icon: IconChannels, tabs: ["Week ahead", "Library"] },
  { label: "Performance", detail: "Audience + search", icon: IconAnalytics, tabs: ["Analytics", "SEO"] },
  { label: "Setup", detail: "Identity + automation", icon: IconSettings, tabs: ["Identity", "Pipeline", "Settings"] },
] as const;

const TAB_BY_QUERY: Record<string, Tab> = {
  overview: "Overview",
  "week-ahead": "Week ahead",
  analytics: "Analytics",
  library: "Library",
  seo: "SEO",
  pipeline: "Pipeline",
  identity: "Identity",
  settings: "Settings",
};

const QUERY_BY_TAB = Object.fromEntries(
  Object.entries(TAB_BY_QUERY).map(([query, tab]) => [tab, query]),
) as Record<Tab, string>;

function validatedTab(value: string | null): Tab {
  return value ? (TAB_BY_QUERY[value.toLowerCase()] ?? "Overview") : "Overview";
}

type WorkspaceSignal = {
  label: string;
  value: string;
  detail?: string;
  tone?: "ready" | "attention" | "quiet";
};

function WorkspaceIntro({
  eyebrow,
  title,
  description,
  signals,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  signals: WorkspaceSignal[];
  action?: ReactNode;
}) {
  return (
    <header className={styles.workspaceIntro}>
      <div className={styles.workspaceIntroCopy}>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action && <div className={styles.workspaceIntroAction}>{action}</div>}
      <div className={styles.workspaceSignals} aria-label={`${title} operating signals`}>
        {signals.map((signal) => (
          <div key={signal.label} className={styles.workspaceSignal} data-tone={signal.tone ?? "quiet"}>
            <small>{signal.label}</small>
            <strong>{signal.value}</strong>
            {signal.detail && <span>{signal.detail}</span>}
          </div>
        ))}
      </div>
    </header>
  );
}

export default function ChannelHubPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const ownerId = useOwnerId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewStartedAt] = useState(() => Date.now());
  const tab = validatedTab(searchParams.get("tab"));
  const selectedPlanId = searchParams.get("plan");
  const activeTabGroup = TAB_GROUPS.find((group) => group.tabs.some((item) => item === tab)) ?? TAB_GROUPS[0];
  const ytStatus = searchParams.get("yt");
  const ytGot = searchParams.get("got");

  const selectTab = (next: Tab) => {
    const query = new URLSearchParams(searchParams.toString());
    query.set("tab", QUERY_BY_TAB[next]);
    query.delete("plan");
    router.replace(`/channels/${encodeURIComponent(slug)}?${query.toString()}`, { scroll: false });
  };

  const channel = useQuery(api.channels.getChannelBySlug, {
    ownerId,
    slug,
  }) as ChannelDoc | null | undefined;

  const channelId = channel?._id as Id<"channels"> | undefined;
  const needsRuns = tab === "Overview" || tab === "Analytics";
  const runs = useQuery(
    api.runs.listRunsByChannel,
    channelId && needsRuns ? { channelId, limit: 500 } : "skip",
  ) as RawRun[] | undefined;
  const headerPlan = useQuery(
    api.contentPlan.listReadyPlanPreview,
    channelId ? { ownerId, channelId } : "skip",
  ) as PlanRow[] | undefined;
  const channelCard = useQuery(
    api.channels.getChannelCard,
    channelId ? { ownerId, channelId } : "skip",
  ) as ChannelCardDetail | null | undefined;

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
  if (
    channelCard === undefined ||
    headerPlan === undefined ||
    (needsRuns && runs === undefined)
  ) {
    return (
      <>
        <PageHeader title={channel.name} />
        <SkeletonList rows={4} />
      </>
    );
  }
  if (channelCard === null) {
    return (
      <EmptyState
        title="Channel data unavailable"
        description="The channel summary could not be read for this owner."
      />
    );
  }

  const id = channel.identity ?? {};
  const allRuns = runs ?? [];
  const videoRuns = allRuns.filter((r) => r.youtubeVideoId);
  const okRuns = allRuns.filter((r) => r.status === "ok");
  const failedRuns = allRuns.filter((r) => r.status === "failed");
  const totalCost = allRuns.reduce((s, r) => s + (r.costTotal ?? 0), 0);
  const costPerVideo = videoRuns.length > 0 ? totalCost / videoRuns.length : null;
  const readyPlan = headerPlan;
  const nextPlan = nextProjectedPlanItem({
    items: readyPlan,
    schedule: channel.schedule,
    cadence: id.cadence,
    fromTimestamp: viewStartedAt,
  });
  const readinessChecks = [
    Boolean(id.imageKey && id.niche),
    Boolean(id.voiceId),
    Boolean(id.thumbnailTemplate),
    Boolean(channel.pipeline?.length),
    Boolean(channel.schedule?.frequency && channel.schedule?.localTime && channel.schedule?.timezone),
  ];
  const readinessDone = readinessChecks.filter(Boolean).length;
  const modulePath = (channel.pipeline ?? []).map((entry) => entry.block.replaceAll("_", " "));
  const latestArtwork = channelCard.latestThumbnailKey;
  const plannedArtwork = nextPlan?.item.thumbnailKey ?? readyPlan.find(
    (item) => item.thumbnailKey,
  )?.thumbnailKey;

  return (
    <>
      {ytStatus && (
        <div
          className={styles.youtubeNotice}
          data-tone={ytStatus === "connected" ? "connected" : "attention"}
          role="status"
        >
          {ytStatus === "connected"
            ? "✓ YouTube connected — the channel is linked and paused. Reapprove the destination and enable runs in Settings when ready."
            : ytStatus === "wrongchannel"
              ? `⚠ You linked "${ytGot ?? "another channel"}", but this app channel was created as a different YouTube channel. Switch to the correct channel on youtube.com and click Link again — the wrong one was rejected.`
              : `⚠ YouTube connect failed${ytGot ? ` (${ytGot})` : ""}. Try Link to YouTube again.`}
        </div>
      )}

      {/* Banner + identity header */}
      <ChannelBanner
        bannerKey={id.bannerKey}
        fallbackKeys={[latestArtwork, plannedArtwork]}
        name={channel.name}
        palette={id.palette}
        height={226}
      >
        <div className={styles.heroContent}>
          <div className={styles.heroIdentity}>
            <ChannelAvatar
              imageKey={id.imageKey}
              name={channel.name}
              palette={id.palette}
              size={88}
              radius={22}
            />
            <div className={styles.heroTitle}>
              <span className={styles.heroKicker}>Channel · {channel.language ?? "primary"}</span>
              <h1>{channel.name}</h1>
              <div className={styles.heroMeta}>
                <span>{id.niche ?? channel.template}</span>
                <i aria-hidden="true" />
                <span>{channelCard.recentPublishedCount} published</span>
                <i aria-hidden="true" />
                <span>{channel.schedule?.frequency ?? id.cadence ?? "Cadence not set"}</span>
              </div>
            </div>
          </div>
          <div className={styles.heroDecision}>
            <small>Next video</small>
            <strong>{nextPlan?.item.title || nextPlan?.item.topic || "Build the ready queue"}</strong>
            <span>
              {nextPlan?.timestamp
                ? formatZonedScheduleTimestamp(nextPlan.timestamp, nextPlan.timeZone, { weekday: true })
                : "No production slot reserved"}
            </span>
          </div>
          <div className={styles.heroStatus}>
            <StageBadge status={channel.status === "active" ? "ok" : channel.status} />
          </div>
        </div>
      </ChannelBanner>

      <section className={styles.operatingProfile} aria-label="Channel operating profile">
        <div className={styles.operatingSignal} data-tone={channel.status === "active" ? "ready" : "attention"}>
          <small>Status</small>
          <strong>{channel.status === "active" ? "Active" : channel.status}</strong>
          <span>{channelCard.lastRunStatus ? `Last run ${channelCard.lastRunStatus}` : "No run history"}</span>
        </div>
        <div className={styles.operatingSignal}>
          <small>Next production</small>
          <strong>
            {nextPlan?.timestamp
              ? formatZonedScheduleTimestamp(nextPlan.timestamp, nextPlan.timeZone, { weekday: true })
              : nextPlan
                ? "Time unavailable"
                : "No ready item"}
          </strong>
          <span>
            {nextPlan
              ? `${nextPlan.pinned ? "Pinned" : "Projected"} · ${nextPlan.item.title || nextPlan.item.topic}`
              : "Ready queue is clear"}
          </span>
        </div>
        <div className={styles.operatingSignal} data-tone={readinessDone === readinessChecks.length ? "ready" : "attention"}>
          <small>Config readiness</small>
          <strong>
            {readinessDone}/{readinessChecks.length} complete
          </strong>
          <span>Identity · voice · thumbnail · pipeline · schedule</span>
        </div>
        <div className={styles.operatingSignal}>
          <small>Module path</small>
          <strong>{modulePath.length} module{modulePath.length === 1 ? "" : "s"}</strong>
          <span title={modulePath.join(" → ")}>
            {modulePath.length ? `${modulePath.slice(0, 3).join(" → ")}${modulePath.length > 3 ? ` → +${modulePath.length - 3}` : ""}` : "Not configured"}
          </span>
        </div>
      </section>

      {channel.inception && <ChannelInceptionProgress inception={channel.inception} />}

      {/* Four stable work areas keep specialist views available without a wall of peer tabs. */}
      <div className={styles.tabDeck} role="tablist" aria-label="Channel sections">
        {TAB_GROUPS.map((group) => (
          <button
            key={group.label}
            type="button"
            onClick={() => selectTab(group.tabs[0])}
            role="tab"
            aria-selected={activeTabGroup.label === group.label}
            tabIndex={activeTabGroup.label === group.label ? 0 : -1}
            className={styles.tabButton}
            onKeyDown={(event) => {
              const currentIndex = TAB_GROUPS.indexOf(group);
              let nextIndex = currentIndex;
              if (event.key === "ArrowRight") {
                nextIndex = (currentIndex + 1) % TAB_GROUPS.length;
              } else if (event.key === "ArrowLeft") {
                nextIndex =
                  (currentIndex - 1 + TAB_GROUPS.length) % TAB_GROUPS.length;
              } else if (event.key === "Home") {
                nextIndex = 0;
              } else if (event.key === "End") {
                nextIndex = TAB_GROUPS.length - 1;
              } else {
                return;
              }
              event.preventDefault();
              selectTab(TAB_GROUPS[nextIndex].tabs[0]);
              const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              );
              tabs?.[nextIndex]?.focus();
            }}
          >
            <group.icon width={17} height={17} aria-hidden="true" />
            <span>
              <strong>{group.label}</strong>
              <small>{group.detail}</small>
            </span>
          </button>
        ))}
      </div>
      {activeTabGroup.tabs.length > 1 && (
        <nav className={styles.subTabs} aria-label={`${activeTabGroup.label} views`}>
          {activeTabGroup.tabs.map((item) => (
            <button
              key={item}
              type="button"
              data-active={tab === item}
              aria-current={tab === item ? "page" : undefined}
              onClick={() => selectTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>
      )}

      <div className={styles.view} data-view={QUERY_BY_TAB[tab]}>
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
      {tab === "Week ahead" && channelId && (
        <WeekAheadTab ownerId={ownerId} channelId={channelId} selectedPlanId={selectedPlanId} />
      )}
      {tab === "Library" && (
        <LibraryTab ownerId={ownerId} channelId={channelId} />
      )}
      {tab === "SEO" && <SeoTab ownerId={ownerId} channelId={channel._id} niche={id.niche} />}
      {tab === "Pipeline" && <PipelineTab pipeline={channel.pipeline ?? []} />}
      {tab === "Identity" && <IdentityTab id={id} budget={channel.budget} />}
      {tab === "Settings" && <SettingsTab channel={channel} />}
      </div>
    </>
  );
}

function ChannelInceptionProgress({
  inception,
}: {
  inception: NonNullable<ChannelDoc["inception"]>;
}) {
  const stages = INCEPTION_STAGE_LABELS.flatMap(([key, label]) => {
    const stage = inception.stages[key];
    return stage ? [{ key, label, ...stage }] : [];
  });
  const complete = stages.filter(
    (stage) => stage.status === "complete" || stage.status === "accepted",
  ).length;
  const progress = stages.length ? Math.round((complete / stages.length) * 100) : 0;

  return (
    <section
      className={styles.inception}
      aria-label="Channel setup progress"
      data-state={inception.status}
      style={{ "--inception-progress": `${progress}%` } as CSSProperties}
    >
      <div className={styles.inceptionHeading}>
        <div>
          <small>Inception / live build</small>
          <strong>
            {inception.status === "complete"
              ? "Ready"
              : inception.status === "blocked"
                ? "Needs attention"
                : inception.status === "planned"
                  ? "Plan ready — approval required"
                : "Building the channel"}
          </strong>
        </div>
        <span>{progress}%</span>
      </div>
      <div className={styles.inceptionProgress} aria-hidden="true"><i /></div>
      <div className={styles.inceptionStages}>
        {stages.map((stage, index) => (
          <div
            className={styles.inceptionStage}
            data-status={stage.status}
            key={stage.key}
            title={stage.error ?? `${stage.label}: ${stage.status}`}
          >
            <i aria-hidden="true">{String(index + 1).padStart(2, "0")}</i>
            <span>
              <strong>{stage.label}</strong>
              <small>{stage.status.replaceAll("_", " ")}</small>
            </span>
            {stage.error && (
              <small className={styles.inceptionStageError} role="alert">
                {stage.error}
              </small>
            )}
          </div>
        ))}
      </div>
    </section>
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
  const visibleRuns = (runs ?? []).filter((run) => run.libraryState !== "archived");
  const recentFailures = visibleRuns
    .filter((run) => run.status === "failed")
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, 1);
  const recent: RunRow[] = [...visibleRuns.filter((run) => run.status !== "failed").slice(0, 7), ...recentFailures]
    .map((r) => ({ ...r, channelName: channel.name, channelSlug: channel.slug }))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, 8);
  const overBudget =
    kpis.costPerVideo !== null && kpis.costPerVideo > channel.budget;

  // Surface the key configured SETTINGS (read from the pipeline params).
  const pipe = (channel.pipeline ?? []) as Array<{ block: string; params?: Record<string, unknown> }>;
  const param = (b: string, k: string): unknown => pipe.find((p) => p.block === b)?.params?.[k];
  const mins = (s: unknown): string => (typeof s === "number" ? `${Math.round((s / 60) * 10) / 10} min` : "—");
  const targetLen = param("script_gen", "maxSeconds");
  const minLen = param("length_check", "minSeconds");
  const maxLen = param("length_check", "maxSeconds");
  const tailSec = param("timeline_assemble", "tailSec");
  const maxQuotes = param("quote_overlays", "maxQuotes");
  const settings: { label: string; value: string }[] = [
    { label: "Target length", value: mins(targetLen) },
    { label: "Length range", value: minLen != null && maxLen != null ? `${mins(minLen)} – ${mins(maxLen)}` : "—" },
    { label: "Philosopher quotes", value: maxQuotes != null ? `up to ${maxQuotes}, ≥5s apart` : "≥2 attributed" },
    { label: "Outro", value: tailSec != null ? `${tailSec}s defined outro card` : "defined card" },
    { label: "Music", value: "gradual duck, fades out" },
    {
      label: "Thumbnail",
      value: `Nano Banana · ${channel.identity?.thumbnailTemplate ?? "Style DNA + playbook"}`,
    },
  ];

  return (
    <>
      <section className={styles.overviewMetrics} aria-label="Channel operating metrics">
        <StatCard label="Recent runs" value={kpis.runs} hint="latest 500 maximum" />
        <StatCard label="Recent published" value={kpis.videos} accent="var(--color-secondary)" />
        <StatCard label="Recent completed" value={kpis.completed} accent="var(--color-ok)" />
        <StatCard
          label="Recent spend"
          value={fmtUsd(kpis.totalCost)}
          accent="var(--color-accent)"
        />
        <StatCard
          label="Cost / video"
          value={kpis.costPerVideo === null ? "—" : fmtUsd(kpis.costPerVideo)}
          accent={overBudget ? "var(--color-failed)" : "var(--color-accent)"}
          hint={
            kpis.costPerVideo === null
              ? "no measured runs yet"
              : overBudget
                ? `over ${fmtUsd(channel.budget)} budget`
                : `within ${fmtUsd(channel.budget)} budget`
          }
        />
        <StatCard label="Budget / run" value={fmtUsd(channel.budget)} />
      </section>

      <LatestVideoWidget ownerId={channel.ownerId} channelId={channel._id as Id<"channels">} />

      <StatsCharts runs={(runs ?? []) as { status: string; startedAt?: number; finishedAt?: number; costTotal?: number }[]} />

      {channel.identity?.persona && (
        <section className={styles.overviewSection}>
          <div className={styles.sectionRail}><span>Channel voice</span><i /></div>
          <blockquote className={styles.personaStatement}>{channel.identity.persona}</blockquote>
        </section>
      )}

      <section className={styles.overviewSection}>
        <div className={styles.sectionRail}><span>Production grammar</span><i /></div>
        <div className={styles.configurationGrid}>
          {settings.map((s) => (
            <div key={s.label} className={styles.configurationItem}>
              <span>{s.label}</span>
              <strong>{s.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.overviewSection}>
        <header className={styles.recentHeader}>
          <div className={styles.sectionRail}><span>Recent production</span><i /></div>
          <Link href="/runs">Open full production history →</Link>
        </header>
        {runs === undefined ? (
          <SkeletonList rows={3} />
        ) : recent.length > 0 ? (
          <div className={styles.recentList}>
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

/* ------------------------------- Settings ------------------------------- */

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className={`${styles.settingRow} channel-setting-row`}>
      <div className={styles.settingCopy}>
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <div className={`${styles.settingControl} channel-setting-control`}>
        {children}
      </div>
    </div>
  );
}

function ChannelSettingsCard({ channel }: { channel: ChannelDoc }) {
  const active = channel.status === "active";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [budget, setBudget] = useState(String(channel.budget ?? 0));
  const schedule = channel.schedule ?? { frequency: "weekly" };
  const [frequency, setFrequency] = useState(schedule.frequency ?? "weekly");
  const [days, setDays] = useState<number[]>(schedule.days?.length ? schedule.days : [1]);
  const [timezone, setTimezone] = useState(schedule.timezone ?? "UTC");
  const [localTime, setLocalTime] = useState(schedule.localTime ?? "09:00");
  const [scheduleEnabled, setScheduleEnabled] = useState(schedule.enabled !== false);
  const [approvalMode, setApprovalMode] = useState<"manual" | "private_auto">(
    schedule.approvalMode ?? "manual",
  );
  const [dailyQuota, setDailyQuota] = useState(String(schedule.dailyQuota ?? 1));
  const [maxConcurrent, setMaxConcurrent] = useState(String(schedule.maxConcurrent ?? 1));
  const [retryMaxAttempts, setRetryMaxAttempts] = useState(
    String(schedule.retryMaxAttempts ?? 5),
  );
  const [retryBaseMinutes, setRetryBaseMinutes] = useState(
    String(schedule.retryBaseMinutes ?? 15),
  );
  const [madeForKids, setMadeForKids] = useState(schedule.madeForKids === true);

  const pipe = (channel.pipeline ?? []) as Array<{ block: string; params?: Record<string, unknown> }>;
  const publishMode = (pipe.find((p) => p.block === "upload_draft")?.params?.["publishMode"] as string) ?? "draft";
  const hasConfiguredCrosspost = pipe.some(
    (entry) =>
      entry.block === "crosspost" ||
      (entry.block === "shorts_spinoff" && entry.params?.["crosspostShort"] === true),
  );

  const postSetting = async (payload: Record<string, unknown>) => {
    setMessage(null);
    const response = await fetch("/api/channel-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: channel._id, ...payload }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) throw new Error(result.error ?? "settings update failed");
    return result;
  };

  const setStatus = async (next: string) => {
    if (
      next === "active" &&
      !window.confirm(
        "Enable automated channel runs? Active runs may consume the configured render budget.",
      )
    ) return;
    setBusy(true);
    try {
      await postSetting({ action: "status", status: next });
      setMessage(`Channel ${next}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "status update failed");
    } finally { setBusy(false); }
  };
  const setPublishMode = async (mode: string) => {
    const externallyVisible = mode === "public" || mode === "scheduled";
    if (externallyVisible && !window.confirm(`Approve automatic ${mode} YouTube publishing for this channel?`)) return;
    setBusy(true);
    try {
      await postSetting({ action: "publish_mode", mode });
      setMessage(
        externallyVisible
          ? `Automatic ${mode} publishing approved and bound to this exact configuration.`
          : "Main-video publishing returned to private drafts.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "publish mode update failed");
    } finally { setBusy(false); }
  };
  const saveBudget = async () => {
    const n = Number(budget);
    if (!Number.isFinite(n) || n < 0) return;
    setBusy(true);
    try {
      await postSetting({ action: "budget", budget: n });
      setMessage("Render budget saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "budget update failed");
    } finally { setBusy(false); }
  };
  const setCrosspostApproval = async (approved: boolean) => {
    if (
      approved &&
      !window.confirm(
        "Approve automatic publishing to every platform configured in the cross-post module?",
      )
    ) return;
    setBusy(true);
    try {
      await postSetting({ action: "crosspost_policy", approved });
      setMessage(
        approved
          ? "Configured cross-posting approved."
          : "Configured cross-posting revoked.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "cross-post update failed");
    } finally { setBusy(false); }
  };
  const saveSchedule = async () => {
    setBusy(true);
    try {
      await postSetting({
        action: "schedule",
        schedule: {
          frequency,
          days,
          timezone: timezone.trim(),
          localTime,
          enabled: scheduleEnabled,
          approvalMode,
          dailyQuota: Number(dailyQuota),
          maxConcurrent: Number(maxConcurrent),
          retryMaxAttempts: Number(retryMaxAttempts),
          retryBaseMinutes: Number(retryBaseMinutes),
          madeForKids,
        },
      });
      setMessage("Tenant schedule, quota, and retry policy saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "schedule update failed");
    } finally { setBusy(false); }
  };
  const toggleDay = (day: number) => {
    setDays((current) =>
      current.includes(day)
        ? current.length === 1
          ? current
          : current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => a - b),
    );
  };

  const ctlSelect: CSSProperties = {
    background: "var(--color-bg-elev, #16161a)", color: "var(--color-fg)",
    border: "1px solid var(--color-border)", borderRadius: 8, padding: "0.45rem 0.6rem", fontSize: "0.85rem",
  };
  const ctlInput: CSSProperties = { ...ctlSelect, width: 96 };
  const ctlBtn: CSSProperties = {
    background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 8,
    padding: "0.45rem 0.85rem", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
  };

  return (
    <section style={{ marginBottom: "1.6rem" }}>
      <SectionTitle>Release control + cadence</SectionTitle>
      <div className={`${styles.settingsCard} glass`}>
        <Row label="Channel" hint={active ? "Active — eligible for scheduled + manual runs" : "Paused — auto-scheduling skips it"}>
          <button
            onClick={() => setStatus(active ? "paused" : "active")}
            disabled={busy}
            style={{
              width: 86, height: 32, borderRadius: 999, cursor: busy ? "default" : "pointer",
              border: "1px solid var(--color-border)", position: "relative",
              background: active ? "rgba(52,211,153,0.20)" : "rgba(148,148,148,0.15)",
              color: active ? "var(--color-ok)" : "var(--color-muted)",
              fontWeight: 700, fontSize: "0.74rem", letterSpacing: "0.05em",
            }}
          >
            {active ? "ENABLED" : "DISABLED"}
          </button>
        </Row>
        <Row label="Auto-publish" hint="How finished videos go live on YouTube">
          <div style={{ display: "flex", gap: "0.45rem", alignItems: "center" }}>
            <select value={publishMode} disabled={busy} onChange={(e) => setPublishMode(e.target.value)} style={ctlSelect}>
              <option value="draft">Private draft (you approve)</option>
              <option value="scheduled">Scheduled (drip)</option>
              <option value="public">Public immediately</option>
            </select>
            {publishMode !== "draft" && (
              <button onClick={() => setPublishMode(publishMode)} disabled={busy} style={ctlBtn}>
                Reapprove
              </button>
            )}
          </div>
        </Row>
        {hasConfiguredCrosspost && (
          <Row label="Cross-post authority" hint="Separate revocable approval for configured off-YouTube platforms">
            <div style={{ display: "flex", gap: "0.45rem" }}>
              <button onClick={() => setCrosspostApproval(true)} disabled={busy} style={ctlBtn}>Approve</button>
              <button onClick={() => setCrosspostApproval(false)} disabled={busy} style={{ ...ctlBtn, background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>Revoke</button>
            </div>
          </Row>
        )}
        <Row label="Budget / run (USD)" hint="Cost cap per render; over-budget is flagged">
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input type="number" min="0" step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} style={ctlInput} />
            <button onClick={saveBudget} disabled={busy || budget === String(channel.budget)} style={ctlBtn}>Save</button>
          </div>
        </Row>
        <Row label="Generation cadence" hint="Tenant-local day and time for eligible automatic runs">
          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <select value={frequency} disabled={busy} onChange={(e) => setFrequency(e.target.value)} style={ctlSelect}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
            </select>
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="IANA timezone" aria-label="IANA timezone" style={{ ...ctlInput, width: 150 }} />
            <input type="time" value={localTime} onChange={(e) => setLocalTime(e.target.value)} aria-label="Local generation time" style={ctlInput} />
          </div>
        </Row>
        {(frequency === "weekly" || frequency === "biweekly") && (
          <Row label="Run days" hint="Days use the channel timezone above">
            <div style={{ display: "flex", gap: 4 }}>
              {DOW.map((label, day) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleDay(day)}
                  disabled={busy}
                  title={label}
                  style={{
                    ...ctlBtn,
                    minWidth: 34,
                    padding: "0.4rem",
                    background: days.includes(day) ? "var(--color-accent)" : "var(--color-surface)",
                    color: days.includes(day) ? "#0a0a0b" : "var(--color-muted)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  {label[0]}
                </button>
              ))}
            </div>
          </Row>
        )}
        <Row label="Scheduler guardrails" hint="Per-channel quota, concurrency, and private-draft approval mode">
          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
            <select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as "manual" | "private_auto")} style={ctlSelect}>
              <option value="manual">Manual intent approval</option>
              <option value="private_auto">Auto private drafts</option>
            </select>
            <input type="number" min="1" max="50" value={dailyQuota} onChange={(e) => setDailyQuota(e.target.value)} aria-label="Daily upload quota" title="Daily upload quota" style={{ ...ctlInput, width: 74 }} />
            <input type="number" min="1" max="10" value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} aria-label="Maximum concurrent uploads" title="Maximum concurrent uploads" style={{ ...ctlInput, width: 74 }} />
          </div>
        </Row>
        <Row label="Retry policy" hint="Maximum attempts and exponential-backoff base minutes">
          <div style={{ display: "flex", gap: "0.45rem", alignItems: "center" }}>
            <input type="number" min="1" max="12" value={retryMaxAttempts} onChange={(e) => setRetryMaxAttempts(e.target.value)} aria-label="Retry attempts" style={{ ...ctlInput, width: 74 }} />
            <input type="number" min="1" max="1440" value={retryBaseMinutes} onChange={(e) => setRetryBaseMinutes(e.target.value)} aria-label="Retry base minutes" style={{ ...ctlInput, width: 86 }} />
          </div>
        </Row>
        <Row label="Content declarations" hint="Required upload audience setting and scheduler enable switch">
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", fontSize: "0.78rem" }}>
            <label className="channel-check-control"><input type="checkbox" checked={madeForKids} onChange={(e) => setMadeForKids(e.target.checked)} /> Made for kids</label>
            <label className="channel-check-control"><input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} /> Scheduler enabled</label>
            <button onClick={saveSchedule} disabled={busy} style={ctlBtn}>Save scheduler</button>
          </div>
        </Row>
        {message && (
          <div style={{ fontSize: "0.78rem", color: message.toLowerCase().includes("fail") || message.toLowerCase().includes("invalid") || message.toLowerCase().includes("error") ? "var(--color-danger)" : "var(--color-muted)" }}>
            {message}
          </div>
        )}
      </div>
    </section>
  );
}

/* -------------------------------- Settings ------------------------------ */

function SettingsTab({ channel }: { channel: ChannelDoc }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const pipeline = (channel.pipeline ?? []) as Array<{ block: string; params?: Record<string, unknown> }>;
  const publishMode = (pipeline.find((entry) => entry.block === "upload_draft")?.params?.["publishMode"] as string) ?? "draft";
  const scheduleEnabled = channel.schedule?.enabled !== false;
  return (
    <div className={`${styles.settingsWorkspace} channel-settings-stack`}>
      <WorkspaceIntro
        eyebrow="Settings"
        title="Channel controls"
        description="Publishing, budget, schedule, and YouTube."
        signals={[
          { label: "Channel", value: channel.status === "active" ? "Enabled" : "Paused", detail: "Eligibility for scheduled + manual runs", tone: channel.status === "active" ? "ready" : "attention" },
          { label: "Release", value: publishMode === "draft" ? "Private drafts" : publishMode, detail: "Main-video publishing authority", tone: publishMode === "draft" ? "ready" : "attention" },
          { label: "Scheduler", value: scheduleEnabled ? channel.schedule?.frequency ?? "Enabled" : "Disabled", detail: `${channel.schedule?.timezone ?? "UTC"} · ${channel.schedule?.localTime ?? "time not set"}` },
          { label: "Route", value: `${pipeline.length} modules`, detail: "Configured production chain" },
        ]}
      />

      <nav className={styles.settingsMap} aria-label="Settings areas">
        <a href="#release-control"><span>01</span><strong>Release control</strong><small>Spend · cadence · publishing</small></a>
        <a href="#route-qualification-benchmark"><span>02</span><strong>Route proof</strong><small>Private final-master benchmark</small></a>
        <a href="#youtube-destination"><span>03</span><strong>YouTube destination</strong><small>OAuth · channel · brand handoff</small></a>
        <a href="#advanced-channel-system"><span>04</span><strong>Channel system</strong><small>Modules · identity · languages</small></a>
      </nav>

      <section id="release-control" className={styles.settingsSection} data-kind="release">
        <div className={styles.sectionRail}><span>01 / release control</span><i /></div>
        <ChannelSettingsCard channel={channel} />
      </section>
      <section className={styles.settingsSection} data-kind="qualification">
        <div className={styles.sectionRail}><span>02 / route proof</span><i /></div>
        <RouteQualificationBenchmarkCard channel={channel} />
      </section>
      <section id="youtube-destination" className={styles.settingsSection} data-kind="youtube">
        <div className={styles.sectionRail}><span>03 / external destination</span><i /></div>
        <YouTubeConnectCard channel={channel} />
      </section>
      <details
        id="advanced-channel-system"
        className={`${styles.settingsAdvanced} channel-advanced glass`}
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>
          <span><strong>04 / Channel system</strong><small>Pipeline modules, voice, niche, and separately admitted language variants</small></span>
          <span aria-hidden="true">+</span>
        </summary>
        {advancedOpen && (
          <div className="channel-advanced-content">
            <PipelineModulesCard channel={channel} />
            <AdvancedControls channel={channel} />
            <MultiLanguageCard channel={channel} />
          </div>
        )}
      </details>
    </div>
  );
}

/**
 * An explicit owner-only route benchmark. It is intentionally separate from
 * the cadence controls: it runs an exact production master privately, creates
 * no upload, and can only qualify a future route after final QA succeeds.
 */
function RouteQualificationBenchmarkCard({ channel }: { channel: ChannelDoc }) {
  const [maximumCostUsd, setMaximumCostUsd] = useState("25");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  // A lost browser response must retry the same durable owner request, not
  // allocate a second paid private benchmark for this channel view.
  const requestKeyRef = useRef<string | null>(null);
  const benchmarkRuns = useQuery(api.runs.listRunsByChannel, {
    channelId: channel._id as Id<"channels">,
    limit: 100,
  }) as Array<{
    _id: string;
    status: string;
    error?: string;
    routeQualificationBenchmarkDispatchState?: "pending" | "queued" | "consumed" | "blocked";
    routeQualificationBenchmarkMaximumCostUsd?: number;
  }> | undefined;
  const latestBenchmark = benchmarkRuns?.find((run) =>
    run.routeQualificationBenchmarkDispatchState !== undefined ||
    run.status === "route_qualification_benchmark_blocked" ||
    run.status === "awaiting_route_qualification_benchmark_dispatch",
  );
  const benchmarkStatus = benchmarkRuns === undefined
    ? "Loading private benchmark status…"
    : !latestBenchmark
      ? "No private route qualification benchmark has been recorded for this channel."
      : latestBenchmark.status === "route_qualification_benchmark_blocked" || latestBenchmark.routeQualificationBenchmarkDispatchState === "blocked"
        ? `Manual attention required${latestBenchmark.error ? `: ${latestBenchmark.error}` : "."}`
        : latestBenchmark.status === "ok"
          ? "Private benchmark completed. Its final-master evidence was recorded before this run completed."
          : latestBenchmark.status === "running" || latestBenchmark.routeQualificationBenchmarkDispatchState === "consumed"
            ? "Private benchmark is running its sealed creative and final-QA route."
            : latestBenchmark.routeQualificationBenchmarkDispatchState === "queued"
              ? "Private benchmark is queued with its immutable dispatch envelope."
              : "Private benchmark request is waiting for a valid sealed route preflight before it can start.";
  const controlInput: CSSProperties = {
    height: 34,
    padding: "0 0.55rem",
    borderRadius: 7,
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
  };
  const controlButton: CSSProperties = {
    height: 34,
    padding: "0 0.7rem",
    borderRadius: 7,
    border: "1px solid var(--color-border)",
    background: "var(--color-accent)",
    color: "#111",
    fontWeight: 700,
    cursor: busy ? "default" : "pointer",
  };

  const requestBenchmark = async () => {
    const maximum = Number(maximumCostUsd);
    if (!Number.isFinite(maximum) || maximum <= 0 || maximum > 100) {
      setMessage("Choose a private benchmark ceiling between $0.01 and $100.");
      return;
    }
    if (!window.confirm(
      `Run a private final-master qualification benchmark for “${channel.name}” with a maximum cost of ${fmtUsd(maximum)}? ` +
      "It will not upload or publish anything. Only a passing final master can qualify this exact route for later production.",
    )) return;
    setBusy(true);
    setMessage(null);
    setRunId(null);
    const requestKey = requestKeyRef.current ?? window.crypto.randomUUID();
    requestKeyRef.current = requestKey;
    try {
      const response = await fetch("/api/route-qualification-benchmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channelId: channel._id,
          requestKey,
          maximumCostUsd: maximum,
          confirmPrivateBenchmark: true,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; state?: string; runId?: string };
      if (!response.ok || !data.ok || !data.runId) {
        setMessage(data.error || "The private benchmark could not be queued.");
        return;
      }
      setRunId(data.runId);
      setMessage(
        data.state === "reused"
          ? "The exact private benchmark request is already recorded. Its durable dispatcher will continue from the existing run."
          : "Private benchmark request recorded. The system will re-check the sealed route before any render and will never upload this run.",
      );
    } catch {
      setMessage("Network error while recording the private benchmark request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="route-qualification-benchmark"
      className={`${styles.qualificationCard} glass`}
      aria-label="Private route qualification benchmark"
      style={{ padding: "1rem" }}
    >
      <SectionTitle>Route qualification</SectionTitle>
      <p style={{ margin: "-0.35rem 0 0.85rem", fontSize: "0.79rem", lineHeight: 1.45, color: "var(--color-muted)" }}>
        Private end-to-end proof for new or supervised routes. It never uploads or changes the schedule.
      </p>
      <div style={{ display: "flex", gap: "0.55rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: "0.22rem", fontSize: "0.68rem", color: "var(--color-muted)" }}>
          PRIVATE COST CEILING (USD)
          <input
            type="number"
            min="0.01"
            max="100"
            step="1"
            value={maximumCostUsd}
            disabled={busy}
            onChange={(event) => setMaximumCostUsd(event.target.value)}
            aria-label="Private route qualification benchmark cost ceiling"
            style={{ ...controlInput, width: 116 }}
          />
        </label>
        <button type="button" onClick={requestBenchmark} disabled={busy} style={{ ...controlButton, alignSelf: "end" }}>
          {busy ? "Recording…" : "Run private benchmark"}
        </button>
      </div>
      <div style={{ marginTop: "0.8rem", display: "grid", gap: "0.22rem", fontSize: "0.73rem", lineHeight: 1.42, color: "var(--color-muted)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", letterSpacing: "0.07em", color: "var(--color-faint)" }}>
          PRIVATE BENCHMARK STATUS
        </span>
        <span>{benchmarkStatus}</span>
        {latestBenchmark && (
          <Link href={`/runs/${encodeURIComponent(latestBenchmark._id)}`} style={{ color: "var(--color-accent)", width: "fit-content" }}>
            Open latest private benchmark
          </Link>
        )}
      </div>
      {message && (
        <p style={{ margin: "0.8rem 0 0", fontSize: "0.75rem", lineHeight: 1.42, color: message.includes("could not") || message.includes("error") ? "var(--color-danger)" : "var(--color-muted)" }}>
          {message}{" "}
          {runId && <Link href={`/runs/${encodeURIComponent(runId)}`} style={{ color: "var(--color-accent)" }}>Open run</Link>}
        </p>
      )}
    </section>
  );
}

/**
 * Pipeline modules — per-module operator toggles (presets + knobs) that persist
 * on the channel and flow into the pipeline (buildChannelProfile → moduleOverrides).
 * Editable, saves on change via channels.setModuleConfig ("toggle captions with
 * a click"). Generic over MODULE_REGISTRY — new modules appear automatically.
 */
function PipelineModulesCard({ channel }: { channel: ChannelDoc }) {
  const cid = channel._id as Id<"channels">;
  return (
    <section style={{ marginBottom: "1.6rem" }}>
      <SectionTitle>Pipeline modules</SectionTitle>
      <p style={{ margin: "-0.4rem 0 0.85rem", fontSize: "0.78rem", color: "var(--color-muted)" }}>
        Tune each module&apos;s style — changes save instantly and shape every future render.
      </p>
      <ModuleConfigSection
        channelId={cid}
        moduleConfig={channel.moduleConfig as ModuleConfigMap | undefined}
        activeBlockIds={(channel.pipeline ?? []).map((entry) => entry.block)}
      />
    </section>
  );
}

/** Link this channel to a YouTube channel (OAuth) + best-effort Browserbase create. */
function YouTubeConnectCard({ channel }: { channel: ChannelDoc }) {
  const ownerId = useOwnerId();
  const links = useQuery(api.youtubeAuth.linkStatus, { ownerId }) as
    | {
        channelId: string;
        ytTitle: string | null;
        ytChannelId: string | null;
        status: "active" | "revoked" | "error";
        scopeHealth: "healthy" | "partial" | "unknown";
        updatedAt: number;
      }[]
    | undefined;
  const connector = links?.find((l) => l.channelId === channel._id);
  const setup = assessYouTubeSetup({
    connector,
    created: channel.youtubeCreated,
    generatedAvatarKey: channel.identity?.imageKey,
  });
  const activeConnector = connector?.status === "active" ? connector : undefined;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [expandedSetupStep, setExpandedSetupStep] = useState<number | null>(null);

  const connect = () => {
    if (!setup.canConnect) return;
    window.location.assign(
      new URL(`/api/youtube-connect?channelId=${channel._id}`, window.location.origin),
    );
  };
  const autoCreate = async () => {
    if (!window.confirm(
      `Create a new external YouTube channel named "${channel.name}"? This is an irreversible provider action.`,
    )) return;
    const intentKey = window.crypto.randomUUID();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/youtube-create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: channel.name,
          channelId: channel._id,
          intentKey,
          confirmedCreateNewChannel: true,
        }),
      });
      const d = await r.json();
      setMsg(
        r.ok
          ? "Creating the YouTube channel via the cloud agent (~1-2 min). When it's done, switch to it on youtube.com and click Connect to link it."
          : d.error || "Failed to start.",
      );
    } catch {
      setMsg("Network error.");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!window.confirm("Revoke this channel's YouTube access? Pending uploads will be blocked and the channel will be paused.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/youtube-revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: channel._id, reason: "revoked from channel settings" }),
      });
      const d = await r.json();
      setMsg(
        r.ok
          ? `${d.dataPolicy}.${d.providerWarning ? ` Google warning: ${d.providerWarning}` : ""}`
          : d.error || "Revocation failed.",
      );
    } catch {
      setMsg("Network error revoking YouTube access.");
    } finally {
      setBusy(false);
    }
  };
  const openProfilePictureHandoff = async () => {
    const imageKey = channel.identity?.imageKey;
    if (!imageKey || !setup.targetChannelId) return;
    setBusy(true);
    setMsg(null);
    try {
      // This remains an owner action. Opening Studio before the awaited request
      // preserves the browser's user gesture and never attempts to control
      // Google's cross-origin profile-picker.
      window.open(
        `https://studio.youtube.com/channel/${setup.targetChannelId}/editing/profile`,
        "_blank",
        "noopener",
      );
      const response = await fetch(`/api/asset-url?key=${encodeURIComponent(imageKey)}`);
      if (!response.ok) throw new Error("Could not prepare the generated profile picture");
      const payload = (await response.json()) as { url?: string };
      if (!payload.url) throw new Error("The generated profile picture is unavailable");
      const download = document.createElement("a");
      download.href = payload.url;
      download.download = `${channel.slug}-avatar.png`;
      document.body.appendChild(download);
      download.click();
      download.remove();
      setMsg("YouTube Studio is open and the generated profile picture was downloaded. Upload it there, then save in YouTube.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not open the profile-picture handoff.");
    } finally {
      setBusy(false);
    }
  };

  const btn: CSSProperties = {
    background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 10,
    padding: "0.6rem 1.2rem", fontSize: "0.88rem", fontWeight: 600, cursor: "pointer",
  };
  const ghost: CSSProperties = {
    background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-border)",
    borderRadius: 10, padding: "0.6rem 1.2rem", fontSize: "0.88rem", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
  };
  const destinationDetail = setup.destination === "verified"
    ? `Google returned ${setup.targetLabel ?? "the selected channel"} as this channel's destination.`
    : setup.destination === "creating"
      ? "The explicitly approved external-channel creation is still running. Do not start a second creation."
      : setup.destination === "created_needs_oauth"
        ? `A provider-created channel is recorded as ${setup.targetLabel ?? "the target"}. Switch to it in YouTube, then connect it here.`
        : setup.destination === "unverified"
          ? "A connector record exists, but Google did not return a usable destination channel ID. Reconnect before any work can publish."
          : "Choose an existing YouTube channel, or explicitly create one before connecting it.";
  const oauthDetail = setup.oauth === "ready"
    ? "All required upload, management, and analytics scopes are present for this destination."
    : setup.oauth === "incomplete"
      ? "A token exists, but required YouTube permissions are incomplete. Reconnect and approve the full requested scope set."
      : setup.oauth === "reconnect_required"
        ? "The saved connector was revoked or failed validation. Reconnect explicitly before publishing or analytics can resume."
        : setup.oauth === "waiting_for_channel"
          ? "OAuth cannot be bound until the external channel creation has a verified destination."
          : setup.oauth === "connect_required"
            ? "Switch to the recorded target channel in YouTube, then use Connect so Google can bind its exact destination ID."
            : "A YouTube channel must exist before an OAuth connection can be created.";
  const profileDetail = setup.profileHandoff === "owner_action_required"
    ? "Required owner action: upload the generated profile image in YouTube Studio. Google does not provide this integration a reliable completion receipt."
    : setup.profileHandoff === "waiting_for_target"
      ? "The generated image is ready, but wait until a destination channel is known before opening YouTube Studio."
      : "No generated profile image is attached to this channel yet; resolve the channel-art stage before this handoff.";
  const setupSteps = [
    {
      label: "Destination channel",
      state: setup.destination === "verified" ? "complete" : setup.destination === "creating" ? "working" : "action",
      detail: destinationDetail,
    },
    {
      label: "OAuth permissions",
      state: setup.oauth === "ready" ? "complete" : setup.oauth === "waiting_for_channel" ? "waiting" : "action",
      detail: oauthDetail,
    },
    {
      label: "Profile picture",
      // This is deliberately not marked complete: the owner performs it in
      // YouTube and the API does not provide a trustworthy receipt to us.
      state: setup.profileHandoff === "owner_action_required" ? "action" : "waiting",
      detail: profileDetail,
    },
    {
      label: "Banner + basic information",
      state: setup.brandingSync === "attempted_unverified" ? "automatic" : "waiting",
      detail: setup.brandingSync === "attempted_unverified"
        ? "After a healthy OAuth callback, the system attempts an official API update for the generated banner, description, country, language, and keywords. Verify the result in YouTube Studio; this page has no delivery receipt yet."
        : "The automatic branding attempt waits for a healthy OAuth connection.",
    },
  ];
  const activeSetupStep = setupSteps.findIndex((step) => step.state === "action" || step.state === "working");

  return (
    <section>
      <SectionTitle>YouTube destination + brand handoff</SectionTitle>
      <div className={`${styles.youtubeCard} glass`} data-oauth={setup.oauth}>
        {setup.oauth === "ready" ? (
          <div className={styles.youtubeLead} data-tone="ready">
            <span aria-hidden="true">✓</span><div><small>Verified destination</small><strong>{setup.targetLabel || setup.targetChannelId || "The selected YouTube channel"}</strong><p>Publishing, branding, and analytics are ready.</p></div>
          </div>
        ) : setup.oauth === "incomplete" ? (
          <div className={styles.youtubeLead} data-tone="attention">
            <span aria-hidden="true">!</span><div><small>Permissions incomplete</small><strong>{setup.targetLabel || setup.targetChannelId || "A YouTube channel"}</strong><p>Reconnect once to restore publishing and analytics.</p></div>
          </div>
        ) : (
          <div className={styles.youtubeLead} data-tone="quiet">
            <span aria-hidden="true">○</span><div><small>Destination required</small><strong>Choose the exact YouTube channel</strong><p>{connector?.status === "revoked"
              ? "Access was revoked. Reconnect before publishing."
              : connector?.status === "error"
                ? "The connection failed validation. Reconnect before publishing."
              : "Connect an existing channel or approve creating one."}</p></div>
          </div>
        )}
        {setup.destination === "creating" && (
          <div style={{ fontSize: "0.82rem", color: "#fbbf24", lineHeight: 1.5 }}>
            <span className="studio-pulse">●</span> Setting up the YouTube channel… (runs in the background — this
            updates by itself, no need to watch anything).
          </div>
        )}
        {setup.destination === "created_needs_oauth" && channel.youtubeCreated?.ytChannelId && (
          <div style={{ fontSize: "0.82rem", color: "var(--color-accent)", lineHeight: 1.5 }}>
            ● The agent created a YouTube channel for this:{" "}
            <a href={channel.youtubeCreated.url} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)", textDecoration: "underline" }}>
              {channel.youtubeCreated.handle || channel.youtubeCreated.ytChannelId}
            </a>
            . Switch to it on youtube.com, then click <strong>Connect</strong> to finish linking.
          </div>
        )}
        <div
          aria-label="YouTube setup checklist"
          className={styles.youtubeChecklist}
        >
          <header><span>Destination sequence</span><strong>{setupSteps.filter((step) => step.state === "complete" || step.state === "automatic").length}/{setupSteps.length} resolved</strong></header>
          {setupSteps.map((step, index) => (
            <details
              key={step.label}
              className={styles.youtubeStep}
              data-state={step.state}
              open={expandedSetupStep === index || (expandedSetupStep === null && index === activeSetupStep)}
              onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setExpandedSetupStep((current) => isOpen
                  ? index
                  : current === index || current === null
                    ? -1
                    : current);
              }}
            >
              <summary>
                <span aria-label={step.state}>
                  {step.state === "complete" ? "✓" : step.state === "action" ? "!" : step.state === "working" ? "●" : "·"}
                </span>
                <strong>{step.label}</strong>
                <small>{step.state === "complete" ? "Ready" : step.state === "working" ? "Working" : step.state === "action" ? "Action" : "Waiting"}</small>
              </summary>
              <p>{step.detail}</p>
            </details>
          ))}
        </div>
        <div className={styles.youtubeActions}>
          <button onClick={connect} disabled={busy || !setup.canConnect} style={{ ...btn, opacity: busy || !setup.canConnect ? 0.6 : 1 }}>
            {setup.oauth === "ready" ? "Reconnect YouTube" : setup.oauth === "incomplete" || setup.oauth === "reconnect_required" ? "Reconnect with full permissions" : setup.destination === "creating" ? "Channel creation running" : "Connect YouTube"}
          </button>
          {activeConnector && (
            <button onClick={revoke} disabled={busy} style={{ ...ghost, color: "#f87171" }}>
              {busy ? "Revoking…" : "Revoke access"}
            </button>
          )}
          {setup.canAutoCreate && (
            <button onClick={autoCreate} disabled={busy} style={ghost}>
              {busy ? "Starting…" : "Auto-create channel (Browserbase)"}
            </button>
          )}
          {setup.profileHandoff === "owner_action_required" && (
            <button onClick={openProfilePictureHandoff} disabled={busy} style={ghost}>
              {busy ? "Preparing…" : "Set profile picture in YouTube"}
            </button>
          )}
        </div>
        {setup.oauth !== "ready" && (
          <details className={styles.youtubeNote}>
            <summary>Connection rules</summary>
            <p><strong>Connect</strong> opens Google for the selected channel. Auto-create is only available before a destination exists because channel creation is irreversible.</p>
          </details>
        )}
        {setup.oauth === "ready" && (
          <details className={styles.youtubeNote}>
            <summary>Connection rules</summary>
            <p>A new or rotated connector pauses this channel until release authority is reviewed.</p>
          </details>
        )}
        {msg && <p aria-live="polite" style={{ fontSize: "0.8rem", color: "var(--color-muted)", margin: 0 }}>{msg}</p>}
      </div>
    </section>
  );
}

const FLAGS: Record<string, string> = { en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", fr: "🇫🇷", pt: "🇵🇹", it: "🇮🇹", nl: "🇳🇱" };

/** Multi-language group: clone this channel into DE + ES flag-branded siblings. */
function MultiLanguageCard({ channel }: { channel: ChannelDoc }) {
  // A standalone channel is not an empty multilingual group. Passing its id
  // as a synthetic group id makes the scoped Convex authorization correctly
  // reject the read before the handler can return an empty list.
  const group = useQuery(
    api.channels.listGroup,
    channel.groupId ? { groupId: channel.groupId } : "skip",
  ) as ChannelDoc[] | undefined;

  const siblings = (group ?? []).filter((c) => c._id !== channel._id);
  const haveLangs = new Set([channel.language ?? "en", ...siblings.map((c) => c.language ?? "")]);
  const targets = ["de", "es"].filter((l) => !haveLangs.has(l));

  return (
    <section>
      <SectionTitle>Multi-language group</SectionTitle>
      <div className="glass" style={{ padding: "1.2rem", display: "grid", gap: "1rem" }}>
        <div style={{ fontSize: "0.84rem", color: "var(--color-muted)", lineHeight: 1.5 }}>
          Existing language siblings share this group. New language channels are deliberately created through
          a separately admitted inception plan: independent identity, localisation review, budget reservation,
          and lifecycle—not a cosmetic clone of the source channel.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
            {FLAGS[channel.language ?? "en"] ?? "🌐"} {channel.groupRole === "sibling" ? "Sibling" : "Base"} · {(channel.language ?? "en").toUpperCase()}
          </span>
          {siblings.map((s) => (
            <Link key={s._id} href={`/channels/${s.slug}`} className="glass lift"
              style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", borderRadius: 8, display: "flex", gap: "0.35rem", alignItems: "center" }}>
              {FLAGS[s.language ?? ""] ?? "🌐"} {(s.language ?? "?").toUpperCase()}
              <span style={{ color: s.status === "active" ? "var(--color-ok)" : "var(--color-muted)", fontSize: "0.66rem" }}>
                {s.status === "active" ? "live" : s.status}
              </span>
            </Link>
          ))}
        </div>
        {targets.length > 0 ? (
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
            <button disabled title="Requires admitted per-language channel inception" style={{
              background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 10,
              padding: "0.6rem 1.2rem", fontSize: "0.88rem", fontWeight: 600, cursor: "not-allowed", opacity: 0.55,
            }}>
              {`+ Make multi-language (${targets.map((l) => FLAGS[l]).join(" ")}) — admission required`}
            </button>
            <span style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>
              Automatic sibling creation is paused until the per-language inception flow is available.
            </span>
          </div>
        ) : (
          <div style={{ fontSize: "0.82rem", color: "var(--color-ok)" }}>✓ DE + ES siblings exist for this group.</div>
        )}
      </div>
    </section>
  );
}

/**
 * Voice + cadence + niche-narrowing controls, plus a button to regenerate fresh
 * competitor + SEO intelligence for the (possibly newly-narrowed) niche.
 */
function AdvancedControls({ channel }: { channel: ChannelDoc }) {
  const update = useMutation(api.channels.updateChannel);
  const cid = channel._id as Id<"channels">;
  const id = channel.identity ?? ({} as ChannelIdentity);

  const [voice, setVoice] = useState(id.voiceId ?? "sleepless_historian");
  const [cadence, setCadence] = useState(channel.schedule?.frequency ?? id.cadence ?? "weekly");
  const [days, setDays] = useState<number[]>(channel.schedule?.days?.length ? channel.schedule.days : [1]);
  const [niche, setNiche] = useState(id.niche ?? "");
  const [nicheKey, setNicheKey] = useState("");
  const [subcat, setSubcat] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [research, setResearch] = useState<string | null>(null);

  const dirty =
    voice !== (id.voiceId ?? "sleepless_historian") ||
    cadence !== (channel.schedule?.frequency ?? id.cadence ?? "weekly") ||
    JSON.stringify(days) !== JSON.stringify(channel.schedule?.days?.length ? channel.schedule.days : [1]) ||
    niche.trim() !== (id.niche ?? "") ||
    Boolean(nicheKey && subcat);

  const catalogNiche = NICHES.find((n) => n.key === nicheKey);

  const applyCatalog = (subName: string) => {
    setSubcat(subName);
    if (catalogNiche) setNiche(`${catalogNiche.label} — ${subName}`);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const nextId = { ...id, voiceId: voice, cadence, niche: niche.trim() };
      // If a catalog subcategory was picked, seed its SEO tags into the metadata
      // block so the pipeline automates from them (v1 catalog defaults).
      const seed = nicheKey && subcat ? subcategoryTags(nicheKey, subcat) : [];
      const pipelinePatch =
        seed.length && channel.pipeline
          ? channel.pipeline.map((p) =>
              p.block === "metadata"
                ? { ...p, params: { ...((p.params as Record<string, unknown>) ?? {}), baseTags: seed } }
                : p,
            )
          : undefined;
      await update({
        channelId: cid,
        identity: nextId,
        schedule: { ...channel.schedule, frequency: cadence, days },
        ...(pipelinePatch ? { pipeline: pipelinePatch } : {}),
      } as Parameters<typeof update>[0]);
      setMsg(seed.length ? `Saved · seeded ${seed.length} SEO tags.` : "Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    const n = niche.trim();
    if (!n) { setResearch("Set a niche first."); return; }
    setBusy(true);
    setResearch(null);
    try {
      // Persist the niche first so the research keys off the latest value.
      if (n !== (id.niche ?? "")) {
        await update({ channelId: cid, identity: { ...id, voiceId: voice, cadence, niche: n } } as Parameters<typeof update>[0]);
      }
      const r = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ niche: n, channelId: cid }),
      });
      const d = await r.json();
      setResearch(
        r.ok
          ? `Researching "${n}" — fresh competitor + SEO intel will populate the SEO tab shortly.`
          : d.error || "Could not start research.",
      );
    } catch {
      setResearch("Network error starting research.");
    } finally {
      setBusy(false);
    }
  };

  const sel: CSSProperties = {
    background: "var(--color-bg-elev, #16161a)", color: "var(--color-fg)",
    border: "1px solid var(--color-border)", borderRadius: 8, padding: "0.45rem 0.6rem", fontSize: "0.85rem",
  };
  const labelStyle: CSSProperties = { fontSize: "0.86rem", fontWeight: 600, color: "var(--color-fg)" };
  const hintStyle: CSSProperties = { fontSize: "0.74rem", color: "var(--color-muted)", marginTop: 2 };
  const btn: CSSProperties = {
    background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 8,
    padding: "0.5rem 1rem", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
  };
  return (
    <section>
      <SectionTitle>Production controls</SectionTitle>
      <div className="glass" style={{ padding: "1.2rem", display: "grid", gap: "1.1rem" }}>
        <Row label="Narration voice (Fish tier)" hint="Fish reference voice — used when no ElevenLabs narrator is cast below">
          <select value={voice} disabled={busy} onChange={(e) => setVoice(e.target.value)} style={sel}>
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>{v.label}{v.note ? ` — ${v.note}` : ""}</option>
            ))}
          </select>
        </Row>

        <NarratorPicker channel={channel} />

        <Row label="Upload cadence" hint="How often this channel publishes">
          <select value={cadence} disabled={busy} onChange={(e) => setCadence(e.target.value)} style={sel}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
          </select>
        </Row>
        {(cadence === "weekly" || cadence === "biweekly") && (
          <Row label="Upload days" hint="Which weekdays the scheduler may run">
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {DOW.map((d, i) => {
                const on = days.includes(i);
                return (
                  <button key={i} disabled={busy}
                    onClick={() => setDays((p) => on ? (p.length === 1 ? p : p.filter((x) => x !== i)) : [...p, i].sort((a, b) => a - b))}
                    style={{
                      width: 34, height: 30, borderRadius: 7, cursor: "pointer", fontSize: "0.72rem", fontWeight: 600,
                      border: `1px solid ${on ? "var(--color-accent)" : "var(--color-border)"}`,
                      background: on ? "var(--color-accent)" : "var(--color-surface)",
                      color: on ? "#0a0a0b" : "var(--color-muted)",
                    }}>{d[0]}</button>
                );
              })}
            </div>
          </Row>
        )}

        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "1.1rem", display: "grid", gap: "0.7rem" }}>
          <div>
            <div style={labelStyle}>Niche</div>
            <div style={hintStyle}>Narrow it down for sharper topics + competitor research</div>
          </div>
          <input
            value={niche}
            disabled={busy}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="e.g. stoic philosophy — daily discipline"
            style={{ ...sel, width: "100%" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <select value={nicheKey} disabled={busy} onChange={(e) => { setNicheKey(e.target.value); setSubcat(""); }} style={sel}>
              <option value="">From catalog…</option>
              {NICHES.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
            </select>
            {catalogNiche && (
              <select value={subcat} disabled={busy} onChange={(e) => applyCatalog(e.target.value)} style={sel}>
                <option value="">Sub-category…</option>
                {catalogNiche.subcategories.map((s) => (
                  <option key={s.id} value={s.name}>{s.name} — {NICHE_CATALOG_EVIDENCE.label}</option>
                ))}
              </select>
            )}
          </div>
          {nicheKey && subcat && subcategoryTags(nicheKey, subcat).length > 0 && (
            <div style={{ fontSize: "0.72rem", color: "var(--color-muted)" }}>
              Seeds {subcategoryTags(nicheKey, subcat).length} SEO tags the pipeline expands with AI:{" "}
              <span style={{ color: "var(--color-faint)" }}>{subcategoryTags(nicheKey, subcat).slice(0, 6).join(", ")}…</span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={save} disabled={busy || !dirty} style={{ ...btn, opacity: busy || !dirty ? 0.5 : 1 }}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button onClick={regenerate} disabled={busy || !niche.trim()} style={{
            ...btn, background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-border)",
            opacity: busy || !niche.trim() ? 0.5 : 1,
          }}>
            ↻ Regenerate competitor + SEO intel
          </button>
          {msg && <span style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>{msg}</span>}
        </div>
        {research && <p style={{ fontSize: "0.8rem", color: "var(--color-muted)", margin: 0 }}>{research}</p>}
      </div>
    </section>
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

  const audienceSamples = trend?.length ?? 0;
  const costedRuns = runs.filter((run) => run.startedAt).length;
  const completedRuns = runs.filter((run) => run.status === "ok").length;

  return (
    <div className={styles.analyticsWorkspace}>
      <WorkspaceIntro
        eyebrow="Analytics"
        title="Audience &amp; cost"
        description="YouTube performance and production spend."
        signals={[
          { label: "Audience window", value: audienceSamples ? `${audienceSamples} snapshots` : "Awaiting sync", detail: "Rolling 90 days", tone: audienceSamples ? "ready" : "attention" },
          { label: "Recent spend", value: fmtUsd(totalCost), detail: "Latest 500 runs maximum" },
          { label: "Cost / uploaded output", value: costPerVideo === null ? "Not available" : fmtUsd(costPerVideo), detail: "Spend divided by YouTube-linked outputs" },
          { label: "Production sample", value: `${completedRuns}/${costedRuns} complete`, detail: "Completed / costed runs" },
        ]}
      />

      <div className={styles.analyticsLedger}>
        <section className={styles.analyticsPanel}>
          <div className={styles.analyticsPanelHeader}>
            <div><span>External signal</span><h3>Audience growth</h3></div>
            <small>90-day YouTube snapshots</small>
          </div>
          {trend === undefined ? (
            <SkeletonList rows={2} />
          ) : trend.length > 0 ? (
            <Chart title="Subscribers + total views" series={growth} formatValue={(n) => compact(n)} />
          ) : (
            <div className={styles.analyticsEmpty}>
              <strong>No audience snapshots yet</strong>
              <p>Connect YouTube to begin syncing analytics.</p>
              <Link href="?tab=settings#youtube-destination">Review YouTube destination →</Link>
            </div>
          )}
        </section>

        <section className={styles.analyticsPanel}>
          <div className={styles.analyticsPanelHeader}>
            <div><span>Internal ledger</span><h3>Cost per production run</h3></div>
            <small>{costedRuns} recorded run{costedRuns === 1 ? "" : "s"}</small>
          </div>
          {costSeries[0].points.length > 0 ? (
            <Chart title="Actual stage-cost rollup" series={costSeries} formatValue={(n) => `$${n.toFixed(2)}`} />
          ) : (
            <div className={styles.analyticsEmpty}>
              <strong>No costed runs yet</strong>
              <p>The ledger begins when a production run records provider and stage receipts.</p>
            </div>
          )}
        </section>
      </div>
    </div>
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
    channelId ? { ownerId, channelId, limit: 500, includeArchived: true } : "skip",
  ) as VideoRow[] | undefined;
  const [index, setIndex] = useState<number | null>(null);

  if (videos === undefined) return <SkeletonList rows={3} />;
  const active = videos.filter((video) => video.libraryState !== "archived");
  const archived = videos.filter((video) => video.libraryState === "archived");
  const published = active.filter((video) => video.youtubeVideoId).length;
  const evidenced = active.filter((video) => video.releaseEvidenceStatus === "release_evidence_recorded").length;

  return (
    <div className={styles.libraryWorkspace}>
      <WorkspaceIntro
        eyebrow="Library"
        title="Videos"
        description="Open active videos or restore archived ones."
        signals={[
          { label: "Active masters", value: String(active.length), detail: "Visible on this channel shelf", tone: active.length ? "ready" : "quiet" },
          { label: "Published", value: String(published), detail: "YouTube-linked outputs" },
          { label: "Evidence recorded", value: `${evidenced}/${active.length}`, detail: "Sealed retained-master provenance", tone: active.length > 0 && evidenced === active.length ? "ready" : "attention" },
          { label: "Archive", value: String(archived.length), detail: "Recoverable, never deleted" },
        ]}
        action={<Link className={styles.workspaceActionLink} href="/library">Open full Library</Link>}
      />

      {active.length === 0 ? (
        <section className={styles.libraryEmpty}>
          <span aria-hidden="true">◇</span>
          <div>
            <strong>{archived.length ? "The active shelf is clear" : "No finished masters yet"}</strong>
            <p>{archived.length ? `${archived.length} retained master${archived.length === 1 ? " is" : "s are"} recoverable in the full Library.` : "Finished private drafts and published videos appear here after the production route records a usable final asset."}</p>
          </div>
          <Link href="/library">{archived.length ? "Review archive" : "Open Library"} →</Link>
        </section>
      ) : (
        <>
          <div className={styles.sectionRail}><span>Active masters / newest first</span><i /></div>
          <VideoGrid
            videos={active}
            onOpen={(video) => setIndex(active.findIndex((item) => item._id === video._id))}
          />
          {index !== null && index >= 0 && (
            <Lightbox
              videos={active}
              index={index}
              onIndex={setIndex}
              onClose={() => setIndex(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

/* --------------------------------- SEO ---------------------------------- */

function SeoTab({ ownerId, channelId, niche }: { ownerId: string; channelId: string; niche?: string }) {
  const [researchState, setResearchState] = useState<{
    status: "idle" | "queuing" | "queued" | "error";
    message?: string;
  }>({ status: "idle" });
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
  const competitors = useQuery(
    api.competitors.listCompetitors,
    niche ? { ownerId, niche } : "skip",
  ) as Array<{ topVideos?: { title: string; views: number }[] }> | undefined;
  const topVids = (competitors ?? [])
    .flatMap((c) => c.topVideos ?? [])
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  const refreshResearch = async () => {
    if (!niche || researchState.status === "queuing") return;
    setResearchState({ status: "queuing" });
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ niche, channelId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Research could not be queued");
      setResearchState({
        status: "queued",
        message: "Refresh queued. This view updates automatically when the research lands.",
      });
    } catch (error) {
      setResearchState({
        status: "error",
        message: error instanceof Error ? error.message : "Research could not be queued",
      });
    }
  };

  if (!niche)
    return (
      <div className={seoStyles.workspace}>
        <header className={seoStyles.header}>
          <div className={seoStyles.headerText}>
            <span className={seoStyles.eyebrow}>Discovery desk / channel positioning</span>
            <h2>Search intelligence needs a defined field</h2>
            <p>Set a niche before comparing competitors.</p>
          </div>
          <Link className={seoStyles.refresh} href="?tab=identity">Review identity</Link>
        </header>
        <div className={seoStyles.emptyPanel}>
          <span className={seoStyles.emptySymbol} aria-hidden="true">⌁</span>
          <strong>No niche is attached to this channel</strong>
          <span>Identity is the source of truth; this desk will update after a niche is saved and research is refreshed.</span>
        </div>
      </div>
    );
  return (
    <div className={seoStyles.workspace}>
      <header className={seoStyles.header}>
        <div className={seoStyles.headerText}>
          <span className={seoStyles.eyebrow}>Discovery desk / observed market</span>
          <h2>{niche}</h2>
          <p>Use observed patterns to plan the next upload.</p>
        </div>
        <button
          type="button"
          className={seoStyles.refresh}
          onClick={refreshResearch}
          disabled={researchState.status === "queuing"}
        >
          {researchState.status === "queuing" ? "Queuing…" : "Refresh intelligence"}
        </button>
      </header>

      <div className={seoStyles.sourceLedger} aria-label="SEO data provenance">
        <span><small>Market frame</small><strong>{competitors === undefined ? "Loading" : `${competitors.length} competitor set${competitors.length === 1 ? "" : "s"}`}</strong></span>
        <span><small>Reusable patterns</small><strong>{databank ? `${(databank.titleTemplates?.length ?? 0) + (databank.hookPatterns?.length ?? 0)} recorded` : "Awaiting research"}</strong></span>
        <span><small>Decision rule</small><strong>Human-selected direction</strong></span>
      </div>

      {researchState.message && (
        <p
          className={`${seoStyles.notice}${researchState.status === "error" ? ` ${seoStyles.noticeError}` : ""}`}
          role={researchState.status === "error" ? "alert" : "status"}
        >
          {researchState.message}
        </p>
      )}

      {intel === undefined ? (
        <SkeletonList rows={3} />
      ) : !intel ? (
        <div className={seoStyles.emptyPanel}>
          <strong>No intelligence snapshot yet</strong>
          <span>Refresh to build competitor benchmarks, reusable title patterns, and content gaps.</span>
        </div>
      ) : (
        <>
          <div className={seoStyles.benchmarkGrid} aria-label="SEO benchmarks">
            <StatCard label="Ideal title length" value={intel.optimalTitleLen ?? "—"} />
            <StatCard
              label="Top-50 average views"
              value={intel.avgViewsTop50 ? compact(intel.avgViewsTop50) : "—"}
              accent="var(--color-secondary)"
            />
            <StatCard
              label="Top-50 median views"
              value={intel.medianViewsTop50 ? compact(intel.medianViewsTop50) : "—"}
              accent="var(--color-secondary)"
            />
          </div>

          <div className={seoStyles.decisionGrid}>
            <section className={seoStyles.panel}>
              <div className={seoStyles.panelHeader}>
                <h3>Content opportunities</h3>
                <span>Prioritize</span>
              </div>
              {databank?.competitorGaps?.length ? (
                <ul className={`${seoStyles.patternList} ${seoStyles.opportunityList}`}>
                  {databank.competitorGaps.map((gap, index) => <li key={`${gap}-${index}`}>{gap}</li>)}
                </ul>
              ) : (
                <p className={seoStyles.guide}>No competitor gaps have been identified yet.</p>
              )}
            </section>

            <section className={seoStyles.panel}>
              <div className={seoStyles.panelHeader}>
                <h3>Thumbnail direction</h3>
                <span>Apply</span>
              </div>
              <p className={seoStyles.guide}>
                {intel.thumbnailStyleGuide?.notes || "No niche-specific thumbnail direction has been recorded yet."}
              </p>
            </section>
          </div>

          <div className={seoStyles.decisionGrid}>
            <section className={seoStyles.panel}>
              <div className={seoStyles.panelHeader}>
                <h3>Title patterns</h3>
                <span>{databank?.titleTemplates?.length ?? 0} saved</span>
              </div>
              {databank?.titleTemplates?.length ? (
                <ul className={seoStyles.patternList}>
                  {databank.titleTemplates.map((pattern, index) => <li key={`${pattern}-${index}`}>{pattern}</li>)}
                </ul>
              ) : <p className={seoStyles.guide}>No reusable title patterns yet.</p>}
            </section>

            <section className={seoStyles.panel}>
              <div className={seoStyles.panelHeader}>
                <h3>Opening hooks</h3>
                <span>{databank?.hookPatterns?.length ?? 0} saved</span>
              </div>
              {databank?.hookPatterns?.length ? (
                <ul className={seoStyles.patternList}>
                  {databank.hookPatterns.map((pattern, index) => <li key={`${pattern}-${index}`}>{pattern}</li>)}
                </ul>
              ) : <p className={seoStyles.guide}>No reusable hook patterns yet.</p>}
            </section>
          </div>

          {topVids.length > 0 && (
            <section className={seoStyles.panel}>
              <div className={seoStyles.panelHeader}>
                <h3>Top competitor videos</h3>
                <span>By views</span>
              </div>
              <ol className={seoStyles.competitorList}>
                {topVids.map((video, index) => (
                  <li key={`${video.title}-${index}`} className={seoStyles.competitorRow}>
                    <span className={seoStyles.rank}>{String(index + 1).padStart(2, "0")}</span>
                    <span className={seoStyles.competitorTitle}>{video.title}</span>
                    <span className={seoStyles.views}>{compact(video.views)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {intel.powerWords?.length ? (
            <section className={seoStyles.panel}>
              <div className={seoStyles.panelHeader}>
                <h3>High-performing language</h3>
                <span>Observed frequency</span>
              </div>
              <div className={seoStyles.chips}>
                {intel.powerWords.slice(0, 24).map((item) => (
                  <span key={item.word} className={seoStyles.chip}>
                    {item.word}<small>×{item.count}</small>
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </>
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
    <section className={styles.pipelineMap} aria-label="Channel production pipeline">
      <header className={styles.pipelineHeader}>
        <div>
          <span>Frozen channel route</span>
          <h2>{pipeline.length} working modules</h2>
          <p>The configured production route.</p>
        </div>
        <strong>{String(pipeline.length).padStart(2, "0")}</strong>
      </header>
      {pipeline.map((p, i) => {
        const params = p.params as Record<string, unknown> | undefined;
        const hasParams = params && Object.keys(params).length > 0;
        const phase = livePipelinePhaseForBlock(p.block);
        const previousPhase = i > 0 ? livePipelinePhaseForBlock(pipeline[i - 1]!.block) : null;
        return (
          <div className={styles.pipelineGroup} key={`${p.block}-${i}`}>
            {phase !== previousPhase && (
              <div className={styles.pipelinePhase}>
                <span>{LIVE_PIPELINE_PHASE_LABEL[phase]}</span><i />
              </div>
            )}
            <article className={styles.pipelineModule} data-phase={phase}>
              <span className={styles.pipelineIndex}>{String(i + 1).padStart(2, "0")}</span>
              <span className={styles.pipelineNode} aria-hidden="true"><i /></span>
              <span className={styles.pipelineIdentity}>
                <strong>{blockLabel(p.block)}</strong>
                <small>{p.block}</small>
              </span>
              <span className={styles.pipelineCapability}>{LIVE_PIPELINE_PHASE_LABEL[phase]}</span>
              {hasParams ? (
                <details className={styles.pipelineParams}>
                  <summary>{Object.keys(params!).length} controls</summary>
                  <dl>
                    {Object.entries(params!).map(([key, value]) => (
                      <div key={key}><dt>{key}</dt><dd>{JSON.stringify(value)}</dd></div>
                    ))}
                  </dl>
                </details>
              ) : <span className={styles.pipelineDefault}>module defaults</span>}
            </article>
          </div>
        );
      })}
    </section>
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
  const bible = id.creativeBrief;
  return (
    <div className={styles.identityWorkspace}>
      {bible && (
        <section className={styles.identitySection}>
          <div className={styles.sectionRail}><span>Show bible / film crew</span><i /></div>
          <div className={styles.showBible}>
            <div className={styles.identityFieldGrid}>
              <Field label="Positioning" value={bible.positioning} />
              <Field label="Vibe" value={bible.vibe} />
              <Field label="Iconic motif" value={bible.iconicMotif} />
            </div>
            {bible.activeCrew?.length > 0 && (
              <div className={styles.identitySubsection}>
                <div className={styles.identityLabel}>Active crew</div>
                <ChipRow items={bible.activeCrew} tone="accent" />
              </div>
            )}
            <div className={styles.identityDoctrineGrid}>
              {bible.worksInSpace?.length > 0 && (
                <div>
                  <div className={styles.identityWorks}>Works in this space</div>
                  <List items={bible.worksInSpace} />
                </div>
              )}
              {bible.avoidInSpace?.length > 0 && (
                <div>
                  <div className={styles.identityAvoids}>Avoid in this space</div>
                  <List items={bible.avoidInSpace} />
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      <div
        className={styles.identityFieldGrid}
      >
        <Field label="Niche" value={id.niche ?? "—"} />
        <Field label="Cadence" value={id.cadence ?? "—"} />
        <Field label="Voice" value={id.voiceId ?? "—"} mono />
        <Field label="Thumbnail" value={id.thumbnailTemplate ?? "—"} />
        <Field label="Per-run budget" value={fmtUsd(budget)} mono />
      </div>

      {id.palette && id.palette.length > 0 && (
        <section className={styles.identitySection}>
          <div className={styles.sectionRail}><span>Palette</span><i /></div>
          <div className={styles.palette}>
            {id.palette.map((c) => (
              <div key={c} className={styles.swatch}>
                <div
                  style={{ background: c }}
                />
                <code>{c}</code>
              </div>
            ))}
          </div>
        </section>
      )}

      {id.styleGrammar && (
        <section className={styles.identitySection}>
          <div className={styles.sectionRail}><span>Style grammar</span><i /></div>
          <p className={styles.styleGrammar}>{id.styleGrammar}</p>
        </section>
      )}
      {id.topicPool && id.topicPool.length > 0 && (
        <section className={styles.identitySection}>
          <div className={styles.sectionRail}><span>Topic pool</span><i /></div>
          <ChipRow items={id.topicPool} tone="secondary" />
        </section>
      )}
      {id.bannedWords && id.bannedWords.length > 0 && (
        <section className={styles.identitySection}>
          <div className={styles.sectionRail}><span>Banned words</span><i /></div>
          <ChipRow items={id.bannedWords} tone="muted" />
        </section>
      )}
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.identityField} data-mono={mono ? "true" : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
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
  return (
    <div className={styles.chipRow} data-tone={tone}>
      {items.map((it, i) => (
        <span key={`${it}-${i}`}>
          {it}
        </span>
      ))}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <div className={styles.doctrineList}>
      {items.map((it, i) => (
        <div key={i}>
          {it}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Week ahead ------------------------------ */

/** Presigned R2 image (key → /api/asset-url → <img>). */
function AssetImg({
  k,
  alt,
  className,
  style,
}: {
  k?: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
}) {
  const asset = useAssetUrlState(k);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageFailed = Boolean(asset.url && failedUrl === asset.url);
  const base: CSSProperties = {
    background: "var(--color-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--color-muted)",
    fontSize: "0.72rem",
    ...style,
  };
  if (!k) return <div className={className} style={base}>no thumbnail</div>;
  if (asset.status === "error" || imageFailed) {
    return <div className={className} style={base}>thumbnail unavailable</div>;
  }
  if (!asset.url) return <div className={className} style={base}>loading thumbnail…</div>;
  return (
    <Image
      src={asset.url}
      alt={alt}
      className={className}
      width={200}
      height={112}
      unoptimized
      onError={() => setFailedUrl(asset.url)}
      style={{ objectFit: "cover", ...style }}
    />
  );
}

type PlanRow = {
  _id: Id<"contentPlan">;
  order: number;
  topic: string;
  title?: string;
  description?: string;
  thumbnailKey?: string;
  status: string;
  scheduledAt?: number;
  scheduledRunId?: Id<"runs">;
  scheduledFailure?: string;
  generationError?: string;
};

function WeekAheadTab({
  ownerId,
  channelId,
  selectedPlanId,
}: {
  ownerId: string;
  channelId: Id<"channels">;
  selectedPlanId: string | null;
}) {
  const plan = useQuery(api.contentPlan.listPlan, { ownerId, channelId }) as PlanRow[] | undefined;
  const del = useMutation(api.contentPlan.deleteItem);
  const reorder = useMutation(api.contentPlan.reorder);
  const [busy, setBusy] = useState(false);
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    if (!plan || !selectedPlanId) return;
    const target = document.getElementById(`plan-${selectedPlanId}`);
    if (!target) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [plan, selectedPlanId]);

  const generate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/plan-week", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId, count: 5 }),
      });
      const d = await r.json();
      setMsg(r.ok ? "Planning 5 upcoming videos — thumbnails appear as they finish." : d.error || "Failed to start.");
    } catch {
      setMsg("Failed to start.");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = async (targetId: string) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || !plan || from === targetId) return;
    const ids = plan.map((p) => p._id as string);
    const fi = ids.indexOf(from);
    const ti = ids.indexOf(targetId);
    if (fi < 0 || ti < 0) return;
    ids.splice(ti, 0, ids.splice(fi, 1)[0]);
    await reorder({ ids: ids as Id<"contentPlan">[] });
  };

  const removeItem = async (item: PlanRow) => {
    if (!window.confirm(`Remove “${item.title || item.topic}” from the upcoming plan?`)) return;
    setRemoveBusyId(item._id);
    setMsg(null);
    try {
      await del({ id: item._id });
      setMsg("Plan item removed. Existing rendered masters were not affected.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "The plan item could not be removed.");
    } finally {
      setRemoveBusyId(null);
    }
  };

  const readyCount = plan?.filter((item) => item.status === "ready").length ?? 0;
  const buildingCount = plan?.filter((item) => item.status !== "ready").length ?? 0;

  return (
    <div className={styles.weekWorkspace}>
      <WorkspaceIntro
        eyebrow="Plan"
        title="Next videos"
        description="Reorder topics or create five more."
        signals={[
          { label: "Planned", value: plan === undefined ? "Loading" : String(plan.length), detail: "Upcoming editorial slots" },
          { label: "Ready", value: String(readyCount), detail: "Topic + cover complete", tone: readyCount ? "ready" : "quiet" },
          { label: "Building", value: String(buildingCount), detail: "Planner still working", tone: buildingCount ? "attention" : "quiet" },
        ]}
        action={(
          <button type="button" onClick={generate} disabled={busy} className={styles.workspaceActionButton}>
            <span aria-hidden="true">＋</span>{busy ? "Starting planner…" : "Plan 5 more"}
          </button>
        )}
      />
      {msg && <p className={styles.workspaceNotice} role="status">{msg}</p>}

      {plan === undefined ? (
        <SkeletonList rows={3} />
      ) : plan.length === 0 ? (
        <section className={styles.weekEmpty}>
          <div className={styles.weekEmptySlots} aria-hidden="true">
            {[1, 2, 3, 4, 5].map((slot) => <span key={slot}>{String(slot).padStart(2, "0")}</span>)}
          </div>
          <div>
            <strong>The editorial runway is open</strong>
            <p>Create five channel-specific video plans.</p>
          </div>
          <button type="button" onClick={generate} disabled={busy} className={styles.workspaceActionButton}>
            {busy ? "Starting planner…" : "Build the first five"}
          </button>
        </section>
      ) : (
        <section className={styles.weekQueue} aria-label="Upcoming editorial queue">
          <div className={styles.sectionRail}><span>Priority order / drag to rearrange</span><i /></div>
          <div className={styles.weekRows}>
          {plan.map((p, index) => (
            <article
              key={p._id}
              id={`plan-${p._id}`}
              tabIndex={-1}
              data-selected={selectedPlanId === String(p._id) || undefined}
              draggable
              onDragStart={() => { dragId.current = p._id; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(p._id)}
              className={`${styles.weekRow} channel-week-row`}
            >
              <span className={styles.weekIndex}>{String(index + 1).padStart(2, "0")}</span>
              <AssetImg k={p.thumbnailKey} alt={p.title ?? p.topic} className="channel-week-thumb" />
              <div className={styles.weekCopy}>
                <strong>{p.title || p.topic}</strong>
                {p.title && p.title !== p.topic && (
                  <span>{p.topic}</span>
                )}
              </div>
              <div className={styles.weekState} data-ready={p.status === "ready"}>
                <span>{p.status === "ready" ? "Ready" : "Building"}</span>
                <small>{p.scheduledAt ? new Date(p.scheduledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Unpinned"}</small>
              </div>
              <button
                type="button"
                onClick={() => void removeItem(p)}
                disabled={removeBusyId === p._id}
                title="Remove from upcoming plan"
                aria-label={`Remove ${p.title || p.topic} from upcoming plan`}
                className={styles.weekRemove}
              >
                {removeBusyId === p._id ? "…" : "×"}
              </button>
              <details className={styles.weekDetails} open={selectedPlanId === String(p._id) || undefined}>
                <summary>
                  <span>Item details</span>
                  <small>{p.scheduledRunId ? "Production attached" : "Plan brief"}</small>
                </summary>
                <div className={styles.weekDetailBody}>
                  <div className={styles.weekDetailGrid}>
                    <div><small>Brief</small><strong>{p.description || p.topic}</strong></div>
                    <div><small>Cover</small><strong>{p.thumbnailKey ? "Ready" : "Pending"}</strong></div>
                    <div><small>Production</small><strong>{p.scheduledRunId ? "Recorded" : p.status === "ready" ? "Queued" : "Not started"}</strong></div>
                  </div>
                  <div className={styles.weekDetailActions}>
                    {p.scheduledRunId ? (
                      <Link href={`/runs/${encodeURIComponent(p.scheduledRunId)}`}>
                        Open script, visuals, narration and master
                      </Link>
                    ) : (
                      <span>Production files appear here after the run starts.</span>
                    )}
                    {(p.scheduledFailure || p.generationError) && (
                      <p role="alert">{p.scheduledFailure || p.generationError}</p>
                    )}
                  </div>
                </div>
              </details>
            </article>
          ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * NARRATOR PICKER — voicecraft's profiled bank inside channel settings: every
 * saved ElevenLabs voice plays the SAME ~10s audition line so the operator
 * picks by ear. Selecting one patches the channel pipeline (narration_tts
 * ttsProvider/elevenVoiceId + script_gen voiceTags) so the next render speaks
 * with it. Renders only on channels whose pipeline has the narration module.
 */
function NarratorPicker({ channel }: { channel: ChannelDoc }) {
  const update = useMutation(api.channels.updateChannel);
  const bank = useQuery(api.voiceBank.listProfiles, { ownerId: channel.ownerId });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const narr = (channel.pipeline ?? []).find((p) => p.block === "narration_tts");
  if (!narr) return null;
  const params = (narr.params ?? {}) as Record<string, unknown>;
  const current = params["ttsProvider"] === "elevenlabs" ? (params["elevenVoiceId"] as string | undefined) : undefined;

  const pick = async (voiceId: string | null) => {
    setBusy(true);
    setMsg(null);
    try {
      const pipeline = (channel.pipeline ?? []).map((p) => {
        const ps = { ...((p.params as Record<string, unknown>) ?? {}) };
        if (p.block === "narration_tts") {
          if (voiceId) {
            ps["ttsProvider"] = "elevenlabs";
            ps["elevenVoiceId"] = voiceId;
          } else {
            ps["ttsProvider"] = "fish";
            delete ps["elevenVoiceId"];
          }
          return { ...p, params: ps };
        }
        if (p.block === "script_gen") {
          // v3 PERFORMS inline [audio tags] — the writer only emits them on this tier.
          ps["voiceTags"] = Boolean(voiceId);
          return { ...p, params: ps };
        }
        return p;
      });
      await update({ channelId: channel._id as Id<"channels">, pipeline } as Parameters<typeof update>[0]);
      setMsg(voiceId ? "Narrator cast — the next render speaks with this voice." : "Reverted to the Fish tier voice above.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const card = (active: boolean): CSSProperties => ({
    background: active ? "rgba(110,231,168,0.08)" : "var(--color-bg-elev, #16161a)",
    border: `1px solid ${active ? "rgba(110,231,168,0.5)" : "var(--color-border)"}`,
    borderRadius: 10,
    padding: "0.65rem",
    display: "grid",
    gap: "0.4rem",
    alignContent: "start",
  });
  const pickBtn = (active: boolean): CSSProperties => ({
    background: active ? "transparent" : "var(--color-accent)",
    color: active ? "var(--color-muted)" : "#0a0a0b",
    border: active ? "1px solid var(--color-border)" : "none",
    borderRadius: 8,
    padding: "0.35rem 0.7rem",
    fontSize: "0.76rem",
    fontWeight: 600,
    cursor: active ? "default" : "pointer",
    justifySelf: "start",
  });

  const voices = (bank ?? [])
    .slice()
    .sort((a, b) => (b.category === "professional" ? 1 : 0) - (a.category === "professional" ? 1 : 0) || a.name.localeCompare(b.name));

  return (
    <div style={{ display: "grid", gap: "0.6rem", borderTop: "1px solid var(--color-border)", paddingTop: "1rem" }}>
      <div>
        <div style={{ fontSize: "0.86rem", fontWeight: 600 }}>ElevenLabs narrator</div>
        <div style={{ fontSize: "0.74rem", color: "var(--color-muted)", marginTop: 2 }}>
          Every saved voice reads the same 10-second line — pick by ear. Selecting casts it for all future renders (v3 expressive tier, performed audio tags).
        </div>
      </div>
      {bank === undefined && <div style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>Loading the voice bank…</div>}
      {bank !== undefined && voices.length === 0 && (
        <div style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>The voice bank is empty — run the bank profiler first.</div>
      )}
      {voices.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "0.55rem" }}>
          <div style={card(!current)}>
            <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>Fish tier (default)</div>
            <div style={{ fontSize: "0.72rem", color: "var(--color-muted)" }}>Uses the Fish voice selected above — no performed audio tags.</div>
            <button disabled={busy || !current} onClick={() => pick(null)} style={pickBtn(!current)}>
              {!current ? "Active" : "Use Fish"}
            </button>
          </div>
          {voices.map((v) => {
            const active = current === v.voiceId;
            const [first, ...rest] = v.name.split(" - ");
            return (
              <div key={v.voiceId} style={card(active)}>
                <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>
                  {first}
                  {rest.length > 0 && <span style={{ fontWeight: 400, color: "var(--color-muted)" }}> — {rest.join(" - ")}</span>}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--color-muted)", minHeight: "2.1em" }}>
                  {v.profile.character.length > 110 ? `${v.profile.character.slice(0, 110)}…` : v.profile.character}
                </div>
                <AuditionClip k={v.auditionKey} />
                <button disabled={busy || active} onClick={() => pick(v.voiceId)} style={pickBtn(active)}>
                  {active ? "Cast for this channel" : "Cast this voice"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {msg && <div style={{ fontSize: "0.78rem", color: "var(--color-muted)" }}>{msg}</div>}
    </div>
  );
}

/** Streams a voice's audition clip through the presigning asset route. */
function AuditionClip({ k }: { k?: string }) {
  const url = useAssetUrl(k ?? null);
  if (!k) return <div style={{ fontSize: "0.72rem", color: "var(--color-muted)" }}>no audition clip yet</div>;
  if (!url) return <div style={{ fontSize: "0.72rem", color: "var(--color-muted)" }}>loading clip…</div>;
  return <audio controls preload="none" src={url} style={{ width: "100%", height: 30 }} />;
}
