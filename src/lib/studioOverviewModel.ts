export type StudioOverviewRun = {
  _id: string;
  status: string;
  startedAt?: number;
  costTotal: number;
  channelName: string;
  channelSlug: string;
};

export type StudioOverviewChannel = {
  _id: string;
  name: string;
  slug: string;
  status: string;
};

export type StudioOverviewPlan = {
  _id: string;
  channelName: string;
  channelSlug: string;
  topic: string;
  title?: string;
  status: string;
  scheduledAt?: number;
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
  planBuildingCount: number;
  publishedCount: number;
  recordedSpend: number;
  successRate: number | null;
  failedRuns: StudioOverviewRun[];
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

export function buildStudioOverview(args: {
  channels: StudioOverviewChannel[];
  recentRuns: StudioOverviewRun[];
  activeRuns: StudioOverviewRun[];
  plan: StudioOverviewPlan[];
  youtubeLinks: StudioOverviewYoutubeLink[];
  now: number;
  publishedCount?: number;
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
  const stalledRuns = args.recentRuns.filter(
    (run) =>
      (run.status === "queued" || run.status === "running") &&
      !activeRunIds.has(run._id),
  );
  const failedPlans = args.plan.filter((item) => item.status === "failed");
  const readyPlans = args.plan.filter((item) => item.status === "ready");
  const overduePlans = readyPlans
    .filter((item) => item.scheduledAt !== undefined && item.scheduledAt < args.now)
    .sort((left, right) => (left.scheduledAt ?? 0) - (right.scheduledAt ?? 0));
  const upcomingPlans = readyPlans
    .filter((item) => item.scheduledAt === undefined || item.scheduledAt >= args.now)
    .sort(
      (left, right) =>
        (left.scheduledAt ?? Number.MAX_SAFE_INTEGER) -
        (right.scheduledAt ?? Number.MAX_SAFE_INTEGER),
    );
  const disconnectedChannels = activeChannels.filter(
    (channel) => !readyYoutubeChannelIds.has(channel._id),
  );
  const terminalRuns = args.recentRuns.filter(
    (run) => run.status === "ok" || run.status === "failed",
  );
  const successfulRuns = terminalRuns.filter((run) => run.status === "ok").length;

  const issues: StudioIssue[] = [
    ...stalledRuns.map((run) => ({
      key: `stalled:${run._id}`,
      kind: "stalled_run" as const,
      title: run.channelName,
      detail: `${run.status} run lost its live lease`,
      href: runHref(run),
    })),
    ...failedRuns.map((run) => ({
      key: `failed:${run._id}`,
      kind: "failed_run" as const,
      title: run.channelName,
      detail: "Run failed",
      href: runHref(run),
    })),
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
              ? `${firstReadyPlan.channelName} is ready for a date`
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
    planBuildingCount: args.plan.filter((item) => item.status === "generating").length,
    publishedCount: args.publishedCount ?? 0,
    recordedSpend: args.recentRuns.reduce(
      (total, run) => total + (Number.isFinite(run.costTotal) ? run.costTotal : 0),
      0,
    ),
    successRate: terminalRuns.length
      ? Math.round((successfulRuns / terminalRuns.length) * 100)
      : null,
    failedRuns,
    stalledRuns,
    failedPlans,
    overduePlans,
    upcomingPlans,
    disconnectedChannels,
    issues,
    decision,
  };
}
