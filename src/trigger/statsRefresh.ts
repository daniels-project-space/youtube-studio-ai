/**
 * Bounded YouTube analytics ingestion.
 *
 * Every channel owns one durable cursor row. A scheduled/manual replay can
 * resume only that frozen batch; it cannot restart a full upload-history scan
 * or issue a second request after an ambiguous YouTube API delivery.
 */
import { task, schedules } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  STUDIO_AUTOMATION_GATES,
  studioAutomationGate,
} from "@/lib/automationGate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  fetchChannelStats,
  fetchVideoStats,
} from "@/lib/youtubeData";
import {
  DeterministicYouTubeConnectorError,
  requireInternalQuerySecret,
  requireYouTubeConnector,
} from "@/lib/youtubeConnector";
import {
  STATS_REFRESH_HISTORY_PAGE_LIMIT,
  STATS_REFRESH_MAX_CHANNELS_PER_RUN,
  STATS_REFRESH_RECENT_PAGE_LIMIT,
  selectStatsRefreshVideoIds,
  selectStatsRefreshWorkChannels,
  statsRefreshCadenceKey,
  type StatsRefreshScanPlan,
} from "@/lib/statsRefreshCheckpoint";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

export interface StatsRefreshArgs {
  ownerId?: string;
}

export interface StatsRefreshResult {
  ok: boolean;
  skipped?: "no_connector";
  channelsProcessed: number;
  videoSnapshots: number;
  manualReconciliation: number;
}

type RefreshBinding = {
  ownerId: string;
  channelId: Id<"channels">;
  connectorId: Id<"youtubeAuth">;
  connectorVersion: number;
};

type StatsRefreshVideoStat = {
  youtubeVideoId: string;
  channelId: string;
  views: number;
  likes: number;
  comments: number;
};

type StatsRefreshChannelRollup = {
  found: boolean;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
};

type StatsRefreshBatch = {
  batchKey: string;
  generation: number;
  connectorId: Id<"youtubeAuth">;
  connectorVersion: number;
  videoIds: string[];
  videoRequestStatus: "pending" | "request_started" | "fetched" | "manual_reconciliation_required";
  channelRequestStatus: "pending" | "request_started" | "fetched" | "manual_reconciliation_required";
  videoStats?: StatsRefreshVideoStat[];
  channelRollup?: StatsRefreshChannelRollup;
};

type StatsRefreshWorker = {
  batch: StatsRefreshBatch;
  workerToken: string;
};

type RunHistoryPage = {
  page: Array<{ youtubeVideoId?: string | null }>;
  isDone: boolean;
  continueCursor: string;
};

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function utcDate(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function admitOrResumeStatsRefreshBatch(args: {
  convex: ConvexHttpClient;
  secret: string;
  binding: RefreshBinding;
  cadenceKey: string;
  windowDate: string;
  now: number;
}): Promise<
  | { action: "batch"; batch: StatsRefreshBatch }
  | { action: "cadence_completed" }
  | { action: "manual_reconciliation_required"; reason: string }
  | { action: "stale_plan" }
> {
  type Acquired =
    | { action: "resume"; batch: StatsRefreshBatch }
    | { action: "cadence_completed" }
    | { action: "manual_reconciliation_required"; reason: string }
    | { action: "plan"; plan: StatsRefreshScanPlan };
  type Admitted =
    | { action: "started"; batch: StatsRefreshBatch }
    | { action: "resume"; batch: StatsRefreshBatch }
    | { action: "cadence_completed" }
    | { action: "manual_reconciliation_required"; reason: string }
    | { action: "stale_plan" };

  const acquired = await args.convex.mutation(api.analyticsRefreshCursors.acquire, {
    secret: args.secret,
    ...args.binding,
    cadenceKey: args.cadenceKey,
    now: args.now,
  }) as Acquired;
  if (acquired.action === "resume") return { action: "batch", batch: acquired.batch };
  if (acquired.action !== "plan") return acquired;

  const plan = acquired.plan;
  let page: RunHistoryPage | null = null;
  if (plan.mode !== "rollup") {
    page = await args.convex.query(api.runs.listRunsByChannelSincePage, {
      channelId: args.binding.channelId,
      startedAfter: plan.startedAfter,
      paginationOpts: {
        cursor: plan.cursor,
        numItems: plan.mode === "freshness"
          ? STATS_REFRESH_RECENT_PAGE_LIMIT
          : STATS_REFRESH_HISTORY_PAGE_LIMIT,
      },
    }) as RunHistoryPage;
  }
  const admitted = await args.convex.mutation(api.analyticsRefreshCursors.admit, {
    secret: args.secret,
    ...args.binding,
    cadenceKey: args.cadenceKey,
    windowDate: args.windowDate,
    mode: plan.mode,
    scanStartedAfter: plan.mode === "rollup" ? 0 : plan.startedAfter,
    ...(plan.mode === "rollup" || !plan.cursor ? {} : { scanCursorBefore: plan.cursor }),
    ...(page && !page.isDone && page.continueCursor
      ? { scanCursorAfter: page.continueCursor }
      : {}),
    scanIsDone: plan.mode === "rollup" || page?.isDone === true,
    videoIds: page ? selectStatsRefreshVideoIds(page.page, []) : [],
    now: args.now,
  }) as Admitted;
  if (admitted.action === "started" || admitted.action === "resume") {
    return { action: "batch", batch: admitted.batch };
  }
  return admitted;
}

async function recordPreDispatchFailure(args: {
  convex: ConvexHttpClient;
  secret: string;
  binding: RefreshBinding;
  worker: StatsRefreshWorker;
  stage: "video" | "channel";
  error: unknown;
  log: Logger;
}): Promise<void> {
  try {
    const result = await args.convex.mutation(api.analyticsRefreshCursors.recordPreDispatchFailure, {
      secret: args.secret,
      ...args.binding,
      batchKey: args.worker.batch.batchKey,
      batchGeneration: args.worker.batch.generation,
      workerToken: args.worker.workerToken,
      stage: args.stage,
      error: errorMessage(args.error),
      now: Date.now(),
    }) as { action: string; failureCount: number };
    args.log("stats refresh pre-dispatch failure retained", {
      action: result.action,
      failureCount: result.failureCount,
    });
  } catch (checkpointError) {
    args.log("stats refresh could not retain pre-dispatch failure", {
      error: errorMessage(checkpointError),
    });
  }
}

async function claimStatsRefreshWorker(args: {
  convex: ConvexHttpClient;
  secret: string;
  binding: RefreshBinding;
  batch: StatsRefreshBatch;
}): Promise<
  | { action: "claimed"; worker: StatsRefreshWorker }
  | { action: "busy" }
  | { action: "stale" }
  | { action: "manual_reconciliation_required"; reason: string }
> {
  type Claimed =
    | { action: "claimed"; batch: StatsRefreshBatch; workerToken: string }
    | { action: "busy" }
    | { action: "stale" }
    | { action: "manual_reconciliation_required"; reason: string };
  const claimed = await args.convex.mutation(api.analyticsRefreshCursors.claimWorker, {
    secret: args.secret,
    ...args.binding,
    batchKey: args.batch.batchKey,
    batchGeneration: args.batch.generation,
    now: Date.now(),
  }) as Claimed;
  if (claimed.action !== "claimed") return claimed;
  return {
    action: "claimed",
    worker: { batch: claimed.batch, workerToken: claimed.workerToken },
  };
}

async function resolveBatchVideoStats(args: {
  convex: ConvexHttpClient;
  secret: string;
  binding: RefreshBinding;
  worker: StatsRefreshWorker;
  batch: StatsRefreshBatch;
  expectedYouTubeChannelId: string;
  refreshToken: string;
  log: Logger;
}): Promise<
  | { action: "ready"; stats: StatsRefreshVideoStat[] }
  | { action: "manual_reconciliation_required"; reason: string }
  | { action: "retry_later" }
> {
  if (args.batch.videoRequestStatus === "fetched") {
    return { action: "ready", stats: args.batch.videoStats ?? [] };
  }
  type Begun =
    | { action: "dispatch"; token: string }
    | { action: "reused"; batch: StatsRefreshBatch }
    | { action: "manual_reconciliation_required"; reason: string };
  let begun: Begun;
  try {
    begun = await args.convex.mutation(api.analyticsRefreshCursors.beginRequest, {
      secret: args.secret,
      ...args.binding,
      batchKey: args.batch.batchKey,
      batchGeneration: args.worker.batch.generation,
      workerToken: args.worker.workerToken,
      stage: "video",
      now: Date.now(),
    }) as Begun;
  } catch (error) {
    await recordPreDispatchFailure({ ...args, stage: "video", error });
    return { action: "retry_later" };
  }
  if (begun.action === "manual_reconciliation_required") {
    return begun;
  }
  if (begun.action === "reused") {
    return { action: "ready", stats: begun.batch.videoStats ?? [] };
  }

  let fetched: StatsRefreshVideoStat[] | undefined;
  try {
    fetched = await fetchVideoStats(args.batch.videoIds, {
      refreshToken: args.refreshToken,
      requireConnector: true,
    });
    const crossedAccount = fetched.find((row) => row.channelId !== args.expectedYouTubeChannelId);
    if (crossedAccount) {
      throw new Error(
        `video ${crossedAccount.youtubeVideoId} belongs to ${crossedAccount.channelId}, expected ${args.expectedYouTubeChannelId}`,
      );
    }
    const saved = await args.convex.mutation(api.analyticsRefreshCursors.saveVideoStats, {
      secret: args.secret,
      ...args.binding,
      batchKey: args.batch.batchKey,
      batchGeneration: args.worker.batch.generation,
      workerToken: args.worker.workerToken,
      requestToken: begun.token,
      stats: fetched,
      now: Date.now(),
    }) as { action: "saved" } | { action: "reused"; batch: StatsRefreshBatch };
    return saved.action === "reused"
      ? { action: "ready", stats: saved.batch.videoStats ?? [] }
      : { action: "ready", stats: fetched };
  } catch (error) {
    try {
      const marked = await args.convex.mutation(api.analyticsRefreshCursors.markRequestAmbiguous, {
        secret: args.secret,
        ...args.binding,
        batchKey: args.batch.batchKey,
        batchGeneration: args.worker.batch.generation,
        workerToken: args.worker.workerToken,
        stage: "video",
        requestToken: begun.token,
        error: errorMessage(error),
        now: Date.now(),
      }) as { action: "already_fetched" } | { action: "manual_reconciliation_required"; reason: string };
      if (marked.action === "already_fetched") {
        if (fetched) return { action: "ready", stats: fetched };
        return {
          action: "manual_reconciliation_required",
          reason: "video response was recorded but its cached payload is unavailable; reconcile before retrying",
        };
      }
      return marked;
    } catch (checkpointError) {
      args.log("stats refresh video ambiguity could not be checkpointed", {
        error: errorMessage(checkpointError),
      });
      return {
        action: "manual_reconciliation_required",
        reason: "video request outcome is unknown; reconcile before retrying",
      };
    }
  }
}

async function resolveBatchChannelRollup(args: {
  convex: ConvexHttpClient;
  secret: string;
  binding: RefreshBinding;
  worker: StatsRefreshWorker;
  batch: StatsRefreshBatch;
  expectedYouTubeChannelId: string;
  refreshToken: string;
  log: Logger;
}): Promise<
  | { action: "ready"; rollup: StatsRefreshChannelRollup }
  | { action: "manual_reconciliation_required"; reason: string }
  | { action: "retry_later" }
> {
  if (args.batch.channelRequestStatus === "fetched" && args.batch.channelRollup) {
    return { action: "ready", rollup: args.batch.channelRollup };
  }
  type Begun =
    | { action: "dispatch"; token: string }
    | { action: "reused"; batch: StatsRefreshBatch }
    | { action: "manual_reconciliation_required"; reason: string };
  let begun: Begun;
  try {
    begun = await args.convex.mutation(api.analyticsRefreshCursors.beginRequest, {
      secret: args.secret,
      ...args.binding,
      batchKey: args.batch.batchKey,
      batchGeneration: args.worker.batch.generation,
      workerToken: args.worker.workerToken,
      stage: "channel",
      now: Date.now(),
    }) as Begun;
  } catch (error) {
    await recordPreDispatchFailure({ ...args, stage: "channel", error });
    return { action: "retry_later" };
  }
  if (begun.action === "manual_reconciliation_required") return begun;
  if (begun.action === "reused") {
    if (!begun.batch.channelRollup) {
      return {
        action: "manual_reconciliation_required",
        reason: "cached channel request is missing its rollup response",
      };
    }
    return { action: "ready", rollup: begun.batch.channelRollup };
  }

  let rollup: StatsRefreshChannelRollup | undefined;
  try {
    const rows = await fetchChannelStats([args.expectedYouTubeChannelId], {
      refreshToken: args.refreshToken,
      requireConnector: true,
    });
    const row = rows.find((candidate) => candidate.channelId === args.expectedYouTubeChannelId);
    rollup = row
      ? {
          found: true,
          subscriberCount: row.subscriberCount,
          viewCount: row.viewCount,
          videoCount: row.videoCount,
        }
      : { found: false, subscriberCount: 0, viewCount: 0, videoCount: 0 };
    const saved = await args.convex.mutation(api.analyticsRefreshCursors.saveChannelRollup, {
      secret: args.secret,
      ...args.binding,
      batchKey: args.batch.batchKey,
      batchGeneration: args.worker.batch.generation,
      workerToken: args.worker.workerToken,
      requestToken: begun.token,
      rollup,
      now: Date.now(),
    }) as { action: "saved" } | { action: "reused"; batch: StatsRefreshBatch };
    if (saved.action === "reused") {
      if (!saved.batch.channelRollup) {
        throw new Error("reused stats-refresh batch is missing its cached channel rollup");
      }
      return { action: "ready", rollup: saved.batch.channelRollup };
    }
    return { action: "ready", rollup };
  } catch (error) {
    try {
      const marked = await args.convex.mutation(api.analyticsRefreshCursors.markRequestAmbiguous, {
        secret: args.secret,
        ...args.binding,
        batchKey: args.batch.batchKey,
        batchGeneration: args.worker.batch.generation,
        workerToken: args.worker.workerToken,
        stage: "channel",
        requestToken: begun.token,
        error: errorMessage(error),
        now: Date.now(),
      }) as { action: "already_fetched" } | { action: "manual_reconciliation_required"; reason: string };
      if (marked.action === "already_fetched") {
        if (rollup) return { action: "ready", rollup };
        return {
          action: "manual_reconciliation_required",
          reason: "channel response was recorded but its cached payload is unavailable; reconcile before retrying",
        };
      }
      return marked;
    } catch (checkpointError) {
      args.log("stats refresh channel ambiguity could not be checkpointed", {
        error: errorMessage(checkpointError),
      });
      return {
        action: "manual_reconciliation_required",
        reason: "channel request outcome is unknown; reconcile before retrying",
      };
    }
  }
}

/** Shared task body for the manual task and six-hour schedule. */
export async function statsRefreshCore(
  args: StatsRefreshArgs,
  log: Logger = () => {},
): Promise<StatsRefreshResult> {
  const ownerId = args.ownerId ?? process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";
  const convex = convexClient();
  const secret = requireInternalQuerySecret();
  const now = Date.now();
  const cadenceKey = statsRefreshCadenceKey(now);
  const date = utcDate(now);
  const channels = await convex.query(api.channels.listChannels, { ownerId });
  const activeWork = await convex.query(api.analyticsRefreshCursors.listActive, {
    secret,
    ownerId,
    limit: STATS_REFRESH_MAX_CHANNELS_PER_RUN,
  }) as {
    active: Array<{ channelId: Id<"channels"> }>;
    manual: Array<{ channelId: Id<"channels">; lastError: string }>;
  };
  const byId = new Map(channels.map((channel) => [String(channel._id), channel]));
  let quarantinedBeforeSelection = 0;
  for (const active of activeWork.active) {
    const channel = byId.get(String(active.channelId));
    if (channel && channel.status !== "archived") continue;
    try {
      const quarantined = await convex.mutation(api.analyticsRefreshCursors.quarantineActiveBatch, {
        secret,
        ownerId,
        channelId: active.channelId,
        reason: channel ? "channel is archived" : "channel is no longer available",
        evidence: "deterministic_invalid" as const,
        now: Date.now(),
      }) as { action: string; reason?: string };
      if (quarantined.action === "manual_reconciliation_required") {
        quarantinedBeforeSelection++;
        log("stats refresh active batch quarantined", {
          channelId: String(active.channelId),
          error: quarantined.reason,
        });
      }
    } catch (error) {
      log("stats refresh could not quarantine unavailable active channel", {
        channelId: String(active.channelId),
        error: errorMessage(error),
      });
    }
  }
  for (const blocked of activeWork.manual) {
    log("stats refresh requires manual reconciliation", {
      channelId: String(blocked.channelId),
      error: blocked.lastError,
    });
  }
  const eligible = channels.filter((channel) => channel.status !== "archived");
  const activeChannels = activeWork.active
    .map((row) => byId.get(String(row.channelId)))
    .filter((channel): channel is (typeof channels)[number] => Boolean(channel && channel.status !== "archived"));
  const selectedChannels = selectStatsRefreshWorkChannels(activeChannels, eligible, now);

  let channelsProcessed = 0;
  let videoSnapshots = 0;
  let connectorsMissing = 0;
  let manualReconciliation = activeWork.manual.length + quarantinedBeforeSelection;

  for (const channel of selectedChannels) {
    const channelId = channel._id as Id<"channels">;
    let connector: Awaited<ReturnType<typeof requireYouTubeConnector>>;
    try {
      connector = await requireYouTubeConnector(convex, {
        channelId,
        ownerId,
        requiredScopes: [
          "https://www.googleapis.com/auth/youtube",
          "https://www.googleapis.com/auth/youtube.readonly",
        ],
      });
      if (!connector.ytChannelId) {
        throw new DeterministicYouTubeConnectorError(
          "missing_youtube_channel_id",
          "linked connector has no YouTube channel id",
        );
      }
    } catch (error) {
      connectorsMissing++;
      if (error instanceof DeterministicYouTubeConnectorError) {
        try {
          const quarantined = await convex.mutation(api.analyticsRefreshCursors.quarantineActiveBatch, {
            secret,
            ownerId,
            channelId,
            reason: errorMessage(error),
            evidence: "deterministic_invalid" as const,
            now: Date.now(),
          }) as { action: string; reason?: string };
          if (quarantined.action === "manual_reconciliation_required") {
            manualReconciliation++;
            log(`stats refresh active connector quarantined for \"${channel.name}\"`, {
              error: quarantined.reason,
            });
          } else if (quarantined.action === "busy") {
            log(`stats refresh active connector quarantine is busy for \"${channel.name}\"`);
          }
        } catch (quarantineError) {
          log(`stats refresh could not quarantine invalid connector for \"${channel.name}\"`, {
            error: errorMessage(quarantineError),
          });
        }
      } else {
        log(`stats refresh connector lookup deferred for \"${channel.name}\"; retrying next cadence`, {
          error: errorMessage(error),
        });
      }
      log(`channel \"${channel.name}\" skipped — ${errorMessage(error)}`);
      continue;
    }

    const binding: RefreshBinding = {
      ownerId,
      channelId,
      connectorId: connector.connectorId,
      connectorVersion: connector.tokenVersion,
    };
    let admitted:
      | { action: "batch"; batch: StatsRefreshBatch }
      | { action: "cadence_completed" }
      | { action: "manual_reconciliation_required"; reason: string }
      | { action: "stale_plan" };
    try {
      admitted = await admitOrResumeStatsRefreshBatch({
        convex,
        secret,
        binding,
        cadenceKey,
        windowDate: date,
        now,
      });
    } catch (error) {
      log(`stats refresh admission failed for \"${channel.name}\"`, { error: errorMessage(error) });
      continue;
    }
    if (admitted.action === "manual_reconciliation_required") {
      manualReconciliation++;
      log(`stats refresh paused for \"${channel.name}\"`, { error: admitted.reason });
      continue;
    }
    if (admitted.action !== "batch") {
      if (admitted.action === "stale_plan") {
        log(`stats refresh plan became stale for \"${channel.name}\"; next cadence will resume it`);
      }
      continue;
    }

    let worker: StatsRefreshWorker;
    try {
      const claimed = await claimStatsRefreshWorker({
        convex,
        secret,
        binding,
        batch: admitted.batch,
      });
      if (claimed.action === "manual_reconciliation_required") {
        manualReconciliation++;
        log(`stats refresh worker paused for \"${channel.name}\"`, { error: claimed.reason });
        continue;
      }
      if (claimed.action !== "claimed") {
        log(`stats refresh worker is ${claimed.action} for \"${channel.name}\"; no provider work started`);
        continue;
      }
      worker = claimed.worker;
    } catch (error) {
      log(`stats refresh worker claim failed for \"${channel.name}\"`, { error: errorMessage(error) });
      continue;
    }

    const video = await resolveBatchVideoStats({
      convex,
      secret,
      binding,
      worker,
      batch: worker.batch,
      expectedYouTubeChannelId: connector.ytChannelId,
      refreshToken: connector.refreshToken,
      log,
    });
    if (video.action !== "ready") {
      if (video.action === "manual_reconciliation_required") {
        manualReconciliation++;
        log(`stats refresh video request paused for \"${channel.name}\"`, { error: video.reason });
      }
      continue;
    }

    const rollup = await resolveBatchChannelRollup({
      convex,
      secret,
      binding,
      worker,
      batch: worker.batch,
      expectedYouTubeChannelId: connector.ytChannelId,
      refreshToken: connector.refreshToken,
      log,
    });
    if (rollup.action !== "ready") {
      if (rollup.action === "manual_reconciliation_required") {
        manualReconciliation++;
        log(`stats refresh channel request paused for \"${channel.name}\"`, { error: rollup.reason });
      }
      continue;
    }

    try {
      const committed = await convex.mutation(api.analyticsRefreshCursors.commit, {
        secret,
        ...binding,
        batchKey: worker.batch.batchKey,
        batchGeneration: worker.batch.generation,
        workerToken: worker.workerToken,
        now: Date.now(),
      }) as { action: "committed"; recordsWritten: number };
      channelsProcessed++;
      videoSnapshots += video.stats.length;
      log(`stats refresh committed for \"${channel.name}\"`, {
        recordsWritten: committed.recordsWritten,
        videos: video.stats.length,
        rollupFound: rollup.rollup.found,
      });
    } catch (error) {
      // The cached provider responses remain durable. This records a strictly
      // bounded local-only retry budget; it never reopens either Google call.
      try {
        const failed = await convex.mutation(api.analyticsRefreshCursors.recordCommitFailure, {
          secret,
          ...binding,
          batchKey: worker.batch.batchKey,
          batchGeneration: worker.batch.generation,
          workerToken: worker.workerToken,
          error: errorMessage(error),
          now: Date.now(),
        }) as { action: "retry_later" | "manual_reconciliation_required"; commitFailureCount: number };
        if (failed.action === "manual_reconciliation_required") {
          manualReconciliation++;
        }
        log(`stats refresh local commit ${failed.action} for \"${channel.name}\"`, {
          attempt: failed.commitFailureCount,
          error: errorMessage(error),
        });
      } catch (checkpointError) {
        log(`stats refresh could not retain local commit failure for \"${channel.name}\"`, {
          error: errorMessage(checkpointError),
        });
      }
    }
  }

  log("stats refresh complete", {
    channelsProcessed,
    videoSnapshots,
    manualReconciliation,
    selectedChannels: selectedChannels.length,
  });
  return {
    ok: true,
    ...(channelsProcessed === 0 && connectorsMissing > 0
      ? { skipped: "no_connector" as const }
      : {}),
    channelsProcessed,
    videoSnapshots,
    manualReconciliation,
  };
}

export const statsRefreshTask = task({
  id: "stats-refresh",
  maxDuration: 900,
  retry: { maxAttempts: 1 },
  run: async (payload: StatsRefreshArgs) => {
    await bootstrapSecrets((message, extra) => console.log(`[stats-refresh] ${message}`, extra ?? ""));
    return statsRefreshCore(payload ?? {}, (message, extra) =>
      console.log(`[stats-refresh] ${message}`, extra ?? ""),
    );
  },
});

export const statsRefreshSchedule = schedules.task({
  id: "stats-refresh-6h",
  cron: "0 */6 * * *",
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  run: async () => {
    const gate = studioAutomationGate(STUDIO_AUTOMATION_GATES.insights);
    if (!gate.enabled) return gate;
    const log: Logger = (message, extra) => console.log(`[stats-refresh-6h] ${message}`, extra ?? "");
    await bootstrapSecrets(log);
    return statsRefreshCore({}, log);
  },
});
