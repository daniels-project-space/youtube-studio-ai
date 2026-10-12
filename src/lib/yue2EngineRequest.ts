import { canonicalJson } from "./canonicalJson";
import { sha256Hex } from "./sha256";
import { createYuE2AcceptedArrangementRequest } from "./yue2Evaluation";
import { StudioYuE2ScoredRequestSchema, YuE2EngineSourceConfigSchema } from "@/engine/studioYuE2EngineSource";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS } from "./studioRenderEngineWorkflows";

/** Direction and score stay composer-owned; Engine receives their exact frozen bytes. */
export function createYuE2EngineRequest(arrangement: unknown, params: unknown) {
  const config = YuE2EngineSourceConfigSchema.parse(params);
  const request = createYuE2AcceptedArrangementRequest({ arrangement, seed: config.seed, personalCreatorAcknowledged: config.personalCreatorAcknowledged });
  const abc = request.acceptedArrangement.symbolicScore;
  if (!abc || !request.acceptedArrangement.reviewContext || request.job.schema_version !== 2) {
    throw new Error("Engine YuE2 requires the accepted score and retained channel review context");
  }
  const safeText = (text: string, max: number) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text) && Buffer.byteLength(text) <= max;
  if (!safeText(abc, 48000) || !safeText(request.job.style, 12000)) throw new Error("Engine YuE2 score/style exceeds its exact UTF-8 contract");
  const key = `studio-yue2-scored-${sha256Hex(canonicalJson({ request, config }))}`;
  const native = StudioYuE2ScoredRequestSchema.parse({
    version: 2, idempotencyKey: key, sourceId: request.job.job_id,
    profileRevisionSha256: STUDIO_ENGINE_AUDIO_WORKFLOWS.yue2.profileRevisionSha256,
    lyrics: "", style: request.job.style, seed: config.seed, maxAudioSeconds: 300, maxCostUsd: config.maxCostUsd,
    abc, abcSha256: sha256Hex(abc), sourceConstraints: { provider: "openrelay", gpuModel: "RTX 3090",
      maxCostUsd: config.maxCostUsd, maxExecutionSeconds: config.maxExecutionSeconds },
    output: { contentType: "audio/wav", sampleRateHz: 48000, channels: 2, sampleFormat: "float32" },
  });
  return { request, native, config };
}
