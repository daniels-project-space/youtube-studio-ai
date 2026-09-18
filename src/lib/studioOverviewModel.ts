import { failureReason } from "@/lib/failureReason";
import { projectPlanSchedule } from "@/lib/scheduleCalendar";

/**
 * A failed run remains inspectable forever, but it stops being a live incident
 * after a day. This keeps an old configuration error from masking a current
 * reconnect, overdue release, or live-run problem in the overview's one
 * primary decision. Unknown timestamps remain conservative and stay live.
 */
const CURRENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type StudioOverviewRun = {
  _id: string;
  status: string;
  startedAt?: number;
  costTotal: number;
  /** Raw run error retained only so the overview can show the same
   * human-readable, bounded reason as the issue inbox. */
  error?: string;
  channelName: string;
  channelSlug: string;
  /** Legacy rows have no immutable execution plan and are history-only. */
  pipelineSource?: "frozen" | "legacy_inferred";
};

export type StudioOverviewChannel = {
  _id: string;
  name: string;
  slug: string;
  status: string;
};

export type StudioOverviewPlan = {
  _id: string;
  channelId?: string;
  channelName: string;
  channelSlug: string;
  topic: string;
  title?: string;
  status: string;
  order?: number;
  scheduledAt?: number;
  /** Channel policy copied from the live channel row for queue projection. */
  channelStatus?: string;
  cadence?: string;
  frequency?: string;
  days?: number[];
  timezone?: string;
  localTime?: string;
  scheduleEnabled?: boolean;
  /** Presentation-only cadence projection; never used as a publish claim. */
  projectedAt?: number;
  automaticSchedule?: boolean;
};

export type StudioOverviewYoutubeLink = {
  channelId: string;
  status: string;
  scopeHealth?: string;
  ytChannelId?: string;
};

export type StudioIssue = {
  key: string;
  kind: "failed_run" | "stalled_run" | "failed_plan" | "overdue_release" | "youtube_link";
  title: string;
  detail: string;
  href: string;
};

export type StudioDecision = {
  eyebrow: string;
  title: string;
  detail: string;
  action: string;
  href: string;
  tone: "attention" | "live" | "ready" | "quiet";
};

export type StudioOverviewSnapshot = {
  activeChannelCount: number;
  runningCount: number;
  queuedCount: number;
  activeRunCount: number;
  readyPlanCount: number;
  scheduledPlanCount: number;
  unscheduledPlanCount: number;
  automaticPlanCount: number;
  manualSchedulingPlanCount: number;
  planBuildingCount: number;
  recentRunCount: number;
  terminalRunCount: number;
  recordedSpend: number;
  successRate: number | null;
  failedRuns: StudioOverviewRun[];
  actionableFailedRuns: StudioOverviewRun[];
  legacyFailedRuns: StudioOverviewRun[];
  stalledRuns: StudioOverviewRun[];
  failedPlans: StudioOverviewPlan[];
  overduePlans: StudioOverviewPlan[];
  upcomingPlans: StudioOverviewPlan[];
  disconnectedChannels: StudioOverviewChannel[];
  issues: StudioIssue[];
  decision: StudioDecision;
};

export function planWorkspaceHref(plan: Pick<StudioOverviewPlan, "_id" | "channelSlug">): string {
  if (!plan.channelSlug) return "/schedule";
  const slug = encodeURIComponent(plan.channelSlug);
  const id = encodeURIComponent(plan._id);
  return `/channels/${slug}?tab=week-ahead&plan=${id}#plan-${id}`;
}

function runHref(run: Pick<StudioOverviewRun, "_id">): string {
  return `/runs/${encodeURIComponent(run._id)}`;
}

function channelSettingsHref(channel: Pick<StudioOverviewChannel, "slug">): string {
  return channel.slug
    ? `/channels/${encodeURIComponent(channel.slug)}?tab=settings`
    : "/channels";
}

function planName(plan: StudioOverviewPlan): string {
  return plan.title?.trim() || plan.topic;
}

function runFailureDetail(run: Pick<StudioOverviewRun, "error">): string {
  const info = failureReason(run.error);
  return `${info.reason}${info.block ? ` · ${info.block}` : ""}`;
}

function isHistoricalFailure(run: Pick<StudioOverviewRun, "startedAt">, now: number): boolean {
  return typeof run.startedAt === "number" &&
    Number.isFinite(run.startedAt) &&
    now - run.startedAt > CURRENT_FAILURE_WINDOW_MS;
}

function isLegacyInferredFailure(run: Pick<StudioOverviewRun, "pipelineSource">): boolean {
  return run.pipelineSource === "legacy_inferred";
}

function overviewFailureDetail(run: StudioOverviewRun, now: number): string {
  const detail = runFailureDetail(run);
  return isHistoricalFailure(run, now) ? `Earlier failure · ${detail}` : detail;
}

/**
 * Unpinned weekly plans are already consumed by the cadence scheduler. The
 * overview used to call them "Needs a date", which made fully automatic
 * channels look blocked even though the calendar already projected the same
 * next dates. Keep this projection presentation-only: durable publish claims
 * still require the scheduler/Convex fence and never trust this value.
 */
function applyAutomaticScheduleProjection(
  plans: StudioOverviewPlan[],
  now: number,
): StudioOverviewPlan[] {
  const grouped = new Map<string, StudioOverviewPlan[]>();
  for (const plan of plans) {
    if (plan.status !== "ready" || !plan.channelId || plan.channelStatus !== "active") continue;
    const rows = grouped.get(plan.channelId) ?? [];
    rows.push(plan);
    grouped.set(plan.channelId, rows);
  }

  const projections = new Map<string, { timestamp?: number; automatic: boolean }>();
  for (const rows of grouped.values()) {
    const first = rows[0];
    if (!first || first.scheduleEnabled === false) continue;
    const projected = projectPlanSchedule({
      items: rows.map((row, index) => ({
        id: row._id,
        order: row.order ?? index,
        scheduledAt: row.scheduledAt,
      })),
      schedule: {
        frequency: first.frequency,
        days: first.days,
        timezone: first.timezone,
        localTime: first.localTime,
      },
      cadence: first.cadence,
      fromTimestamp: now,
    });
    for (const projection of projected) {
      if (projection.item.scheduledAt !== undefined) continue;
      projections.set(projection.item.id, {
        timestamp: projection.timestamp,
        automatic: true,
      });
    }
  }

  return plans.map((plan) => {
    const projection = projections.get(plan._id);
    return projection
      ? { ...plan, projectedAt: projection.timestamp, automaticSchedule: projection.automatic }
      : plan;
  });
}

function planTimestamp(plan: Pick<StudioOverviewPlan, "scheduledAt" | "projectedAt">): number | undefined {
  return plan.scheduledAt ?? plan.projectedAt;
}

export function buildStudioOverview(args: {
  channels: StudioOverviewChannel[];
  recentRuns: StudioOverviewRun[];
  activeRuns: StudioOverviewRun[];
  plan: StudioOverviewPlan[];
  youtubeLinks: StudioOverviewYoutubeLink[];
  now: number;
}): StudioOverviewSnapshot {
  const activeChannels = args.channels.filter((channel) => channel.status === "active");
  const activeRunIds = new Set(args.activeRuns.map((run) => run._id));
  const readyYoutubeChannelIds = new Set(
    args.youtubeLinks
      .filter((link) =>
        link.status === "active" &&
        link.scopeHealth === "healthy" &&
        Boolean(link.ytChannelId)
      )
      .map((link) => link.channelId),
  );

  const failedRuns = args.recentRuns.filter((run) => run.status === "failed");
  // The run detail retains every failed row. The command centre only surfaces
  // a run with a sealed route, so it never suggests recovery by guessing at
  // historic inputs or providers.
  const actionableFailedRuns = failedRuns.filter((run) => !isLegacyInferredFailure(run));
  const legacyFailedRuns = failedRuns.filter(isLegacyInferredFailure);
  const stalledRuns = args.recentRuns.filter(
    (run) =>
      (run.status === "queued" || run.status === "running") &&
      !activeRunIds.has(run._id),
  );
  const failedPlans = args.plan.filter((item) => item.status === "failed");
  const projectedPlans = applyAutomaticScheduleProjection(args.plan, args.now);
  const readyPlans = projectedPlans.filter((item) => item.status === "ready");
  const overduePlans = readyPlans
    .filter((item) => item.scheduledAt !== undefined && item.scheduledAt < args.now)
    .sort((left, right) => (planTimestamp(left) ?? 0) - (planTimestamp(right) ?? 0));
  const upcomingPlans = readyPlans
    .filter((item) => {
      const timestamp = planTimestamp(item);
      return timestamp === undefined || timestamp >= args.now;
    })
    .sort(
      (left, right) =>
        (planTimestamp(left) ?? Number.MAX_SAFE_INTEGER) -
        (planTimestamp(right) ?? Number.MAX_SAFE_INTEGER) ||
        (left.order ?? 0) - (right.order ?? 0),
    );
  const disconnectedChannels = activeChannels.filter(
    (channel) => !readyYoutubeChannelIds.has(channel._id),
  );
  const terminalRuns = args.recentRuns.filter(
    (run) => run.status === "ok" || run.status === "failed",
  ).filter((run) => !isLegacyInferredFailure(run));
  const successfulRuns = terminalRuns.filter((run) => run.status === "ok").length;

  const currentFailedRuns = actionableFailedRuns.filter((run) => !isHistoricalFailure(run, args.now));
  const historicalFailedRuns = actionableFailedRuns.filter((run) => isHistoricalFailure(run, args.now));
  const failedRunIssues = (runs: StudioOverviewRun[]): StudioIssue[] => runs.map((run) => ({
    key: `failed:${run._id}`,
    kind: "failed_run" as const,
    title: run.channelName,
    detail: overviewFailureDetail(run, args.now),
    href: runHref(run),
  }));

  const issues: StudioIssue[] = [
    ...stalledRuns.map((run) => ({
      key: `stalled:${run._id}`,
      kind: "stalled_run" as const,
      title: run.channelName,
      detail: `${run.status} run lost its live lease`,
      href: runHref(run),
    })),
    ...failedRunIssues(currentFailedRuns),
    ...failedPlans.map((item) => ({
      key: `plan:${item._id}`,
      kind: "failed_plan" as const,
      title: planName(item),
      detail: `${item.channelName} plan failed`,
      href: planWorkspaceHref(item),
    })),
    ...overduePlans.map((item) => ({
      key: `overdue:${item._id}`,
      kind: "overdue_release" as const,
      title: planName(item),
      detail: `${item.channelName} release is overdue`,
      href: planWorkspaceHref(item),
    })),
    ...disconnectedChannels.map((channel) => ({
      key: `youtube:${channel._id}`,
      kind: "youtube_link" as const,
      title: channel.name,
      detail: "YouTube connection needs attention",
      href: channelSettingsHref(channel),
    })),
    // Keep prior failures visible in the inbox, but after current work. A
    // historical receipt cannot establish that the provider is unavailable
    // now, so it must not outrank an active connection or release problem.
    ...failedRunIssues(historicalFailedRuns),
  ];

  const firstIssue = issues[0];
  const firstActiveRun = args.activeRuns[0];
  const firstReadyPlan = upcomingPlans[0] ?? overduePlans[0];
  const firstChannel = activeChannels[0] ?? args.channels[0];
  const decision: StudioDecision = firstIssue
    ? {
        eyebrow: "Next decision",
        title: firstIssue.title,
        detail: firstIssue.detail,
        action: firstIssue.kind.includes("run") ? "Inspect run" : "Resolve issue",
        href: firstIssue.href,
        tone: "attention",
      }
    : firstActiveRun
      ? {
          eyebrow: "Live now",
          title: firstActiveRun.channelName,
          detail: `${firstActiveRun.status} in production`,
          action: "Monitor run",
          href: runHref(firstActiveRun),
          tone: "live",
        }
      : firstReadyPlan
        ? {
            eyebrow: "Next release",
            title: planName(firstReadyPlan),
            detail: firstReadyPlan.scheduledAt === undefined
              ? firstReadyPlan.automaticSchedule
                ? `${firstReadyPlan.channelName} follows its active cadence`
                : `${firstReadyPlan.channelName} is ready for a date`
              : `${firstReadyPlan.channelName} is scheduled`,
            action: "Open plan",
            href: planWorkspaceHref(firstReadyPlan),
            tone: "ready",
          }
        : firstChannel
          ? {
              eyebrow: "Studio ready",
              title: firstChannel.name,
              detail: "No open production or release issue",
              action: "Open channel",
              href: `/channels/${encodeURIComponent(firstChannel.slug)}`,
              tone: "quiet",
            }
          : {
              eyebrow: "Start here",
              title: "Create a channel",
              detail: "Set the identity, format and first quality check",
              action: "New channel",
              href: "/channels/new",
              tone: "quiet",
            };

  return {
    activeChannelCount: activeChannels.length,
    runningCount: args.activeRuns.filter((run) => run.status === "running").length,
    queuedCount: args.activeRuns.filter((run) => run.status === "queued").length,
    activeRunCount: args.activeRuns.length,
    readyPlanCount: readyPlans.length,
    scheduledPlanCount: readyPlans.filter((item) => item.scheduledAt !== undefined).length,
    unscheduledPlanCount: readyPlans.filter((item) => item.scheduledAt === undefined).length,
    automaticPlanCount: readyPlans.filter((item) => item.automaticSchedule === true).length,
    manualSchedulingPlanCount: readyPlans.filter((item) =>
      item.scheduledAt === undefined && item.automaticSchedule !== true,
    ).length,
    planBuildingCount: args.plan.filter((item) => item.status === "generating").length,
    recentRunCount: args.recentRuns.length,
    terminalRunCount: terminalRuns.length,
    recordedSpend: args.recentRuns.reduce(
      (total, run) => total + (Number.isFinite(run.costTotal) ? run.costTotal : 0),
      0,
    ),
    successRate: terminalRuns.length
      ? Math.round((successfulRuns / terminalRuns.length) * 100)
      : null,
    failedRuns,
    actionableFailedRuns,
    legacyFailedRuns,
    stalledRuns,
    failedPlans,
    overduePlans,
    upcomingPlans,
    disconnectedChannels,
    issues,
    decision,
  };
}
