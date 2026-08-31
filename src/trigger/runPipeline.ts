/**
 * `run-pipeline` Trigger task (MASTER-PLAN §D).
 *
 * Input: { channelId, runId }. It:
 *   1. loads the channel from Convex,
 *   2. resolves + validates its pipeline (topological consumes/produces),
 *   3. preflights (budget + required keys),
 *   4. runs the blocks via the engine runner, writing a runStage per block
 *      (Convex-backed sink), and
 *   5. marks the run ok/failed and fires a Telegram alert on failure.
 *
 * Idempotency: paid/heavy blocks carry `idempotencyKey = runId:block` so a
 * resumed run never double-spends (decision A.4). In P1 the blocks are trivial
 * and run inline; in P2 each heavy block becomes a child task triggered with
 * that key.
 */
import { task, idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline, preflight } from "@/engine/validate";
import {
  assertFamilyAutonomousPlanningPipeline,
  FAMILY_KEYS,
  type FamilyKey,
} from "@/engine/families";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { assertMinimumVideoFoundationForAutomaticFamily } from "@/engine/minimumVideoFoundation";
import {
  assertPipelineMatchesContentLane,
  injectContentLaneIntoPipeline,
  resolveContentLane,
} from "@/engine/contentLane";
import {
  productionRouteQualificationReceiptAdmission,
  productionRouteQualificationRequirement,
} from "@/engine/productionRouteQualificationAdmission";
import {
  assessProductionRouteQualification,
  readProductionRouteProvenanceEvidenceFromReleaseCertificate,
  readProductionRouteQualityEvidence,
  readProductionRouteRuntimeEvidence,
} from "@/engine/productionRouteQualification";
import {
  createRouteReleaseQualifiedReceipt,
  routePreflightQualificationEvidence,
} from "@/engine/productionRouteQualificationReceipt";
import { automaticCreatorBriefAdmission } from "@/engine/automaticCreatorBriefAdmission";
import {
  automaticFamilyExecutionReadinessAdmission,
  requiresAutomaticFamilyExecutionReadiness,
} from "@/engine/automaticFamilyExecutionReadiness";
import {
  compilePipeline,
  completePipelineForPolicy,
  materializeRuntimePipelineParams,
  PRIVATE_PROBE_CONTRACT_POLICY,
} from "@/engine/pipelineCompiler";
import { assertFrozenUploadQaEvidence } from "@/engine/frozenPipelineQaAdmission";
import {
  PAID_STAGE_RECONCILIATION_MARKER,
  runPipeline as runEngine,
} from "@/engine/runner";
import { ExecutionError } from "@/engine/executionErrors";
import { mergeRuntimeModuleConfig } from "@/engine/runtimeModuleConfig";
import { renderBlockTask } from "@/trigger/render-block";
import { renderBlockLightTask } from "@/trigger/render-block-light";
import { planHeal } from "@/engine/healer";
import { makeConvexSink } from "@/engine/convexSink";
import { makeRunLogSink, teeLog } from "@/engine/runLogSink";
import { channelPrefix } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { alertBudget, alertFailure } from "@/lib/telegram";
import { evaluateBudgetAlert } from "@/lib/budgetAlert";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { rehydrateOutputs } from "@/lib/rehydrate";
import type { PipelineEntry, ResumeRehydrationRequest } from "@/engine/types";
import { throwForTaskRetryPolicy } from "@/trigger/taskRetryPolicy";
import {
  assertScheduledPlanPayloadMatches,
  scheduledPlanSeed,
  type ScheduledPlanRunPayload,
} from "@/lib/scheduledPlanRuntime";
import {
  assertFreshPipelineInvocationRouteAdmission,
  assertRunPipelineAdmission,
} from "@/lib/runPipelineAdmission";
import {
  assertPipelineInvocationCompilation,
  normalizePipelineInvocationSnapshot,
  pipelineInvocationUsesCurrentShowProfileGuard,
  REMOTE_RENDER_BLOCK_IDS,
  renderBlockMachineClass,
  snapshotParamsByBlock,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import {
  renderChildWaitLeaseMs,
  renderChildWorkDeadlineMs,
} from "@/lib/renderChildLease";
import {
  serializedProgramEpisodeBusyRetryAt,
  serializedProgramEpisodeBusyRetryReceipt,
  serializedProgramEpisodeBusyRetrySchedule,
} from "@/lib/serializedProgramEpisode";
import { requireInternalQuerySecret } from "@/lib/youtubeConnector";
import {
  pipelineOverrideFingerprint,
  pipelineProbeApprovalSubject,
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
  type StudioActionApprovalReceipt,
} from "@/lib/studioActionApproval";
import {
  assertChannelInceptionProbeAttempt,
  channelInceptionProbeEffectiveBudgetUsd,
  type ChannelInceptionProbeAttemptCheckpoint,
  type ChannelInceptionProbeInvocationContext,
} from "@/lib/channelInceptionProbe";
import {
  assertRouteQualificationBenchmarkAdmission,
  assertRouteQualificationBenchmarkDispatchEnvelope,
  routeQualificationBenchmarkApprovalSubject,
  routeQualificationBenchmarkDispatchEnvelopeFingerprint,
  type RouteQualificationBenchmarkDispatchEnvelope,
  type RouteQualificationBenchmarkInput,
} from "@/lib/routeQualificationBenchmark";
import { CHANNEL_INCEPTION_STANDARD_PROBE_COST_CEILING_USD } from "@/engine/channelInceptionContracts";
import { assertPipelineVideoRuntimeReady } from "@/engine/runtimeCapability";
import {
  assertReviewedLtxRuntimeSeedStillActive,
  reviewedLtxRuntimeSeed,
  REVIEWED_LTX_RUNTIME_SEED_KEY,
} from "@/engine/reviewedLtxRuntimeTarget";
import { assertPersistedProgramBriefIdentity } from "@/engine/channelProgramBrief";
import {
  assertChannelProgramRouteBinding,
  assertChannelProgramRoutePipelineCompatibility,
  assertChannelProgramRouteRunSeed,
  channelProgramRouteFingerprint,
  channelProgramRouteRunSeed,
  parseChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertChannelShowProfilePipelineCompatibility,
  channelShowProfileFingerprint,
} from "@/engine/channelShowProfile";
import {
  assertChildrenShowBibleSeeded,
  childrenShowBibleSeedKeys,
} from "@/engine/childrenShowBible";
import { hasSourceAttributedDataStoryParams } from "@/engine/dataStory";
import {
  admitReviewedEvidencePackForSourceDataStoryRun,
  assertFrozenReviewedEvidencePackRunSeed,
  assertNoReviewedEvidencePackRunSeed,
  parseReviewedEvidencePackRunSelector,
  requiresReviewedEvidencePackForSourceDataStory,
  REVIEWED_EVIDENCE_PACK_RUN_ADMISSION_SEED_KEY,
  REVIEWED_EVIDENCE_PACK_SEED_KEY,
  REVIEWED_EVIDENCE_PACK_SELECTOR_SEED_KEY,
} from "@/engine/reviewedEvidenceRunAdmission";
import {
  assertNarrativeSeriesAcceptedCharacterAdapters,
  assertNarrativeSeriesNoGenericSchedule,
  assertNarrativeSeriesRunAdmission,
  assertNarrativeSeriesVisualControlComposition,
  narrativeSeriesRunAdmissionSeed,
  parseNarrativeSeriesRunSelector,
  NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY,
  type NarrativeSeriesRunAdmission,
} from "@/lib/narrativeSeriesRunAdmission";
import {
  getAcceptedCharacterLoRARecord,
  getNarrativeSeriesPlanRecord,
} from "@/lib/narrativeSeriesStateRuntime";
import { resolveOwnerReviewedLtxRuntime } from "@/lib/reviewedLtxRuntimeStateRuntime";
import type { ThirdPartyStockEvidenceReference } from "@/lib/thirdPartyStockEvidence";

const MAX_SELF_HEALS = 2;
const FACTUAL_REVIEW_FROZEN_BLOCK_IDS = new Set([
  "script_gen",
  "qa_script",
  "narration_tts",
  "story_spine",
  "episode_graph",
]);

// Keep the fresh Convex module boundary narrow until the normal generated API
// declaration refresh. Trigger carries only receipt identifiers/fingerprints;
// the handler reloads every reviewed artifact and authority server-side.
const factualReviewCheckpointsApi = (api as unknown as {
  readonly factualReviewCheckpoints: {
    readonly createAwaiting: never;
    readonly getApprovedResumeNarration: never;
    readonly blockResume: never;
  };
}).factualReviewCheckpoints;

// This read-only bridge intentionally does not add a writer, endpoint, or
// automatic benchmark dispatch. The worker only reloads a current immutable
// receipt already persisted by the service-owned qualification workflow.
const productionRouteQualificationStateApi = (api as unknown as {
  readonly productionRouteQualificationState: {
    readonly getCurrentRouteQualificationReceipt: never;
    readonly recordRouteReleaseQualified: never;
  };
}).productionRouteQualificationState;

/**
 * Phase I is deliberately limited to the new source-data materialization. A
 * historical source-data run without Episode Graph keeps its historical
 * behavior; a graph that claims the new boundary but places it after visual
 * work fails closed before any provider starts.
 */
function hasPhaseIFactualReviewBoundary(entries: readonly PipelineEntry[]): boolean {
  const episodeIndexes = entries
    .map((entry, index) => entry.block === "episode_graph" ? index : -1)
    .filter((index) => index >= 0);
  if (episodeIndexes.length === 0) return false;
  if (episodeIndexes.length !== 1) {
    throw new Error("source-attributed data-story factual review requires exactly one episode_graph boundary");
  }
  const storySpineIndex = entries.findIndex((entry) => entry.block === "story_spine");
  const stockFootageIndex = entries.findIndex((entry) => entry.block === "stock_footage");
  const episodeGraphIndex = episodeIndexes[0]!;
  if (
    storySpineIndex < 0 ||
    stockFootageIndex < 0 ||
    episodeGraphIndex <= storySpineIndex ||
    episodeGraphIndex >= stockFootageIndex
  ) {
    throw new Error(
      "source-attributed data-story factual review requires episode_graph after story_spine and before stock_footage",
    );
  }
  return true;
}

export interface RunPipelineInput {
  channelId: string;
  runId: string;
  /**
   * Identifier-only route-owned narrative horizon. The immutable plan is
   * reloaded from Convex before snapshotting; generic calendar planning never
   * supplies episode prose to this path.
   */
  narrativeSeriesSelector?: unknown;
  /** Exact frozen invocation identity supplied by post-upload recovery. */
  invocationSha256?: string;
  /** Exact uploaded intent/artifact/video identity supplied by recovery. */
  publishResume?: {
    intentId: string;
    videoArtifactId: string;
    youtubeVideoId: string;
  };
  /** Exact, atomically claimed content-plan snapshot for this run. */
  scheduledPlan?: ScheduledPlanRunPayload;
  /**
   * Identifier-only opt-in for one already private, immutable, human-reviewed
   * source-data-story pack. Facts are reloaded server-side and are never
   * accepted from this Trigger payload.
   */
  reviewedEvidencePackSelector?: {
    packId: string;
    contentFingerprint: string;
  };
  /**
   * Service-created first-run receipt for the supervised source-data-story
   * lane. It binds a selected immutable pack to one durable run; the payload
   * has no factual content and cannot substitute for the selector.
   */
  reviewedDataStoryInitialAdmission?: {
    admissionFingerprint: string;
  };
  /**
   * Server-created one-shot continuation of an exact owner-approved factual
   * checkpoint. It contains no review content or browser-derived authority.
   */
  factualReviewResume?: {
    checkpointId: string;
    checkpointFingerprint: string;
    approvalFingerprint: string;
    invocationSha256: string;
  };
  /**
   * Optional one-off pipeline for THIS run only (e.g. a short test render).
   * When set, it is used instead of the channel's persisted pipeline so the
   * channel config is never clobbered and there is no read race. Identity/seed
   * still come from the channel.
   */
  pipelineOverride?: PipelineEntry[];
  /** Exact module settings paired with an admitted one-off probe override. */
  moduleConfigOverride?: Record<string, Record<string, unknown>>;
  /** Every mutable channel-derived input frozen by the inception parent. */
  probeInvocationContext?: ChannelInceptionProbeInvocationContext;
  /** Signed, request-bound ceiling for an admitted Channel Inception probe. */
  probeAdmission?: {
    maximumCostUsd: number;
    approval: StudioActionApprovalReceipt;
    dispatchEnvelopeFingerprint: string;
  };
  /**
   * Full no-upload execution of an exact production route. The signed input
   * can earn only a release-qualification receipt after final-master QA and
   * durable certificate verification; it grants no publishing authority.
   */
  routeQualificationBenchmark?: RouteQualificationBenchmarkInput;
  routeQualificationBenchmarkAdmission?: {
    maximumCostUsd: number;
    approval: StudioActionApprovalReceipt;
    dispatchEnvelopeFingerprint: string;
  };
  /**
   * Fresh, child-editor-approved per-episode packet for the supervised
   * children lane. It is frozen into the invocation snapshot before any
   * provider work and is never a channel-level automatic-production setting.
   */
  childrenShowBibleInput?: unknown;
  /**
   * Fresh, child-editor-approved episode intent that must run before Story
   * Spine / Episode Graph planning in the supervised children lane.
   */
  curriculumEpisodeSeedInput?: unknown;
  /**
   * A freshly researched (or human-curated) Casefile Case Packet for the
   * cinematic_ai lane's `casefile_source_packet` admission block. Supplied
   * either by `generation-scheduler`'s opt-in auto-research dispatch
   * (`@/engine/casefileAutoResearchDispatch`) or, in principle, any other
   * caller — the manual `/api/casefile-episodes` desk workflow does not use
   * this field today; it is a fully separate, unaffected admission chain.
   * Same freeze-before-provider-work contract as `childrenShowBibleInput`.
   */
  casefileSourcePacketInput?: unknown;
  /**
   * Render-group reuse: when a language sibling is fanned out by the base run's
   * emit_bundle, the base assets are passed here and seeded into the store so the
   * expensive blocks (topic_select / script_gen / stock_footage / music) reuse
   * them instead of regenerating. Only narration/captions/text/metadata re-run.
   */
  reuse?: {
    language?: string;
    topic?: string;
    script?: unknown;
    footageKeys?: string[];
    thirdPartyStockEvidence?: ThirdPartyStockEvidenceReference;
    musicKey?: string;
  };
}

async function enqueueSerializedProgramEpisodeBusyRetry(input: {
  readonly payload: RunPipelineInput;
  readonly retryAt: number;
  readonly attempt: number;
}): Promise<void> {
  const request = serializedProgramEpisodeBusyRetrySchedule({
    payload: input.payload,
    channelId: input.payload.channelId,
    runId: input.payload.runId,
    retryAt: input.retryAt,
    attempt: input.attempt,
  });
  // This receipt is shared by the original task, any early scheduler task,
  // and the durable dispatcher. A run-scoped key would let each parent task
  // mint a duplicate delayed invocation; the frozen run/attempt/timestamp is
  // the true durable idempotency boundary.
  const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, {
    scope: "global",
  });
  await tasks.trigger("run-pipeline", request.payload, {
    delay: new Date(request.retryAt),
    concurrencyKey: request.concurrencyKey,
    idempotencyKey,
  });
}

export const runPipelineTask = task({
  id: "run-pipeline",
  // P1→P2 SPLIT: the memory-heavy local composites (timeline_assemble,
  // documotion_short) run on a large-2x CHILD task (render-block), and the
  // GPU-offloaded Novita renders on a medium-1x child (render-block-light);
  // this orchestrator runs every other block (LLM/TTS/footage/idle waits) and
  // SUSPENDS during the render. So it no longer pays the large-2x rate to sit
  // idle ~50% of the run waiting on external APIs.
  // large-1x (8GB) comfortably handles footage gating + captions + qa_visual.
  machine: "large-1x",
  // Long-form (15-35 min) renders do many full-video re-encodes; allow up to ~2h.
  maxDuration: 4200, // was 7200; real successful renders p95=2817s/max=3634s, 4200s halves the hung-run ceiling without risking legit long-form
  // On a crash/OOM/timeout, retry the whole task — the runner's resume restores
  // completed blocks (no double-spend).
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000, factor: 2 },
  // PER-CHANNEL serialization, CROSS-CHANNEL concurrency: every trigger site
  // passes concurrencyKey=channelId, so each channel renders one video at a
  // time (topic no-repeat + schedule stay race-free) while different channels
  // render fully in parallel (each run gets its own machine; the old global
  // limit of 3 throttled the whole fleet).
  queue: { concurrencyLimit: 1 },
  run: async (payload: RunPipelineInput, { ctx }) => {
    try {
      registerAllBlocks();
    } catch (error) {
      throwForTaskRetryPolicy(error);
    }
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throwForTaskRetryPolicy(new Error("NEXT_PUBLIC_CONVEX_URL is not configured"));
    const convex = new ConvexHttpClient(url);

    let channel;
    let durableRun;
    try {
      [channel, durableRun] = await Promise.all([
        convex.query(api.channels.getChannel, {
          channelId: payload.channelId as Id<"channels">,
        }),
        convex.query(api.runs.getRun, {
          runId: payload.runId as Id<"runs">,
        }),
      ]);
    } catch (error) {
      throwForTaskRetryPolicy(error);
    }
    if (!channel) throwForTaskRetryPolicy(new Error(`channel not found: ${payload.channelId}`));

    const ownerId = channel.ownerId;
    try {
      assertRunPipelineAdmission({
        run: durableRun,
        runId: payload.runId,
        ownerId,
        channelId: payload.channelId,
        scheduledPlanItemId: payload.scheduledPlan?.planItemId,
      });
    } catch (error) {
      throwForTaskRetryPolicy(error);
    }
    if (!durableRun) {
      throw new Error(`run-pipeline run not found after admission: ${payload.runId}`);
    }
    const hasInvocationSnapshot = durableRun.pipelineInvocationSnapshot !== undefined;
    const hasInvocationHash = durableRun.pipelineInvocationSha256 !== undefined;
    if (hasInvocationSnapshot !== hasInvocationHash) {
      throwForTaskRetryPolicy(
        new Error("run-pipeline durable invocation snapshot/hash pair is incomplete"),
      );
    }
    if (durableRun.status === "failed" && !hasInvocationSnapshot) {
      const isFanoutReceipt =
        durableRun.bundleDispatchState !== undefined ||
        durableRun.bundleParentRunId !== undefined ||
        durableRun.bundleParentChannelId !== undefined ||
        durableRun.bundleDispatchKey !== undefined ||
        durableRun.bundleDispatchEnvelope !== undefined ||
        durableRun.bundleDispatchEnvelopeFingerprint !== undefined;
      throwForTaskRetryPolicy(
        isFanoutReceipt
          ? new ExecutionError(
            "run-pipeline terminal bundle fanout receipt has no durable invocation snapshot",
            {
              code: "BUNDLE_FANOUT_EXECUTION_INELIGIBLE",
              retryable: false,
              phase: "fanout_execution_admission",
            },
          )
          : new Error("run-pipeline failed legacy run has no durable invocation snapshot"),
      );
    }
    if (
      payload.invocationSha256 !== undefined &&
      (!hasInvocationSnapshot ||
        durableRun.pipelineInvocationSha256 !== payload.invocationSha256 ||
        !/^[a-f0-9]{64}$/.test(payload.invocationSha256))
    ) {
      throwForTaskRetryPolicy(
        new Error("run-pipeline recovery invocation hash mismatch"),
      );
    }
    let durableInvocation: PipelineInvocationSnapshot | undefined;
    try {
      if (durableRun.pipelineInvocationSnapshot !== undefined) {
        durableInvocation = normalizePipelineInvocationSnapshot(
          durableRun.pipelineInvocationSnapshot as PipelineInvocationSnapshot,
        );
        if (
          durableInvocation.ownerId !== ownerId ||
          durableInvocation.runId !== payload.runId ||
          durableInvocation.channelId !== payload.channelId ||
          durableRun.pipelineInvocationSha256 !==
            pipelineInvocationSha256(durableInvocation)
        ) {
          throw new Error("durable pipeline invocation identity/hash mismatch");
        }
      }
    } catch (error) {
      throwForTaskRetryPolicy(error);
    }
    let serializedEpisodeRetry;
    try {
      serializedEpisodeRetry = serializedProgramEpisodeBusyRetryReceipt({
        retryAt: durableRun.serializedProgramEpisodeRetryAt,
        attempt: durableRun.serializedProgramEpisodeRetryAttempts,
      });
    } catch (error) {
      throwForTaskRetryPolicy(error);
    }
    if (serializedEpisodeRetry.kind === "active") {
      if (serializedEpisodeRetry.retryAt > Date.now()) {
        // A task carrying the same global receipt may start slightly before
        // its not-before timestamp. It must NOT succeed/re-enqueue with that
        // same key: a completed global key could otherwise suppress the real
        // due dispatch. Preserve the immutable receipt and let Trigger retry
        // this task (or the minute outbox dispatcher) without provider work.
        throwForTaskRetryPolicy(
          new ExecutionError(
            `serialized program episode retry is not due until ${serializedEpisodeRetry.retryAt}`,
            {
              code: "SERIALIZED_EPISODE_RETRY_NOT_BEFORE",
              retryable: true,
              retryScope: "durable_task",
            },
          ),
        );
      }
    }
    if (payload.probeAdmission && payload.routeQualificationBenchmarkAdmission) {
      throwForTaskRetryPolicy(
        new Error("run-pipeline cannot combine a shortened inception probe with a route qualification benchmark"),
      );
    }
    if (
      (payload.moduleConfigOverride ||
        payload.probeInvocationContext ||
        payload.routeQualificationBenchmark) &&
      !payload.probeAdmission &&
      !payload.routeQualificationBenchmarkAdmission
    ) {
      throwForTaskRetryPolicy(
        new Error("run-pipeline frozen private overrides require their exact signed admission"),
      );
    }
    let durableProbeEnvelope: ChannelInceptionProbeAttemptCheckpoint | undefined;
    if (durableRun.probeDispatchEnvelope !== undefined) {
      try {
        durableProbeEnvelope = durableRun.probeDispatchEnvelope as
          ChannelInceptionProbeAttemptCheckpoint;
        assertChannelInceptionProbeAttempt(durableProbeEnvelope);
        if (
          durableProbeEnvelope.ownerId !== ownerId ||
          durableProbeEnvelope.channelId !== payload.channelId ||
          durableProbeEnvelope.runId !== payload.runId ||
          durableRun.probeDispatchEnvelopeFingerprint !==
            durableProbeEnvelope.dispatchEnvelopeFingerprint
        ) {
          throw new Error("durable probe dispatch envelope identity mismatch");
        }
      } catch (error) {
        throwForTaskRetryPolicy(error);
      }
    }
    let durableRouteQualificationBenchmarkEnvelope:
      | RouteQualificationBenchmarkDispatchEnvelope
      | undefined;
    if (durableRun.routeQualificationBenchmarkDispatchEnvelope !== undefined) {
      try {
        durableRouteQualificationBenchmarkEnvelope =
          durableRun.routeQualificationBenchmarkDispatchEnvelope as RouteQualificationBenchmarkDispatchEnvelope;
        assertRouteQualificationBenchmarkDispatchEnvelope(durableRouteQualificationBenchmarkEnvelope);
        if (
          durableRouteQualificationBenchmarkEnvelope.ownerId !== ownerId ||
          durableRouteQualificationBenchmarkEnvelope.channelId !== payload.channelId ||
          durableRouteQualificationBenchmarkEnvelope.runId !== payload.runId ||
          durableRun.routeQualificationBenchmarkDispatchEnvelopeFingerprint !==
            durableRouteQualificationBenchmarkEnvelope.dispatchEnvelopeFingerprint
        ) {
          throw new Error("durable route qualification benchmark envelope identity mismatch");
        }
      } catch (error) {
        throwForTaskRetryPolicy(error);
      }
    }
    const rawOverrideFingerprint =
      payload.pipelineOverride &&
      payload.moduleConfigOverride &&
      payload.probeInvocationContext &&
      durableProbeEnvelope
        ? pipelineOverrideFingerprint({
            pipelineOverride: payload.pipelineOverride,
            moduleConfigOverride: payload.moduleConfigOverride,
            invocationContext: payload.probeInvocationContext,
            productionFingerprint: durableProbeEnvelope.input.productionFingerprint,
          })
        : undefined;
    let probeBudgetAdmission: PipelineInvocationSnapshot["budgetAdmission"];
    let routeQualificationBenchmarkAdmission: Extract<
      PipelineInvocationSnapshot["budgetAdmission"],
      { kind: "route-qualification-benchmark" }
    > | undefined;
    if (payload.probeAdmission) {
      const maximumCostUsd = payload.probeAdmission.maximumCostUsd;
      // The immutable child envelope is the authority here. New cinematic
      // envelopes carry their explicitly signed $55 ceiling; a legacy envelope
      // without that field stays at the historic $3 ceiling rather than gaining
      // a larger authority merely because the global contract evolved.
      const frozenProbeCeilingUsd =
        durableProbeEnvelope?.input.invocationContext.probeMaximumCostUsd ??
        CHANNEL_INCEPTION_STANDARD_PROBE_COST_CEILING_USD;
      if (
        !rawOverrideFingerprint ||
        !durableProbeEnvelope ||
        payload.probeAdmission.dispatchEnvelopeFingerprint !==
          durableProbeEnvelope.dispatchEnvelopeFingerprint ||
        rawOverrideFingerprint !== durableProbeEnvelope.input.overrideFingerprint ||
        !Number.isFinite(maximumCostUsd) ||
        maximumCostUsd <= 0 ||
        maximumCostUsd > frozenProbeCeilingUsd
      ) {
        throwForTaskRetryPolicy(
          new Error("run-pipeline probe admission requires an override within its frozen signed ceiling"),
        );
      }
      const subject = pipelineProbeApprovalSubject({
        ownerId,
        channelId: payload.channelId,
        runId: payload.runId,
        pipelineOverrideFingerprint: rawOverrideFingerprint,
        maximumCostUsd,
      });
      const persistedAdmission = durableInvocation?.budgetAdmission;
      const valid = verifyStudioActionApproval(payload.probeAdmission.approval, {
        action: "channel-inception-probe",
        ownerId,
        subject,
        maximumCostUsd,
        persistedReceiptFingerprint:
          persistedAdmission?.receiptFingerprint ?? durableProbeEnvelope.approvalFingerprint,
      });
      const receiptFingerprint = studioActionApprovalFingerprint(
        payload.probeAdmission.approval,
      );
      if (
        !valid ||
        payload.probeAdmission.approval.maxCostUsd !== maximumCostUsd ||
        maximumCostUsd !== durableProbeEnvelope.maximumCostUsd ||
        receiptFingerprint !== durableProbeEnvelope.approvalFingerprint ||
        (persistedAdmission !== undefined &&
          (persistedAdmission.kind !== "channel-inception-probe" ||
            persistedAdmission.maximumCostUsd !== maximumCostUsd ||
            persistedAdmission.receiptFingerprint !== receiptFingerprint ||
            persistedAdmission.subject !== subject ||
            persistedAdmission.pipelineOverrideFingerprint !== rawOverrideFingerprint ||
            persistedAdmission.dispatchEnvelopeFingerprint !==
              durableProbeEnvelope.dispatchEnvelopeFingerprint))
      ) {
        throwForTaskRetryPolicy(new Error("run-pipeline probe admission is invalid or changed"));
      }
      probeBudgetAdmission = {
        kind: "channel-inception-probe",
        maximumCostUsd,
        receiptFingerprint,
        subject,
        pipelineOverrideFingerprint: rawOverrideFingerprint,
        dispatchEnvelopeFingerprint: durableProbeEnvelope.dispatchEnvelopeFingerprint,
      };
    } else if (
      (durableInvocation?.budgetAdmission || durableProbeEnvelope || durableRouteQualificationBenchmarkEnvelope) &&
      !payload.routeQualificationBenchmarkAdmission
    ) {
      throwForTaskRetryPolicy(
        new Error("run-pipeline durable private invocation requires its exact signed admission"),
      );
    }
    if (payload.routeQualificationBenchmarkAdmission || payload.routeQualificationBenchmark) {
      if (!payload.routeQualificationBenchmarkAdmission || !payload.routeQualificationBenchmark) {
        throwForTaskRetryPolicy(
          new Error("route qualification benchmark requires both its sealed input and signed admission"),
        );
      }
      try {
        assertRouteQualificationBenchmarkAdmission({
          benchmark: payload.routeQualificationBenchmark,
          maximumCostUsd: payload.routeQualificationBenchmarkAdmission.maximumCostUsd,
          approval: payload.routeQualificationBenchmarkAdmission.approval,
        });
      } catch (error) {
        throwForTaskRetryPolicy(error);
      }
      const benchmark = payload.routeQualificationBenchmark;
      const admission = payload.routeQualificationBenchmarkAdmission;
      if (
        !payload.pipelineOverride ||
        !payload.moduleConfigOverride ||
        canonicalJson(payload.pipelineOverride) !== canonicalJson(benchmark.benchmarkPipeline) ||
        canonicalJson(payload.moduleConfigOverride) !== canonicalJson(benchmark.moduleConfigOverride)
      ) {
        throwForTaskRetryPolicy(
          new Error("route qualification benchmark task payload does not match its sealed private pipeline/configuration"),
        );
      }
      const subject = routeQualificationBenchmarkApprovalSubject({
        ownerId,
        channelId: payload.channelId,
        runId: payload.runId,
        benchmarkInput: benchmark,
        maximumCostUsd: admission.maximumCostUsd,
      });
      const approvalFingerprint = studioActionApprovalFingerprint(admission.approval);
      const dispatchEnvelopeFingerprint = routeQualificationBenchmarkDispatchEnvelopeFingerprint({
        ownerId,
        channelId: payload.channelId,
        runId: payload.runId,
        dispatchKey: durableRouteQualificationBenchmarkEnvelope?.dispatchKey ?? "unpersisted",
        benchmarkInput: benchmark,
        maximumCostUsd: admission.maximumCostUsd,
        approval: admission.approval,
      });
      const persistedAdmission = durableInvocation?.budgetAdmission;
      if (
        admission.dispatchEnvelopeFingerprint !== dispatchEnvelopeFingerprint ||
        admission.approval.maxCostUsd !== admission.maximumCostUsd ||
        !verifyStudioActionApproval(admission.approval, {
          action: "route-qualification-benchmark",
          ownerId,
          subject,
          maximumCostUsd: admission.maximumCostUsd,
          persistedReceiptFingerprint: persistedAdmission?.receiptFingerprint ?? approvalFingerprint,
        }) ||
        (persistedAdmission !== undefined &&
          (persistedAdmission.kind !== "route-qualification-benchmark" ||
            persistedAdmission.maximumCostUsd !== admission.maximumCostUsd ||
            persistedAdmission.receiptFingerprint !== approvalFingerprint ||
            persistedAdmission.subject !== subject ||
            persistedAdmission.pipelineOverrideFingerprint !== benchmark.benchmarkPipelineFingerprint ||
            persistedAdmission.dispatchEnvelopeFingerprint !== dispatchEnvelopeFingerprint ||
            persistedAdmission.productionPipelineFingerprint !== benchmark.productionPipelineFingerprint ||
            persistedAdmission.preflightReceiptFingerprint !== benchmark.preflightReceiptFingerprint))
      ) {
        throwForTaskRetryPolicy(
          new Error("route qualification benchmark admission is invalid, changed, or not bound to its sealed input"),
        );
      }
      if (
        !durableRouteQualificationBenchmarkEnvelope ||
        durableRouteQualificationBenchmarkEnvelope.dispatchEnvelopeFingerprint !== admission.dispatchEnvelopeFingerprint ||
        canonicalJson(durableRouteQualificationBenchmarkEnvelope.input) !== canonicalJson(benchmark) ||
        durableRouteQualificationBenchmarkEnvelope.maximumCostUsd !== admission.maximumCostUsd ||
        canonicalJson(durableRouteQualificationBenchmarkEnvelope.approval) !== canonicalJson(admission.approval)
      ) {
        throwForTaskRetryPolicy(
          new Error("route qualification benchmark task payload is not its durable owner-confirmed dispatch envelope"),
        );
      }
      routeQualificationBenchmarkAdmission = {
        kind: "route-qualification-benchmark",
        maximumCostUsd: admission.maximumCostUsd,
        receiptFingerprint: approvalFingerprint,
        subject,
        pipelineOverrideFingerprint: benchmark.benchmarkPipelineFingerprint,
        dispatchEnvelopeFingerprint,
        productionPipelineFingerprint: benchmark.productionPipelineFingerprint,
        preflightReceiptFingerprint: benchmark.preflightReceiptFingerprint,
      };
      // Keep the existing variable as the narrow trigger for the private
      // compiler policy and budget calculation below.
      probeBudgetAdmission = routeQualificationBenchmarkAdmission;
    }
    if (payload.publishResume) {
      const resume = payload.publishResume;
      if (
        !["failed", "running"].includes(durableRun.status) ||
        !resume.intentId.trim() ||
        !/^sha256:[a-f0-9]{64}$/.test(resume.videoArtifactId) ||
        !resume.youtubeVideoId.trim() ||
        String(durableRun.blockedPublishIntentId ?? "") !== resume.intentId ||
        durableRun.blockedPublishArtifactId !== resume.videoArtifactId ||
        String(durableRun.publishContinuationIntentId ?? "") !== resume.intentId ||
        durableRun.publishContinuationArtifactId !== resume.videoArtifactId ||
        durableRun.publishContinuationVideoId !== resume.youtubeVideoId ||
        durableRun.youtubeVideoId !== resume.youtubeVideoId ||
        !["pending", "queued"].includes(durableRun.publishContinuationState ?? "")
      ) {
        throwForTaskRetryPolicy(
          new Error("run-pipeline publish continuation identity/state mismatch"),
        );
      }
      let publishIntent;
      try {
        publishIntent = await convex.query(api.publishIntents.get, {
          secret: requireInternalQuerySecret(),
          intentId: resume.intentId as Id<"publishIntents">,
        });
      } catch (error) {
        throwForTaskRetryPolicy(error);
      }
      if (
        !publishIntent ||
        publishIntent.status !== "uploaded" ||
        String(publishIntent.runId ?? "") !== payload.runId ||
        publishIntent.ownerId !== ownerId ||
        String(publishIntent.channelId) !== payload.channelId ||
        publishIntent.videoArtifactId !== resume.videoArtifactId ||
        publishIntent.youtubeVideoId !== resume.youtubeVideoId
      ) {
        throwForTaskRetryPolicy(
          new Error("run-pipeline uploaded publish intent identity mismatch"),
        );
      }
    }
    let entries = (
      durableInvocation?.entries ?? payload.pipelineOverride ?? channel.pipeline ?? []
    ) as PipelineEntry[];
    // A run may use an admitted one-off override, but it may never exchange the
    // channel's visual engine. The persisted lock is the authority; legacy rows
    // are safely derived from their family/pipeline for this invocation.
    const contentLane = resolveContentLane({
      stored: (channel as { contentLane?: unknown }).contentLane,
      family: (channel as { family?: unknown }).family,
      pipeline: (channel.pipeline ?? []) as PipelineEntry[],
    });
    if (
      (payload.childrenShowBibleInput !== undefined || payload.curriculumEpisodeSeedInput !== undefined) &&
      contentLane.key !== "children_learning_supervised"
    ) {
      throwForTaskRetryPolicy(
        new Error("children editorial inputs are only accepted by the supervised children-learning lane"),
      );
    }
    if (durableInvocation && (
      payload.childrenShowBibleInput !== undefined || payload.curriculumEpisodeSeedInput !== undefined
    )) {
      throwForTaskRetryPolicy(
        new Error("children editorial inputs cannot replace frozen packets on a resumed run"),
      );
    }
    if (payload.casefileSourcePacketInput !== undefined && contentLane.key !== "cinematic_ai") {
      throwForTaskRetryPolicy(
        new Error("casefileSourcePacketInput is only accepted by the cinematic_ai lane"),
      );
    }
    if (durableInvocation && payload.casefileSourcePacketInput !== undefined) {
      throwForTaskRetryPolicy(
        new Error("casefileSourcePacketInput cannot replace a frozen packet on a resumed run"),
      );
    }
    if (durableInvocation && payload.reviewedEvidencePackSelector !== undefined) {
      throwForTaskRetryPolicy(
        new Error("reviewedEvidencePackSelector cannot replace a frozen reviewed-evidence pack on a resumed run"),
      );
    }
    if (!durableInvocation && payload.pipelineOverride) {
      console.log(`[run-pipeline] using one-off pipelineOverride (${entries.length} blocks) — channel config untouched`);
    }

    // Repeat the scheduler's qualification check before this worker can lease
    // execution, hydrate a provider secret, freeze a new invocation, or spend.
    // Existing certified automatic families remain receipt-free for migration
    // safety. A signed private probe is the only currently recognized future
    // benchmark/manual shape, and deliberately accepts preflight readiness
    // only; this task does not create or dispatch that workflow.
    const routeQualificationRequirement = productionRouteQualificationRequirement({
      path: payload.probeAdmission || payload.routeQualificationBenchmarkAdmission
        ? "private_benchmark_manual"
        : "normal_cadence",
      identity: channel.identity,
      contentLane: (channel as { contentLane?: unknown }).contentLane,
      family: (channel as { family?: unknown }).family,
      pipeline: channel.pipeline,
    });
    let routeQualificationAdmission = productionRouteQualificationReceiptAdmission({
      requirement: routeQualificationRequirement,
      row: null,
      ownerId,
      channelId: payload.channelId,
    });
    let routeQualificationReceiptRow: unknown = null;
    if (routeQualificationRequirement.requiresReceipt && routeQualificationRequirement.binding) {
      let row;
      try {
        row = await convex.query(
          productionRouteQualificationStateApi.getCurrentRouteQualificationReceipt,
          {
            ownerId,
            channelId: payload.channelId as Id<"channels">,
            level: routeQualificationRequirement.level,
            bindingFingerprint: routeQualificationRequirement.binding.bindingFingerprint,
          } as never,
        );
      } catch (error) {
        // A transient receipt-read outage has no run/plan mutation yet, so it
        // remains a normal bounded task retry rather than a false manual
        // failure. Neither provider credentials nor execution leasing occurred.
        throwForTaskRetryPolicy(error);
      }
      routeQualificationAdmission = productionRouteQualificationReceiptAdmission({
        requirement: routeQualificationRequirement,
        row,
        ownerId,
        channelId: payload.channelId,
      });
      routeQualificationReceiptRow = row;
    }
    if (!routeQualificationAdmission.automatic) {
      console.log(
        `[run-pipeline] production-route qualification manual gate for ${payload.runId}: ` +
          routeQualificationAdmission.reason,
      );
      // Return before the execution lease and the generic task failure handler.
      // This preserves the durable run/plan for an owner-qualified manual path
      // instead of recording a bogus failed plan or letting a provider start.
      return {
        ok: false,
        qualificationBlocked: true,
        manualGate: true,
        runId: payload.runId,
        error: routeQualificationAdmission.reason,
      };
    }
    if (routeQualificationBenchmarkAdmission) {
      const currentPreflightFingerprint =
        routeQualificationReceiptRow && typeof routeQualificationReceiptRow === "object"
          ? (routeQualificationReceiptRow as { receiptFingerprint?: unknown }).receiptFingerprint
          : undefined;
      if (
        currentPreflightFingerprint !== routeQualificationBenchmarkAdmission.preflightReceiptFingerprint
      ) {
        // The benchmark has not spent yet. Do not render a route whose private
        // preflight was superseded/revoked after the owner confirmed it.
        return {
          ok: false,
          qualificationBlocked: true,
          manualGate: true,
          runId: payload.runId,
          error: "route qualification benchmark preflight receipt changed before execution; create a fresh private benchmark request",
        };
      }
    }

    // Direct/recovered runs must not rely on a historical automatic flag when
    // the sealed channel Brief now signals factual, child, or other reviewed
    // work. This mirrors fresh creator admission before any secret bootstrap,
    // lease mutation, invocation snapshot, or provider preparation.
    const creatorBriefAdmission = automaticCreatorBriefAdmission({
      family: (channel as { family?: unknown }).family,
      identity: channel.identity,
    });
    if (!creatorBriefAdmission.automatic) {
      console.log(
        `[run-pipeline] creator Brief manual gate for ${payload.runId}: ` +
          creatorBriefAdmission.reason,
      );
      return {
        ok: false,
        creatorBriefBlocked: true,
        manualGate: true,
        runId: payload.runId,
        error: creatorBriefAdmission.reason,
      };
    }

    // A selected narrative series may not initialize any credential boundary
    // until its immutable, owner/channel-bound plan is present. The full
    // route/seed and adapter proof is repeated after the lease below, but this
    // cheap preflight rejects cross-owner, missing, or substituted plan IDs
    // before the automatic-runtime reader hydrates a single provider secret.
    const narrativeSelectorPreflightInput = durableInvocation
      ? durableInvocation.seedStore[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY]
      : payload.narrativeSeriesSelector;
    if (narrativeSelectorPreflightInput !== undefined) {
      const selector = parseNarrativeSeriesRunSelector(narrativeSelectorPreflightInput);
      const record = await getNarrativeSeriesPlanRecord({
        client: convex,
        ownerId,
        channelId: payload.channelId as Id<"channels">,
        fingerprint: selector.seriesPlanFingerprint,
      });
      if (
        !record ||
        record.ownerId !== ownerId ||
        String(record.channelId) !== payload.channelId ||
        record.fingerprint !== selector.seriesPlanFingerprint
      ) {
        throw new Error("narrative series selector has no matching immutable owner-scoped plan");
      }
    }

    // A durable automatic channel can outlive a provider credential or a
    // renderer attestation. Hydrate only after the narrative-selector
    // preflight, then stop before the execution lease, snapshot, or paid work
    // if its automatic foundation has drifted.
    const persistedFamily = (channel as { family?: unknown }).family;
    if (requiresAutomaticFamilyExecutionReadiness(persistedFamily)) {
      try {
        await bootstrapSecrets(
          (m, x) => console.log(`[run-pipeline] ${m}`, x ?? ""),
        );
      } catch (error) {
        throwForTaskRetryPolicy(error);
      }
      const automaticRuntimeAdmission = automaticFamilyExecutionReadinessAdmission(persistedFamily);
      if (!automaticRuntimeAdmission.automatic) {
        console.log(
          `[run-pipeline] automatic execution stack manual gate for ${payload.runId}: ` +
            automaticRuntimeAdmission.reason,
        );
        return {
          ok: false,
          executionReadinessBlocked: true,
          manualGate: true,
          runId: payload.runId,
          error: automaticRuntimeAdmission.reason,
        };
      }
    }

    // (Idempotency for the render CHILD is created at dispatch time inside
    // runRemoteBlock — it must vary per HEAL cycle, since a superseded render
    // must genuinely re-run while a plain orchestrator retry must reattach.)

    const leaseOwner = ctx.run.id;
    let executionLeaseToken: number | undefined;
    let claimedSelfHealGeneration: number | undefined;
    try {
      const lease = await convex.mutation(api.runs.claimExecutionLease, {
        ownerId,
        channelId: payload.channelId as Id<"channels">,
        runId: payload.runId as Id<"runs">,
        leaseOwner,
        now: Date.now(),
        ...(payload.factualReviewResume
          ? {
              factualReviewResume: {
                checkpointId: payload.factualReviewResume.checkpointId as Id<"factualReviewCheckpoints">,
                checkpointFingerprint: payload.factualReviewResume.checkpointFingerprint,
                approvalFingerprint: payload.factualReviewResume.approvalFingerprint,
                invocationSha256: payload.factualReviewResume.invocationSha256,
              },
            }
          : {}),
        ...(payload.reviewedDataStoryInitialAdmission && payload.reviewedEvidencePackSelector
          ? {
              reviewedDataStoryInitialAdmission: {
                admissionFingerprint: payload.reviewedDataStoryInitialAdmission.admissionFingerprint,
                packId: payload.reviewedEvidencePackSelector.packId as Id<"reviewedEvidencePacks">,
                contentFingerprint: payload.reviewedEvidencePackSelector.contentFingerprint,
              },
            }
          : {}),
        ...(routeQualificationBenchmarkAdmission
          ? {
              routeQualificationBenchmarkDispatch: {
                dispatchEnvelopeFingerprint:
                  routeQualificationBenchmarkAdmission.dispatchEnvelopeFingerprint,
              },
            }
          : {}),
      });
      if (lease.kind === "fanout_ineligible") {
        throw new ExecutionError(
          `run-pipeline: ${lease.error}`,
          {
            code: "BUNDLE_FANOUT_EXECUTION_INELIGIBLE",
            retryable: false,
            phase: "fanout_execution_admission",
          },
        );
      }
      if (lease.kind === "factual_review_awaiting") {
        // This is an intentional, durable human pause—not a failed task. Do
        // not let Trigger retry it or allow a scheduler replay to cross the
        // approval boundary without the signed continuation receipt.
        return {
          ok: true,
          awaitingFactualReview: true,
          runId: payload.runId,
          message: lease.error,
        };
      }
      if (lease.kind === "factual_review_ineligible") {
        // The claim mutation has already terminalized a corrupt/missing
        // receipt. Returning normally keeps it out of retry/self-heal.
        return {
          ok: false,
          factualReviewBlocked: true,
          runId: payload.runId,
          error: lease.error,
        };
      }
      if (lease.kind === "reviewed_data_story_initial_awaiting") {
        // A generic/scheduler task is never allowed to turn a reviewed-pack
        // choice into a source-data run. It must wait for the dedicated
        // owner-created outbox envelope without entering retry/self-heal.
        return {
          ok: true,
          awaitingReviewedDataStoryDispatch: true,
          runId: payload.runId,
          message: lease.error,
        };
      }
      if (lease.kind === "reviewed_data_story_initial_ineligible") {
        return {
          ok: false,
          reviewedDataStoryDispatchBlocked: true,
          runId: payload.runId,
          error: lease.error,
        };
      }
      if (lease.kind === "route_qualification_benchmark_awaiting") {
        return {
          ok: true,
          awaitingRouteQualificationBenchmarkDispatch: true,
          runId: payload.runId,
          message: lease.error,
        };
      }
      if (lease.kind === "route_qualification_benchmark_ineligible") {
        return {
          ok: false,
          routeQualificationBenchmarkBlocked: true,
          runId: payload.runId,
          error: lease.error,
        };
      }
      executionLeaseToken = lease.executionLeaseToken;
      claimedSelfHealGeneration = lease.selfHealGeneration;
      console.log(
        `[run-pipeline] execution lease claimed (attempt ${lease.executionAttempts}, expires ${new Date(lease.leaseExpiresAt).toISOString()})`,
      );
    } catch (error) {
      throwForTaskRetryPolicy(error);
    }
    if (executionLeaseToken === undefined) {
      throw new Error("execution lease claim returned no write-fence token");
    }
    const initialSelfHealGeneration = claimedSelfHealGeneration;
    if (
      initialSelfHealGeneration === undefined ||
      !Number.isSafeInteger(initialSelfHealGeneration) ||
      initialSelfHealGeneration < 0 ||
      initialSelfHealGeneration > MAX_SELF_HEALS
    ) {
      throw new Error("execution lease claim returned an invalid self-heal generation");
    }
    const executionLease = { leaseOwner, executionLeaseToken };

    // Live log sink — tees every ctx.log line into the runLogs table so the
    // run detail page can stream a console. Best-effort: never crashes the run.
    const logSink = makeRunLogSink(convex, ownerId, payload.runId);
    const log = teeLog(logSink, (msg, extra) =>
      console.log(`[run-pipeline] ${msg}`, extra ?? ""),
    );
    let scheduledPlan: ScheduledPlanRunPayload | undefined;
    let requiresFactualReviewCheckpoint = false;
    let observedCostTotal = Number(durableRun.costTotal ?? 0);
    let narrativeSeriesAdmission: NarrativeSeriesRunAdmission | undefined;
    let frozenModuleConfig: Record<string, Record<string, unknown>> | undefined;

    try {
      // A selected narrative horizon is a route-owned serial planner. It must
      // not be mixed with the generic content-plan or bundle-reuse fast paths
      // before this worker has even read a calendar item.
      const durableNarrativeSelector = durableInvocation?.seedStore[
        NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY
      ];
      if (durableInvocation && payload.narrativeSeriesSelector !== undefined) {
        const supplied = parseNarrativeSeriesRunSelector(payload.narrativeSeriesSelector);
        if (
          durableNarrativeSelector === undefined ||
          supplied.fingerprint !== parseNarrativeSeriesRunSelector(durableNarrativeSelector).fingerprint
        ) {
          throw new Error("a resumed narrative series run cannot replace its frozen selector");
        }
      }
      if (!durableInvocation && durableNarrativeSelector !== undefined) {
        throw new Error("a fresh pipeline invocation cannot inherit an unclaimed narrative series selector");
      }
      assertNarrativeSeriesNoGenericSchedule({
        selector: durableInvocation ? durableNarrativeSelector : payload.narrativeSeriesSelector,
        scheduledPlan: payload.scheduledPlan,
        reuse: payload.reuse,
      });
      if (payload.scheduledPlan) {
        const durablePlan = await convex.query(api.contentPlan.getClaimedPlanItemForRun, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          itemId: payload.scheduledPlan.planItemId as Id<"contentPlan">,
          runId: payload.runId as Id<"runs">,
        });
        scheduledPlan = assertScheduledPlanPayloadMatches(payload.scheduledPlan, durablePlan);
        log(
          `scheduled plan admitted: ${scheduledPlan.planItemId} ` +
            `(${scheduledPlan.scheduledAt !== undefined ? new Date(scheduledPlan.scheduledAt).toISOString() : "cadence/unpinned"})`,
        );
      }

      // FORGED modules: interpreter-backed blocks the architect authored. Load
      // their validated specs and register before pipeline resolution.
      const forgedIds = entries.filter((e) => e.block.startsWith("forged_")).map((e) => e.block);
      if (forgedIds.length) {
        const { registerForgedSpecs } = await import("@/engine/forge/runtime");
        const { forgedModuleSchema } = await import("@/engine/forge/spec");
        for (const id of forgedIds) {
          const row = await convex.query(api.forgedModules.getByBlock, { ownerId, blockId: id });
          if (!row || row.status !== "active") {
            throw new Error(`pipeline references unknown/disabled forged module "${id}"`);
          }
          registerForgedSpecs([forgedModuleSchema.parse(row.spec)]);
          log(`forge: registered ${id}`);
        }
      }

      if (!durableInvocation) {
        // Persisted channels predate the production capability policy. Complete
        // uniquely resolvable safety/crew gaps once, before freezing the run.
        const completed = completePipelineForPolicy(entries);
        entries = completed.entries;
        if (completed.retired.length) {
          log(`Production compiler retired replaced legacy modules: ${completed.retired.join(", ")}`);
        }
        if (completed.inserted.length) {
          log(`Production compiler completed legacy pipeline: ${completed.inserted.join(", ")}`);
        }
        const firstParams = snapshotParamsByBlock(entries);
        // OPERATOR moduleConfig is folded into the write-once invocation. A
        // retry never reads these mutable settings again. Invalid settings for
        // a selected module are terminal before any provider admission; silently
        // reverting a channel to defaults would make its module configuration a
        // misleading UI control rather than an execution contract.
        try {
          const configuredModuleConfig = payload.moduleConfigOverride ??
            (channel as { moduleConfig?: Record<string, Record<string, unknown>> }).moduleConfig;
          const mergedModuleConfig = mergeRuntimeModuleConfig({
            entries,
            paramsByBlock: firstParams,
            moduleConfig: configuredModuleConfig,
          });
          Object.assign(firstParams, mergedModuleConfig.paramsByBlock);
          if (configuredModuleConfig !== undefined) {
            frozenModuleConfig = { ...mergedModuleConfig.frozenModuleConfig };
          }
          for (const blockId of mergedModuleConfig.skippedBlockIds) {
            log(`moduleConfig[${blockId}] SKIPPED (module is not selected in this pipeline)`);
          }
          for (const applied of mergedModuleConfig.applied) {
            log(
              `moduleConfig[${applied.blockId}] ${applied.virtual ? "validated as virtual runtime config" : "applied to runtime params"} ` +
              `(${applied.knobCount} knob(s)${applied.preset ? `, preset ${applied.preset}` : ""})`,
            );
          }
        } catch (e) {
          throw new ExecutionError(
            `invalid channel module configuration before provider admission: ${e instanceof Error ? e.message : String(e)}`,
            {
              code: "CHANNEL_MODULE_CONFIG_INVALID",
              retryable: false,
              phase: "pipeline_configuration",
            },
          );
        }
        entries = materializeRuntimePipelineParams(entries, firstParams).map((entry) =>
          entry.block === "upload_draft" &&
          typeof entry.params?.["madeForKids"] !== "boolean"
            ? {
                ...entry,
                params: {
                  ...(entry.params ?? {}),
                  madeForKids:
                    payload.probeInvocationContext?.madeForKids ??
                    channel.schedule?.madeForKids ??
                    false,
                },
              }
            : entry,
        );
      } else {
        log(
          `run-pipeline: restored frozen ${durableInvocation.source} invocation ` +
            `${durableRun.pipelineInvocationSha256}`,
        );
        // Frozen snapshots are hash-bound and must not be silently rewritten.
        // A fresh invocation is completed by policy before it can freeze; an
        // historical omission instead fails before credentials, lease work, or
        // provider spend.
        assertFrozenUploadQaEvidence(entries);
      }

      assertPipelineMatchesContentLane(contentLane, entries);
      if (!durableInvocation) {
        entries = injectContentLaneIntoPipeline(entries, contentLane);
      }
      // A content lane proves the visual grammar, but it deliberately does
      // not own the complete non-Gemini planning spine. Enforce the family's
      // registered admission on the exact frozen graph before any provider
      // preflight or execution. Unknown legacy lanes retain their existing
      // legacy handling; canonical lanes always carry a known family.
      const laneFamily = contentLane.family;
      if (laneFamily && (FAMILY_KEYS as readonly string[]).includes(laneFamily)) {
        if (certifiedFamilyAdmission(laneFamily as FamilyKey).automatic) {
          // The designer and channel-inception flow seal this baseline, but a
          // durable invocation can be retried/imported later. Reassert it here
          // for every currently certified automatic family before preflight can
          // hydrate credentials or reserve any provider budget.
          assertMinimumVideoFoundationForAutomaticFamily({
            family: laneFamily as FamilyKey,
            contentLane,
            pipeline: entries,
          });
          assertFamilyAutonomousPlanningPipeline(laneFamily as FamilyKey, entries);
        }
      }

      // A resumed route-bearing invocation must consume its own immutable seed,
      // never re-resolve a possibly edited channel brief/profile. The snapshot
      // hash already binds this seed; checking its internal fingerprint here
      // catches malformed historical records before any provider preflight.
      const frozenProgramRouteSeed = durableInvocation === undefined
        ? undefined
        : (() => {
            const rawSeed = durableInvocation.seedStore["channelProgramRoute"];
            const fingerprint = durableInvocation.programRouteFingerprint;
            if (rawSeed === undefined && fingerprint === undefined) return undefined;
            if (rawSeed === undefined || fingerprint === undefined) {
              throw new Error("frozen pipeline invocation has an incomplete channel program route receipt");
            }
            const seed = parseChannelProgramRouteRunSeed(rawSeed);
            if (seed.routeFingerprint !== fingerprint) {
              throw new Error("frozen pipeline invocation channel program route fingerprint does not match its seed");
            }
            return seed;
          })();

      // A durable route receipt remains the execution source of truth, but it
      // must still prove that it was sealed from this channel's immutable
      // identity. This deliberately validates without substituting any current
      // identity value into the frozen entries or seed store: identity drift can
      // only reject the retry before preflight/provider work.
      if (durableInvocation && frozenProgramRouteSeed) {
        const immutableProgramBrief = assertPersistedProgramBriefIdentity(channel.identity, {
          context: "route-bearing frozen pipeline invocation channel identity",
          requireProgramBrief: true,
        });
        const rawImmutableProgramRoute =
          (channel.identity as { programRoute?: unknown }).programRoute;
        if (rawImmutableProgramRoute === undefined) {
          throw new Error(
            "route-bearing frozen pipeline invocation requires a sealed channel program route identity",
          );
        }
        const immutableProgramRoute = assertChannelProgramRouteBinding({
          route: rawImmutableProgramRoute,
          programBrief: immutableProgramBrief,
        });
        if (immutableProgramRoute.fingerprint !== durableInvocation.programRouteFingerprint) {
          throw new Error(
            "frozen pipeline invocation channel program route fingerprint does not match channel identity",
          );
        }
        assertChannelProgramRoutePipelineCompatibility({
          route: immutableProgramRoute,
          programBrief: immutableProgramBrief,
          pipeline: entries,
        });
        assertChannelProgramRouteRunSeed({
          seed: frozenProgramRouteSeed,
          route: immutableProgramRoute,
          programBrief: immutableProgramBrief,
        });
      }

      // Fresh runs bind the latest canonical brief to the persisted route once,
      // then freeze the derived run seed below. A route-less durable snapshot
      // still needs that same canonical brief solely for its historical
      // show-profile compatibility check; a route-bearing retry must not
      // inspect mutable current identity.
      const usesCurrentShowProfileGuard =
        pipelineInvocationUsesCurrentShowProfileGuard(durableInvocation);
      const programBrief =
        usesCurrentShowProfileGuard &&
        channel.identity?.programBrief !== undefined
        ? assertPersistedProgramBriefIdentity(channel.identity, {
            context: "run-pipeline channel identity",
            requireProgramBrief: true,
          })
        : undefined;
      const programRoute = durableInvocation !== undefined || programBrief === undefined
        ? undefined
        : (() => {
            const rawRoute = (channel.identity as { programRoute?: unknown }).programRoute;
            if (rawRoute === undefined) {
              throw new Error(
                "fresh pipeline invocation requires a sealed channel program route; historical route-less channels may only replay their existing frozen invocation",
              );
            }
            const route = assertChannelProgramRouteBinding({ route: rawRoute, programBrief });
            assertChannelProgramRoutePipelineCompatibility({ route, programBrief, pipeline: entries });
            if (route.contentLaneKey !== contentLane.key) {
              throw new Error("channel program route content lane does not match the current channel lane");
            }
            return route;
          })();
      if (
        durableInvocation === undefined &&
        programBrief === undefined &&
        (channel.identity as { programRoute?: unknown } | undefined)?.programRoute !== undefined
      ) {
        throw new Error("channel program route is present without a canonical channel program brief");
      }
      assertFreshPipelineInvocationRouteAdmission({
        hasDurableInvocation: durableInvocation !== undefined,
        programBrief,
        programRoute,
      });

      // The narrative selector carries no episode prose. Before the snapshot
      // is allowed to exist, reload the immutable owner/channel-bound plan and
      // bind it to the exact sealed Program Route seed. On a retry, the same
      // validation deliberately uses the frozen route seed, never a mutable
      // current planner, content-plan, or channel brief substitution.
      const narrativeSelectorInput = durableInvocation
        ? durableInvocation.seedStore[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY]
        : payload.narrativeSeriesSelector;
      if (narrativeSelectorInput !== undefined) {
        const routeSeed = durableInvocation
          ? frozenProgramRouteSeed
          : programRoute && programBrief
            ? channelProgramRouteRunSeed({ route: programRoute, programBrief })
            : undefined;
        if (!routeSeed) {
          throw new Error("narrative series execution requires a sealed serialized Program Route seed");
        }
        const selector = parseNarrativeSeriesRunSelector(narrativeSelectorInput);
        const record = await getNarrativeSeriesPlanRecord({
          client: convex,
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          fingerprint: selector.seriesPlanFingerprint,
        });
        if (
          !record ||
          record.ownerId !== ownerId ||
          String(record.channelId) !== payload.channelId ||
          record.fingerprint !== selector.seriesPlanFingerprint
        ) {
          throw new Error("narrative series selector has no matching immutable owner-scoped plan");
        }
        narrativeSeriesAdmission = assertNarrativeSeriesRunAdmission({
          selector,
          plan: record.plan,
          ownerId,
          channelId: payload.channelId,
          routeSeed,
        });
        const acceptedAdapterRows = await Promise.all(
          narrativeSeriesAdmission.selector.acceptedCharacterAdapters.map(async (adapter) => {
            const adapterRecord = await getAcceptedCharacterLoRARecord({
              client: convex,
              ownerId,
              channelId: payload.channelId as Id<"channels">,
              characterId: adapter.characterId,
              characterSpecFingerprint: adapter.characterSpecFingerprint,
            });
            if (!adapterRecord) {
              throw new Error("narrative series selector names a character LoRA that is not accepted");
            }
            return adapterRecord.entry;
          }),
        );
        // This is intentionally a reuse-only lookup. The run has no mutation
        // path to character-sheet, dataset, or training-request records.
        assertNarrativeSeriesAcceptedCharacterAdapters({
          admission: narrativeSeriesAdmission,
          entries: acceptedAdapterRows,
        });
        assertNarrativeSeriesVisualControlComposition({
          selector: narrativeSeriesAdmission.selector,
          routeSeed,
          contentLaneKey: contentLane.key,
          orderedBlocks: entries.map((entry) => entry.block),
        });
      } else {
        assertNarrativeSeriesVisualControlComposition({
          selector: undefined,
          routeSeed: durableInvocation ? frozenProgramRouteSeed : undefined,
          contentLaneKey: contentLane.key,
          orderedBlocks: entries.map((entry) => entry.block),
        });
      }

      // Keep the legacy show-profile replay guard for route-less snapshots. A
      // route-bearing retry intentionally avoids inspecting current profile
      // state: its route directives live exclusively in frozenProgramRouteSeed.
      let showProfile: ReturnType<typeof assertChannelShowProfilePipelineCompatibility> | undefined;
      const showProfileFingerprint =
        usesCurrentShowProfileGuard && channel.identity?.showProfile
          ? (() => {
              if (!programBrief) {
                throw new Error("channel show profile requires a canonical channel program brief");
              }
              showProfile = assertChannelShowProfilePipelineCompatibility({
                profile: channel.identity.showProfile,
                programBrief,
                pipeline: entries,
              });
              if (programRoute) {
                if (!showProfile.programRoute) {
                  throw new Error("channel show profile is missing its sealed channel program route");
                }
                if (
                  channelProgramRouteFingerprint(showProfile.programRoute) !==
                  channelProgramRouteFingerprint(programRoute)
                ) {
                  throw new Error("channel identity and channel show profile program routes do not match");
                }
              } else if (showProfile.programRoute) {
                throw new Error("channel show profile route is present without a sealed identity route");
              }
              return channelShowProfileFingerprint(showProfile);
            })()
          : undefined;
      if (!durableInvocation && programRoute && !showProfile) {
        throw new Error("fresh channel program route invocation requires a sealed channel show profile");
      }
      if (
        durableInvocation &&
        durableInvocation.programRouteFingerprint === undefined &&
        durableInvocation.showProfileFingerprint !== showProfileFingerprint
      ) {
        throw new Error("frozen pipeline invocation channel show profile does not match current channel composition");
      }

      // The provider/hardware contract is a pre-spend gate, not a diagnostic
      // emitted after an image, TTS pass, or child worker has already billed.
      // A reviewed LTX target is reloaded from the service-only, owner-scoped
      // registry before every parent attempt. Retries retain their original
      // benchmark set, but an added benchmark is harmless while a revocation
      // fails closed before any provider work. Historical snapshots with no
      // target keep the old static fail-closed behavior.
      const currentReviewedLtxRuntime = await resolveOwnerReviewedLtxRuntime({ client: convex, ownerId });
      const frozenReviewedLtxRuntime = durableInvocation?.seedStore[REVIEWED_LTX_RUNTIME_SEED_KEY];
      const reviewedLtxRuntime = frozenReviewedLtxRuntime === undefined
        ? reviewedLtxRuntimeSeed(currentReviewedLtxRuntime)
        : assertReviewedLtxRuntimeSeedStillActive({
            seed: frozenReviewedLtxRuntime,
            current: currentReviewedLtxRuntime,
          });
      assertPipelineVideoRuntimeReady(entries, reviewedLtxRuntime?.runtime);

      // Compile the exact frozen entries. On a retry, a changed/revoked module
      // implementation must fail closed before any stage/provider executes.
      // contentLane is resolved from the persisted channel and placed in
      // seedStore below. It is a channel-level policy input, not something a
      // render block may synthesize or replace.
      const resolved = validatePipeline(entries, ["contentLane", ...childrenShowBibleSeedKeys(contentLane)]);
      // A signed Channel Inception probe is intentionally private: the frozen
      // probe shape has no upload block, but retains every actual editorial
      // and technical release requirement. Choose that narrow policy only
      // after admission validation above; ordinary and forged invocations
      // always keep the full publish-capable production contract.
      const compilation = compilePipeline(
        resolved,
        probeBudgetAdmission ? PRIVATE_PROBE_CONTRACT_POLICY : undefined,
      );
      if (durableInvocation) {
        assertPipelineInvocationCompilation(durableInvocation, compilation);
      }

      const privateInvocationContext =
        payload.probeInvocationContext ?? payload.routeQualificationBenchmark?.invocationContext;
      let seedStore: Record<string, unknown>;
      if (durableInvocation) {
        seedStore = { ...durableInvocation.seedStore };
      } else if (payload.probeInvocationContext) {
        seedStore = structuredClone(payload.probeInvocationContext.seedStore);
        // A fresh private probe may carry its general channel identity in a
        // sealed context, but the explicit run override still owns the exact
        // configuration this invocation executes with.
        if (frozenModuleConfig) {
          seedStore.channelModuleConfig = frozenModuleConfig;
        }
      } else if (payload.routeQualificationBenchmark) {
        // A full route qualification benchmark has the same immutable identity
        // freeze as a probe, but its pipeline is an exact no-upload production
        // chain rather than a shortened sample.
        seedStore = structuredClone(payload.routeQualificationBenchmark.invocationContext.seedStore);
        if (frozenModuleConfig) {
          seedStore.channelModuleConfig = frozenModuleConfig;
        }
      } else {
        // Freeze every channel-identity input that blocks can observe. These are
        // plain Convex values/R2 keys; credentials and live publish policy are
        // deliberately excluded and continue to be rechecked at side effect time.
        seedStore = {
          ...(channel.thumbnailer ? { thumbnailer: channel.thumbnailer } : {}),
          topicPool: channel.identity?.topicPool ?? [],
          styleGrammar: channel.identity?.styleGrammar ?? "",
          channelName: channel.name,
          palette: channel.identity?.palette ?? [],
          persona: channel.identity?.persona ?? "",
          niche: channel.identity?.niche ?? "",
          // The Showrunner-authored stance for THIS channel's critic. Frozen
          // into the seed store alongside the rest of the identity so every
          // model-graded gate (script, thumbnail, narration, visual review)
          // judges against the channel's own standard, not a generic rubric.
          ...(channel.identity?.creativeBrief?.criticDoctrine
            ? { criticDoctrine: channel.identity.creativeBrief.criticDoctrine }
            : {}),
          ...(channel.identity?.voiceId ? { voiceId: channel.identity.voiceId } : {}),
          bannedWords: channel.identity?.bannedWords ?? [],
          ...(channel.identity?.imageKey ? { channelAvatarKey: channel.identity.imageKey } : {}),
          ...((channel as { scriptPlaybook?: unknown }).scriptPlaybook
            ? { scriptPlaybook: (channel as { scriptPlaybook?: unknown }).scriptPlaybook }
            : {}),
          styleDNA: (channel as { styleDNA?: unknown }).styleDNA ?? null,
          qualityBar: (channel as { qaRubric?: unknown }).qaRubric ?? null,
          contentLane,
          // Non-credential, non-publish-policy channel config a handful of
          // blocks otherwise re-fetch from Convex independently (crewBlocks.ts's
          // loadGrounding, intelligenceBlocks.ts's loadChannel). Freezing it here
          // removes those redundant getChannel calls entirely rather than just
          // caching them — same freeze rationale as the fields above.
          ...(channel.identity?.creativeBrief ? { showBible: channel.identity.creativeBrief } : {}),
          ...((channel as { slug?: string }).slug ? { channelSlug: (channel as { slug?: string }).slug } : {}),
          channelStatus: (channel as { status?: string }).status ?? "active",
          ...((channel as { template?: string }).template
            ? { channelTemplate: (channel as { template?: string }).template }
            : {}),
          channelBudget: channel.budget ?? 0,
          ...(frozenModuleConfig
            ? { channelModuleConfig: frozenModuleConfig }
            : {}),
          ...((channel as { thumbnailPlaybook?: unknown }).thumbnailPlaybook
            ? { thumbnailPlaybook: (channel as { thumbnailPlaybook?: unknown }).thumbnailPlaybook }
            : {}),
          ...((channel as { family?: string }).family ? { family: (channel as { family?: string }).family } : {}),
          ...(channel.identity?.thumbnailIdentity
            ? { thumbnailIdentity: channel.identity.thumbnailIdentity }
            : {}),
          ...(programRoute && programBrief
            ? { channelProgramRoute: channelProgramRouteRunSeed({ route: programRoute, programBrief }) }
            : {}),
          // The durable invocation holds selector fingerprints only. The
          // immutable narrative plan itself is always reloaded server-side by
          // its owner/channel/fingerprint before a retry can run.
          ...(narrativeSeriesAdmission
            ? narrativeSeriesRunAdmissionSeed(narrativeSeriesAdmission)
            : {}),
          // A route-bearing run must replay the exact capability selection
          // sealed in its ShowProfile. The QA certificate may use this only to
          // decide whether a matching existing receipt is applicable; it never
          // recomputes selection from mutable channel state on retry.
          ...(showProfile
            ? { channelSelectedCapabilityKeys: [...showProfile.selectedCapabilityKeys] }
            : {}),
          ...(payload.childrenShowBibleInput !== undefined
            ? { childrenShowBibleInput: structuredClone(payload.childrenShowBibleInput) }
            : {}),
          ...(payload.curriculumEpisodeSeedInput !== undefined
            ? { curriculumEpisodeSeedInput: structuredClone(payload.curriculumEpisodeSeedInput) }
            : {}),
          ...(payload.casefileSourcePacketInput !== undefined
            ? { casefileSourcePacketInput: structuredClone(payload.casefileSourcePacketInput) }
            : {}),
          ...(scheduledPlan ? scheduledPlanSeed(scheduledPlan) : {}),
        };
        if (payload.reuse) {
          if (payload.reuse.topic) seedStore["reuseTopic"] = payload.reuse.topic;
          if (payload.reuse.script) seedStore["reuseScript"] = payload.reuse.script;
          if (payload.reuse.footageKeys?.length) seedStore["reuseFootageKeys"] = payload.reuse.footageKeys;
          if (payload.reuse.thirdPartyStockEvidence) {
            seedStore["reuseThirdPartyStockEvidence"] = payload.reuse.thirdPartyStockEvidence;
          }
          if (payload.reuse.musicKey) seedStore["reuseMusicKey"] = payload.reuse.musicKey;
          if (payload.reuse.language) seedStore["reuseLanguage"] = payload.reuse.language;
          log(`run-pipeline: render-group REUSE active (lang=${payload.reuse.language}, ${payload.reuse.footageKeys?.length ?? 0} clips)`);
        }
      }

      // A children lane is intentionally executable only with a fresh,
      // operator-supplied editorial packet. This happens before preflight and
      // snapshotting, so a missing packet cannot reach a paid provider stage.
      assertChildrenShowBibleSeeded(contentLane, seedStore);
      if (durableInvocation && frozenProgramRouteSeed) {
        const routeSeed = parseChannelProgramRouteRunSeed(seedStore["channelProgramRoute"]);
        if (routeSeed.routeFingerprint !== frozenProgramRouteSeed.routeFingerprint) {
          throw new Error("frozen pipeline invocation channel program route seed changed during rehydration");
        }
      } else if (durableInvocation) {
        if (
          seedStore["channelProgramRoute"] !== undefined ||
          durableInvocation.programRouteFingerprint !== undefined
        ) {
          throw new Error("pipeline invocation has a route seed or fingerprint without a sealed frozen channel program route");
        }
      } else if (programRoute && programBrief) {
        const routeSeed = assertChannelProgramRouteRunSeed({
          seed: seedStore["channelProgramRoute"],
          route: programRoute,
          programBrief,
        });
        if (routeSeed.routeFingerprint !== programRoute.fingerprint) {
          throw new Error("fresh pipeline invocation program route fingerprint does not match its frozen route seed");
        }
      } else if (seedStore["channelProgramRoute"] !== undefined) {
        throw new Error("pipeline invocation has a route seed or fingerprint without a sealed channel program route");
      }
      if (narrativeSeriesAdmission) {
        const seededSelector = parseNarrativeSeriesRunSelector(
          seedStore[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY],
        );
        if (seededSelector.fingerprint !== narrativeSeriesAdmission.selector.fingerprint) {
          throw new Error("pipeline invocation narrative series selector changed before snapshotting");
        }
      } else if (seedStore[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY] !== undefined) {
        throw new Error("pipeline invocation has a narrative series selector without a validated immutable plan");
      }

      // Reviewed factual evidence is a deliberately narrow, provider-free
      // handoff. A Trigger payload may name an immutable private pack, but it
      // never carries facts; this reloads the owner-scoped record and binds it
      // to the exact frozen route, topic, and Show Profile before credentials,
      // preflight, or any billable stage can begin.
      const hasReviewedEvidencePackSeed =
        seedStore[REVIEWED_EVIDENCE_PACK_SELECTOR_SEED_KEY] !== undefined ||
        seedStore[REVIEWED_EVIDENCE_PACK_SEED_KEY] !== undefined ||
        seedStore[REVIEWED_EVIDENCE_PACK_RUN_ADMISSION_SEED_KEY] !== undefined;
      const hasSourceAttributedDataStoryPipeline = entries.some((entry) =>
        hasSourceAttributedDataStoryParams(entry.params ?? {}),
      );
      const hasDataStorySourceLedgerSeed = seedStore["dataStorySourceLedger"] !== undefined;
      const hasReviewedEvidenceRouteBinding =
        seedStore["channelProgramRoute"] !== undefined ||
        seedStore["channelSelectedCapabilityKeys"] !== undefined;
      if (!hasReviewedEvidenceRouteBinding) {
        if (
          payload.reviewedEvidencePackSelector !== undefined ||
          hasReviewedEvidencePackSeed ||
          hasSourceAttributedDataStoryPipeline ||
          hasDataStorySourceLedgerSeed
        ) {
          throw new Error(
            "reviewed source-data-story execution requires a sealed Program Route and Show Profile before provider work",
          );
        }
      } else {
        const reviewedEvidenceBinding = {
          route: seedStore["channelProgramRoute"],
          showProfileFingerprint:
            durableInvocation?.showProfileFingerprint ?? showProfileFingerprint,
          selectedCapabilityKeys: seedStore["channelSelectedCapabilityKeys"],
        };
        const reviewedEvidenceRequired =
          requiresReviewedEvidencePackForSourceDataStory(reviewedEvidenceBinding);
        if (!reviewedEvidenceRequired) {
          if (payload.reviewedEvidencePackSelector !== undefined || hasReviewedEvidencePackSeed) {
            throw new Error(
              "reviewed evidence packs are only accepted by the sealed source_attributed_data_story route",
            );
          }
          assertNoReviewedEvidencePackRunSeed(seedStore);
          if (hasSourceAttributedDataStoryPipeline || hasDataStorySourceLedgerSeed) {
            throw new Error(
              "source-attributed data-story inputs require the sealed source_attributed_data_story capability",
            );
          }
        } else {
          if (!hasSourceAttributedDataStoryPipeline) {
            throw new Error(
              "sealed source_attributed_data_story capability is missing its exact pipeline materialization",
            );
          }
          // Only the new immutable materialization places deterministic
          // Episode Graph before the first visual stage. Historical receipts
          // intentionally remain replayable without retrofitting a review
          // pause; any malformed claim of the new boundary fails before a
          // provider is reachable.
          requiresFactualReviewCheckpoint = hasPhaseIFactualReviewBoundary(entries);
          const selectorInput = durableInvocation
            ? seedStore[REVIEWED_EVIDENCE_PACK_SELECTOR_SEED_KEY]
            : payload.reviewedEvidencePackSelector;
          if (selectorInput === undefined) {
            throw new Error(
              "source_attributed_data_story requires a private immutable reviewedEvidencePackSelector before provider work",
            );
          }
          const selector = parseReviewedEvidencePackRunSelector(selectorInput);
          // The committed Convex handler is available at runtime through the
          // generated API proxy. Its local declaration may lag a fresh schema
          // addition until the normal Convex codegen step, so keep this cast
          // confined to the new handler boundary rather than accepting any
          // untyped pack content from the Trigger payload.
          const reviewedEvidencePackGet = (api as unknown as {
            readonly reviewedEvidencePacks: { readonly get: never };
          }).reviewedEvidencePacks.get;
          const record = await convex.query(reviewedEvidencePackGet, {
            ownerId,
            packId: selector.packId as Id<"reviewedEvidencePacks">,
          } as never) as unknown as {
            readonly _id: unknown;
            readonly ownerId: unknown;
            readonly contentFingerprint: unknown;
            readonly pack: unknown;
          } | null;
          if (!record) {
            throw new Error("reviewed evidence pack was not found for this owner");
          }
          if (durableInvocation) {
            assertFrozenReviewedEvidencePackRunSeed({
              seedStore,
              record,
              ownerId,
              binding: reviewedEvidenceBinding,
              ...(scheduledPlan ? { scheduledTopic: scheduledPlan.topic } : {}),
            });
          } else {
            const admitted = admitReviewedEvidencePackForSourceDataStoryRun({
              selector,
              record,
              ownerId,
              binding: reviewedEvidenceBinding,
              ...(scheduledPlan ? { scheduledTopic: scheduledPlan.topic } : {}),
            });
            Object.assign(seedStore, admitted.seed);
          }
        }
      }

      // Hydrate scoped provider credentials only after every route/profile/
      // topic/evidence fence above has admitted the exact frozen invocation.
      // Gemini remains thumbnail-only; creative text routes through their
      // declared non-Google provider or deterministic modules.
      try {
        await bootstrapSecrets(
          (m, x) => console.log(`[run-pipeline] ${m}`, x ?? ""),
        );
      } catch (error) {
        throwForTaskRetryPolicy(error);
      }

      const invocationCandidate = durableInvocation ?? normalizePipelineInvocationSnapshot({
        version: 1,
        ownerId,
        runId: payload.runId,
        channelId: payload.channelId,
        source: payload.reuse
          ? "bundle-reuse"
          : payload.pipelineOverride
            ? "override"
            : "channel",
        entries,
        seedStore,
        budgetUsd: probeBudgetAdmission
          ? routeQualificationBenchmarkAdmission
            ? routeQualificationBenchmarkAdmission.maximumCostUsd
            : channelInceptionProbeEffectiveBudgetUsd(
                payload.probeInvocationContext!,
                probeBudgetAdmission.maximumCostUsd,
              )
          : channel.budget ?? 0,
        keyPrefix: privateInvocationContext?.keyPrefix ?? channelPrefix(ownerId, channel.slug),
        // GPU/provider render stages and full-resolution masters run as
        // isolated cloud child tasks. Keep the allowlist derived from the
        // frozen pipeline so a run never authorizes an unrelated renderer.
        remoteBlocks: entries
          .filter((entry) => (REMOTE_RENDER_BLOCK_IDS as readonly string[]).includes(entry.block))
          .map((entry) => entry.block),
        defaultRetries: 2,
        compilationFingerprint: compilation.fingerprint,
        compilationPolicyId: compilation.policyId,
        compilationPolicyVersion: compilation.policyVersion,
        compilationModules: compilation.modules,
        compilationCapabilities: compilation.capabilities,
        reservedMaxCostUsd: compilation.reservedMaxCostUsd,
        ...(showProfileFingerprint ? { showProfileFingerprint } : {}),
        ...(programRoute ? { programRouteFingerprint: programRoute.fingerprint } : {}),
        ...(probeBudgetAdmission ? { budgetAdmission: probeBudgetAdmission } : {}),
      });
      preflight(resolved, { budgetUsd: invocationCandidate.budgetUsd });
      const invocationSha256 = pipelineInvocationSha256(invocationCandidate);
      const claimedInvocation = await convex.mutation(api.runs.claimInvocationSnapshot, {
        ownerId,
        channelId: payload.channelId as Id<"channels">,
        runId: payload.runId as Id<"runs">,
        ...executionLease,
        snapshot: invocationCandidate,
        sha256: invocationSha256,
      });
      const invocation = normalizePipelineInvocationSnapshot(
        claimedInvocation.snapshot as PipelineInvocationSnapshot,
      );
      if (
        claimedInvocation.sha256 !== invocationSha256 ||
        pipelineInvocationSha256(invocation) !== invocationSha256
      ) {
        throw new Error("claimed pipeline invocation hash mismatch");
      }
      if (
        probeBudgetAdmission &&
        (!invocation.budgetAdmission ||
          invocation.budgetAdmission.receiptFingerprint !==
            probeBudgetAdmission.receiptFingerprint ||
          invocation.budgetAdmission.dispatchEnvelopeFingerprint !==
            probeBudgetAdmission.dispatchEnvelopeFingerprint ||
          invocation.budgetUsd > probeBudgetAdmission.maximumCostUsd)
      ) {
        throw new Error("claimed pipeline invocation escaped its signed probe ceiling");
      }
      assertPipelineInvocationCompilation(invocation, compilation);
      entries = invocation.entries;
      seedStore = { ...invocation.seedStore };
      const paramsByBlock = snapshotParamsByBlock(entries);
      log(
        `Production compile ${compilation.policyId}@${compilation.policyVersion} ${compilation.fingerprint}: ` +
          `${compilation.modules.length} versioned modules, ${compilation.capabilities.length} capabilities`,
      );
      log(
        `Catalog route (selected only; qualification kept separate): ${[
          ...new Set(compilation.catalogFlow.map((step) => `${step.stage}/${step.catalogKey}`)),
        ].join(" → ")}`,
      );
      log(
        `Spend reserved: up to $${compilation.reservedMaxCostUsd.toFixed(2)} ` +
          `of $${invocation.budgetUsd.toFixed(2)} frozen per-video budget`,
      );

      const sink = makeConvexSink(convex, ownerId, executionLease);
      if (payload.factualReviewResume) {
        // Re-prove that the exact approved narration remains downloadable on
        // this worker before any later visual block can start. A confirmed
        // missing object is terminal/manual; a storage outage still follows
        // the ordinary bounded task retry without ever re-running TTS.
        const retained = await convex.query(factualReviewCheckpointsApi.getApprovedResumeNarration, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          runId: payload.runId as Id<"runs">,
          checkpointId: payload.factualReviewResume.checkpointId as Id<"factualReviewCheckpoints">,
          checkpointFingerprint: payload.factualReviewResume.checkpointFingerprint,
          approvalFingerprint: payload.factualReviewResume.approvalFingerprint,
          invocationSha256: payload.factualReviewResume.invocationSha256,
        } as never) as unknown as { narrationOutputs: Record<string, unknown> };
        const rehydratedNarration = await rehydrateOutputs(
          "narration_tts",
          retained.narrationOutputs,
          payload.runId,
          { neededOutputKeys: new Set(["narrationLocalPath"]) },
        );
        if (!rehydratedNarration.ok) {
          const reason =
            "factual review continuation blocked: the exact approved narration object is no longer retained";
          await convex.mutation(factualReviewCheckpointsApi.blockResume, {
            ownerId,
            channelId: payload.channelId as Id<"channels">,
            runId: payload.runId as Id<"runs">,
            checkpointId: payload.factualReviewResume.checkpointId as Id<"factualReviewCheckpoints">,
            checkpointFingerprint: payload.factualReviewResume.checkpointFingerprint,
            approvalFingerprint: payload.factualReviewResume.approvalFingerprint,
            ...executionLease,
            reason,
            now: Date.now(),
          } as never);
          log(reason);
          await logSink.flush();
          return { ok: false, factualReviewBlocked: true, runId: payload.runId, error: reason };
        }
        log("factual review continuation: retained narration rehydrated before visual work (TTS not re-run)");
      }
      // Declared BEFORE engineOpts so runRemoteBlock's closure can key the
      // child-task idempotency on the durable current heal cycle. A recovered
      // parent must start at h1/h2 rather than accidentally reattaching h0.
      let heals = initialSelfHealGeneration;
      const engineOpts = {
        ownerId,
        runId: payload.runId,
        channelId: payload.channelId,
        executionLease,
        keyPrefix: invocation.keyPrefix,
        budgetUsd: invocation.budgetUsd,
        paramsByBlock,
        sink,
        log,
        // Reliability (Phase 5): per-block retry on transient errors + resume —
        // if this task is retried (crash/OOM), skip blocks that already finished
        // and restore their outputs (re-download local files from R2) so paid
        // blocks never re-spend.
        resume: true,
        // New source-data materialization only: persist the deterministic
        // Story Spine/Episode Graph handoff and deliberately return to the
        // owner before any stock, generated visual, or render block starts.
        ...(requiresFactualReviewCheckpoint && !payload.factualReviewResume
          ? { stopAfterBlockId: "episode_graph" }
          : {}),
        defaultRetries: invocation.defaultRetries,
        rehydrate: (
          block: string,
          outputs: Record<string, unknown>,
          request: ResumeRehydrationRequest | undefined,
        ) =>
          rehydrateOutputs(block, outputs, payload.runId, request),
        // P1→P2 SPLIT: run the memory-heavy render on a large-2x child task so
        // this orchestrator (large-1x) suspends — unbilled — during the render
        // instead of paying the big-machine rate to wait on external APIs.
        remoteBlocks: new Set(invocation.remoteBlocks),
        runRemoteBlock: async (blockId: string, params: Record<string, unknown>) => {
          // Same run + block + heal cycle → same child run: a retried
          // orchestrator REATTACHES to the finished render (no double large-2x
          // spend), while a durable self-heal advance mints a fresh key so the
          // superseded render genuinely re-runs.
          // This identity must survive a parent task retry or lease-recovery
          // resume. Trigger's default `run` scope includes the parent task ID,
          // which would make the same durable run dispatch a second child after
          // the parent is recreated. The durable run/block/heal tuple is already
          // globally unique; the fenced generation advance below remains the
          // only intentional way to request a replacement render.
          const idemKey = await idempotencyKeys.create(
            `${payload.runId}:${blockId}:h${heals}`,
            { scope: "global" },
          );
          // Route to the child task provisioned for this block's machine class:
          // local compositing (timeline_assemble/documotion_short) needs the
          // large-2x worker; the Novita blocks offload their GPU work and only
          // submit + validate here, so they bill on the cheaper medium-1x task.
          const machineClass = renderBlockMachineClass(blockId);
          const child = machineClass === "heavy" ? renderBlockTask : renderBlockLightTask;
          const remoteChildWaitStartedAt = Date.now();
          await convex.mutation(api.runs.beginRemoteChildWait, {
            ownerId,
            channelId: payload.channelId as Id<"channels">,
            runId: payload.runId as Id<"runs">,
            ...executionLease,
            blockId,
            dispatchKey: idemKey,
            waitUntil: remoteChildWaitStartedAt + renderChildWaitLeaseMs(machineClass),
            deadline: remoteChildWaitStartedAt + renderChildWorkDeadlineMs(machineClass),
          });
          const requireDocuMotionReconciliation = (childFailure: string): ExecutionError =>
            new ExecutionError(
              `${PAID_STAGE_RECONCILIATION_MARKER}: remote documotion_short child failed after dispatch; ` +
                `provider cost is UNKNOWN and automatic replay/heal is forbidden. ${childFailure}`,
              {
                code: "DOCUMOTION_REMOTE_COST_RECONCILIATION_REQUIRED",
                retryable: false,
              },
            );
          let res:
            | { ok: true; output: { patch: Record<string, unknown> } }
            | { ok: false; error: unknown }
            | undefined;
          let postDispatchFailure: unknown;
          let hasPostDispatchFailure = false;
          let childDispatchStarted = false;
          try {
            // Once this call has been initiated, an ambiguous throw can mean
            // Trigger accepted the child even if the parent never receives a
            // terminal result. Treat DocuMotion as potentially paid from that
            // point forward rather than attempting another generation.
            childDispatchStarted = true;
            res = await child.triggerAndWait(
              {
                runId: payload.runId,
                ownerId,
                channelId: payload.channelId,
                keyPrefix: invocation.keyPrefix,
                blockId,
                params,
                budgetUsd: invocation.budgetUsd,
                seedStore,
                ...executionLease,
                dispatchKey: idemKey,
              },
              { idempotencyKey: idemKey },
            ) as Exclude<typeof res, undefined>;
          } catch (error) {
            hasPostDispatchFailure = true;
            postDispatchFailure = error;
          } finally {
            // A completed/failed child no longer needs the long wait window.
            // If the lease changed while suspended, this fails closed and the
            // stale parent cannot write a terminal state afterward.
            try {
              await convex.mutation(api.runs.heartbeatExecutionLease, {
                ownerId,
                channelId: payload.channelId as Id<"channels">,
                runId: payload.runId as Id<"runs">,
                ...executionLease,
                now: Date.now(),
              });
            } catch (error) {
              if (!hasPostDispatchFailure) {
                hasPostDispatchFailure = true;
                postDispatchFailure = error;
              }
            }
          }
          if (hasPostDispatchFailure) {
            const childFailure = `${child.id} child wait failed: ${
              postDispatchFailure instanceof Error
                ? postDispatchFailure.message.slice(0, 300)
                : JSON.stringify(postDispatchFailure)?.slice(0, 300)
            }`;
            if (blockId === "documotion_short" && childDispatchStarted) {
              throw requireDocuMotionReconciliation(childFailure);
            }
            throw postDispatchFailure;
          }
          if (!res) {
            const childFailure = `${child.id} child wait ended without a terminal result`;
            if (blockId === "documotion_short" && childDispatchStarted) {
              throw requireDocuMotionReconciliation(childFailure);
            }
            throw new Error(childFailure);
          }
          if (!res.ok) {
            const childFailure = `${child.id} child failed: ${JSON.stringify(res.error)?.slice(0, 300)}`;
            if (blockId === "documotion_short") {
              // The heavy child may have accepted FAL/TTS/music work before a
              // later render/download/validation failure. Until its durable
              // per-operation receipt layer lands, the amount is explicitly
              // UNKNOWN — do not pretend it was $0 or start h+1 automatically.
              throw requireDocuMotionReconciliation(childFailure);
            }
            throw new Error(childFailure);
          }
          return (res.output as { patch: Record<string, unknown> }).patch;
        },
      };
      await convex.mutation(api.runs.heartbeatExecutionLease, {
        ownerId,
        channelId: payload.channelId as Id<"channels">,
        runId: payload.runId as Id<"runs">,
        ...executionLease,
        now: Date.now(),
      });
      let result = await runEngine(resolved, { ...engineOpts, seedStore });
      observedCostTotal = result.costTotal;

      if (result.status === "awaiting_review") {
        if (
          !requiresFactualReviewCheckpoint ||
          payload.factualReviewResume !== undefined ||
          result.stoppedAfterBlockId !== "episode_graph"
        ) {
          // Do not reinterpret an unexpected runner boundary as a success or
          // feed it into self-heal. It has not reached a visual provider, and
          // must be investigated rather than silently admitted.
          throw new Error("unexpected factual-review runner boundary");
        }
        log("factual review checkpoint: Story Spine and Episode Graph retained; awaiting owner decision before visual work");
        // Stage/artifact writes are fenced by the current execution lease, so
        // flush them before the checkpoint mutation deliberately releases it.
        await logSink.flush();
        const checkpoint = await convex.mutation(factualReviewCheckpointsApi.createAwaiting, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          runId: payload.runId as Id<"runs">,
          ...executionLease,
          invocationSha256,
          costTotal: result.costTotal,
          now: Date.now(),
        } as never) as unknown as {
          kind: "awaiting" | "blocked";
          checkpointId?: Id<"factualReviewCheckpoints">;
          checkpointFingerprint?: string;
          error?: string;
        };
        if (checkpoint.kind === "blocked") {
          // Missing/corrupt retained facts are terminal/manual, never a
          // retry or self-heal that could rerun TTS or enter visual spend.
          return {
            ok: false,
            factualReviewBlocked: true,
            runId: payload.runId,
            error: checkpoint.error,
          };
        }
        return {
          ok: true,
          awaitingFactualReview: true,
          runId: payload.runId,
          checkpointId: checkpoint.checkpointId,
          checkpointFingerprint: checkpoint.checkpointFingerprint,
          costTotal: result.costTotal,
          invocationSha256,
        };
      }
      if (reviewedLtxRuntime) {
        seedStore[REVIEWED_LTX_RUNTIME_SEED_KEY] = reviewedLtxRuntime;
      } else {
        delete seedStore[REVIEWED_LTX_RUNTIME_SEED_KEY];
      }

      // SELF-HEALER (Pipeline Doctor, run-level): a QA failure over a defect a
      // cheap block owns must not discard the run's paid artifacts. Diagnose →
      // supersede exactly the owning block + its downstream consumers → resume
      // (everything else restores from the stage cache). Max 2 heals; unknown
      // or unhealable failures fall through and fail honestly.
      const healable = resolved.blocks.map((b) => ({
        id: b.id,
        produces: b.produces,
        consumes: b.consumes,
        paid: (b as { paid?: boolean }).paid,
      }));
      while (!result.ok && heals < MAX_SELF_HEALS) {
        if (result.error?.includes(PAID_STAGE_RECONCILIATION_MARKER)) {
          log(
            `${PAID_STAGE_RECONCILIATION_MARKER}: refusing self-heal because a paid stage ` +
              "requires receipt reconciliation before any new child dispatch.",
          );
          break;
        }
        const plan = planHeal(result.error ?? "", healable, (m) => log(m), result.visualRepair, {
          contentLaneKey: contentLane.key,
          ...(channel.identity?.creativeBrief?.criticDoctrine
            ? { criticDoctrine: channel.identity.creativeBrief.criticDoctrine }
            : {}),
          ...(channel.identity?.styleGrammar ? { styleGrammar: channel.identity.styleGrammar } : {}),
        });
        if (!plan) break;
        if (
          payload.factualReviewResume !== undefined &&
          plan.rerunBlocks.some((blockId) => FACTUAL_REVIEW_FROZEN_BLOCK_IDS.has(blockId))
        ) {
          // An approved checkpoint freezes the actual narration/Story Spine/
          // Episode Graph. A repair that would mutate any of them is a fresh
          // factual revision, never an automatic post-approval self-heal.
          log(
            "factual review fence: refusing self-heal that would change approved narration or story planning; manual revision required",
          );
          break;
        }
        const advanced = await convex.mutation(api.runs.advanceSelfHealGeneration, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          runId: payload.runId as Id<"runs">,
          ...executionLease,
          expectedGeneration: heals,
          rerunBlocks: plan.rerunBlocks,
          reason: plan.reason,
        });
        heals = advanced.generation;
        log(
          `SELF-HEAL ${heals}/${MAX_SELF_HEALS}: ${plan.reason} — superseding [${plan.rerunBlocks.join(", ")}] and resuming from the stage cache`,
        );
        await safeAlert(
          `self-heal ${heals} (${channel.slug})`,
          `${plan.reason} → re-running ${plan.rerunBlocks.length} block(s), paid artifacts preserved`,
        );
        await convex.mutation(api.runs.heartbeatExecutionLease, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          runId: payload.runId as Id<"runs">,
          ...executionLease,
          now: Date.now(),
        });
        result = await runEngine(resolved, {
          ...engineOpts,
          seedStore: {
            ...seedStore,
            healHints: plan.hints,
            // The DECLARED repair strategy per block (healer.ts `HealClass`).
            // Blocks switch on this instead of pattern-matching the hint prose,
            // whose wording is not a contract.
            healClasses: plan.healClasses,
            healAttempt: heals,
            ...(plan.visualRepair?.length ? { visualRepair: plan.visualRepair } : {}),
          },
        });
        observedCostTotal = result.costTotal;
      }
      if (heals > 0 && result.ok) {
        log(`SELF-HEAL succeeded after ${heals} cycle(s) — run recovered without re-spending paid blocks`);
      }

      if (result.costTotal > invocation.budgetUsd + Number.EPSILON) {
        throw new Error(
          `pipeline actual cost exceeded frozen invocation ceiling (${result.costTotal} > ${invocation.budgetUsd})`,
        );
      }

      // Drain any buffered log lines before resolving the run state.
      await logSink.flush();

      if (!result.ok) {
        const serialBusyRetry =
          result.failedBlock === "topic_select" &&
          result.retryDirective?.scope === "durable_task" &&
          result.retryDirective.code === "SERIALIZED_EPISODE_BUSY";
        if (serialBusyRetry) {
          const retryAt = serializedProgramEpisodeBusyRetryAt(
            Date.now(),
            result.retryDirective?.retryAfterMs,
          );
          const deferred = await convex.mutation(api.runs.deferSerializedProgramEpisodeRetry, {
            ownerId,
            channelId: payload.channelId as Id<"channels">,
            runId: payload.runId as Id<"runs">,
            ...executionLease,
            retryAt,
            costTotal: result.costTotal,
            error: result.error ?? "serialized program episode claim is busy",
          });
          try {
            await enqueueSerializedProgramEpisodeBusyRetry({
              payload,
              retryAt: deferred.retryAt,
              attempt: deferred.attempt,
            });
          } catch (error) {
            // The durable receipt is already queued. Preserve it through this
            // task's short retry so the early-reentry path can retry exactly
            // the same Trigger idempotency key without touching a provider.
            throw new ExecutionError(
              `serialized program episode retry enqueue failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
              {
                code: "SERIALIZED_EPISODE_REQUEUE_DISPATCH_FAILED",
                retryable: true,
                retryScope: "durable_task",
              },
            );
          }
          log(
            `serialized episode busy: released pipeline lease and queued same-run replay ` +
              `attempt ${deferred.attempt} for ${new Date(deferred.retryAt).toISOString()}`,
          );
          await logSink.flush();
          return {
            ok: false,
            deferred: true,
            failedBlock: result.failedBlock,
            retryAt: deferred.retryAt,
            retryAttempt: deferred.attempt,
          };
        }
        const failedAt = Date.now();
        if (scheduledPlan) {
          await convex.mutation(api.contentPlan.failClaimedPlanRun, {
            ownerId,
            channelId: payload.channelId as Id<"channels">,
            itemId: scheduledPlan.planItemId as Id<"contentPlan">,
            runId: payload.runId as Id<"runs">,
            ...executionLease,
            failedAt,
            costTotal: result.costTotal,
            error: result.error ?? "unknown pipeline failure",
          });
        } else {
          await convex.mutation(api.runs.updateRun, {
            runId: payload.runId as Id<"runs">,
            ...executionLease,
            status: "failed",
            finishedAt: failedAt,
            costTotal: result.costTotal,
            error: result.error,
          });
        }
        await safeAlert(
          `run-pipeline failed (${channel.slug}/${result.failedBlock})`,
          result.error ?? "unknown error",
        );
        return { ok: false, failedBlock: result.failedBlock, error: result.error };
      }

      if (routeQualificationBenchmarkAdmission) {
        // This is the sole bridge from a full private master to automatic
        // route qualification. It runs before the run becomes successful, so
        // a missing/swapped QA receipt or superseded preflight cannot leave a
        // paid benchmark looking qualified.
        if (!routeQualificationRequirement.binding || !routeQualificationReceiptRow) {
          throw new Error("route qualification benchmark is missing its current private preflight receipt");
        }
        const preflightRow = routeQualificationReceiptRow as {
          receipt?: unknown;
          receiptFingerprint?: unknown;
        };
        if (
          typeof preflightRow.receiptFingerprint !== "string" ||
          preflightRow.receiptFingerprint !== routeQualificationBenchmarkAdmission.preflightReceiptFingerprint
        ) {
          throw new Error("route qualification benchmark preflight receipt changed before final-master promotion");
        }
        const binding = routeQualificationRequirement.binding;
        if (binding.pipelineFingerprint !== routeQualificationBenchmarkAdmission.productionPipelineFingerprint) {
          throw new Error("route qualification benchmark production pipeline does not match its current route binding");
        }
        const preflightEvidence = routePreflightQualificationEvidence(preflightRow.receipt);
        const currentRuntime = readProductionRouteRuntimeEvidence({
          binding,
          planner: preflightEvidence.planner,
          pipeline: channel.pipeline,
          runtimeTarget: reviewedLtxRuntime?.runtime,
        });
        if (
          currentRuntime.evidenceFingerprint !== preflightEvidence.runtime.evidenceFingerprint ||
          currentRuntime.runtimeTargetFingerprint !== preflightEvidence.runtime.runtimeTargetFingerprint
        ) {
          throw new Error("route qualification benchmark runtime evidence changed or was revoked during execution");
        }
        const quality = readProductionRouteQualityEvidence({
          binding,
          qualityEvidence: result.store["qualityEvidence"],
        });
        const finalMasterSha256 = result.store["finalMasterSha256"];
        const finalMasterReleaseCertificate = result.store["finalMasterReleaseCertificate"];
        const finalMasterReleaseCertificateKey = result.store["finalMasterReleaseCertificateKey"];
        if (
          typeof finalMasterSha256 !== "string" ||
          typeof finalMasterReleaseCertificateKey !== "string" ||
          finalMasterReleaseCertificate === undefined
        ) {
          throw new Error("route qualification benchmark completed without a durable final-master release certificate");
        }
        const provenance = readProductionRouteProvenanceEvidenceFromReleaseCertificate({
          binding,
          quality,
          certificate: finalMasterReleaseCertificate,
          releaseCertificateKey: finalMasterReleaseCertificateKey,
          expectedFinalMasterSha256: finalMasterSha256,
        });
        const qualification = assessProductionRouteQualification({
          mode: "automatic",
          binding,
          planner: preflightEvidence.planner,
          inception: preflightEvidence.inception,
          runtime: currentRuntime,
          quality,
          provenance,
          visualMatter: preflightEvidence.visualMatter,
        });
        const releaseReceipt = createRouteReleaseQualifiedReceipt({
          ownerId,
          channelId: String(payload.channelId),
          preflight: preflightRow.receipt,
          qualification,
        });
        await convex.mutation(
          productionRouteQualificationStateApi.recordRouteReleaseQualified,
          {
            ownerId,
            channelId: payload.channelId as Id<"channels">,
            receipt: releaseReceipt,
          } as never,
        );
        log("sealed route_release_qualified receipt from exact private final-master benchmark");
      }

      const finishedAt = Date.now();
      if (scheduledPlan) {
        await convex.mutation(api.contentPlan.completeClaimedPlanRun, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          itemId: scheduledPlan.planItemId as Id<"contentPlan">,
          runId: payload.runId as Id<"runs">,
          ...executionLease,
          finishedAt,
          costTotal: result.costTotal,
        });
      } else {
        await convex.mutation(api.runs.completeRun, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          runId: payload.runId as Id<"runs">,
          ...executionLease,
          finishedAt,
          costTotal: result.costTotal,
        });
      }
      // Ship-stage "budget alert" gate (GOLDEN_MODULES catalog key "ship").
      // The hard ceiling is already enforced above (throw when costTotal >
      // budgetUsd) and per-block in engine/runner.ts, so a true overage can't
      // reach this line for declared provider envelopes. This is the
      // advisory rail: fire when spend lands at/near the frozen per-run
      // budget so the operator sees a channel running hot via Telegram
      // before the NEXT run trips the hard ceiling.
      const budgetAlert = evaluateBudgetAlert({
        costUsd: result.costTotal,
        budgetUsd: invocation.budgetUsd,
      });
      if (budgetAlert?.shouldAlert) {
        await safeBudgetAlert(`budget alert (${channel.slug})`, budgetAlert.message);
      }
      return {
        ok: true,
        stages: result.stages,
        costTotal: result.costTotal,
        invocationSha256,
        budgetUsd: invocation.budgetUsd,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`run aborted: ${message}`);
      await logSink.flush();
      if (
        err instanceof ExecutionError &&
        (err.code === "SERIALIZED_EPISODE_REQUEUE_DISPATCH_FAILED" ||
          err.code === "SERIALIZED_EPISODE_RETRY_NOT_BEFORE")
      ) {
        // `deferSerializedProgramEpisodeRetry` has already made the run
        // queued/recoverable. Do not overwrite that outbox receipt with a
        // terminal failed run while Trigger retries either a dispatch failure
        // or a clock-early delivery of the same global receipt.
        throwForTaskRetryPolicy(err);
      }
      const failedAt = Date.now();
      if (scheduledPlan) {
        await convex.mutation(api.contentPlan.failClaimedPlanRun, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          itemId: scheduledPlan.planItemId as Id<"contentPlan">,
          runId: payload.runId as Id<"runs">,
          ...executionLease,
          failedAt,
          costTotal: observedCostTotal,
          error: message,
        });
      } else {
        await convex.mutation(api.runs.updateRun, {
          runId: payload.runId as Id<"runs">,
          ...executionLease,
          status: "failed",
          finishedAt: failedAt,
          costTotal: observedCostTotal,
          error: message,
        });
      }
      await safeAlert(`run-pipeline aborted (${payload.runId})`, message);
      throwForTaskRetryPolicy(err);
    }
  },
});

/** Fire a Telegram alert but never let alerting failures mask the real error. */
async function safeAlert(context: string, error: string): Promise<void> {
  try {
    await alertFailure(context, error);
  } catch (e) {
    console.error(
      "[run-pipeline] telegram alert failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

/** Fire the ship-stage budget alert but never let alerting failures fail a completed run. */
async function safeBudgetAlert(context: string, message: string): Promise<void> {
  try {
    await alertBudget(context, message);
  } catch (e) {
    console.error(
      "[run-pipeline] telegram budget alert failed:",
      e instanceof Error ? e.message : e,
    );
  }
}
