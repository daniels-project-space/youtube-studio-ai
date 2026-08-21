import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import type { NovitaPhaseProfile } from "@/lib/novitaRenderFarm";

/**
 * Native-720p LTX is intentionally not a generally admitted runtime profile.
 * This contract only recognizes an already-reviewed proof for the exact
 * 1280x704 -> 2560x1408 two-stage target; it never selects or promotes it.
 */
export const CINEMATIC_PROOF_ADMISSION_VERSION = "cinematic-proof-admission/v1" as const;

export const NATIVE_720_X2_CINEMATIC_TARGET = Object.freeze({
  stageOneWidth: 1280,
  stageOneHeight: 704,
  outputWidth: 2560,
  outputHeight: 1408,
  spatialUpscaleFactor: 2,
});

/**
 * The immutable proof record that a source-reviewed release may eventually
 * register for the native-720p x2 target. It is never supplied by a render
 * caller: callers can request a profile, but only this release-controlled
 * registry can authorize it.
 */
export interface CinematicProofAdmissionReceipt {
  version: typeof CINEMATIC_PROOF_ADMISSION_VERSION;
  profileFingerprint: string;
  finalMasterSha256: string;
  visualReviewReceiptFingerprint: string;
  cinematicFinalMasterQaReceiptFingerprint: string;
  receiptSha256: string;
}

type UnsealedCinematicProofAdmissionReceipt = Omit<CinematicProofAdmissionReceipt, "receiptSha256">;

const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Release-controlled trust anchor for the requested native-720p x2 target.
 * It is intentionally empty: no retained artifact currently proves that
 * profile. A future entry must be copied from a reviewed durable proof
 * artifact during a source-reviewed release; configuration, environment, and
 * loose manifests are never an approval source.
 */
const APPROVED_NATIVE_720_X2_PROOF_RECEIPTS: readonly CinematicProofAdmissionReceipt[] = Object.freeze([]);

function receiptCore(receipt: UnsealedCinematicProofAdmissionReceipt): UnsealedCinematicProofAdmissionReceipt {
  return {
    version: receipt.version,
    profileFingerprint: receipt.profileFingerprint,
    finalMasterSha256: receipt.finalMasterSha256,
    visualReviewReceiptFingerprint: receipt.visualReviewReceiptFingerprint,
    cinematicFinalMasterQaReceiptFingerprint: receipt.cinematicFinalMasterQaReceiptFingerprint,
  };
}

/** Exact, canonical identity of every field that can change LTX output. */
export function cinematicProofProfileFingerprint(profile: NovitaPhaseProfile): string {
  return sha256Hex(canonicalJson(profile));
}

export function cinematicProofAdmissionReceiptFingerprint(
  receipt: UnsealedCinematicProofAdmissionReceipt,
): string {
  return sha256Hex(canonicalJson(receiptCore(receipt)));
}

/**
 * Test/registry-authoring helper. It only binds receipt fields together; it
 * does not approve the receipt or create a production admission.
 */
export function sealCinematicProofAdmissionReceipt(
  receipt: UnsealedCinematicProofAdmissionReceipt,
): CinematicProofAdmissionReceipt {
  const core = receiptCore(receipt);
  return { ...core, receiptSha256: cinematicProofAdmissionReceiptFingerprint(core) };
}

/**
 * Only the requested native-720p two-stage target is gated here. Existing
 * lower-resolution admitted profiles intentionally retain their current path.
 */
export function requiresNative720X2CinematicProof(profile: NovitaPhaseProfile): boolean {
  const target = NATIVE_720_X2_CINEMATIC_TARGET;
  return profile.phase === "video"
    && profile.width === target.outputWidth
    && profile.height === target.outputHeight
    && profile.stageOneWidth === target.stageOneWidth
    && profile.stageOneHeight === target.stageOneHeight
    && profile.spatialUpscaleFactor === target.spatialUpscaleFactor;
}

function assertSha256(name: string, value: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new Error(`cinematic proof admission receipt has invalid ${name}`);
  }
}

/**
 * Resolve the sole admissible native-720p x2 proof from the immutable release
 * registry. This deliberately has no caller-provided receipt parameter: a
 * self-consistent payload from an API, repair task, or hand-authored config
 * must never become render authority.
 */
export function resolveApprovedCinematicProofAdmission(
  profile: NovitaPhaseProfile,
): CinematicProofAdmissionReceipt | undefined {
  if (!requiresNative720X2CinematicProof(profile)) return undefined;

  const expectedProfileFingerprint = cinematicProofProfileFingerprint(profile);
  const proof = APPROVED_NATIVE_720_X2_PROOF_RECEIPTS
    .find((candidate) => candidate.profileFingerprint === expectedProfileFingerprint);
  if (!proof) {
    throw new Error(
      "native-720p x2 cinematic production is blocked: no immutable approved proof receipt is registered for the exact requested profile",
    );
  }
  if (proof.version !== CINEMATIC_PROOF_ADMISSION_VERSION) {
    throw new Error("registered cinematic proof admission receipt has an unsupported version");
  }
  assertSha256("profileFingerprint", proof.profileFingerprint);
  assertSha256("finalMasterSha256", proof.finalMasterSha256);
  assertSha256("visualReviewReceiptFingerprint", proof.visualReviewReceiptFingerprint);
  assertSha256("cinematicFinalMasterQaReceiptFingerprint", proof.cinematicFinalMasterQaReceiptFingerprint);
  assertSha256("receiptSha256", proof.receiptSha256);

  const expectedReceiptSha256 = cinematicProofAdmissionReceiptFingerprint(proof);
  if (proof.receiptSha256 !== expectedReceiptSha256) {
    throw new Error("registered cinematic proof admission receipt integrity fingerprint does not match");
  }
  if (proof.profileFingerprint !== expectedProfileFingerprint) {
    throw new Error("registered cinematic proof admission receipt does not match the exact requested native-720p x2 profile");
  }
  return proof;
}

/**
 * Fail closed before any provider admission. A smaller 640x352 -> 1280x704
 * proof has a different profile fingerprint and therefore cannot unlock the
 * native-720p x2 worker path.
 */
export function assertCinematicProofAdmission(args: {
  profile: NovitaPhaseProfile;
}): void {
  void resolveApprovedCinematicProofAdmission(args.profile);
}
