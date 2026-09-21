import { z } from "zod";
import { wait } from "@trigger.dev/sdk/v3";
import { AcceptedMusicArrangementSchema } from "@/engine/acceptedMusicArrangement";
import { YuE2MusicCandidateSchema } from "@/engine/yue2MusicCandidate";
import { ExecutionError } from "@/engine/executionErrors";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { COST_PATCH_KEY, type Block } from "@/engine/types";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { canonicalJson } from "@/lib/canonicalJson";
import { createYuE2AcceptedArrangementRequest } from "@/lib/yue2Evaluation";
import { validateYuE2ExecutionPolicy } from "@/lib/yue2ExecutionAccounting";
import { executeDurableYuE2Evaluation, readDurableYuE2Candidate, validateDurableYuE2Evaluation } from "@/lib/yue2DurableEvaluation";

export const YUE2_MUSIC_CANDIDATE_VERSION = "3.0.0-yue2-candidate";
const config = z.object({
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  personalCreatorAcknowledged: z.literal(true),
  maxCostUsd: z.number().finite().positive().max(1),
  executionPolicy: z.unknown().transform(value => validateYuE2ExecutionPolicy(value)),
}).strict().superRefine((value, ctx) => {
  if (value.executionPolicy.reserved_allocation_usd_micros > Math.floor(value.maxCostUsd * 1_000_000) ||
    value.executionPolicy.max_execution_seconds > 1200) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "YuE2 policy exceeds the explicit stage allocation or 1200-second execution window" });
  }
});

function hold(reason: string, charge?: number): Error {
  return Object.assign(new ExecutionError(`PAID_STAGE_RECONCILIATION_REQUIRED: YuE2 ${reason}; recover the same job, never regenerate`,
    { code: "PAID_STAGE_RECONCILIATION_REQUIRED", retryable: false }),
  charge === undefined ? {} : { additionalObservedCostUsd: charge });
}

const block: Block & { version: string } = {
  id: "music", version: YUE2_MUSIC_CANDIDATE_VERSION,
  consumes: ["topic", "acceptedMusicArrangement"], produces: ["yue2MusicCandidate"], paid: true,
  run: async ctx => {
    const params = config.parse(ctx.params);
    const arrangement = AcceptedMusicArrangementSchema.parse(ctx.store["acceptedMusicArrangement"]);
    if (arrangement.ownerId !== ctx.ownerId || arrangement.channelId !== ctx.channelId ||
      arrangement.runId !== ctx.runId || arrangement.topic !== ctx.store["topic"] ||
      !arrangement.symbolicScore || !arrangement.reviewContext) {
      throw new Error("YuE2 music requires the current run's scored arrangement and retained channel context");
    }
    if (!Number.isFinite(ctx.budgetUsd) || ctx.budgetUsd < params.maxCostUsd ||
      !Number.isFinite(ctx.stageBudgetUsd) || ctx.stageBudgetUsd! < params.maxCostUsd || !ctx.assertInlinePaidExecutionLease) {
      throw new Error("YuE2 music requires a finite run/stage reservation and active execution authority");
    }
    const request = createYuE2AcceptedArrangementRequest({ arrangement, seed: params.seed, personalCreatorAcknowledged: true });
    const input = {
      request, endpoint: process.env.YUE2_EVALUATION_URL ?? "", bearerToken: process.env.YUE2_EVALUATION_TOKEN ?? "",
      expectedExecutionPolicy: params.executionPolicy,
      authorizeSubmission: ctx.assertInlinePaidExecutionLease,
    };
    validateDurableYuE2Evaluation(input);
    await bootstrapSecrets(() => undefined, { services: ["cloudflare"], required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] });
    let charge: number | undefined;
    try {
      let result = await executeDurableYuE2Evaluation(input);
      const checks = Math.ceil((params.executionPolicy.max_execution_seconds + params.executionPolicy.termination_grace_seconds) / 120) + 2;
      for (let index = 0; result.status === "pending" && index < checks; index++) {
        ctx.log(`music: YuE2 source ${result.jobId} pending; recovering the same job`);
        await wait.for({ seconds: 120, idempotencyKey: `${request.job.job_id}:music-source-wait:${index}` });
        result = await executeDurableYuE2Evaluation({ ...input, recoverOnly: true });
      }
      if (result.status === "held") charge = result.executionAccounting.allocatedCostUsdMicros / 1_000_000;
      if (result.status !== "completed") throw hold(result.status, charge);
      if (result.candidate.version !== "studio-yue2-durable-candidate/v2") throw hold("missing supervised accounting");
      charge = result.candidate.executionAccounting.allocatedCostUsdMicros / 1_000_000;
      const material = await readDurableYuE2Candidate({ ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId });
      if (!material || canonicalJson(material.request) !== canonicalJson(request) ||
        canonicalJson(material.candidate) !== canonicalJson(result.candidate) || charge > params.maxCostUsd) {
        throw hold("candidate, request or allocation mismatch", charge);
      }
      const candidate = material.candidate;
      const yue2MusicCandidate = YuE2MusicCandidateSchema.parse({
        version: "shared-yue2-music-candidate/v1", ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId,
        arrangementFingerprint: arrangement.fingerprint, jobId: request.job.job_id,
        candidateSha256: material.candidateSha256, candidateKey: result.candidateKey,
        listeningAudioKey: material.listeningAudioKey,
        listeningAudioSha256: candidate.headroom?.audioSha256 ?? candidate.audioSha256,
        nativeFrames: candidate.nativeOutput.frames, sampleRateHz: 48000, channels: 2,
        technicalStatus: material.quality.status,
        allocatedCostUsdMicros: candidate.executionAccounting.allocatedCostUsdMicros,
        costBasis: "supervised_dispatch_wall_time", providerBilledCostUsdMicros: null, productionApproved: false,
      });
      ctx.log(`music: retained YuE2 candidate (${material.quality.status}); allocation estimate $${charge.toFixed(6)}, provider bill unknown`);
      return { yue2MusicCandidate, [COST_PATCH_KEY]: charge };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      throw hold("source execution or retained verification requires reconciliation", charge);
    }
  },
};

/** Explicit shared-module source version; no old provider, assembly or release fallback. */
export function createYuE2MusicManifest() {
  const manifest = manifestFromBlock(block, {
    version: block.version,
    capabilities: ["audio.music_candidate"], requiredCapabilities: ["music.arrangement.accepted"],
    providerProfiles: [{ id: "yue2-native-v1", provider: "openrelay", quality: "production", allowFallback: false }],
    maxCostUsd: 1, maxCostUsdFor: params => config.parse(params).maxCostUsd, maxLatencySec: 1800,
    certification: "contract", qualityRequired: true,
    certificationEvidence: "Opt-in native source generation/recovery and private candidate handoff; not musical or production qualification.",
  });
  return { ...manifest, configSchema: config, retryAndResume: { retryable: false, durableCheckpoint: true } };
}
