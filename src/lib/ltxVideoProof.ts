/**
 * Fail-closed evidence checks for the pinned LTX-2.5 two-stage video path.
 *
 * A rendered file is not evidence by itself. Direct workers attach the
 * completion contract and the post-render ffprobe geometry; the story block
 * accepts an artifact only when every shot carries that exact evidence.
 */
import type {
  NovitaNativeInputGeometrySources,
  NovitaPhaseProfile,
  NovitaVideoInputGeometryReceipt,
  NovitaVideoOutputProof,
} from "@/lib/novitaRenderFarm";
import { requiresNative720X2CinematicProof } from "@/lib/cinematicProofAdmission";

const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Hashes from the sealed worker manifest, used to bind a native-720p geometry
 * receipt to the exact conditioning stills the worker downloaded.
 */
export type LtxNativeInputGeometrySources = NovitaNativeInputGeometrySources;

export interface LtxWorkerCompletionEvidence {
  /** Written only after the worker's local nvidia-smi attestation succeeds. */
  gpuSku?: unknown;
  gpuCount?: unknown;
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

function nativeInputGeometryProof(args: {
  value: unknown;
  profile: NovitaPhaseProfile;
  sources?: LtxNativeInputGeometrySources;
}): NovitaVideoInputGeometryReceipt | undefined {
  const { value, profile, sources } = args;
  if (!sources || !SHA256_HEX.test(sources.initialSha256) || (sources.endSha256 && !SHA256_HEX.test(sources.endSha256))) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const receipts = value as Record<string, unknown>;
  const normalize = (raw: unknown, expectedSha256: string) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const receipt = raw as Record<string, unknown>;
    if (
      receipt.sha256 !== expectedSha256
      || receipt.width !== profile.stageOneWidth
      || receipt.height !== profile.stageOneHeight
    ) return undefined;
    return {
      sha256: expectedSha256,
      width: profile.stageOneWidth!,
      height: profile.stageOneHeight!,
    };
  };
  const initial = normalize(receipts.initial, sources.initialSha256);
  if (!initial) return undefined;
  if (!sources.endSha256) {
    if (receipts.end !== undefined) return undefined;
    return { initial };
  }
  const end = normalize(receipts.end, sources.endSha256);
  return end ? { initial, end } : undefined;
}

function outputProof(
  value: unknown,
  profile: NovitaPhaseProfile,
  nativeInputGeometrySources?: LtxNativeInputGeometrySources,
): NovitaVideoOutputProof | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const proof = value as Record<string, unknown>;
  if (
    proof.outputWidth !== profile.width
    || proof.outputHeight !== profile.height
    || proof.hasAudio !== true
    || proof.stageOneWidth !== profile.stageOneWidth
    || proof.stageOneHeight !== profile.stageOneHeight
    || proof.spatialUpscaleFactor !== 2
    || proof.pipeline !== "distilled"
    || proof.quantization !== "fp8-cast"
    || proof.offload !== "cpu"
  ) return undefined;
  const nativeInputGeometry = requiresNative720X2CinematicProof(profile)
    ? nativeInputGeometryProof({
        value: proof.inputGeometry,
        profile,
        sources: nativeInputGeometrySources,
      })
    : undefined;
  if (requiresNative720X2CinematicProof(profile) && !nativeInputGeometry) return undefined;
  return {
    outputWidth: profile.width,
    outputHeight: profile.height,
    hasAudio: true,
    stageOneWidth: profile.stageOneWidth!,
    stageOneHeight: profile.stageOneHeight!,
    spatialUpscaleFactor: 2,
    pipeline: "distilled",
    quantization: "fp8-cast",
    offload: "cpu",
    ...(nativeInputGeometry ? { inputGeometry: nativeInputGeometry } : {}),
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
  /** Required only for native 1280x704 -> 2560x1408 proof normalization. */
  nativeInputGeometrySources?: LtxNativeInputGeometrySources;
}): NovitaVideoOutputProof {
  const { profile, jobId, completion, nativeInputGeometrySources } = args;
  requireExactProfile(profile);
  // The worker independently checks the physical device with nvidia-smi before
  // it writes this receipt. Do not accept a correctly shaped MP4 if that
  // hardware attestation was omitted or changed on its way back to the control
  // plane; the exact RTX 4090 contract is part of video admission.
  if (completion.gpuSku !== "RTX 4090" || completion.gpuCount !== 1) {
    throw new Error("did not attest exactly one RTX 4090 worker");
  }
  if (!renderContractMatches(completion.renderContract, profile)) {
    throw new Error("did not attest the sealed LTX-2.5 runtime contract");
  }
  const outputs = completion.videoOutputs;
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) {
    throw new Error("omitted its ffprobe video output evidence");
  }
  const entries = outputs as Record<string, unknown>;
  const proof = outputProof(entries[jobId], profile, nativeInputGeometrySources);
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
  /**
   * Future native-720p callers must carry the sealed source hashes per shot;
   * ordinary 640x352 -> 1280x704 proof sets deliberately need no migration.
   */
  nativeInputGeometrySources?: Readonly<Record<string, LtxNativeInputGeometrySources>>;
}): Record<string, NovitaVideoOutputProof> {
  const { profile, shotIds, proofs, nativeInputGeometrySources } = args;
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
  if (requiresNative720X2CinematicProof(profile)) {
    const sourceIds = Object.keys(nativeInputGeometrySources ?? {});
    if (
      sourceIds.length !== expected.size
      || sourceIds.some((shotId) => !expected.has(shotId))
    ) {
      throw new Error("native-720p x2 proof set is missing sealed input geometry sources");
    }
  }
  const normalized: Record<string, NovitaVideoOutputProof> = {};
  for (const shotId of shotIds) {
    const proof = outputProof(received[shotId], profile, nativeInputGeometrySources?.[shotId]);
    if (!proof) {
      throw new Error(`x2 output proof does not match the pinned profile for ${shotId}`);
    }
    normalized[shotId] = proof;
  }
  return normalized;
}
