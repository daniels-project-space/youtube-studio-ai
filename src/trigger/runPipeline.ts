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
import { task, idempotencyKeys } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline, preflight } from "@/engine/validate";
import {
  assertPipelineMatchesContentLane,
  injectContentLaneIntoPipeline,
  resolveContentLane,
} from "@/engine/contentLane";
import {
  compilePipeline,
  completePipelineForPolicy,
  materializeRuntimePipelineParams,
} from "@/engine/pipelineCompiler";
import { runPipeline as runEngine } from "@/engine/runner";
import { renderBlockTask } from "@/trigger/render-block";
import { planHeal } from "@/engine/healer";
import { makeConvexSink } from "@/engine/convexSink";
import { makeRunLogSink, teeLog } from "@/engine/runLogSink";
import { channelPrefix } from "@/lib/storage";
import { alertFailure } from "@/lib/telegram";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { rehydrateOutputs } from "@/lib/rehydrate";
import type { PipelineEntry } from "@/engine/types";
import { throwForTaskRetryPolicy } from "@/trigger/taskRetryPolicy";
import {
  assertScheduledPlanPayloadMatches,
  scheduledPlanSeed,
  type ScheduledPlanRunPayload,
} from "@/lib/scheduledPlanRuntime";
import { assertRunPipelineAdmission } from "@/lib/runPipelineAdmission";
import {
  assertPipelineInvocationCompilation,
  normalizePipelineInvocationSnapshot,
  snapshotParamsByBlock,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
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

export interface RunPipelineInput {
  channelId: string;
  runId: string;
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
    musicKey?: string;
  };
}

export const runPipelineTask = task({
  id: "run-pipeline",
  // P1→P2 SPLIT: the memory-heavy render (timeline_assemble) now runs on a
  // large-2x CHILD task (render-block); this orchestrator runs every other block
  // (LLM/TTS/footage/idle waits) and SUSPENDS during the render. So it no longer
  // pays the large-2x rate to sit idle ~50% of the run waiting on external APIs.
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
    // CRITICAL-KEY GATE: without the core model keys every creative block falls
    // back to generic output (the "basic and stale" failure mode). Fail the run
    // at minute 0 instead of silently producing a degraded video.
    try {
      await bootstrapSecrets(
        (m, x) => console.log(`[run-pipeline] ${m}`, x ?? ""),
        { required: ["GEMINI_API_KEY"] },
      );
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
      throwForTaskRetryPolicy(
        new Error("run-pipeline failed legacy run has no durable invocation snapshot"),
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
    if (
      (payload.moduleConfigOverride || payload.probeInvocationContext) &&
      !payload.probeAdmission
    ) {
      throwForTaskRetryPolicy(
        new Error("run-pipeline frozen probe overrides require signed inception admission"),
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
    if (payload.probeAdmission) {
      const maximumCostUsd = payload.probeAdmission.maximumCostUsd;
      if (
        !rawOverrideFingerprint ||
        !durableProbeEnvelope ||
        payload.probeAdmission.dispatchEnvelopeFingerprint !==
          durableProbeEnvelope.dispatchEnvelopeFingerprint ||
        rawOverrideFingerprint !== durableProbeEnvelope.input.overrideFingerprint ||
        !Number.isFinite(maximumCostUsd) ||
        maximumCostUsd <= 0 ||
        maximumCostUsd > 3
      ) {
        throwForTaskRetryPolicy(
          new Error("run-pipeline probe admission requires an override and a $0-$3 ceiling"),
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
    } else if (durableInvocation?.budgetAdmission || durableProbeEnvelope) {
      throwForTaskRetryPolicy(
        new Error("run-pipeline durable probe invocation requires its exact signed admission"),
      );
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
    if (!durableInvocation && payload.pipelineOverride) {
      console.log(`[run-pipeline] using one-off pipelineOverride (${entries.length} blocks) — channel config untouched`);
    }

    // (Idempotency for the render CHILD is created at dispatch time inside
    // runRemoteBlock — it must vary per HEAL cycle, since a superseded render
    // must genuinely re-run while a plain orchestrator retry must reattach.)

    const leaseOwner = ctx.run.id;
    try {
      const lease = await convex.mutation(api.runs.claimExecutionLease, {
        ownerId,
        channelId: payload.channelId as Id<"channels">,
        runId: payload.runId as Id<"runs">,
        leaseOwner,
        now: Date.now(),
      });
      console.log(
        `[run-pipeline] execution lease claimed (attempt ${lease.executionAttempts}, expires ${new Date(lease.leaseExpiresAt).toISOString()})`,
      );
    } catch (error) {
      throwForTaskRetryPolicy(error);
    }

    // Live log sink — tees every ctx.log line into the runLogs table so the
    // run detail page can stream a console. Best-effort: never crashes the run.
    const logSink = makeRunLogSink(convex, ownerId, payload.runId);
    const log = teeLog(logSink, (msg, extra) =>
      console.log(`[run-pipeline] ${msg}`, extra ?? ""),
    );
    let scheduledPlan: ScheduledPlanRunPayload | undefined;
    let observedCostTotal = Number(durableRun.costTotal ?? 0);

    try {
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
        // retry never reads these mutable settings again.
        try {
          const moduleConfig = payload.moduleConfigOverride ??
            (channel as { moduleConfig?: Record<string, Record<string, unknown>> }).moduleConfig ?? {};
          if (Object.keys(moduleConfig).length) {
            const { moduleSurface } = await import("@/engine/moduleRegistry");
            const { resolveKnobs } = await import("@/engine/customization");
            for (const [blockId, cfg] of Object.entries(moduleConfig)) {
              if (!cfg || typeof cfg !== "object") continue;
              const { preset, ...overrides } = cfg as { preset?: string } & Record<string, unknown>;
              const surface = moduleSurface(blockId);
              let values: Record<string, unknown> = overrides;
              if (surface) {
                const r = resolveKnobs(surface, preset, overrides as Parameters<typeof resolveKnobs>[2]);
                if (!r.ok) {
                  log(`moduleConfig[${blockId}] SKIPPED (invalid: ${r.errors.join("; ")})`);
                  continue;
                }
                const chosen = new Set([
                  ...(preset ? Object.keys(surface.presets[preset] ?? {}) : []),
                  ...Object.keys(overrides),
                ]);
                values = Object.fromEntries(
                  Object.entries(r.values as Record<string, unknown>).filter(([k]) => chosen.has(k)),
                );
              }
              firstParams[blockId] = { ...(firstParams[blockId] ?? {}), ...values };
              log(`moduleConfig[${blockId}] applied to runtime params (${Object.keys(values).length} knob(s)${preset ? `, preset ${preset}` : ""})`);
            }
          }
        } catch (e) {
          log(`moduleConfig runtime merge failed (defaults kept): ${e instanceof Error ? e.message : e}`);
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
      }

      assertPipelineMatchesContentLane(contentLane, entries);
      if (!durableInvocation) {
        entries = injectContentLaneIntoPipeline(entries, contentLane);
      }

      // Compile the exact frozen entries. On a retry, a changed/revoked module
      // implementation must fail closed before any stage/provider executes.
      const resolved = validatePipeline(entries);
      const compilation = compilePipeline(resolved);
      if (durableInvocation) {
        assertPipelineInvocationCompilation(durableInvocation, compilation);
      }

      let seedStore: Record<string, unknown>;
      if (durableInvocation) {
        seedStore = { ...durableInvocation.seedStore };
      } else if (payload.probeInvocationContext) {
        seedStore = structuredClone(payload.probeInvocationContext.seedStore);
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
          ...(channel.identity?.voiceId ? { voiceId: channel.identity.voiceId } : {}),
          bannedWords: channel.identity?.bannedWords ?? [],
          ...(channel.identity?.imageKey ? { channelAvatarKey: channel.identity.imageKey } : {}),
          ...((channel as { scriptPlaybook?: unknown }).scriptPlaybook
            ? { scriptPlaybook: (channel as { scriptPlaybook?: unknown }).scriptPlaybook }
            : {}),
          styleDNA: (channel as { styleDNA?: unknown }).styleDNA ?? null,
          qualityBar: (channel as { qaRubric?: unknown }).qaRubric ?? null,
          contentLane,
          ...(scheduledPlan ? scheduledPlanSeed(scheduledPlan) : {}),
        };
        if (payload.reuse) {
          if (payload.reuse.topic) seedStore["reuseTopic"] = payload.reuse.topic;
          if (payload.reuse.script) seedStore["reuseScript"] = payload.reuse.script;
          if (payload.reuse.footageKeys?.length) seedStore["reuseFootageKeys"] = payload.reuse.footageKeys;
          if (payload.reuse.musicKey) seedStore["reuseMusicKey"] = payload.reuse.musicKey;
          if (payload.reuse.language) seedStore["reuseLanguage"] = payload.reuse.language;
          log(`run-pipeline: render-group REUSE active (lang=${payload.reuse.language}, ${payload.reuse.footageKeys?.length ?? 0} clips)`);
        }
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
          ? channelInceptionProbeEffectiveBudgetUsd(
              payload.probeInvocationContext!,
              probeBudgetAdmission.maximumCostUsd,
            )
          : channel.budget ?? 0,
        keyPrefix: payload.probeInvocationContext?.keyPrefix ?? channelPrefix(ownerId, channel.slug),
        remoteBlocks: ["timeline_assemble"],
        defaultRetries: 2,
        compilationFingerprint: compilation.fingerprint,
        compilationPolicyId: compilation.policyId,
        compilationPolicyVersion: compilation.policyVersion,
        compilationModules: compilation.modules,
        compilationCapabilities: compilation.capabilities,
        reservedMaxCostUsd: compilation.reservedMaxCostUsd,
        ...(probeBudgetAdmission ? { budgetAdmission: probeBudgetAdmission } : {}),
      });
      preflight(resolved, { budgetUsd: invocationCandidate.budgetUsd });
      const invocationSha256 = pipelineInvocationSha256(invocationCandidate);
      const claimedInvocation = await convex.mutation(api.runs.claimInvocationSnapshot, {
        ownerId,
        channelId: payload.channelId as Id<"channels">,
        runId: payload.runId as Id<"runs">,
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

      const sink = makeConvexSink(convex, ownerId);
      // Declared BEFORE engineOpts so runRemoteBlock's closure can key the
      // child-task idempotency on the CURRENT heal cycle.
      let heals = 0;
      const engineOpts = {
        ownerId,
        runId: payload.runId,
        channelId: payload.channelId,
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
        defaultRetries: invocation.defaultRetries,
        rehydrate: (block: string, outputs: Record<string, unknown>) =>
          rehydrateOutputs(block, outputs, payload.runId),
        // P1→P2 SPLIT: run the memory-heavy render on a large-2x child task so
        // this orchestrator (large-1x) suspends — unbilled — during the render
        // instead of paying the big-machine rate to wait on external APIs.
        remoteBlocks: new Set(invocation.remoteBlocks),
        runRemoteBlock: async (blockId: string, params: Record<string, unknown>) => {
          // Same run + block + heal cycle → same child run: a retried
          // orchestrator REATTACHES to the finished render (no double large-2x
          // spend), while a self-heal (heals++) mints a fresh key so the
          // superseded render genuinely re-runs.
          const idemKey = await idempotencyKeys.create(`${payload.runId}:${blockId}:h${heals}`);
          const res = await renderBlockTask.triggerAndWait(
            {
              runId: payload.runId,
              ownerId,
              channelId: payload.channelId,
              keyPrefix: invocation.keyPrefix,
              blockId,
              params,
              budgetUsd: invocation.budgetUsd,
              seedStore,
            },
            { idempotencyKey: idemKey },
          );
          if (!res.ok) {
            throw new Error(`render-block child failed: ${JSON.stringify(res.error)?.slice(0, 300)}`);
          }
          return (res.output as { patch: Record<string, unknown> }).patch;
        },
      };
      await convex.mutation(api.runs.heartbeatExecutionLease, {
        ownerId,
        channelId: payload.channelId as Id<"channels">,
        runId: payload.runId as Id<"runs">,
        leaseOwner,
        now: Date.now(),
      });
      let result = await runEngine(resolved, { ...engineOpts, seedStore });
      observedCostTotal = result.costTotal;

      // SELF-HEALER (Pipeline Doctor, run-level): a QA failure over a defect a
      // cheap block owns must not discard the run's paid artifacts. Diagnose →
      // supersede exactly the owning block + its downstream consumers → resume
      // (everything else restores from the stage cache). Max 2 heals; unknown
      // or unhealable failures fall through and fail honestly.
      const MAX_HEALS = 2;
      const healable = resolved.blocks.map((b) => ({
        id: b.id,
        produces: b.produces,
        consumes: b.consumes,
        paid: (b as { paid?: boolean }).paid,
      }));
      while (!result.ok && heals < MAX_HEALS) {
        const plan = planHeal(result.error ?? "", healable, (m) => log(m));
        if (!plan) break;
        heals++;
        log(
          `SELF-HEAL ${heals}/${MAX_HEALS}: ${plan.reason} — superseding [${plan.rerunBlocks.join(", ")}] and resuming from the stage cache`,
        );
        await safeAlert(
          `self-heal ${heals} (${channel.slug})`,
          `${plan.reason} → re-running ${plan.rerunBlocks.length} block(s), paid artifacts preserved`,
        );
        for (const b of plan.rerunBlocks) {
          await convex.mutation(api.runStages.upsertRunStage, {
            ownerId,
            runId: payload.runId as Id<"runs">,
            block: b,
            status: "superseded",
            error: `superseded by self-heal #${heals}: ${plan.reason}`,
          });
        }
        await convex.mutation(api.runs.heartbeatExecutionLease, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          runId: payload.runId as Id<"runs">,
          leaseOwner,
          now: Date.now(),
        });
        result = await runEngine(resolved, {
          ...engineOpts,
          seedStore: { ...seedStore, healHints: plan.hints, healAttempt: heals },
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
        const failedAt = Date.now();
        if (scheduledPlan) {
          await convex.mutation(api.contentPlan.failClaimedPlanRun, {
            ownerId,
            channelId: payload.channelId as Id<"channels">,
            itemId: scheduledPlan.planItemId as Id<"contentPlan">,
            runId: payload.runId as Id<"runs">,
            failedAt,
            costTotal: result.costTotal,
            error: result.error ?? "unknown pipeline failure",
          });
        } else {
          await convex.mutation(api.runs.updateRun, {
            runId: payload.runId as Id<"runs">,
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

      const finishedAt = Date.now();
      if (scheduledPlan) {
        await convex.mutation(api.contentPlan.completeClaimedPlanRun, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          itemId: scheduledPlan.planItemId as Id<"contentPlan">,
          runId: payload.runId as Id<"runs">,
          finishedAt,
          costTotal: result.costTotal,
        });
      } else {
        await convex.mutation(api.runs.completeRun, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          runId: payload.runId as Id<"runs">,
          finishedAt,
          costTotal: result.costTotal,
        });
      }
      // This should be unreachable for declared provider envelopes because
      // preflight reserves the worst case before execution. Keep the alert as
      // a second rail for a provider returning a charge above its contract.
      if (result.costTotal > invocation.budgetUsd) {
        await safeAlert(
          `budget exceeded (${channel.slug})`,
          `run cost $${result.costTotal.toFixed(2)} > budget $${invocation.budgetUsd.toFixed(2)}`,
        );
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
      const failedAt = Date.now();
      if (scheduledPlan) {
        await convex.mutation(api.contentPlan.failClaimedPlanRun, {
          ownerId,
          channelId: payload.channelId as Id<"channels">,
          itemId: scheduledPlan.planItemId as Id<"contentPlan">,
          runId: payload.runId as Id<"runs">,
          failedAt,
          costTotal: observedCostTotal,
          error: message,
        });
      } else {
        await convex.mutation(api.runs.updateRun, {
          runId: payload.runId as Id<"runs">,
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
