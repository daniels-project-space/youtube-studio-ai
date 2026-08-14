import assert from "node:assert/strict";

import { generationProfile } from "@/engine/generationProfiles";
import {
  assertLtxVideoOutputProofSet,
  assertLtxWorkerCompletionEvidence,
} from "@/lib/ltxVideoProof";
import {
  toNovitaPhaseProfile,
  waitForBridgeRender,
  type NovitaBridgeStatus,
  type NovitaPhaseProfile,
  type NovitaRenderLaunch,
} from "@/lib/novitaRenderFarm";

const profile = toNovitaPhaseProfile(generationProfile("production"), "video");
const shotId = "shot-01";
const jobId = "video-0123456789abcdef0123456789abcdef";
const prefix = "proof-test";
const outputPrefix = `videocraft/${prefix}/${jobId}/shots`;

function contractFor(value: NovitaPhaseProfile = profile): Record<string, unknown> {
  return {
    model: value.model,
    revision: value.revision,
    checkpoint: value.checkpoint,
    precision: value.precision,
    pipeline: value.pipeline,
    twoStageRefine: value.twoStageRefine,
    textEncoderCheckpoint: value.textEncoderCheckpoint,
    videoVaeCheckpoint: value.videoVaeCheckpoint,
    audioVaeCheckpoint: value.audioVaeCheckpoint,
    spatialUpscalerCheckpoint: value.spatialUpscalerCheckpoint,
    quantization: value.quantization,
    offload: value.offload,
    spatialUpscaleFactor: value.spatialUpscaleFactor,
    stageOneWidth: value.stageOneWidth,
    stageOneHeight: value.stageOneHeight,
    outputWidth: value.width,
    outputHeight: value.height,
  };
}

function proofFor(value: NovitaPhaseProfile = profile): Record<string, unknown> {
  return {
    outputWidth: value.width,
    outputHeight: value.height,
    stageOneWidth: value.stageOneWidth,
    stageOneHeight: value.stageOneHeight,
    spatialUpscaleFactor: 2,
    pipeline: "distilled",
    quantization: "fp8-cast",
    offload: "cpu",
  };
}

function launch(): NovitaRenderLaunch {
  return {
    jobId,
    phase: "video",
    prefix,
    expectedJobIds: [shotId],
    profile,
    profileSha256: "a".repeat(64),
    requestSha256: "b".repeat(64),
    requestCanonicalJson: "{}",
    nshard: 1,
    maxCostUsd: 1,
  };
}

function statusFor(): NovitaBridgeStatus {
  return {
    ok: true,
    jobId,
    phase: "video",
    status: "done",
    outputs: [`${outputPrefix}/${shotId}.mp4`],
    n_outputs: 1,
    n_jobs: 1,
    outputPrefix,
    expectedKeys: [`${outputPrefix}/${shotId}.mp4`],
    missingKeys: [],
    failedIds: [],
    footageKeys: [`${outputPrefix}/${shotId}.mp4`],
    footageClips: [],
    profile,
    profileSha256: "a".repeat(64),
    manifestSha256: "c".repeat(64),
    requestSha256: "b".repeat(64),
    runtimeAttestation: {
      provider: "novita",
      capacityMode: "spot",
      weightStorage: "local-persistent-disk",
      cacheMount: "/workspace/model-cache",
      checkpointing: true,
      idleShutdownSeconds: profile.infrastructure.idleShutdownSeconds,
      gpuCount: 1,
      model: profile.model,
      revision: profile.revision,
      checkpoint: profile.checkpoint,
      precision: profile.precision,
      pipeline: profile.pipeline,
      twoStageRefine: profile.twoStageRefine,
      textEncoderCheckpoint: profile.textEncoderCheckpoint,
      videoVaeCheckpoint: profile.videoVaeCheckpoint,
      audioVaeCheckpoint: profile.audioVaeCheckpoint,
      spatialUpscalerCheckpoint: profile.spatialUpscalerCheckpoint,
      quantization: profile.quantization,
      offload: profile.offload,
      spatialUpscaleFactor: profile.spatialUpscaleFactor,
      stageOneWidth: profile.stageOneWidth,
      stageOneHeight: profile.stageOneHeight,
      outputWidth: profile.width,
      outputHeight: profile.height,
    },
    billingReceipt: {
      provider: "novita",
      currency: "USD",
      receiptId: "proof-test-receipt",
      gpuSku: "RTX_4090",
      gpuCount: 1,
      gpuSeconds: 1,
      gpuRateUsdPerSecond: 0.01,
      startupUsd: 0,
      storageUsd: 0,
      costUsd: 0.01,
      costSource: "lifecycle_estimate",
    },
    billingReceiptSha256: "d".repeat(64),
    error: null,
  };
}

async function main(): Promise<void> {
  const completionProof = assertLtxWorkerCompletionEvidence({
    profile,
    jobId,
    completion: {
      gpuSku: "RTX 4090",
      gpuCount: 1,
      renderContract: contractFor(),
      videoOutputs: { [jobId]: proofFor() },
    },
  });
  assert.deepEqual(completionProof, proofFor(), "direct workers normalize only exact ffprobe/x2 proof values");

  assert.throws(
    () => assertLtxWorkerCompletionEvidence({
      profile,
      jobId,
      completion: { gpuSku: "RTX 4090", gpuCount: 1, renderContract: contractFor() },
    }),
    /omitted its ffprobe video output evidence/,
    "a completed worker cannot turn an MP4 into an accepted artifact without ffprobe evidence",
  );
  assert.throws(
    () => assertLtxWorkerCompletionEvidence({
      profile,
      jobId,
      completion: {
        gpuSku: "RTX 4090",
        gpuCount: 1,
        renderContract: contractFor(),
        videoOutputs: { [jobId]: { ...proofFor(), outputWidth: profile.width - 64 } },
      },
    }),
    /invalid LTX x2 output evidence/,
    "a mismatched observed geometry cannot pass the direct worker boundary",
  );
  assert.throws(
    () => assertLtxWorkerCompletionEvidence({
      profile,
      jobId,
      completion: {
        gpuSku: "RTX 4090",
        gpuCount: 1,
        renderContract: { ...contractFor(), spatialUpscaleFactor: 1 },
        videoOutputs: { [jobId]: proofFor() },
      },
    }),
    /sealed LTX-2.5 runtime contract/,
    "the direct worker must attest that the LTX x2 stage actually ran",
  );
  assert.throws(
    () => assertLtxWorkerCompletionEvidence({
      profile,
      jobId,
      completion: {
        gpuSku: "A100",
        gpuCount: 1,
        renderContract: contractFor(),
        videoOutputs: { [jobId]: proofFor() },
      },
    }),
    /exactly one RTX 4090 worker/,
    "the controller rejects a completion unless the data plane attests the exact physical GPU",
  );

  const outputProofs = assertLtxVideoOutputProofSet({
    profile,
    shotIds: [shotId],
    proofs: { [shotId]: proofFor() },
  });
  assert.deepEqual(outputProofs[shotId], proofFor(), "the story block receives normalized x2 evidence per accepted shot");
  assert.throws(
    () => assertLtxVideoOutputProofSet({ profile, shotIds: [shotId], proofs: undefined }),
    /no worker-observed LTX x2 output proof/,
    "the story block must reject a provider result that omits proof before writing its render manifest",
  );
  assert.throws(
    () => assertLtxVideoOutputProofSet({
      profile,
      shotIds: [shotId],
      proofs: { [shotId]: { ...proofFor(), spatialUpscaleFactor: 1 } },
    }),
    /does not match the pinned profile/,
    "the story block must reject a non-x2 proof before artifact acceptance",
  );

  const valid = await waitForBridgeRender(launch(), {
    statusReader: async () => statusFor(),
    pollWait: async () => undefined,
  });
  assert.equal(valid.runtimeAttestation.outputWidth, profile.width, "farm accepts a pinned runtime attestation with observed output geometry");

  const missingOutputGeometry = statusFor();
  delete (missingOutputGeometry.runtimeAttestation as Record<string, unknown>).outputWidth;
  await assert.rejects(
    () => waitForBridgeRender(launch(), {
      statusReader: async () => missingOutputGeometry,
      pollWait: async () => undefined,
    }),
    /did not attest the pinned Novita spot\/local-disk model contract/,
    "farm rejects a terminal status without observed ffprobe output geometry",
  );

  const wrongUpscale = statusFor();
  (wrongUpscale.runtimeAttestation as Record<string, unknown>).spatialUpscaleFactor = 1;
  await assert.rejects(
    () => waitForBridgeRender(launch(), {
      statusReader: async () => wrongUpscale,
      pollWait: async () => undefined,
    }),
    /did not attest the pinned Novita spot\/local-disk model contract/,
    "farm rejects a terminal status whose runtime attestation is not LTX x2",
  );

  console.log("LTX worker ffprobe/x2 proof tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
