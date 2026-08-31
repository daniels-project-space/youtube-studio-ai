import { idempotencyKeys, schedules, task, tasks } from "@trigger.dev/sdk";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { registerAllBlocks } from "@/engine/blocks";
import { makeConvexSink } from "@/engine/convexSink";
import { runPipeline as runEngine } from "@/engine/runner";
import { preflight, validatePipeline } from "@/engine/validate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { rehydrateOutputs } from "@/lib/rehydrate";
import { channelPrefix } from "@/lib/storage";
import {
  assertThumbnailRefreshCandidateDispatch,
  thumbnailRefreshCandidateApprovalSubject,
  thumbnailRefreshTriggerRequest,
  type ThumbnailRefreshCandidateDispatch,
} from "@/lib/thumbnailRefreshCandidate";
import type { ThumbnailRefreshReplayMaterial } from "@/lib/thumbnailRefreshReplay";
import {
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
  type StudioActionApprovalReceipt,
} from "@/lib/studioActionApproval";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";

const DISPATCH_LIMIT = 10;
const thumbnailRefreshApi = (api as unknown as {
  readonly thumbnailRefresh: {
    readonly getCandidateDispatch: never;
    readonly getCandidateExecution: never;
    readonly listPendingCandidateDispatches: never;
    readonly reapExpiredCandidateDispatches: never;
    readonly markCandidateDispatchQueued: never;
    readonly recordCandidateDispatchFailure: never;
    readonly consumeCandidateDispatch: never;
  };
}).thumbnailRefresh;

type CandidatePayload = Readonly<{
  ownerId: string;
  channelId: string;
  sourceRunId: string;
  candidateRunId: string;
  replayFingerprint: string;
}>;

type CandidateExecution = Readonly<{
  candidate: {
    _id: Id<"runs">;
    ownerId: string;
    channelId: Id<"channels">;
    status: string;
    costTotal: number;
    thumbnailRefreshSourceRunId?: Id<"runs">;
    thumbnailRefreshReplayFingerprint?: string;
  };
  source: { _id: Id<"runs"> };
  channelSlug: string;
  material: ThumbnailRefreshReplayMaterial;
}>;

function client(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("thumbnail refresh: NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function boundDispatch(
  dispatch: unknown,
  payload: CandidatePayload,
): ThumbnailRefreshCandidateDispatch {
  const sealed = assertThumbnailRefreshCandidateDispatch(dispatch);
  if (
    sealed.ownerId !== payload.ownerId ||
    sealed.channelId !== payload.channelId ||
    sealed.sourceRunId !== payload.sourceRunId ||
    sealed.candidateRunId !== payload.candidateRunId ||
    sealed.replayFingerprint !== payload.replayFingerprint
  ) throw new Error("thumbnail refresh task payload does not match its durable dispatch");
  const subject = thumbnailRefreshCandidateApprovalSubject({
    ownerId: sealed.ownerId,
    channelId: sealed.channelId,
    sourceRunId: sealed.sourceRunId,
    candidateRunId: sealed.candidateRunId,
    replayFingerprint: sealed.replayFingerprint,
    maximumCostUsd: sealed.maximumCostUsd,
    dispatchKey: sealed.dispatchKey,
  });
  const approval = sealed.approval as StudioActionApprovalReceipt;
  if (
    studioActionApprovalFingerprint(approval) !== sealed.approvalFingerprint ||
    approval.maxCostUsd !== sealed.maximumCostUsd ||
    !verifyStudioActionApproval(approval, {
      action: "thumbnail-refresh-candidate",
      ownerId: sealed.ownerId,
      subject,
      maximumCostUsd: sealed.maximumCostUsd,
      persistedReceiptFingerprint: sealed.approvalFingerprint,
    })
  ) throw new Error("thumbnail refresh owner approval is invalid or changed");
  return sealed;
}

export async function executeThumbnailRefreshCandidate(
  payload: CandidatePayload,
  triggerRunId: string,
): Promise<{ ok: boolean; candidateRunId: string; costTotal?: number; error?: string }> {
  const convex = client();
  const dispatch = await convex.query(thumbnailRefreshApi.getCandidateDispatch, {
    ownerId: payload.ownerId,
    candidateRunId: payload.candidateRunId as Id<"runs">,
  } as never);
  const sealed = boundDispatch(dispatch, payload);
  const execution = await convex.query(thumbnailRefreshApi.getCandidateExecution, {
    ownerId: payload.ownerId,
    candidateRunId: payload.candidateRunId as Id<"runs">,
  } as never) as unknown as CandidateExecution | null;
  if (!execution) throw new Error("thumbnail refresh candidate execution material is unavailable");
  if (
    String(execution.candidate._id) !== payload.candidateRunId ||
    String(execution.candidate.channelId) !== payload.channelId ||
    String(execution.source._id) !== payload.sourceRunId ||
    execution.material.replayFingerprint !== payload.replayFingerprint
  ) throw new Error("thumbnail refresh replay material does not match its candidate shell");

  registerAllBlocks();
  const params = { qualityProfile: "production", thumbnailCritiqueIters: 2 };
  const entries = [{ block: "thumbnail_gen", params }];
  const seedStore = structuredClone(execution.material.store) as Record<string, unknown>;
  const resolved = validatePipeline(entries, Object.keys(seedStore));
  preflight(resolved, { budgetUsd: sealed.maximumCostUsd });

  // Consume the outbox only after the immutable replay and signed authority
  // have both passed, but before provider credentials or an execution lease.
  await convex.mutation(thumbnailRefreshApi.consumeCandidateDispatch, {
    ownerId: payload.ownerId,
    candidateRunId: payload.candidateRunId as Id<"runs">,
    now: Date.now(),
  } as never);

  const lease = await convex.mutation(api.runs.claimExecutionLease, {
    ownerId: payload.ownerId,
    channelId: payload.channelId as Id<"channels">,
    runId: payload.candidateRunId as Id<"runs">,
    leaseOwner: triggerRunId,
    now: Date.now(),
  });
  if (lease.kind !== "claimed") {
    throw new Error(`thumbnail refresh execution lease rejected: ${lease.error}`);
  }
  const executionLease = {
    leaseOwner: triggerRunId,
    executionLeaseToken: lease.executionLeaseToken,
  };
  let observedCost = Number(execution.candidate.costTotal ?? 0);
  try {
    await bootstrapSecrets(
      (message, extra) => console.log(`[thumbnail-refresh-candidate] ${message}`, extra ?? ""),
      { required: [] },
    );
    const sink = makeConvexSink(convex, payload.ownerId, executionLease);
    const result = await runEngine(resolved, {
      ownerId: payload.ownerId,
      channelId: payload.channelId,
      runId: payload.candidateRunId,
      executionLease,
      keyPrefix: channelPrefix(payload.ownerId, execution.channelSlug),
      budgetUsd: sealed.maximumCostUsd,
      paramsByBlock: { thumbnail_gen: params },
      seedStore,
      sink,
      resume: true,
      defaultRetries: 1,
      rehydrate: (block, outputs, request) =>
        rehydrateOutputs(block, outputs, payload.candidateRunId, request),
      log: (message, extra) =>
        console.log(`[thumbnail-refresh-candidate] ${message}`, extra ?? ""),
    });
    observedCost = result.costTotal;
    if (!result.ok) {
      await convex.mutation(api.runs.updateRun, {
        runId: payload.candidateRunId as Id<"runs">,
        status: "failed",
        finishedAt: Date.now(),
        costTotal: observedCost,
        error: result.error ?? "thumbnail candidate failed production QA",
        ...executionLease,
      });
      return {
        ok: false,
        candidateRunId: payload.candidateRunId,
        costTotal: observedCost,
        error: result.error ?? "thumbnail candidate failed production QA",
      };
    }
    await convex.mutation(api.runs.completeRun, {
      ownerId: payload.ownerId,
      channelId: payload.channelId as Id<"channels">,
      runId: payload.candidateRunId as Id<"runs">,
      finishedAt: Date.now(),
      costTotal: observedCost,
      ...executionLease,
    });
    return { ok: true, candidateRunId: payload.candidateRunId, costTotal: observedCost };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await convex.mutation(api.runs.updateRun, {
      runId: payload.candidateRunId as Id<"runs">,
      status: "failed",
      finishedAt: Date.now(),
      costTotal: observedCost,
      error: message.slice(0, 2_000),
      ...executionLease,
    });
    return { ok: false, candidateRunId: payload.candidateRunId, costTotal: observedCost, error: message };
  }
}

export const thumbnailRefreshCandidateTask = task({
  id: "thumbnail-refresh-candidate",
  machine: "medium-1x",
  maxDuration: 900,
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 20_000, factor: 2 },
  queue: { concurrencyLimit: 1 },
  run: async (payload: CandidatePayload, { ctx }) =>
    executeThumbnailRefreshCandidate(payload, ctx.run.id),
});

export async function dispatchPendingThumbnailRefreshCandidates(input?: {
  ownerId?: string;
  convex?: ConvexHttpClient;
}): Promise<{ pending: number; triggered: number; failed: number }> {
  const ownerId = input?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const convex = input?.convex ?? client();
  await convex.mutation(thumbnailRefreshApi.reapExpiredCandidateDispatches, {
    ownerId,
    now: Date.now(),
    limit: DISPATCH_LIMIT,
  } as never);
  const due = await convex.query(thumbnailRefreshApi.listPendingCandidateDispatches, {
    ownerId,
    limit: DISPATCH_LIMIT,
  } as never) as unknown as Array<{ candidateRunId: Id<"runs"> }>;
  let triggered = 0;
  let failed = 0;
  for (const row of due) {
    const raw = await convex.query(thumbnailRefreshApi.getCandidateDispatch, {
      ownerId,
      candidateRunId: row.candidateRunId,
    } as never);
    let sealed: ThumbnailRefreshCandidateDispatch;
    try {
      sealed = assertThumbnailRefreshCandidateDispatch(raw);
      // Validate the receipt before its identifiers reach a task payload.
      boundDispatch(sealed, {
        ownerId: sealed.ownerId,
        channelId: sealed.channelId,
        sourceRunId: sealed.sourceRunId,
        candidateRunId: sealed.candidateRunId,
        replayFingerprint: sealed.replayFingerprint,
      });
      const request = thumbnailRefreshTriggerRequest(sealed);
      const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, { scope: "global" });
      const handle = await tasks.trigger(request.taskId, request.payload, {
        concurrencyKey: request.concurrencyKey,
        idempotencyKey,
      });
      await convex.mutation(thumbnailRefreshApi.markCandidateDispatchQueued, {
        ownerId,
        candidateRunId: row.candidateRunId,
        triggerRunId: handle.id,
        attempt: sealed.dispatchAttempt + 1,
        now: Date.now(),
      } as never);
      triggered++;
    } catch (error) {
      failed++;
      const attempt = raw && typeof raw === "object" && Number.isSafeInteger((raw as { dispatchAttempt?: unknown }).dispatchAttempt)
        ? Number((raw as { dispatchAttempt: number }).dispatchAttempt) + 1
        : 1;
      await convex.mutation(thumbnailRefreshApi.recordCandidateDispatchFailure, {
        ownerId,
        candidateRunId: row.candidateRunId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
        now: Date.now(),
      } as never);
    }
  }
  return { pending: due.length, triggered, failed };
}

export const thumbnailRefreshDispatcher = schedules.task({
  id: "thumbnail-refresh-dispatcher",
  cron: "* * * * *",
  maxDuration: 120,
  run: async () => dispatchPendingThumbnailRefreshCandidates(),
});
