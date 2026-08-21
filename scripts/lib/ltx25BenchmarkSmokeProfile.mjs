/**
 * The expensive 720p-native LTX smoke contract is deliberately isolated from
 * app generation profiles.  Importing this module is only permitted from the
 * operator benchmark script; it is not a production-render capability.
 */
export const LTX25_720P_NATIVE_X2_SMOKE = Object.freeze({
  id: "ltx25-720p-native-x2-smoke",
  stageOneWidth: 1280,
  stageOneHeight: 704,
  outputWidth: 2560,
  outputHeight: 1408,
  fps: 25,
  frames: 17,
  spatialUpscaleFactor: 2,
  quantization: "fp8-cast",
  offload: "cpu",
  maxSampledPeakVramMib: 22_000,
});

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function ltx25Native720X2SmokeImageProfile({ model, revision, infrastructure }) {
  const contract = LTX25_720P_NATIVE_X2_SMOKE;
  return {
    contractVersion: "1.0.0",
    id: contract.id,
    phase: "image",
    model,
    revision,
    checkpoint: "Z-Image-Turbo",
    width: contract.stageOneWidth,
    height: contract.stageOneHeight,
    steps: 9,
    guidanceScale: 0,
    precision: "bf16",
    candidates: 1,
    infrastructure,
    benchmarkOnly: true,
    allowFallback: false,
  };
}

export function ltx25Native720X2SmokeProfile({ model, revision, infrastructure }) {
  const contract = LTX25_720P_NATIVE_X2_SMOKE;
  return {
    contractVersion: "1.0.0",
    id: contract.id,
    phase: "video",
    model,
    revision,
    checkpoint: "ltx-2.5-22b-distilled-transformer-bf16.safetensors",
    width: contract.outputWidth,
    height: contract.outputHeight,
    steps: 8,
    guidanceScale: 1,
    precision: "bf16",
    candidates: 1,
    infrastructure,
    fps: contract.fps,
    pipeline: "distilled",
    twoStageRefine: true,
    textEncoderCheckpoint: "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
    videoVaeCheckpoint: "ltx-2.5-video-vae-bf16.safetensors",
    audioVaeCheckpoint: "ltx-2.5-audio-vae-bf16.safetensors",
    spatialUpscalerCheckpoint: "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
    quantization: contract.quantization,
    offload: contract.offload,
    spatialUpscaleFactor: contract.spatialUpscaleFactor,
    stageOneWidth: contract.stageOneWidth,
    stageOneHeight: contract.stageOneHeight,
    benchmarkOnly: true,
    maxFrames: contract.frames,
    maxSampledPeakVramMib: contract.maxSampledPeakVramMib,
    allowFallback: false,
  };
}

export function assertLtx25Native720X2SmokeJob(job) {
  const contract = LTX25_720P_NATIVE_X2_SMOKE;
  if (
    !job
    || job.width !== contract.outputWidth
    || job.height !== contract.outputHeight
    || job.steps !== 8
    || job.frames !== contract.frames
    || job.fps !== contract.fps
  ) {
    throw new Error("LTX 2.5 native-720p x2 smoke job must be exactly 2560x1408 at 17 frames / 25 fps");
  }
}

export function assertLtx25Native720X2SmokeProof(proof, sources = {}) {
  const contract = LTX25_720P_NATIVE_X2_SMOKE;
  const exactStill = (receipt, expectedSha256) => (
    receipt
    && typeof receipt === "object"
    && SHA256_HEX.test(receipt.sha256 || "")
    && (!expectedSha256 || receipt.sha256 === expectedSha256)
    && receipt.width === contract.stageOneWidth
    && receipt.height === contract.stageOneHeight
  );
  const geometry = proof?.inputGeometry;
  const initial = geometry?.initial;
  const end = geometry?.end;
  if (
    !proof
    || proof.outputWidth !== contract.outputWidth
    || proof.outputHeight !== contract.outputHeight
    || proof.stageOneWidth !== contract.stageOneWidth
    || proof.stageOneHeight !== contract.stageOneHeight
    || proof.spatialUpscaleFactor !== contract.spatialUpscaleFactor
    || proof.frameCount !== contract.frames
    || proof.frameRate !== contract.fps
    || proof.hasAudio !== true
    || !Number.isInteger(proof.sampledPeakVramMib)
    || proof.sampledPeakVramMib < 0
    || proof.sampledPeakVramMib > contract.maxSampledPeakVramMib
    || !SHA256_HEX.test(sources.initialSha256 || "")
    || !exactStill(initial, sources.initialSha256)
    || (sources.endSha256 ? !exactStill(end, sources.endSha256) : end !== undefined)
  ) {
    throw new Error("LTX 2.5 native-720p x2 smoke output proof is incomplete, has unbound input geometry, or exceeds the 22 GiB VRAM gate");
  }
}
