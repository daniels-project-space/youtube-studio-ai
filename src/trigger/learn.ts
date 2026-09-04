/**
 * `learning-refresh` (Phase 7) — the feedback loop. Pulls YouTube Analytics
 * (retention/CTR) for each channel's published videos (≥72h old, so metrics are
 * settled), links them to their content attributes (topic/title/thumbnail from
 * the run's stages), and writes a per-channel performance ledger in R2. The
 * creative Directors (topic_select, seo) read it to lean toward what worked.
 *
 * Requires the yt-analytics.readonly OAuth scope (scripts/youtube-oauth.ts);
 * degrades to a no-op without it.
 */
import { schedules, task } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import {
  STUDIO_AUTOMATION_GATES,
  studioAutomationGate,
} from "@/lib/automationGate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { channelPrefix } from "@/lib/storage";
import {
  fetchVideoAnalytics,
  getAnalyticsAccessToken,
  hasAnalyticsAccess,
} from "@/lib/youtubeAnalytics";
import {
  requireInternalQuerySecret,
  requireYouTubeConnector,
  type YouTubeConnectorCredential,
} from "@/lib/youtubeConnector";
import { loadLedger, saveLedger, loadPerformanceContext, type PerfEntry } from "@/lib/performance";
import {
  hasYouTubeAnalyticsReportScopes,
  YOUTUBE_ANALYTICS_SCOPE,
} from "@/lib/publishingPolicy";
import { agentJson } from "@/agents/mastra";
import {
  assertLearningAnalyticsHttpDispatchWindow,
  LEARNING_ANALYTICS_BATCH_LIMIT,
  LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS,
  LEARNING_ANALYTICS_HTTP_DISPATCH_WINDOW_MS,
  LEARNING_ANALYTICS_METRIC_DEFINITION_V1,
  LEARNING_ANALYTICS_METRIC_DEFINITION_V2,
  LEARNING_ANALYTICS_REQUEST_TIMEOUT_MS,
  resolveLearningAnalyticsMetricDefinitionVersion,
  settledVideoAt,
} from "@/lib/learningRefreshCheckpoint";
import { z } from "zod";

const SETTLE_MS = 72 * 3_600_000;
if (LEARNING_ANALYTICS_REQUEST_TIMEOUT_MS >= LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS) {
  throw new Error("learning Analytics GET timeout must remain below its batch worker lease");
}
if (LEARNING_ANALYTICS_HTTP_DISPATCH_WINDOW_MS >= LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS) {
  throw new Error("learning Analytics dispatch capability window must remain below its batch worker lease");
}
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Logger = (m: string) => void;

const InsightsSchema = z.object({
  worksInSpace: z.array(z.string()).max(8),
  avoidInSpace: z.array(z.string()).max(8),
});

type Identity = NonNullable<Doc<"channels">["identity"]>;
type Brief = NonNullable<Identity["creativeBrief"]>;

const SHOW_BIBLE_SYSTEM = "You refine a channel's creative doctrine from REAL performance data. Be concrete and brand-true; only assert what the data + existing doctrine support.";

type ShowBibleClaim = {
  recommendationKey: string;
  claimToken: string;
  request: {
    role: "showrunner";
    system: string;
    prompt: string;
    maxTokens: number;
  };
  baseBrief: Brief;
};

/**
 * Close the creative loop: turn the performance ledger's winners/losers into an
 * updated Show Bible doctrine (worksInSpace / avoidInSpace) so the film crew leans
 * toward what actually performed. Only fires when there's a Bible AND ≥4 measured
 * videos (loadPerformanceContext returns "" below that, so we never bias on noise).
 */
async function adaptShowBible(
  convex: ConvexHttpClient,
  ch: {
    _id: Id<"channels">;
    name: string;
    identity?: Identity;
    learningPolicyVersion?: number;
  },
  ownerId: string,
  prefix: string,
  connector: YouTubeConnectorCredential,
  admissionDay: string,
  fairnessKey: string,
  log: Logger,
): Promise<boolean> {
  const identity = ch.identity;
  const brief: Brief | undefined = identity?.creativeBrief;
  if (!identity || !brief) return false;
  const perf = await loadPerformanceContext(prefix, {
    minViews: 50,
    connectorId: String(connector.connectorId),
    connectorVersion: connector.tokenVersion,
  });
  if (!perf) return false;
  const measured = (await loadLedger(prefix)).filter(
    (entry) =>
      entry.views >= 50 &&
      entry.connectorId === String(connector.connectorId) &&
      entry.connectorVersion === connector.tokenVersion,
  );
  const baseline = measured.length
    ? measured.reduce((sum, entry) => sum + entry.avgViewPct, 0) / measured.length
    : undefined;
  const basePolicyVersion = ch.learningPolicyVersion ?? 0;
  const recommendationKey = `show-bible:${String(ch._id)}:v${basePolicyVersion + 1}`;
  const prompt =
    `Refine the creative doctrine for "${ch.name}" (${(identity.niche as string) ?? ""}).\n` +
    `Positioning: ${brief.positioning}\n` +
    `Current worksInSpace: ${(brief.worksInSpace ?? []).join("; ") || "(none)"}\n` +
    `Current avoidInSpace: ${(brief.avoidInSpace ?? []).join("; ") || "(none)"}\n\n` +
    `${perf}\n\n` +
    `Update worksInSpace (concrete choices to DO MORE of) and avoidInSpace (to do LESS of), grounded in the ` +
    `performance above + the existing doctrine. Short, concrete, actionable entries. STRICT JSON ` +
    `{worksInSpace:string[], avoidInSpace:string[]}.`;
  const now = Date.now();
  let claimed: ShowBibleClaim | undefined;
  try {
    const result = await convex.mutation(api.learningGovernance.claimShowBibleProposal, {
      secret: requireInternalQuerySecret(),
      ownerId,
      channelId: ch._id,
      connectorId: connector.connectorId,
      connectorVersion: connector.tokenVersion,
      recommendationKey,
      basePolicyVersion,
      request: {
        role: "showrunner",
        system: SHOW_BIBLE_SYSTEM,
        prompt,
        maxTokens: 600,
      },
      baseBrief: brief,
      sourceVideoIds: measured.map((entry) => entry.videoId),
      dataWindowStart: measured.length
        ? ymd(Math.min(...measured.map((entry) => entry.publishedAt)))
        : ymd(now),
      dataWindowEnd: ymd(now),
      offlineEvaluation: {
        method: "historical_evidence_sufficiency_v1",
        sampleSize: measured.length,
        baselineScore: baseline,
        passed: measured.length >= 4,
        notes:
          measured.length >= 4
            ? "At least four settled videos with defined retention metrics."
            : "Insufficient settled historical sample; activation is blocked.",
      },
      admissionDay,
      fairnessKey,
      // This token fences the short pre-provider lease.  It is never reused
      // after provider_started, because a lost provider result is not safe to
      // replay just because the Trigger task is retried.
      claimToken: `learning:${String(ch._id)}:${now}:${Math.random().toString(36).slice(2)}`,
      now,
    }) as { action: string; claim?: ShowBibleClaim };
    if (result.action !== "generate" || !result.claim) {
      log(`learning-refresh: Show Bible ${recommendationKey} skipped — ${result.action}`);
      return false;
    }
    claimed = result.claim;
  } catch (e) {
    log(`adaptShowBible claim failed (${e instanceof Error ? e.message : e})`);
    return false;
  }

  // This mutation is the durable paid-provider marker.  Its failure is
  // intentionally fail-closed: do not call agentJson unless it acknowledged a
  // fresh exact claim, because a lost marker response could otherwise bill a
  // duplicate request.
  try {
    const started = await convex.mutation(api.learningGovernance.markShowBibleProviderStarted, {
      secret: requireInternalQuerySecret(),
      ownerId,
      channelId: ch._id,
      recommendationKey: claimed.recommendationKey,
      claimToken: claimed.claimToken,
      now: Date.now(),
    }) as { started?: boolean; status?: string };
    if (!started.started) {
      log(`learning-refresh: Show Bible ${recommendationKey} stopped before model dispatch — ${started.status ?? "claim unavailable"}`);
      return false;
    }
  } catch (e) {
    log(`learning-refresh: Show Bible ${recommendationKey} provider marker unresolved; no model call (${e instanceof Error ? e.message : e})`);
    return false;
  }

  // A second durable marker closes the boundary immediately before the model
  // request.  If this acknowledgement is lost, do not call the provider: the
  // visible provider_started claim can only be rearmed by an audited owner
  // attestation that no dispatch occurred.
  try {
    const dispatchStarted = await convex.mutation(api.learningGovernance.markShowBibleProviderDispatchStarted, {
      secret: requireInternalQuerySecret(),
      ownerId,
      channelId: ch._id,
      recommendationKey: claimed.recommendationKey,
      claimToken: claimed.claimToken,
      now: Date.now(),
    }) as { started?: boolean; status?: string };
    if (!dispatchStarted.started) {
      log(`learning-refresh: Show Bible ${recommendationKey} stopped before model dispatch marker — ${dispatchStarted.status ?? "claim unavailable"}`);
      return false;
    }
  } catch (e) {
    log(`learning-refresh: Show Bible ${recommendationKey} dispatch marker unresolved; no model call (${e instanceof Error ? e.message : e})`);
    return false;
  }

  try {
    const insights = await agentJson({
      role: claimed.request.role,
      schema: InsightsSchema,
      maxTokens: claimed.request.maxTokens,
      system: claimed.request.system,
      prompt: claimed.request.prompt,
      log,
    });
    const nextBrief: Brief = {
      ...claimed.baseBrief,
      worksInSpace: insights.worksInSpace?.length ? insights.worksInSpace : claimed.baseBrief.worksInSpace,
      avoidInSpace: insights.avoidInSpace?.length ? insights.avoidInSpace : claimed.baseBrief.avoidInSpace,
      refreshedAt: Date.now(),
    };
    await convex.mutation(api.learningGovernance.finalizeShowBibleProposal, {
      secret: requireInternalQuerySecret(),
      ownerId,
      channelId: ch._id,
      recommendationKey: claimed.recommendationKey,
      claimToken: claimed.claimToken,
      nextValue: nextBrief,
      now: Date.now(),
    });
    log(`learning-refresh: proposed Show Bible v${basePolicyVersion + 1} for ${ch.name}; operator approval required`);
    return true;
  } catch (e) {
    // Any error after provider_dispatch_started is treated as an ambiguous paid outcome,
    // including a finalization response that may have been committed but lost.
    try {
      await convex.mutation(api.learningGovernance.markShowBibleProposalAmbiguous, {
        secret: requireInternalQuerySecret(),
        ownerId,
        channelId: ch._id,
        recommendationKey: claimed.recommendationKey,
        claimToken: claimed.claimToken,
        error: e instanceof Error ? e.message : String(e),
        now: Date.now(),
      });
    } catch {
      // The provider_started marker itself remains a no-replay fence even if
      // this follow-up write is unavailable.
    }
    log(`adaptShowBible failed after provider marker (${e instanceof Error ? e.message : e}); manual reconciliation required`);
    return false;
  }
}

type LearningAnalyticsItem = {
  runId: Id<"runs">;
  youtubeVideoId: string;
  publishedAt: number;
  requestStatus: "pending" | "request_started" | "request_dispatch_started" | "fetched" | "ambiguous";
  requestDispatchCapabilityToken?: string;
  requestDispatchCapabilityExpiresAt?: number;
  requestDispatchCapabilityConsumedAt?: number;
  requestDispatchHttpDeadlineAt?: number;
  views?: number;
  engagedViews?: number;
  avgViewPct?: number;
  ctr?: number;
  thumbnailImpressions?: number;
  title?: string;
  titleAlternate?: string;
  topic?: string;
  thumbnailStrategy?: string;
};

type LearningAnalyticsBatch = {
  batchKey: string;
  ingestionId: Id<"analyticsIngestions">;
  metricDefinitionVersion?: string;
  connectorId?: Id<"youtubeAuth">;
  connectorVersion?: number;
  status: "collecting" | "ledger_write_started" | "manual_reconciliation_required";
  ledgerFingerprint?: string;
  workerLeaseToken?: string;
  workerLeaseGeneration?: number;
  workerLeaseExpiresAt?: number;
  items: LearningAnalyticsItem[];
};

async function runAttributes(
  convex: ConvexHttpClient,
  runId: Id<"runs">,
): Promise<{ title: string; topic: string; thumbnailStrategy?: string; titleAlternate?: string }> {
  try {
    const stages = (await convex.query(api.runStages.listRunStages, {
      runId,
    })) as Array<{ block: string; outputs?: Record<string, unknown> }>;
    return {
      title: (stages.find((stage) => stage.block === "metadata")?.outputs?.title as string) ?? "",
      // Metacraft's judged runner-up. Carried into the ledger so the CTR swap
      // has something to swap TO; without it the alternate is generated on
      // every video and then thrown away, which is what used to happen.
      titleAlternate: (stages.find((stage) => stage.block === "metadata")?.outputs?.titleAlternate as string) || undefined,
      topic: (stages.find((stage) => stage.block === "topic_select")?.outputs?.topic as string) ?? "",
      thumbnailStrategy: (stages.find((stage) => stage.block === "thumbnail_gen")?.outputs as { strategy?: string })?.strategy,
    };
  } catch {
    // Content attributes are quality context, not a reason to repeat an
    // already-marked Analytics API request.  Persist an empty best-effort
    // value and retain the measured outcome.
    return { title: "", topic: "" };
  }
}

function ledgerContainsBatch(
  ledger: PerfEntry[],
  batch: LearningAnalyticsBatch,
): boolean {
  const metricDefinitionVersion = resolveLearningAnalyticsMetricDefinitionVersion(
    batch.metricDefinitionVersion,
  );
  const byId = new Map(ledger.map((entry) => [entry.videoId, entry]));
  return batch.items
    .filter((item) => item.requestStatus === "fetched")
    .every((item) => {
      const entry = byId.get(item.youtubeVideoId);
      return entry?.ingestionId === String(batch.ingestionId) &&
        (entry.metricDefinitionVersion ?? LEARNING_ANALYTICS_METRIC_DEFINITION_V1) === metricDefinitionVersion &&
        entry.views === item.views &&
        entry.avgViewPct === item.avgViewPct &&
        entry.ctr === item.ctr &&
        entry.engagedViews === item.engagedViews;
    });
}

async function recordExperimentOutcomes(args: {
  convex: ConvexHttpClient;
  ownerId: string;
  batch: LearningAnalyticsBatch;
  internalSecret: string;
  log: Logger;
}): Promise<void> {
  const { convex, ownerId, batch, internalSecret, log } = args;
  const metricDefinitionVersion = resolveLearningAnalyticsMetricDefinitionVersion(
    batch.metricDefinitionVersion,
  );
  const windowEnd = ymd(Date.now());
  for (const item of batch.items) {
    if (
      item.requestStatus !== "fetched" ||
      item.views === undefined ||
      item.avgViewPct === undefined
    ) continue;
    try {
      const experiment = await convex.query(api.learningGovernance.getExperimentByVideo, {
        secret: internalSecret,
        ownerId,
        youtubeVideoId: item.youtubeVideoId,
      });
      if (experiment) {
        await convex.mutation(api.learningGovernance.recordExperimentOutcome, {
          secret: internalSecret,
          ownerId,
          experimentId: experiment._id,
          ingestionId: batch.ingestionId,
          youtubeVideoId: item.youtubeVideoId,
          outcome: {
            views: item.views,
            avgViewPct: item.avgViewPct,
            ...(item.ctr === undefined ? {} : { ctr: item.ctr }),
            windowStart: ymd(item.publishedAt),
            windowEnd,
            metricDefinitionVersion,
          },
          observedAt: Date.now(),
        });
      }
    } catch (error) {
      // This is a local governance projection of an already-durable ingestion;
      // it never authorizes another Analytics call or ledger write.
      log(`learning-refresh: experiment outcome failed for ${item.youtubeVideoId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function processLearningBatch(args: {
  convex: ConvexHttpClient;
  ownerId: string;
  channelId: Id<"channels">;
  prefix: string;
  connector: YouTubeConnectorCredential;
  refreshToken: string;
  batch: LearningAnalyticsBatch;
  internalSecret: string;
  log: Logger;
}): Promise<{ recordsWritten: number; ledgerSaved: boolean }> {
  const { convex, ownerId, channelId, prefix, connector, refreshToken, batch, internalSecret, log } = args;
  if (batch.status === "manual_reconciliation_required") {
    log(`learning-refresh: ${String(channelId)} has a ledger write awaiting manual reconciliation`);
    return { recordsWritten: 0, ledgerSaved: false };
  }

  const workerLeaseToken = `learning-batch:${String(channelId)}:${batch.batchKey}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const workerClaim = await convex.mutation(api.analyticsIngestions.claimLearningBatchWorker, {
    secret: internalSecret,
    ownerId,
    channelId,
    batchKey: batch.batchKey,
    workerLeaseToken,
    now: Date.now(),
  }) as {
    action: "claimed" | "busy" | "manual_reconciliation_required";
    batch?: LearningAnalyticsBatch;
    workerLeaseGeneration?: number;
    leaseExpiresAt?: number;
  };
  if (workerClaim.action === "busy") {
    log(`learning-refresh: ${String(channelId)} batch is owned by another live worker until ${new Date(workerClaim.leaseExpiresAt ?? Date.now() + LEARNING_ANALYTICS_BATCH_WORKER_LEASE_MS).toISOString()}`);
    return { recordsWritten: 0, ledgerSaved: false };
  }
  if (workerClaim.action !== "claimed" || !workerClaim.batch || !workerClaim.workerLeaseGeneration) {
    log(`learning-refresh: ${String(channelId)} batch cannot run — ${workerClaim.action}`);
    return { recordsWritten: 0, ledgerSaved: false };
  }
  const activeBatch = workerClaim.batch;
  const metricDefinitionVersion = resolveLearningAnalyticsMetricDefinitionVersion(
    activeBatch.metricDefinitionVersion,
  );
  const workerLease = {
    workerLeaseToken,
    workerLeaseGeneration: workerClaim.workerLeaseGeneration,
  };
  const connectorBinding = {
    connectorId: connector.connectorId,
    connectorVersion: connector.tokenVersion,
  };

  for (const item of activeBatch.items) {
    const request = await convex.mutation(api.analyticsIngestions.startLearningItemRequest, {
      secret: internalSecret,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey: batch.batchKey,
      runId: item.runId,
      ...workerLease,
      now: Date.now(),
    }) as { action: "dispatch" | "ambiguous" | "skip" | "manual_reconciliation_required"; item?: LearningAnalyticsItem };
    if (request.action === "ambiguous") {
      await convex.mutation(api.analyticsIngestions.markLearningItemAmbiguous, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: item.runId,
        ...workerLease,
        error: "previous Analytics API request crossed its durable marker but did not save a response",
        now: Date.now(),
      });
      continue;
    }
    if (request.action !== "dispatch" || !request.item) continue;

    // Resolve OAuth before the final lease fence.  If that setup stalls long
    // enough for recovery to take the batch, the next mutation rejects and no
    // Analytics GET is issued by this stale worker.
    const accessToken = await getAnalyticsAccessToken(refreshToken);
    if (!accessToken) {
      await convex.mutation(api.analyticsIngestions.markLearningItemAmbiguous, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: request.item.runId,
        ...workerLease,
        error: "Analytics OAuth token could not be prepared before the fenced GET boundary",
        now: Date.now(),
      });
      continue;
    }
    const dispatch = await convex.mutation(api.analyticsIngestions.markLearningItemRequestDispatchStarted, {
      secret: internalSecret,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey: batch.batchKey,
      runId: request.item.runId,
      ...workerLease,
      now: Date.now(),
    }) as {
      action: "fetch" | "ambiguous" | "skip" | "manual_reconciliation_required";
      item?: LearningAnalyticsItem;
      dispatchCapabilityToken?: string;
    };
    if (dispatch.action === "ambiguous") {
      await convex.mutation(api.analyticsIngestions.markLearningItemAmbiguous, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: request.item.runId,
        ...workerLease,
        error: "previous Analytics GET dispatch marker was persisted without a durable response",
        now: Date.now(),
      });
      continue;
    }
    if (dispatch.action !== "fetch" || !dispatch.item) continue;
    if (!dispatch.dispatchCapabilityToken) {
      await convex.mutation(api.analyticsIngestions.markLearningItemAmbiguous, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: dispatch.item.runId,
        ...workerLease,
        error: "Analytics GET dispatch marker did not return its one-time capability",
        now: Date.now(),
      });
      continue;
    }

    // Do not place an await between this final capability consumption and the
    // HTTP helper. The mutation repeats the live connector/lease check, then
    // the helper checks its short deadline immediately before every GET.
    const dispatchCapability = await convex.mutation(
      api.analyticsIngestions.consumeLearningItemRequestDispatchCapability,
      {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: dispatch.item.runId,
        ...workerLease,
        dispatchCapabilityToken: dispatch.dispatchCapabilityToken,
        now: Date.now(),
      },
    ) as {
      action: "fetch" | "ambiguous" | "skip" | "manual_reconciliation_required";
      item?: LearningAnalyticsItem;
      httpDispatchDeadlineAt?: number;
    };
    if (dispatchCapability.action === "ambiguous") {
      await convex.mutation(api.analyticsIngestions.markLearningItemAmbiguous, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: dispatch.item.runId,
        ...workerLease,
        error: "Analytics GET dispatch capability was expired, consumed, or no longer exact",
        now: Date.now(),
      });
      continue;
    }
    if (
      dispatchCapability.action !== "fetch" ||
      !dispatchCapability.item ||
      dispatchCapability.httpDispatchDeadlineAt === undefined
    ) continue;

    let analytics;
    try {
      analytics = await fetchVideoAnalytics({
        videoId: dispatchCapability.item.youtubeVideoId,
        startDate: ymd(dispatchCapability.item.publishedAt),
        endDate: ymd(Date.now()),
        refreshToken,
        accessToken,
        timeoutMs: LEARNING_ANALYTICS_REQUEST_TIMEOUT_MS,
        includeEngagedViews:
          metricDefinitionVersion === LEARNING_ANALYTICS_METRIC_DEFINITION_V2,
        beforeRequest: () => assertLearningAnalyticsHttpDispatchWindow({
          deadlineAt: dispatchCapability.httpDispatchDeadlineAt!,
        }),
      });
    } catch (error) {
      // The GET has crossed the quota boundary.  A timeout/transport error has
      // no durable receipt, so record it and continue rather than reissue it.
      await convex.mutation(api.analyticsIngestions.markLearningItemAmbiguous, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: dispatchCapability.item.runId,
        ...workerLease,
        error: `analytics request outcome unresolved: ${error instanceof Error ? error.message : String(error)}`,
        now: Date.now(),
      });
      continue;
    }
    if (!analytics) {
      await convex.mutation(api.analyticsIngestions.markLearningItemAmbiguous, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: dispatchCapability.item.runId,
        ...workerLease,
        error: "Analytics API returned no usable response after its durable request marker",
        now: Date.now(),
      });
      continue;
    }

    const attributes = await runAttributes(convex, dispatchCapability.item.runId);
    try {
      await convex.mutation(api.analyticsIngestions.recordLearningItemFetched, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: dispatchCapability.item.runId,
        ...workerLease,
        views: analytics.views,
        ...(analytics.engagedViews === undefined ? {} : { engagedViews: analytics.engagedViews }),
        avgViewPct: analytics.avgViewPct,
        ...(analytics.ctr === undefined ? {} : { ctr: analytics.ctr }),
        ...(analytics.thumbnailImpressions === undefined
          ? {}
          : { thumbnailImpressions: analytics.thumbnailImpressions }),
        title: attributes.title,
        ...(attributes.titleAlternate ? { titleAlternate: attributes.titleAlternate } : {}),
        topic: attributes.topic,
        ...(attributes.thumbnailStrategy ? { thumbnailStrategy: attributes.thumbnailStrategy } : {}),
        now: Date.now(),
      });
    } catch (error) {
      // The response is local but a lost Convex acknowledgement leaves its
      // persistence unknown.  Marking it terminal is safer than refetching.
      await convex.mutation(api.analyticsIngestions.markLearningItemAmbiguous, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: dispatchCapability.item.runId,
        ...workerLease,
        error: `fetched analytics response could not be durably recorded: ${error instanceof Error ? error.message : String(error)}`,
        now: Date.now(),
      });
    }
  }

  // One bounded resolve pass handles a stale request-start/dispatch marker
  // without any unbounded retry loop.
  for (let resolvePass = 0; resolvePass < 2; resolvePass++) {
    const preparation = await convex.mutation(api.analyticsIngestions.prepareLearningLedgerWrite, {
      secret: internalSecret,
      ownerId,
      channelId,
      ...connectorBinding,
      batchKey: batch.batchKey,
      ...workerLease,
      now: Date.now(),
    }) as {
      action: string;
      runId?: Id<"runs">;
      batch?: LearningAnalyticsBatch;
      items?: Array<LearningAnalyticsItem & Required<Pick<LearningAnalyticsItem, "views" | "avgViewPct" | "title" | "topic">>>;
      ingestionId?: Id<"analyticsIngestions">;
      ledgerFingerprint?: string;
    };
    if (preparation.action === "resolve_items" && preparation.runId) {
      await convex.mutation(api.analyticsIngestions.markLearningItemAmbiguous, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        runId: preparation.runId,
        ...workerLease,
        error: "Analytics request remained unresolved at ledger checkpoint",
        now: Date.now(),
      });
      continue;
    }
    if (preparation.action === "completed_without_ledger_write") {
      return { recordsWritten: 0, ledgerSaved: false };
    }
    if (preparation.action === "manual_reconciliation_required") {
      log(`learning-refresh: ${String(channelId)} ledger write needs manual reconciliation`);
      return { recordsWritten: 0, ledgerSaved: false };
    }
    if ((preparation.action !== "write" && preparation.action !== "reconcile") || !preparation.batch || !preparation.ledgerFingerprint) {
      log(`learning-refresh: ${String(channelId)} ledger checkpoint returned ${preparation.action}; no external write made`);
      return { recordsWritten: 0, ledgerSaved: false };
    }

    const active = preparation.batch;
    if (active.connectorId === undefined || active.connectorVersion === undefined) {
      log(`learning-refresh: ${String(channelId)} active batch lacks immutable connector provenance`);
      return { recordsWritten: 0, ledgerSaved: false };
    }
    const activeMetricDefinitionVersion = resolveLearningAnalyticsMetricDefinitionVersion(
      active.metricDefinitionVersion,
    );
    if (preparation.action === "reconcile") {
      const existing = await loadLedger(prefix);
      if (!ledgerContainsBatch(existing, active)) {
        await convex.mutation(api.analyticsIngestions.markLearningLedgerWriteAmbiguous, {
          secret: internalSecret,
          ownerId,
          channelId,
          ...connectorBinding,
          batchKey: batch.batchKey,
          ...workerLease,
          error: "persisted ledger does not prove the prior write completed",
          now: Date.now(),
        });
        return { recordsWritten: 0, ledgerSaved: false };
      }
      try {
        const completion = await convex.mutation(api.analyticsIngestions.completeLearningLedgerWrite, {
          secret: internalSecret,
          ownerId,
          channelId,
          ...connectorBinding,
          batchKey: batch.batchKey,
          ledgerFingerprint: preparation.ledgerFingerprint,
          ...workerLease,
          now: Date.now(),
        }) as { completed?: boolean; action?: string };
        if (!completion.completed) {
          log(`learning-refresh: ${String(channelId)} ledger completion was quarantined (${completion.action ?? "unknown"})`);
          return { recordsWritten: 0, ledgerSaved: false };
        }
        await recordExperimentOutcomes({ convex, ownerId, batch: active, internalSecret, log });
        return {
          recordsWritten: active.items.filter((item) => item.requestStatus === "fetched").length,
          ledgerSaved: true,
        };
      } catch (error) {
        log(`learning-refresh: ledger was verified but completion receipt is still pending (${error instanceof Error ? error.message : error})`);
        return { recordsWritten: 0, ledgerSaved: false };
      }
    }

    const ledger = await loadLedger(prefix);
    const byId = new Map<string, PerfEntry>(ledger.map((entry) => [entry.videoId, entry]));
    for (const item of preparation.items ?? []) {
      // MERGE, never replace. A fresh object here silently dropped every field
      // written by another task on the same entry — `reoptimizedAt`, and now
      // the title-swap record — so a cooldown that exists to prevent repeated
      // rewrites was erased by the next analytics run.
      const prior = byId.get(item.youtubeVideoId);
      byId.set(item.youtubeVideoId, {
        ...prior,
        videoId: item.youtubeVideoId,
        topic: item.topic,
        title: item.title,
        ...(item.thumbnailStrategy ? { thumbnailStrategy: item.thumbnailStrategy } : {}),
        publishedAt: item.publishedAt,
        views: item.views,
        ...(item.engagedViews === undefined ? {} : { engagedViews: item.engagedViews }),
        avgViewPct: item.avgViewPct,
        ...(item.ctr === undefined ? {} : { ctr: item.ctr }),
        ...(item.thumbnailImpressions === undefined
          ? {}
          : { thumbnailImpressions: item.thumbnailImpressions }),
        ...(item.titleAlternate ? { titleAlternate: item.titleAlternate } : {}),
        updatedAt: Date.now(),
        connectorId: String(active.connectorId),
        connectorVersion: active.connectorVersion,
        ingestionId: String(preparation.ingestionId),
        metricDefinitionVersion: activeMetricDefinitionVersion,
      });
    }
    try {
      await saveLedger(prefix, [...byId.values()]);
    } catch (error) {
      await convex.mutation(api.analyticsIngestions.markLearningLedgerWriteAmbiguous, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        ...workerLease,
        error: error instanceof Error ? error.message : String(error),
        now: Date.now(),
      });
      return { recordsWritten: 0, ledgerSaved: false };
    }
    try {
      const completion = await convex.mutation(api.analyticsIngestions.completeLearningLedgerWrite, {
        secret: internalSecret,
        ownerId,
        channelId,
        ...connectorBinding,
        batchKey: batch.batchKey,
        ledgerFingerprint: preparation.ledgerFingerprint,
        ...workerLease,
        now: Date.now(),
      }) as { completed?: boolean; action?: string };
      if (!completion.completed) {
        log(`learning-refresh: ${String(channelId)} ledger completion was quarantined (${completion.action ?? "unknown"})`);
        return { recordsWritten: 0, ledgerSaved: false };
      }
      await recordExperimentOutcomes({ convex, ownerId, batch: active, internalSecret, log });
      return { recordsWritten: (preparation.items ?? []).length, ledgerSaved: true };
    } catch (error) {
      // The R2 write succeeded, but its Convex completion response may not
      // have.  Leave the durable write marker for a read-only reconciliation.
      log(`learning-refresh: ledger write saved; completion receipt pending (${error instanceof Error ? error.message : error})`);
      return { recordsWritten: 0, ledgerSaved: false };
    }
  }
  return { recordsWritten: 0, ledgerSaved: false };
}

async function refresh(ownerId: string, log: Logger) {
  await bootstrapSecrets((m) => log(m));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
  const convex = new ConvexHttpClient(url);
  const internalSecret = requireInternalQuerySecret();

  const channels = (await convex.query(api.channels.listChannels, { ownerId })) as Array<{
    _id: Id<"channels">;
    slug: string;
    name: string;
    identity?: Identity;
    learningPolicyVersion?: number;
  }>;
  const showBibleCandidates: Array<{
    channel: (typeof channels)[number];
    prefix: string;
    connector: YouTubeConnectorCredential;
  }> = [];
  let videos = 0;
  let adapted = 0;
  for (const ch of channels) {
    let refreshToken: string;
    let connector: YouTubeConnectorCredential;
    try {
      connector = await requireYouTubeConnector(convex, {
        channelId: ch._id,
        ownerId,
        requiredScopes: [YOUTUBE_ANALYTICS_SCOPE],
      });
      refreshToken = connector.refreshToken;
    } catch (error) {
      log(
        `learning-refresh: ${ch.name} skipped — ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (!hasYouTubeAnalyticsReportScopes(connector.grantedScopes)) {
      log(`learning-refresh: ${ch.name} skipped — Analytics report read scopes unavailable`);
      continue;
    }
    if (!hasAnalyticsAccess(refreshToken)) {
      log(`learning-refresh: ${ch.name} skipped — analytics scope unavailable`);
      continue;
    }
    const prefix = channelPrefix(ownerId, ch.slug);
    // A deferred owner-budget claim must get a later fair turn even when this
    // channel had no newly-written ledger page today.  This is local evidence
    // loading only; the durable admission below is what caps paid model calls.
    showBibleCandidates.push({ channel: ch, prefix, connector });
    try {
      const now = Date.now();
      const next = await convex.query(api.analyticsIngestions.nextLearningBatch, {
        secret: internalSecret,
        ownerId,
        channelId: ch._id,
        connectorId: connector.connectorId,
        connectorVersion: connector.tokenVersion,
        now,
      }) as {
        kind: "scan" | "resume" | "idle" | "manual_reconciliation_required";
        mode?: "history" | "freshness";
        startedAfter?: number;
        cursor?: string | null;
        batch?: LearningAnalyticsBatch;
        notBefore?: number;
        reason?: string;
      };
      if (next.kind === "idle") {
        log(`learning-refresh: ${ch.name} freshness sweep is not due until ${new Date(next.notBefore ?? now).toISOString()}`);
        continue;
      }
      if (next.kind === "manual_reconciliation_required") {
        log(`learning-refresh: ${ch.name} skipped — ${next.reason ?? "manual analytics reconciliation required"}`);
        continue;
      }

      let batch = next.batch;
      if (next.kind === "scan") {
        const page = await convex.query(api.runs.listRunsByChannelSincePage, {
          channelId: ch._id,
          startedAfter: next.startedAfter ?? 0,
          paginationOpts: {
            cursor: next.cursor ?? null,
            numItems: LEARNING_ANALYTICS_BATCH_LIMIT,
          },
        }) as {
          page: Array<{
            _id: Id<"runs">;
            youtubeVideoId?: string;
            finishedAt?: number;
          }>;
          isDone: boolean;
          continueCursor: string;
        };
        const candidates = page.page.flatMap((run) =>
          settledVideoAt(run, now, SETTLE_MS)
            ? [{ runId: run._id, youtubeVideoId: run.youtubeVideoId, publishedAt: run.finishedAt }]
            : [],
        );
        const admitted = await convex.mutation(api.analyticsIngestions.admitLearningBatch, {
          secret: internalSecret,
          ownerId,
          channelId: ch._id,
          connectorId: connector.connectorId,
          connectorVersion: connector.tokenVersion,
          mode: next.mode ?? "history",
          scanStartedAfter: next.startedAfter ?? 0,
          ...(next.cursor ? { scanCursorBefore: next.cursor } : {}),
          ...(!page.isDone ? { scanCursorAfter: page.continueCursor } : {}),
          scanIsDone: page.isDone,
          settledBefore: now - SETTLE_MS,
          candidates,
          now,
        }) as {
          action: "admitted" | "resume" | "advanced" | "idle" | "manual_reconciliation_required";
          batch?: LearningAnalyticsBatch;
          reason?: string;
        };
        if (admitted.action === "advanced") {
          log(`learning-refresh: ${ch.name} advanced one bounded ${next.mode} page with no new settled videos`);
          continue;
        }
        if (admitted.action === "idle" || admitted.action === "manual_reconciliation_required") {
          log(`learning-refresh: ${ch.name} skipped — ${admitted.reason ?? admitted.action}`);
          continue;
        }
        batch = admitted.batch;
      }
      if (!batch) {
        log(`learning-refresh: ${ch.name} had no admitted durable analytics batch`);
        continue;
      }
      const result = await processLearningBatch({
        convex,
        ownerId,
        channelId: ch._id,
        prefix,
        connector,
        refreshToken,
        batch,
        internalSecret,
        log,
      });
      videos += result.recordsWritten;
      log(`learning-refresh: ${ch.name} → ${result.recordsWritten} settled video(s) in this bounded batch`);
    } catch (error) {
      log(`learning-refresh: ${ch.name} batch failed before a new external replay was permitted — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    const admissionState = await convex.query(
      api.learningGovernance.getShowBibleOwnerAdmissionState,
      { secret: internalSecret, ownerId },
    ) as { roundRobinCursor?: string } | null;
    const byFairnessKey = [...showBibleCandidates].sort((left, right) =>
      String(left.channel._id).localeCompare(String(right.channel._id)),
    );
    const cursor = admissionState?.roundRobinCursor;
    // Rotate after the last admitted channel.  A stable channel list therefore
    // cannot permanently starve later channels when the daily envelope is
    // smaller than the owner's channel count.
    const orderedCandidates = cursor
      ? [
          ...byFairnessKey.filter((candidate) => String(candidate.channel._id) > cursor),
          ...byFairnessKey.filter((candidate) => String(candidate.channel._id) <= cursor),
        ]
      : byFairnessKey;
    const admissionDay = ymd(Date.now());
    for (const candidate of orderedCandidates) {
      if (await adaptShowBible(
        convex,
        candidate.channel,
        ownerId,
        candidate.prefix,
        candidate.connector,
        admissionDay,
        String(candidate.channel._id),
        log,
      )) {
        adapted++;
      }
    }
  } catch (error) {
    log(`learning-refresh: Show Bible admission pass failed closed — ${error instanceof Error ? error.message : String(error)}`);
  }
  log(`learning-refresh: done — ${videos} video(s) updated, ${adapted} Show Bible(s) adapted across ${channels.length} channel(s)`);
  return { ok: true, channels: channels.length, videos, adapted };
}

export const learningRefreshSchedule = schedules.task({
  id: "learning-refresh",
  cron: "0 7 * * *", // daily, after metrics settle
  run: async () => {
    const gate = studioAutomationGate(STUDIO_AUTOMATION_GATES.insights);
    if (!gate.enabled) return gate;

    return refresh(process.env.STUDIO_OWNER_ID ?? "owner_daniel", (m) => console.log(`[learn] ${m}`));
  },
});

export const learningRefreshTask = task({
  id: "learning-refresh-now",
  run: async (payload: { ownerId?: string }) =>
    refresh(payload?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel", (m) => console.log(`[learn] ${m}`)),
});
