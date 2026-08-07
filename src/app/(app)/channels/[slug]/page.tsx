"use client";

import { use, useState, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import type { ChannelIdentity, RunRow, VideoRow } from "@/lib/types";
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
import { fmtUsd } from "@/lib/format";
import { VOICES } from "@/lib/voices";
import { useAssetUrl, useAssetUrlState } from "@/lib/asset-url";
import { NICHES, subcategoryTags } from "@/lib/nicheCatalog";
import {
  formatZonedScheduleTimestamp,
  nextProjectedPlanItem,
} from "@/lib/scheduleCalendar";

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
  { label: "Overview", tabs: ["Overview"] },
  { label: "Content", tabs: ["Week ahead", "Library"] },
  { label: "Performance", tabs: ["Analytics", "SEO"] },
  { label: "Setup", tabs: ["Identity", "Pipeline", "Settings"] },
] as const satisfies ReadonlyArray<{ label: string; tabs: ReadonlyArray<Tab> }>;

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
  const activeTabGroup = TAB_GROUPS.find((group) => group.tabs.some((item) => item === tab)) ?? TAB_GROUPS[0];
  const ytStatus = searchParams.get("yt");
  const ytGot = searchParams.get("got");

  const selectTab = (next: Tab) => {
    const query = new URLSearchParams(searchParams.toString());
    query.set("tab", QUERY_BY_TAB[next]);
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
          className="glass"
          style={{
            padding: "0.7rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            border: `1px solid ${ytStatus === "connected" ? "rgba(52,211,153,0.5)" : "rgba(248,113,113,0.5)"}`,
            color: ytStatus === "connected" ? "var(--color-ok)" : "#fca5a5",
          }}
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
        height={170}
      >
        <div className="channel-detail-hero-content">
          <ChannelAvatar
            imageKey={id.imageKey}
            name={channel.name}
            palette={id.palette}
            size={76}
            radius={18}
          />
          <div className="channel-detail-title">
            <h1>{channel.name}</h1>
            <div className="channel-detail-meta">
              <span>{id.niche ?? channel.template}</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{channelCard.recentPublishedCount} recently published</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{channel.schedule?.frequency ?? id.cadence ?? "Cadence not set"}</span>
            </div>
          </div>
          <StageBadge status={channel.status === "active" ? "ok" : "queued"} />
        </div>
      </ChannelBanner>

      <section className="channel-operating-profile glass" aria-label="Channel operating profile">
        <div>
          <small>Status</small>
          <strong>{channel.status === "active" ? "Active" : channel.status}</strong>
          <span>{channelCard.lastRunStatus ? `Last run ${channelCard.lastRunStatus}` : "No run history"}</span>
        </div>
        <div>
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
        <div>
          <small>Config readiness</small>
          <strong className={readinessDone === readinessChecks.length ? "channel-ready" : "channel-incomplete"}>
            {readinessDone}/{readinessChecks.length} complete
          </strong>
          <span>Identity · voice · thumbnail · pipeline · schedule</span>
        </div>
        <div>
          <small>Module path</small>
          <strong>{modulePath.length} module{modulePath.length === 1 ? "" : "s"}</strong>
          <span title={modulePath.join(" → ")}>
            {modulePath.length ? `${modulePath.slice(0, 3).join(" → ")}${modulePath.length > 3 ? ` → +${modulePath.length - 3}` : ""}` : "Not configured"}
          </span>
        </div>
      </section>

      {channel.inception && <ChannelInceptionProgress inception={channel.inception} />}

      {/* Four stable work areas keep specialist views available without a wall of peer tabs. */}
      <div className="channel-tabs" role="tablist" aria-label="Channel sections">
        {TAB_GROUPS.map((group) => (
          <button
            key={group.label}
            type="button"
            onClick={() => selectTab(group.tabs[0])}
            role="tab"
            aria-selected={activeTabGroup.label === group.label}
            className="channel-tab"
          >
            {group.label}
          </button>
        ))}
      </div>
      {activeTabGroup.tabs.length > 1 && (
        <nav className="channel-subtabs" aria-label={`${activeTabGroup.label} views`}>
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
        <WeekAheadTab ownerId={ownerId} channelId={channelId} />
      )}
      {tab === "Library" && (
        <LibraryTab ownerId={ownerId} channelId={channelId} />
      )}
      {tab === "SEO" && <SeoTab ownerId={ownerId} niche={id.niche} />}
      {tab === "Pipeline" && <PipelineTab pipeline={channel.pipeline ?? []} />}
      {tab === "Identity" && <IdentityTab id={id} budget={channel.budget} />}
      {tab === "Settings" && <SettingsTab channel={channel} />}
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

  return (
    <section className="channel-inception glass" aria-label="Channel setup progress">
      <div className="channel-inception-heading">
        <div>
          <small>Channel setup engine</small>
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
        <span>{complete}/{stages.length} stages</span>
      </div>
      <div className="channel-inception-stages">
        {stages.map((stage) => (
          <div
            className="channel-inception-stage"
            data-status={stage.status}
            key={stage.key}
            title={stage.error ?? `${stage.label}: ${stage.status}`}
          >
            <i aria-hidden="true" />
            <span>{stage.label}</span>
            {stage.error && (
              <small className="channel-inception-stage-error" role="alert">
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
  const recent: RunRow[] = (runs ?? [])
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
    { label: "Thumbnail", value: "Flux Pro · statue-right / text-left" },
  ];

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
      </div>

      <LatestVideoWidget ownerId={channel.ownerId} channelId={channel._id as Id<"channels">} />

      <StatsCharts runs={(runs ?? []) as { status: string; startedAt?: number; finishedAt?: number; costTotal?: number }[]} />

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

      <section style={{ marginBottom: "1.6rem" }}>
        <SectionTitle>Pipeline configuration</SectionTitle>
        <div
          className="glass"
          style={{
            padding: "1rem 1.2rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "0.8rem 1.4rem",
          }}
        >
          {settings.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
              <span style={{ fontSize: "0.72rem", color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {s.label}
              </span>
              <span style={{ fontSize: "0.92rem", color: "var(--color-fg)", fontWeight: 500 }}>{s.value}</span>
            </div>
          ))}
        </div>
      </section>

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

/* ------------------------------- Settings ------------------------------- */

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="channel-setting-row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--color-fg)" }}>{label}</div>
        <div style={{ fontSize: "0.74rem", color: "var(--color-muted)", marginTop: 2 }}>{hint}</div>
      </div>
      <div className="channel-setting-control">
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
      <SectionTitle>Settings</SectionTitle>
      <div className="glass" style={{ padding: "1.2rem", display: "grid", gap: "1.1rem" }}>
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
            <label><input type="checkbox" checked={madeForKids} onChange={(e) => setMadeForKids(e.target.checked)} /> Made for kids</label>
            <label><input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} /> Scheduler enabled</label>
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
  return (
    <div className="channel-settings-stack">
      <ChannelSettingsCard channel={channel} />
      <YouTubeConnectCard channel={channel} />
      <details className="channel-advanced glass">
        <summary>
          <span><strong>Advanced channel configuration</strong><small>Identity, module parameters and language variants</small></span>
          <span aria-hidden="true">+</span>
        </summary>
        <div className="channel-advanced-content">
          <PipelineModulesCard channel={channel} />
          <AdvancedControls channel={channel} />
          <MultiLanguageCard channel={channel} />
        </div>
      </details>
    </div>
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
  const link = connector?.status === "active" ? connector : undefined;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const connect = () => {
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

  const btn: CSSProperties = {
    background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 10,
    padding: "0.6rem 1.2rem", fontSize: "0.88rem", fontWeight: 600, cursor: "pointer",
  };
  const ghost: CSSProperties = {
    background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-border)",
    borderRadius: 10, padding: "0.6rem 1.2rem", fontSize: "0.88rem", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
  };

  return (
    <section>
      <SectionTitle>YouTube connection</SectionTitle>
      <div className="glass" style={{ padding: "1.2rem", display: "grid", gap: "1rem" }}>
        {link ? (
          <div style={{ fontSize: "0.86rem", color: "var(--color-ok)" }}>
            ✓ Linked to <strong>{link.ytTitle || link.ytChannelId || "a YouTube channel"}</strong> — uploads go here.
          </div>
        ) : (
          <div style={{ fontSize: "0.84rem", color: "var(--color-muted)" }}>
            {connector?.status === "revoked"
              ? "YouTube access was revoked. Reconnect explicitly before this channel can publish or ingest analytics."
              : connector?.status === "error"
                ? "The YouTube connector failed validation. Reconnect it before publishing or analytics can resume."
                : "Not linked yet. Connect a YouTube channel so this channel can publish. (A channel must exist on YouTube first — create one manually, or try Browserbase auto-create below.)"}
          </div>
        )}
        {!link && channel.youtubeCreated?.status === "creating" && (
          <div style={{ fontSize: "0.82rem", color: "#fbbf24", lineHeight: 1.5 }}>
            <span className="studio-pulse">●</span> Setting up the YouTube channel… (runs in the background — this
            updates by itself, no need to watch anything).
          </div>
        )}
        {!link && channel.youtubeCreated?.status !== "creating" && channel.youtubeCreated?.ytChannelId && (
          <div style={{ fontSize: "0.82rem", color: "var(--color-accent)", lineHeight: 1.5 }}>
            ● The agent created a YouTube channel for this:{" "}
            <a href={channel.youtubeCreated.url} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)", textDecoration: "underline" }}>
              {channel.youtubeCreated.handle || channel.youtubeCreated.ytChannelId}
            </a>
            . Switch to it on youtube.com, then click <strong>Connect</strong> to finish linking.
          </div>
        )}
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={connect} style={btn}>{link ? "Reconnect YouTube" : "Connect YouTube"}</button>
          {link && (
            <button onClick={revoke} disabled={busy} style={{ ...ghost, color: "#f87171" }}>
              {busy ? "Revoking…" : "Revoke access"}
            </button>
          )}
          {!link && (
            <button onClick={autoCreate} disabled={busy} style={ghost}>
              {busy ? "Starting…" : "Auto-create channel (Browserbase)"}
            </button>
          )}
        </div>
        {!link && (
          <p style={{ fontSize: "0.74rem", color: "var(--color-faint)", margin: 0 }}>
            <strong>Connect</strong> links a channel via Google (instant, in your browser — switch to the target
            channel on youtube.com first). <strong>Auto-create</strong> uses the cloud agent to create a brand-new
            YouTube channel; once it exists, switch to it and Connect.
          </p>
        )}
        {msg && <p style={{ fontSize: "0.8rem", color: "var(--color-muted)", margin: 0 }}>{msg}</p>}
      </div>
    </section>
  );
}

const FLAGS: Record<string, string> = { en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", fr: "🇫🇷", pt: "🇵🇹", it: "🇮🇹", nl: "🇳🇱" };

/** Multi-language group: clone this channel into DE + ES flag-branded siblings. */
function MultiLanguageCard({ channel }: { channel: ChannelDoc }) {
  const groupId = channel.groupId ?? channel._id;
  const group = useQuery(api.channels.listGroup, { groupId }) as ChannelDoc[] | undefined;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const siblings = (group ?? []).filter((c) => c._id !== channel._id);
  const haveLangs = new Set([channel.language ?? "en", ...siblings.map((c) => c.language ?? "")]);
  const targets = ["de", "es"].filter((l) => !haveLangs.has(l));

  const make = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/make-multilingual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: channel._id, languages: targets }),
      });
      const d = await r.json();
      setMsg(r.ok ? "Creating siblings — they appear here in ~1 min (refresh)." : d.error || "Failed to start.");
    } catch {
      setMsg("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionTitle>Multi-language group</SectionTitle>
      <div className="glass" style={{ padding: "1.2rem", display: "grid", gap: "1rem" }}>
        <div style={{ fontSize: "0.84rem", color: "var(--color-muted)", lineHeight: 1.5 }}>
          Clone this channel into language siblings — identical pipeline, shared profile image, a flag
          banner per country. Each renders in its own language; the expensive visuals are reused (the
          render-group engine finishes only narration, captions, text + metadata per language).
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
            <button onClick={make} disabled={busy} style={{
              background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 10,
              padding: "0.6rem 1.2rem", fontSize: "0.88rem", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}>
              {busy ? "Creating…" : `+ Make multi-language (${targets.map((l) => FLAGS[l]).join(" ")})`}
            </button>
            {msg && <span style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>{msg}</span>}
          </div>
        ) : (
          <div style={{ fontSize: "0.82rem", color: "var(--color-ok)" }}>✓ DE + ES siblings exist for this group.{msg ? ` ${msg}` : ""}</div>
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
                  <option key={s.id} value={s.name}>{s.name} — ~{s.searchVolume}K · ${(s.rpm ?? catalogNiche.rpm).toFixed(1)} RPM</option>
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
        <StatCard label="Recent spend" value={fmtUsd(totalCost)} accent="var(--color-accent)" hint="latest 500 runs maximum" />
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
  const competitors = useQuery(
    api.competitors.listCompetitors,
    niche ? { ownerId, niche } : "skip",
  ) as Array<{ topVideos?: { title: string; views: number }[] }> | undefined;
  const topVids = (competitors ?? [])
    .flatMap((c) => c.topVideos ?? [])
    .sort((a, b) => b.views - a.views)
    .slice(0, 12);

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

      {topVids.length > 0 && (
        <section>
          <SectionTitle>Top competitor videos</SectionTitle>
          <div style={{ display: "grid", gap: "0.4rem" }}>
            {topVids.map((v, i) => (
              <div
                key={i}
                className="glass"
                style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.6rem 0.9rem", fontSize: "0.84rem" }}
              >
                <span style={{ color: "var(--color-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title}</span>
                <span style={{ color: "var(--color-secondary)", whiteSpace: "nowrap" }}>{compact(v.views)} views</span>
              </div>
            ))}
          </div>
        </section>
      )}

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
  const bible = id.creativeBrief;
  return (
    <div style={{ display: "grid", gap: "1.4rem" }}>
      {bible && (
        <section>
          <SectionTitle>Show Bible · film crew</SectionTitle>
          <div className="glass glass-shine" style={{ padding: "1.25rem 1.4rem", display: "grid", gap: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.1rem" }}>
              <Field label="Positioning" value={bible.positioning} />
              <Field label="Vibe" value={bible.vibe} />
              <Field label="Iconic motif" value={bible.iconicMotif} />
            </div>
            {bible.activeCrew?.length > 0 && (
              <div>
                <div style={{ fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-faint)", marginBottom: "0.4rem" }}>Active crew</div>
                <ChipRow items={bible.activeCrew} tone="accent" />
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.1rem" }}>
              {bible.worksInSpace?.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--color-ok)", marginBottom: "0.4rem" }}>✓ Works in this space</div>
                  <List items={bible.worksInSpace} />
                </div>
              )}
              {bible.avoidInSpace?.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--color-failed)", marginBottom: "0.4rem" }}>✕ Avoid (fails here)</div>
                  <List items={bible.avoidInSpace} />
                </div>
              )}
            </div>
          </div>
        </section>
      )}
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
};

function WeekAheadTab({ ownerId, channelId }: { ownerId: string; channelId: Id<"channels"> }) {
  const plan = useQuery(api.contentPlan.listPlan, { ownerId, channelId }) as PlanRow[] | undefined;
  const del = useMutation(api.contentPlan.deleteItem);
  const reorder = useMutation(api.contentPlan.reorder);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

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

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <SectionTitle>Week ahead — upcoming videos</SectionTitle>
        <button
          onClick={generate}
          disabled={busy}
          className="glass"
          style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--color-fg)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Starting…" : "+ Plan 5 more"}
        </button>
      </div>
      {msg && <p style={{ fontSize: "0.82rem", color: "var(--color-muted)", marginBottom: "0.9rem" }}>{msg}</p>}

      {plan === undefined ? (
        <SkeletonList rows={3} />
      ) : plan.length === 0 ? (
        <EmptyState title="No upcoming videos planned yet" description="Click “Plan 5 more” to pre-build topics, thumbnails and descriptions." />
      ) : (
        <div style={{ display: "grid", gap: "0.8rem" }}>
          {plan.map((p) => (
            <div
              key={p._id}
              draggable
              onDragStart={() => { dragId.current = p._id; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(p._id)}
              className="glass channel-week-row"
            >
              <AssetImg k={p.thumbnailKey} alt={p.title ?? p.topic} className="channel-week-thumb" />
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 0 }}>
                <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--color-fg)" }}>{p.title || p.topic}</span>
                {p.title && p.title !== p.topic && (
                  <span style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>{p.topic}</span>
                )}
                {p.description && (
                  <span style={{ fontSize: "0.8rem", color: "var(--color-muted)", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {p.description}
                  </span>
                )}
                <span style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em", color: p.status === "ready" ? "var(--color-ok)" : "var(--color-muted)" }}>
                  {p.status === "ready" ? "● ready" : "○ generating…"}
                </span>
              </div>
              <button
                onClick={() => del({ id: p._id })}
                title="Delete"
                style={{ background: "none", border: "none", color: "var(--color-muted)", fontSize: "1.1rem", cursor: "pointer", padding: "0.4rem" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
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
