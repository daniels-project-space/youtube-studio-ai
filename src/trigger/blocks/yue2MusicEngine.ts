import { createHash } from "node:crypto";
import { wait } from "@trigger.dev/sdk/v3";
import { AcceptedMusicArrangementSchema } from "@/engine/acceptedMusicArrangement";
import { YuE2MusicCandidateSchema } from "@/engine/yue2MusicCandidate";
import { YuE2SourceConfigSchema as config } from "@/engine/yue2SourceConfig";
import { ExecutionError } from "@/engine/executionErrors";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { COST_PATCH_KEY, type Block } from "@/engine/types";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { materializeRenderEngineYuE2Candidate } from "@/lib/renderEngineYuE2Candidate";
import {
  getRenderEngineYuE2Job,
  getRenderEngineYuE2Output,
  provisionRenderEngineYuE2Workflow,
  stageRenderEngineYuE2Request,
  type RenderEngineYuE2Request,
} from "@/lib/renderEngineYuE2StageClient";
import { RENDER_ENGINE_STUDIO_PROJECT_NAME, RENDER_ENGINE_STUDIO_SITE } from "@/lib/renderEngineStudioProject";
import { createYuE2AcceptedArrangementRequest } from "@/lib/yue2Evaluation";
import { musicProgramForCurrentRoute } from "./blockContext";

export const RENDER_ENGINE_YUE2_MUSIC_VERSION = "4.0.0-render-engine-yue2";

function hold(reason: string, charge?: number): Error {
  return Object.assign(new ExecutionError(`PAID_STAGE_RECONCILIATION_REQUIRED: Render Engine YuE2 ${reason}; recover the same job, never regenerate`,
    { code: "PAID_STAGE_RECONCILIATION_REQUIRED", retryable: false }),
  charge === undefined ? {} : { additionalObservedCostUsd: charge });
}

const block: Block & { version: string } = {
  id: "music", version: RENDER_ENGINE_YUE2_MUSIC_VERSION,
  consumes: ["topic", "acceptedMusicArrangement"], produces: ["yue2MusicCandidate"], paid: true,
  run: async (ctx) => {
    const params = config.parse(ctx.params);
    const topic = String(ctx.store["topic"] ?? "");
    const program = musicProgramForCurrentRoute(ctx, topic);
    if (program && program.audio.providerPreference !== "yue2") {
      throw new Error("Render Engine YuE2 music requires a sealed YuE2 program; it cannot override another provider");
    }
    const arrangement = AcceptedMusicArrangementSchema.parse(ctx.store["acceptedMusicArrangement"]);
    if (arrangement.ownerId !== ctx.ownerId || arrangement.channelId !== ctx.channelId ||
        arrangement.runId !== ctx.runId || arrangement.topic !== topic || !arrangement.symbolicScore ||
        !arrangement.reviewContext) {
      throw new Error("Render Engine YuE2 requires the current run's accepted, scored arrangement and channel context");
    }
    if (!Number.isFinite(ctx.budgetUsd) || ctx.budgetUsd < params.maxCostUsd ||
        !Number.isFinite(ctx.stageBudgetUsd) || ctx.stageBudgetUsd! < params.maxCostUsd ||
        !ctx.assertInlinePaidExecutionLease) {
      throw new Error("Render Engine YuE2 requires finite run/stage budget and active paid-execution authority");
    }
    if (params.seed > 0xffff_ffff) throw new Error("Render Engine YuE2 seed must fit the pinned uint32 worker contract");
    await bootstrapSecrets(() => undefined, {
      services: ["cloudflare", "render-engine"],
      required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "RENDER_ENGINE_PROJECT_TOKEN"],
    });
    const projectCapability = process.env.RENDER_ENGINE_PROJECT_TOKEN?.trim() ?? "";
    if (!/^[a-f0-9]{64}$/u.test(projectCapability)) throw new Error("Render Engine Studio project capability is unavailable");

    const source = createYuE2AcceptedArrangementRequest({ arrangement, seed: params.seed, personalCreatorAcknowledged: true });
    const abc = arrangement.symbolicScore;
    if (!abc) throw new Error("Render Engine YuE2 requires the exact accepted ABC score");
    const projectConfig = { baseUrl: RENDER_ENGINE_STUDIO_SITE, projectName: RENDER_ENGINE_STUDIO_PROJECT_NAME, projectCapability };
    const sourceId = `studio-${createHash("sha256").update(`${ctx.ownerId}:${ctx.channelId}:${ctx.runId}:${arrangement.fingerprint}`).digest("hex")}`;
    let charge: number | undefined;
    try {
      const workflow = await provisionRenderEngineYuE2Workflow(projectConfig);
      const sourceDurationPolicy = arrangement.arrangement.playback === "repeat" ? "natural_loop" : "exact";
      const request: RenderEngineYuE2Request = {
        version: 1,
        idempotencyKey: source.job.job_id,
        sourceId,
        profileRevisionSha256: workflow.profileRevisionSha256,
        lyrics: "",
        style: source.job.style,
        seed: params.seed,
        maxAudioSeconds: Math.min(300, Math.max(60, Math.ceil(arrangement.arrangement.requestedDurationSec * 1.5))),
        maxCostUsd: params.maxCostUsd,
        abc,
        scorePolicy: "instrumental",
        sourceDurationPolicy,
        sourceConstraints: { provider: "openrelay", gpuModel: "RTX 3090" },
        output: { contentType: "audio/flac", sampleRateHz: 48_000, channels: 2 },
      };
      await ctx.assertInlinePaidExecutionLease();
      let stage = await stageRenderEngineYuE2Request({ ...projectConfig, workflowId: workflow.workflowId,
        profileRevisionSha256: workflow.profileRevisionSha256, request });
      const checks = Math.ceil((params.executionPolicy.max_execution_seconds + params.executionPolicy.termination_grace_seconds) / 120) + 2;
      let status: Record<string, unknown> | undefined;
      for (let index = 0; index <= checks; index++) {
        status = await getRenderEngineYuE2Job(projectConfig, stage.jobId);
        if (status.status === "completed") break;
        if (status.status === "failed" || status.status === "cancelled") throw hold(`job ${status.status}`, charge);
        if (index === checks) break;
        ctx.log(`music: Render Engine YuE2 job ${stage.jobId} is ${String(status.status)}; observing the same request`);
        await wait.for({ seconds: 120, idempotencyKey: `${source.job.job_id}:engine-yue2-observe:${index}` });
        if (status.status === "awaiting-final-qualification" || status.status === "queued") {
          await ctx.assertInlinePaidExecutionLease();
          stage = await stageRenderEngineYuE2Request({ ...projectConfig, workflowId: workflow.workflowId,
            profileRevisionSha256: workflow.profileRevisionSha256, request });
        }
      }
      if (!status || status.status !== "completed") throw hold("job did not reach verified completion within its frozen execution window", charge);
      const allocation = status.allocationUsage;
      if (allocation && typeof allocation === "object" && !Array.isArray(allocation) &&
          typeof (allocation as Record<string, unknown>).costUsd === "number") {
        charge = (allocation as Record<string, number>).costUsd;
      }
      const readback = await getRenderEngineYuE2Output(projectConfig, stage.jobId);
      const material = await materializeRenderEngineYuE2Candidate({
        scope: { ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId },
        programFingerprint: arrangement.fingerprint, request, acceptedArrangementRequest: source, stage, status, readback,
        projectName: RENDER_ENGINE_STUDIO_PROJECT_NAME,
      });
      charge = material.allocationCostUsd;
      const allocatedCostUsdMicros = Math.ceil(charge * 1_000_000);
      const candidate = YuE2MusicCandidateSchema.parse({
        version: "shared-yue2-music-candidate/v1", ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId,
        arrangementFingerprint: arrangement.fingerprint, jobId: source.job.job_id,
        candidateSha256: material.candidateSha256, candidateKey: material.candidateKey,
        listeningAudioKey: material.audioKey, listeningAudioSha256: material.audioSha256,
        nativeFrames: material.nativeFrames, sampleRateHz: 48_000, channels: 2,
        technicalStatus: "needs_audition", allocatedCostUsdMicros,
        costBasis: "engine-reservation-debit", providerBilledCostUsdMicros: null, productionApproved: false,
      });
      ctx.log(`music: retained Engine YuE2 candidate (${candidate.technicalStatus}); Engine allocation debit $${charge.toFixed(6)}, provider invoice unverified`);
      return { yue2MusicCandidate: candidate, [COST_PATCH_KEY]: charge };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      throw hold(error instanceof Error ? error.message : "source execution or retained verification requires reconciliation", charge);
    }
  },
};

export function createRenderEngineYuE2MusicManifest() {
  const manifest = manifestFromBlock(block, {
    version: block.version,
    capabilities: ["audio.music_candidate"], requiredCapabilities: ["music.arrangement.accepted"],
    optionalConsumes: ["channelProgramRoute", "musicProgramPlan"],
    providerProfiles: [{ id: "yue2-openrelay-engine-v1", provider: "openrelay", quality: "draft", allowFallback: false }],
    maxCostUsd: 1, maxCostUsdFor: (params) => config.parse(params).maxCostUsd, maxLatencySec: 1800,
    certification: "contract", qualityRequired: true,
    certificationEvidence: "Project-scoped Render Engine dispatch, verified native artifacts and private run-scoped candidate retention; requires separate musical audition and production qualification.",
  });
  return { ...manifest, configSchema: config, retryAndResume: { retryable: false, durableCheckpoint: true } };
}
