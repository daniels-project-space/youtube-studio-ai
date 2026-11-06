import { YuE2SourceConfigSchema as config, YuE2HyperSourceConfigSchema } from "@/engine/yue2SourceConfig";
import { wait } from "@trigger.dev/sdk/v3";
import { AcceptedMusicArrangementSchema } from "@/engine/acceptedMusicArrangement";
import { YuE2MusicCandidateSchema } from "@/engine/yue2MusicCandidate";
import { ExecutionError } from "@/engine/executionErrors";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { COST_PATCH_KEY, type Block } from "@/engine/types";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { canonicalJson } from "@/lib/canonicalJson";
import { createYuE2AcceptedArrangementRequest, YuE2EvaluationError } from "@/lib/yue2Evaluation";
import { executeDurableYuE2Evaluation, readDurableYuE2Candidate, validateDurableYuE2Evaluation } from "@/lib/yue2DurableEvaluation";
import { musicProgramForCurrentRoute } from "./blockContext";
import { renderHyperYoutubeYue, readHyperYoutubeYue } from "@/lib/hyperYoutubeYue";

export const YUE2_MUSIC_CANDIDATE_VERSION = "3.0.0-yue2-candidate";
export const HRS_YUE2_MUSIC_CANDIDATE_VERSION = "4.0.0-yue2-hrs";

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
    const program = musicProgramForCurrentRoute(ctx, String(ctx.store["topic"]));
    if (program && program.audio.providerPreference !== "yue2") {
      throw new Error("YuE2 music requires a sealed YuE2 program; a legacy provider choice cannot be overwritten");
    }
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
      if (error instanceof YuE2EvaluationError && error.code === "worker_rejected_invalid_job") {
        throw new ExecutionError("PAID_STAGE_RECONCILIATION_REQUIRED: YuE2 worker rejected the frozen score/request before queue admission; review inputs explicitly, same-job retries cannot repair this refusal",
          { code: "PAID_STAGE_RECONCILIATION_REQUIRED", retryable: false });
      }
      throw hold("source execution or retained verification requires reconciliation", charge);
    }
  },
};

/** Explicit shared-module source version; no old provider, assembly or release fallback. */
export function createYuE2MusicManifest() {
  const manifest = manifestFromBlock(block, {
    version: block.version,
    capabilities: ["audio.music_candidate"], requiredCapabilities: ["music.arrangement.accepted"],
    optionalConsumes: ["channelProgramRoute", "musicProgramPlan"],
    providerProfiles: [{ id: "yue2-native-v1", provider: "openrelay", quality: "production", allowFallback: false }],
    maxCostUsd: 1, maxCostUsdFor: params => config.parse(params).maxCostUsd, maxLatencySec: 1800,
    certification: "contract", qualityRequired: true,
    certificationEvidence: "Opt-in native source generation/recovery and private candidate handoff; not musical or production qualification.",
  });
  return { ...manifest, configSchema: config, retryAndResume: { retryable: false, durableCheckpoint: true } };
}

/** Project-scoped HRS source; the existing audition and assembly remain mandatory. */
export function createHyperYuE2MusicManifest() {
  const hyperConfig=YuE2HyperSourceConfigSchema;
  const hyperBlock:Block & {version:string}={id:"music",version:HRS_YUE2_MUSIC_CANDIDATE_VERSION,
    consumes:["topic","acceptedMusicArrangement"],produces:["yue2MusicCandidate"],paid:true,run:async ctx=>{
      const params=hyperConfig.parse(ctx.params),arrangement=AcceptedMusicArrangementSchema.parse(ctx.store["acceptedMusicArrangement"]);
      const program=musicProgramForCurrentRoute(ctx,String(ctx.store["topic"]));
      if ((program && program.audio.providerPreference!=="yue2") || arrangement.ownerId!==ctx.ownerId ||
          arrangement.channelId!==ctx.channelId || arrangement.runId!==ctx.runId || arrangement.topic!==ctx.store["topic"] ||
          !arrangement.symbolicScore || !arrangement.reviewContext || !ctx.assertInlinePaidExecutionLease)
        throw new Error("HRS YuE requires the current run's accepted YuE arrangement, score and execution authority");
      await bootstrapSecrets(()=>undefined,{services:["cloudflare"],required:["R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_BUCKET"]});
      const rendered=await renderHyperYoutubeYue({ownerId:ctx.ownerId,channelId:String(ctx.channelId),runId:ctx.runId,
        arrangement,seed:params.seed,authorize:ctx.assertInlinePaidExecutionLease,wait:async(jobId,index)=>{
          await wait.for({seconds:10,idempotencyKey:`hrs-yue:${jobId}:${index}`});
        }});
      const material=await readHyperYoutubeYue({ownerId:ctx.ownerId,channelId:String(ctx.channelId),runId:ctx.runId});
      if (!material || material.candidateSha256!==rendered.candidateSha256 ||
          material.request.acceptedArrangement.fingerprint!==arrangement.fingerprint)
        throw new Error("HRS YuE retained source evidence does not match the accepted arrangement");
      return {yue2MusicCandidate:YuE2MusicCandidateSchema.parse({version:"shared-yue2-music-candidate/v2-hrs",
        ownerId:ctx.ownerId,channelId:ctx.channelId,runId:ctx.runId,arrangementFingerprint:arrangement.fingerprint,
        jobId:material.candidate.jobId,candidateSha256:material.candidateSha256,candidateKey:rendered.candidateKey,
        listeningAudioKey:material.listeningAudioKey,listeningAudioSha256:material.candidate.audioSha256,
        nativeFrames:material.candidate.nativeOutput.frames,sampleRateHz:48000,channels:2,technicalStatus:material.quality.status,
        allocatedCostUsdMicros:null,costBasis:"unreported",providerBilledCostUsdMicros:null,productionApproved:false})};
    }};
  const manifest=manifestFromBlock(hyperBlock,{version:hyperBlock.version,capabilities:["audio.music_candidate"],
    requiredCapabilities:["music.arrangement.accepted"],optionalConsumes:["channelProgramRoute","musicProgramPlan"],
    providerProfiles:[{id:"yue2-native-v1",provider:"hyper",quality:"production",allowFallback:false}],
    // The GPU is prepaid and HRS imposes no per-job allocation limit. This
    // zero is the incremental reservation for the compiler, not a billed cost.
    maxCostUsd:0,maxLatencySec:7200,certification:"contract",qualityRequired:true,
    certificationEvidence:"HRS project-scoped source receipt; owner audition and native output verification remain required."});
  return {...manifest,configSchema:hyperConfig,retryAndResume:{retryable:false,durableCheckpoint:true}};
}
