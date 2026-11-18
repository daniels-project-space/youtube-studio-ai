import { task, tasks, idempotencyKeys } from "@trigger.dev/sdk";
import { deliveryRecoveryMode } from "@/lib/deliveryRecoveryMode";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FamilyKey } from "@/engine/families";
import {
  productionRouteQualificationReceiptAdmission,
  productionRouteQualificationRequirement,
} from "@/engine/productionRouteQualificationAdmission";
import { routePreflightQualificationEvidence } from "@/engine/productionRouteQualificationReceipt";
import { freezeChannelInceptionProbeContext } from "@/lib/channelInceptionProbe";
import {
  assertRouteQualificationBenchmarkDispatchEnvelope,
  createRouteQualificationBenchmarkInput,
  prepareRouteQualificationBenchmarkDispatchEnvelope,
  routeQualificationBenchmarkApprovalSubject,
  routeQualificationBenchmarkRequestApprovalSubject,
  type RouteQualificationBenchmarkDispatchEnvelope,
} from "@/lib/routeQualificationBenchmark";
import {
  issueStudioActionApproval,
  verifyStudioActionApproval,
  type StudioActionApprovalReceipt,
} from "@/lib/studioActionApproval";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { makeFunctionReference } from "convex/server";
import { verifiedDurationCandidate } from "@/lib/durationCandidateEvidenceReview";
import { durationCandidatePreflight } from "@/lib/durationCandidatePreflight";
import { candidateBenchmarkInvocation } from "@/lib/candidateBenchmarkInvocation";
import { canonicalJson } from "@/lib/canonicalJson";

const ROUTE_QUALIFICATION_BENCHMARK_DISPATCH_LIMIT = 10;

const routeQualificationBenchmarkRunsApi = (api as unknown as {
  readonly routeQualificationBenchmarkRuns: {
    readonly listPending: never;
    readonly getPendingForRun: never;
    readonly reapExpiredQueuedForRun: never;
    readonly reapExpiredQueued: never;
    readonly claimDispatchEnvelope: never;
    readonly markQueued: never;
    readonly recordEnqueueFailure: never;
    readonly recordPreparationFailure: never;
    readonly recordCandidatePreflightBlocked: never;
  };
}).routeQualificationBenchmarkRuns;
const routeQualificationStateApi = (api as unknown as {
  readonly productionRouteQualificationState: {
    readonly getCurrentRouteQualificationReceipt: never;
  };
}).productionRouteQualificationState;

class CandidatePreflightBlocked extends Error {
  constructor(readonly report: ReturnType<typeof durationCandidatePreflight>) {
    super("Candidate preflight is not an admission; candidate-aware worker validation is unavailable.");
  }
}

type PendingRouteQualificationBenchmarkDispatch = {
  readonly runId: Id<"runs">;
  readonly channelId: Id<"channels">;
  readonly dispatchKey: string;
  readonly envelope?: RouteQualificationBenchmarkDispatchEnvelope;
  readonly approval: unknown;
  readonly approvalFingerprint: string;
  readonly maximumCostUsd: number;
  readonly attempt: number;
  readonly candidate?: { readonly candidateId: string; readonly fingerprint: string; readonly baselineFingerprint: string };
  readonly candidateInvocationInput?: unknown;
};

export function routeQualificationBenchmarkDispatchSchedule(
  receipt: PendingRouteQualificationBenchmarkDispatch & {
    readonly envelope: RouteQualificationBenchmarkDispatchEnvelope;
  },
  input?: { readonly deliveryAttempt?: number },
) {
  if (receipt.candidate) throw new Error("candidate benchmark worker admission is not available");
  // This is the final boundary before a durable receipt becomes a task payload.
  // Revalidate here as well as at storage/lease boundaries so malformed state can
  // never reach Trigger merely because a caller was refactored.
  assertRouteQualificationBenchmarkDispatchEnvelope(receipt.envelope);
  const deliveryAttempt = input?.deliveryAttempt ?? receipt.attempt + 1;
  return {
    payload: {
      channelId: String(receipt.channelId),
      runId: String(receipt.runId),
      pipelineOverride: receipt.envelope.input.benchmarkPipeline,
      moduleConfigOverride: receipt.envelope.input.moduleConfigOverride,
      routeQualificationBenchmark: receipt.envelope.input,
      routeQualificationBenchmarkAdmission: {
        maximumCostUsd: receipt.envelope.maximumCostUsd,
        approval: receipt.envelope.approval,
        dispatchEnvelopeFingerprint: receipt.envelope.dispatchEnvelopeFingerprint,
      },
    },
    concurrencyKey: String(receipt.channelId),
    idempotencySeed:
      `route-qualification-benchmark:${receipt.envelope.dispatchEnvelopeFingerprint}:delivery:${deliveryAttempt}`,
  };
}

async function prepareEnvelope(input: {
  readonly convex: ConvexHttpClient;
  readonly ownerId: string;
  readonly receipt: PendingRouteQualificationBenchmarkDispatch;
}): Promise<RouteQualificationBenchmarkDispatchEnvelope> {
  const parent = input.receipt.approval as StudioActionApprovalReceipt;
  const requestSubject = routeQualificationBenchmarkRequestApprovalSubject({
    ownerId: input.ownerId,
    channelId: String(input.receipt.channelId),
    runId: String(input.receipt.runId),
    dispatchKey: input.receipt.dispatchKey,
    maximumCostUsd: input.receipt.maximumCostUsd,
    ...(input.receipt.candidate ? { candidate: input.receipt.candidate } : {}),
  });
  if (!verifyStudioActionApproval(parent, {
    action: "route-qualification-benchmark-request",
    ownerId: input.ownerId,
    subject: requestSubject,
    maximumCostUsd: input.receipt.maximumCostUsd,
    persistedReceiptFingerprint: input.receipt.approvalFingerprint,
  })) {
    throw new Error("route qualification benchmark owner request approval is invalid or changed");
  }
  const channel = await input.convex.query(api.channels.getChannel, {
    channelId: input.receipt.channelId,
  }) as unknown as Record<string, unknown> | null;
  if (!channel || channel.ownerId !== input.ownerId) {
    throw new Error("route qualification benchmark channel is not owned by this operator");
  }
  if (input.receipt.candidate) {
    const target = input.receipt.candidate;
    const candidate = await input.convex.query(makeFunctionReference<"query">("durationDraftCandidates:get"), {
      ownerId: input.ownerId, channelId: input.receipt.channelId, candidateId: target.candidateId,
    }) as unknown as Record<string, unknown> | null;
    const verified = verifiedDurationCandidate(candidate, input.ownerId, String(input.receipt.channelId));
    if (!candidate || !verified || candidate.fingerprint !== target.fingerprint || candidate.baselineFingerprint !== target.baselineFingerprint || typeof candidate.family !== "string" || typeof candidate.requestedSeconds !== "number") throw new Error("candidate benchmark draft is unavailable or changed");
    const retained = input.receipt.candidateInvocationInput as { body?: { version?: unknown } } | undefined;
    const version = retained?.body?.version;
    if (version !== "candidate-benchmark-invocation-input/v1" && version !== "candidate-benchmark-invocation-input/v2") throw new Error("candidate benchmark invocation input version is invalid");
    const frozen = candidateBenchmarkInvocation({ ownerId: input.ownerId, channelId: String(input.receipt.channelId), runId: String(input.receipt.runId), target, channel: channel as never, candidate, maximumCostUsd: input.receipt.maximumCostUsd, version });
    if (canonicalJson(frozen) !== canonicalJson(input.receipt.candidateInvocationInput)) throw new Error("candidate benchmark invocation input is unavailable or changed");
    const preflight = durationCandidatePreflight({ ownerId: input.ownerId, channelId: String(input.receipt.channelId), channel: channel as never, candidate: { fingerprint: target.fingerprint, baselineFingerprint: target.baselineFingerprint, family: candidate.family, requestedSeconds: candidate.requestedSeconds, ...verified }, maximumCostUsd: input.receipt.maximumCostUsd, worker: null });
    throw new CandidatePreflightBlocked(preflight);
  }
  const requirement = productionRouteQualificationRequirement({
    path: "private_benchmark_manual",
    identity: channel.identity,
    family: channel.family,
    contentLane: channel.contentLane,
    pipeline: channel.pipeline,
  });
  if (!requirement.requiresReceipt || !requirement.binding) {
    throw new Error("sealed channel route does not require a private qualification benchmark");
  }
  const preflightRow = await input.convex.query(
    routeQualificationStateApi.getCurrentRouteQualificationReceipt,
    {
      ownerId: input.ownerId,
      channelId: input.receipt.channelId,
      level: "route_preflight_ready",
      bindingFingerprint: requirement.binding.bindingFingerprint,
    } as never,
  );
  const preflight = productionRouteQualificationReceiptAdmission({
    requirement,
    row: preflightRow,
    ownerId: input.ownerId,
    channelId: String(input.receipt.channelId),
  });
  if (!preflight.automatic || !preflight.receiptFingerprint || !preflightRow || typeof preflightRow !== "object") {
    throw new Error(preflight.reason);
  }
  routePreflightQualificationEvidence((preflightRow as { receipt?: unknown }).receipt);
  const context = freezeChannelInceptionProbeContext({
    ownerId: input.ownerId,
    family: requirement.binding.family as FamilyKey,
    channel: channel as never,
  });
  const benchmarkInput = createRouteQualificationBenchmarkInput({
    productionPipeline: channel.pipeline as never,
    moduleConfigOverride: structuredClone(
      (channel.moduleConfig && typeof channel.moduleConfig === "object" && !Array.isArray(channel.moduleConfig)
        ? channel.moduleConfig
        : {}) as Record<string, Record<string, unknown>>,
    ),
    invocationContext: {
      keyPrefix: `${context.keyPrefix}/route-qualification-benchmark/${String(input.receipt.runId)}`,
      seedStore: context.seedStore,
      madeForKids: context.madeForKids,
    },
    preflightReceiptFingerprint: preflight.receiptFingerprint,
  });
  const approval = issueStudioActionApproval({
    action: "route-qualification-benchmark",
    ownerId: input.ownerId,
    subject: routeQualificationBenchmarkApprovalSubject({
      ownerId: input.ownerId,
      channelId: String(input.receipt.channelId),
      runId: String(input.receipt.runId),
      benchmarkInput,
      maximumCostUsd: input.receipt.maximumCostUsd,
    }),
    actor: parent.actor,
    evidence: `Bound exact private benchmark from owner request: ${parent.evidence}`,
    maxCostUsd: input.receipt.maximumCostUsd,
  });
  return prepareRouteQualificationBenchmarkDispatchEnvelope({
    ownerId: input.ownerId,
    channelId: String(input.receipt.channelId),
    runId: String(input.receipt.runId),
    dispatchKey: input.receipt.dispatchKey,
    input: benchmarkInput,
    maximumCostUsd: input.receipt.maximumCostUsd,
    approval,
  });
}

/**
 * Durable owner-confirmed benchmark outbox. The API only records signed intent;
 * this is the sole component that derives route evidence, seals the concrete
 * no-upload pipeline, and turns it into a Trigger delivery.
 */
export async function dispatchPendingRouteQualificationBenchmarks(input?: {
  readonly ownerId?: string;
  readonly convex?: ConvexHttpClient;
  readonly log?: (message: string) => void;
  readonly target?: { readonly channelId: string; readonly runId: string };
}): Promise<{ readonly pending: number; readonly triggered: number }> {
  const ownerId = input?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const log = input?.log ?? ((message: string) => console.log(`[route-qualification-benchmark-dispatcher] ${message}`));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url && !input?.convex) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const convex = input?.convex ?? new ConvexHttpClient(url!, { requestTimeoutMs: 30_000 });
  let pending: PendingRouteQualificationBenchmarkDispatch[];
  if (input?.target) {
    await convex.mutation(routeQualificationBenchmarkRunsApi.reapExpiredQueuedForRun, {
      ownerId, channelId: input.target.channelId, runId: input.target.runId, now: Date.now(),
    } as never);
    const receipt = await convex.query(routeQualificationBenchmarkRunsApi.getPendingForRun, {
      ownerId, channelId: input.target.channelId, runId: input.target.runId,
    } as never) as unknown as PendingRouteQualificationBenchmarkDispatch | null;
    pending = receipt ? [receipt] : [];
  } else {
    const recovery = await convex.mutation(routeQualificationBenchmarkRunsApi.reapExpiredQueued, {
      ownerId, now: Date.now(), limit: ROUTE_QUALIFICATION_BENCHMARK_DISPATCH_LIMIT,
    } as never) as unknown as { checked: number; requeued: number; blocked: number };
    if (recovery.requeued || recovery.blocked) {
      log(`route qualification benchmark queued delivery recovery: ${recovery.requeued} reissued, ${recovery.blocked} manual-blocked`);
    }
    pending = await convex.query(routeQualificationBenchmarkRunsApi.listPending, {
      ownerId, limit: ROUTE_QUALIFICATION_BENCHMARK_DISPATCH_LIMIT,
    } as never) as unknown as PendingRouteQualificationBenchmarkDispatch[];
  }
  let triggered = 0;
  for (const receipt of pending.slice(0, ROUTE_QUALIFICATION_BENCHMARK_DISPATCH_LIMIT)) {
    let envelope = receipt.envelope;
    if (!envelope) {
      try {
        const prepared = await prepareEnvelope({ convex, ownerId, receipt });
        const claimed = await convex.mutation(routeQualificationBenchmarkRunsApi.claimDispatchEnvelope, {
          ownerId,
          channelId: receipt.channelId,
          runId: receipt.runId,
          envelope: prepared,
          fingerprint: prepared.dispatchEnvelopeFingerprint,
        } as never) as unknown as { envelope: unknown; fingerprint: string };
        if (claimed.fingerprint !== prepared.dispatchEnvelopeFingerprint) {
          throw new Error("route qualification benchmark envelope claim returned a different fingerprint");
        }
        assertRouteQualificationBenchmarkDispatchEnvelope(claimed.envelope);
        envelope = claimed.envelope;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof CandidatePreflightBlocked) {
          await convex.mutation(routeQualificationBenchmarkRunsApi.recordCandidatePreflightBlocked, {
            ownerId, channelId: receipt.channelId, runId: receipt.runId, report: error.report, failedAt: Date.now(),
          } as never);
          log(message);
          continue;
        }
        await convex.mutation(routeQualificationBenchmarkRunsApi.recordPreparationFailure, {
          ownerId,
          channelId: receipt.channelId,
          runId: receipt.runId,
          error: message,
          failedAt: Date.now(),
        } as never);
        log(`route qualification benchmark preparation is waiting for a valid sealed route: ${message}`);
        continue;
      }
    }
    const sealed = { ...receipt, envelope } as PendingRouteQualificationBenchmarkDispatch & {
      readonly envelope: RouteQualificationBenchmarkDispatchEnvelope;
    };
    const request = routeQualificationBenchmarkDispatchSchedule(sealed, {
      deliveryAttempt: receipt.attempt + 1,
    });
    try {
      const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, { scope: "global" });
      const task = await tasks.trigger("run-pipeline", request.payload, {
        concurrencyKey: request.concurrencyKey,
        idempotencyKey,
      });
      const triggerRunId = typeof (task as { id?: unknown }).id === "string"
        ? (task as { id: string }).id
        : request.idempotencySeed;
      try {
        await convex.mutation(routeQualificationBenchmarkRunsApi.markQueued, {
          ownerId,
          channelId: receipt.channelId,
          runId: receipt.runId,
          dispatchEnvelopeFingerprint: envelope.dispatchEnvelopeFingerprint,
          triggerRunId,
          queuedAt: Date.now(),
        } as never);
        triggered++;
        log(`queued private route qualification benchmark ${receipt.runId} (${triggerRunId})`);
      } catch (error) {
        log(
          `route qualification benchmark acknowledgement pending for ${receipt.runId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await convex.mutation(routeQualificationBenchmarkRunsApi.recordEnqueueFailure, {
          ownerId,
          channelId: receipt.channelId,
          runId: receipt.runId,
          dispatchEnvelopeFingerprint: envelope.dispatchEnvelopeFingerprint,
          error: message,
          failedAt: Date.now(),
        } as never);
      } catch (stateError) {
        log(
          `route qualification benchmark dispatch failure state write failed for ${receipt.runId}: ` +
            `${stateError instanceof Error ? stateError.message : String(stateError)}`,
        );
      }
      log(`route qualification benchmark enqueue failed for ${receipt.runId}: ${message}`);
    }
  }
  return { pending: pending.length, triggered };
}

export const routeQualificationBenchmarkDispatcher = task({
  id: "route-qualification-benchmark-dispatcher",
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  run: async (payload?: { channelId?: string; runId?: string }) => {
    if (payload !== undefined && (!payload || Array.isArray(payload) || typeof payload !== "object")) throw new Error("Invalid benchmark dispatch");
    const keys = Object.keys(payload ?? {});
    const targeted = keys.length > 0;
    if (targeted && (typeof payload?.channelId !== "string" || !payload.channelId.trim() ||
      typeof payload.runId !== "string" || !payload.runId.trim() || keys.some(key => !["channelId", "runId"].includes(key)))) {
      throw new Error("Invalid targeted benchmark dispatch");
    }
    if (!targeted && deliveryRecoveryMode() !== "individual") return { skipped: "shared-delivery-recovery" };
    return dispatchPendingRouteQualificationBenchmarks(targeted ? { target: { channelId: payload!.channelId!, runId: payload!.runId! } } : undefined);
  },
});
