import { wait } from "@trigger.dev/sdk/v3";
import { YuE2SourceConfigSchema } from "@/engine/yue2SourceConfig";
import { YuE2EngineSourceConfigSchema } from "@/engine/studioYuE2EngineSource";
import { AcceptedMusicArrangementSchema } from "@/engine/acceptedMusicArrangement";
import { YuE2MusicCandidateSchema } from "@/engine/yue2MusicCandidate";
import { ExecutionError } from "@/engine/executionErrors";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { COST_PATCH_KEY, type Block } from "@/engine/types";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { canonicalJson } from "@/lib/canonicalJson";
import { readDurableYuE2Candidate } from "@/lib/yue2DurableEvaluation";
import { executeYuE2EngineSource } from "@/lib/yue2EngineSource";
import { StudioRenderEngineClient } from "@/lib/studioRenderEngineClient";
import { musicProgramForCurrentRoute } from "./blockContext";

export const YUE2_MUSIC_CANDIDATE_VERSION = "4.0.0-yue2-engine-candidate";
function hold(reason: string, charge?: number): Error {
  return Object.assign(new ExecutionError(`PAID_STAGE_RECONCILIATION_REQUIRED: YuE2 ${reason}; recover the same immutable source, never regenerate`,
    { code: "PAID_STAGE_RECONCILIATION_REQUIRED", retryable: false }), charge === undefined ? {} : { additionalObservedCostUsd: charge });
}
function currentArrangement(ctx: Parameters<Block["run"]>[0]) {
  const program = musicProgramForCurrentRoute(ctx, String(ctx.store["topic"]));
  if (program && program.audio.providerPreference !== "yue2") throw new Error("YuE2 requires the sealed channel provider choice");
  const arrangement = AcceptedMusicArrangementSchema.parse(ctx.store["acceptedMusicArrangement"]);
  if (arrangement.ownerId !== ctx.ownerId || arrangement.channelId !== ctx.channelId || arrangement.runId !== ctx.runId ||
      arrangement.topic !== ctx.store["topic"] || !arrangement.symbolicScore || !arrangement.reviewContext) throw new Error("YuE2 requires the current run's accepted score and channel context");
  return arrangement;
}
const block: Block & { version: string } = {
  id: "music", version: YUE2_MUSIC_CANDIDATE_VERSION,
  consumes: ["topic", "acceptedMusicArrangement"], produces: ["yue2MusicCandidate"], paid: true,
  run: async ctx => {
    const params = YuE2EngineSourceConfigSchema.parse(ctx.params), arrangement = currentArrangement(ctx);
    if (!Number.isFinite(ctx.budgetUsd) || ctx.budgetUsd < params.maxCostUsd ||
        !Number.isFinite(ctx.stageBudgetUsd) || ctx.stageBudgetUsd! < params.maxCostUsd || !ctx.assertInlinePaidExecutionLease) throw new Error("YuE2 Engine needs finite run/stage reservations and active authority");
    const client = new StudioRenderEngineClient(process.env.RENDER_MANAGEMENT_API_KEY ?? "");
    await bootstrapSecrets(() => undefined, { services: ["cloudflare"], required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] });
    try {
      const material = await executeYuE2EngineSource(arrangement, params, { client, authorize: ctx.assertInlinePaidExecutionLease,
        wait: async (seconds, key) => { ctx.log("music: Engine source pending; observing its original admission"); await wait.for({ seconds, idempotencyKey: key }); } });
      const c = material.candidate;
      if (canonicalJson(material.request.acceptedArrangement) !== canonicalJson(arrangement)) throw hold("accepted arrangement changed", c.usage.costUsd);
      const yue2MusicCandidate = YuE2MusicCandidateSchema.parse({ version: "shared-yue2-music-candidate/v2", ownerId: ctx.ownerId,
        channelId: ctx.channelId, runId: ctx.runId, arrangementFingerprint: arrangement.fingerprint, jobId: c.jobId,
        candidateSha256: material.candidateSha256, candidateKey: `owner/${ctx.ownerId}/runs/${ctx.runId}/music/yue2-engine/candidate.json`,
        listeningAudioKey: material.listeningAudioKey, listeningAudioSha256: c.headroom?.audioSha256 ?? c.audioSha256,
        nativeFrames: c.nativeOutput.frames, sampleRateHz: 48000, channels: 2, technicalStatus: material.quality.status,
        costUsd: c.usage.costUsd, gpuSeconds: c.usage.gpuSeconds, costBasis: c.usage.costBasis ?? "engine-reported-usage", providerInvoiceVerified: false, productionApproved: false });
      ctx.log(`music: retained Engine source (${material.quality.status}); ${c.usage.costBasis} $${c.usage.costUsd.toFixed(6)}, provider invoice not independently verified`);
      return { yue2MusicCandidate, [COST_PATCH_KEY]: c.usage.costUsd };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      throw hold("Engine generation or retained evidence requires reconciliation", (error as { additionalObservedCostUsd?: number }).additionalObservedCostUsd);
    }
  },
};
/** Historical data stays readable; this retired version cannot admit new generation. */
const legacyBlock: typeof block = { ...block, version: "3.0.0-yue2-candidate", run: async ctx => {
  YuE2SourceConfigSchema.parse(ctx.params);
  const arrangement = currentArrangement(ctx), material = await readDurableYuE2Candidate({ ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId });
  if (!material || canonicalJson(material.request.acceptedArrangement) !== canonicalJson(arrangement)) throw hold("legacy generation is retired; use a new Engine pipeline/run");
  const c = material.candidate;
  return { yue2MusicCandidate: YuE2MusicCandidateSchema.parse({ version: "shared-yue2-music-candidate/v1", ownerId: ctx.ownerId,
    channelId: ctx.channelId, runId: ctx.runId, arrangementFingerprint: arrangement.fingerprint, jobId: c.jobId,
    candidateSha256: material.candidateSha256, candidateKey: `owner/${ctx.ownerId}/runs/${ctx.runId}/music/yue2-evaluation/candidate.json`,
    listeningAudioKey: material.listeningAudioKey, listeningAudioSha256: c.headroom?.audioSha256 ?? c.audioSha256,
    nativeFrames: c.nativeOutput.frames, sampleRateHz: 48000, channels: 2, technicalStatus: material.quality.status,
    allocatedCostUsdMicros: c.executionAccounting.allocatedCostUsdMicros, costBasis: "supervised_dispatch_wall_time",
    providerBilledCostUsdMicros: null, productionApproved: false }), [COST_PATCH_KEY]: c.executionAccounting.allocatedCostUsdMicros / 1_000_000 };
} };
function manifest(source: typeof block, engine: boolean) {
  const result = manifestFromBlock(source, { version: source.version,
    capabilities: ["audio.music_candidate"], requiredCapabilities: ["music.arrangement.accepted"], optionalConsumes: ["channelProgramRoute", "musicProgramPlan"],
    providerProfiles: [{ id: engine ? "yue2-scored-engine-v2" : "yue2-historical-source", provider: "openrelay", quality: "production", allowFallback: false }],
    maxCostUsd: 1, maxCostUsdFor: params => (engine ? YuE2EngineSourceConfigSchema : YuE2SourceConfigSchema).parse(params).maxCostUsd,
    maxLatencySec: 1800, certification: "contract", qualityRequired: true,
    certificationEvidence: engine ? "Owned Engine source generation/recovery and measured private source handoff; not musical Final qualification." : "Read-only historical handoff; legacy generation retired.",
  });
  return { ...result, configSchema: engine ? YuE2EngineSourceConfigSchema : YuE2SourceConfigSchema, retryAndResume: { retryable: false, durableCheckpoint: true } };
}
export const createYuE2MusicManifest = () => manifest(block, true);
export const createLegacyYuE2MusicManifest = () => manifest(legacyBlock, false);
