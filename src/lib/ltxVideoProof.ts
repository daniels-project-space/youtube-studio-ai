/**
 * Fail-closed evidence checks for the pinned LTX-2.5 two-stage video path.
 *
 * A rendered file is not evidence by itself. Direct workers attach the
 * completion contract and the post-render ffprobe geometry; the story block
 * accepts an artifact only when every shot carries that exact evidence.
 */
import type {
  NovitaPhaseProfile,
  NovitaVideoOutputProof,
} from "@/lib/novitaRenderFarm";

export interface LtxWorkerCompletionEvidence {
  renderContract?: unknown;
  videoOutputs?: unknown;
}

function hasExactLtxTwoStageProfile(profile: NovitaPhaseProfile): boolean {
  return profile.phase === "video"
    && profile.pipeline === "distilled"
    && profile.twoStageRefine === true
    && profile.quantization === "fp8-cast"
    && profile.offload === "cpu"
    && profile.spatialUpscaleFactor === 2
    && Number.isInteger(profile.stageOneWidth)
    && Number.isInteger(profile.stageOneHeight)
    && profile.stageOneWidth! > 0
    && profile.stageOneHeight! > 0
    && profile.width === profile.stageOneWidth! * 2
    && profile.height === profile.stageOneHeight! * 2;
}

function outputProof(value: unknown, profile: NovitaPhaseProfile): NovitaVideoOutputProof | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const proof = value as Record<string, unknown>;
  if (
    proof.outputWidth !== profile.width
    || proof.outputHeight !== profile.height
    || proof.stageOneWidth !== profile.stageOneWidth
    || proof.stageOneHeight !== profile.stageOneHeight
    || proof.spatialUpscaleFactor !== 2
    || proof.pipeline !== "distilled"
    || proof.quantization !== "fp8-cast"
    || proof.offload !== "cpu"
  ) return undefined;
  return {
    outputWidth: profile.width,
    outputHeight: profile.height,
    stageOneWidth: profile.stageOneWidth!,
    stageOneHeight: profile.stageOneHeight!,
    spatialUpscaleFactor: 2,
    pipeline: "distilled",
    quantization: "fp8-cast",
    offload: "cpu",
  };
}

function renderContractMatches(value: unknown, profile: NovitaPhaseProfile): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const contract = value as Record<string, unknown>;
  return contract.model === profile.model
    && contract.revision === profile.revision
    && contract.checkpoint === profile.checkpoint
    && contract.precision === profile.precision
    && contract.pipeline === "distilled"
    && contract.twoStageRefine === true
    && contract.textEncoderCheckpoint === profile.textEncoderCheckpoint
    && contract.videoVaeCheckpoint === profile.videoVaeCheckpoint
    && contract.audioVaeCheckpoint === profile.audioVaeCheckpoint
    && contract.spatialUpscalerCheckpoint === profile.spatialUpscalerCheckpoint
    && contract.quantization === "fp8-cast"
    && contract.offload === "cpu"
    && contract.spatialUpscaleFactor === 2
    && contract.stageOneWidth === profile.stageOneWidth
    && contract.stageOneHeight === profile.stageOneHeight
    && contract.outputWidth === profile.width
    && contract.outputHeight === profile.height;
}

function requireExactProfile(profile: NovitaPhaseProfile): void {
  if (!hasExactLtxTwoStageProfile(profile)) {
    throw new Error("does not carry the exact LTX-2.5 2x proof profile");
  }
}

/**
 * Accept one direct-worker completion only after its sealed runtime contract
 * and one worker-observed ffprobe proof match the requested two-stage profile.
 */
export function assertLtxWorkerCompletionEvidence(args: {
  profile: NovitaPhaseProfile;
  jobId: string;
  completion: LtxWorkerCompletionEvidence;
}): NovitaVideoOutputProof {
  const { profile, jobId, completion } = args;
  requireExactProfile(profile);
  if (!renderContractMatches(completion.renderContract, profile)) {
    throw new Error("did not attest the sealed LTX-2.5 runtime contract");
  }
  const outputs = completion.videoOutputs;
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) {
    throw new Error("omitted its ffprobe video output evidence");
  }
  const entries = outputs as Record<string, unknown>;
  const proof = outputProof(entries[jobId], profile);
  if (!proof || Object.keys(entries).length !== 1) {
    throw new Error("returned invalid LTX x2 output evidence");
  }
  return proof;
}

/**
 * Require exactly one valid ffprobe/x2 proof for each accepted story shot.
 * The returned record is normalized from the pinned profile rather than
 * forwarding worker-controlled values downstream.
 */
export function assertLtxVideoOutputProofSet(args: {
  profile: NovitaPhaseProfile;
  shotIds: readonly string[];
  proofs: unknown;
}): Record<string, NovitaVideoOutputProof> {
  const { profile, shotIds, proofs } = args;
  requireExactProfile(profile);
  if (!proofs || typeof proofs !== "object" || Array.isArray(proofs)) {
    throw new Error("returned no worker-observed LTX x2 output proof");
  }
  const expected = new Set(shotIds);
  if (expected.size !== shotIds.length) {
    throw new Error("contains duplicate shot identifiers");
  }
  const received = proofs as Record<string, unknown>;
  const proofIds = Object.keys(received);
  if (proofIds.length !== expected.size || proofIds.some((shotId) => !expected.has(shotId))) {
    throw new Error("returned stale, duplicate, or unexpected LTX x2 output proofs");
  }
  const normalized: Record<string, NovitaVideoOutputProof> = {};
  for (const shotId of shotIds) {
    const proof = outputProof(received[shotId], profile);
    if (!proof) {
      throw new Error(`x2 output proof does not match the pinned profile for ${shotId}`);
    }
    normalized[shotId] = proof;
  }
  return normalized;
}
