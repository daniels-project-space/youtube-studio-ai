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
 * A caller may supply this explicit receipt, but it carries no authority by
 * itself. Admission accepts it only when it exactly matches an immutable,
 * release-controlled record below. `receiptSha256` detects accidental field
 * substitution after that durable record has been created.
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

function sameCinematicProofAdmissionReceipt(
  left: CinematicProofAdmissionReceipt,
  right: CinematicProofAdmissionReceipt,
): boolean {
  return left.version === right.version
    && left.profileFingerprint === right.profileFingerprint
    && left.finalMasterSha256 === right.finalMasterSha256
    && left.visualReviewReceiptFingerprint === right.visualReviewReceiptFingerprint
    && left.cinematicFinalMasterQaReceiptFingerprint === right.cinematicFinalMasterQaReceiptFingerprint
    && left.receiptSha256 === right.receiptSha256;
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
 * Fail closed before any provider admission. A smaller 640x352 -> 1280x704
 * receipt has a different fingerprint and therefore cannot approve native-720
 * x2 worker spend.
 */
export function assertCinematicProofAdmission(args: {
  profile: NovitaPhaseProfile;
  proof?: CinematicProofAdmissionReceipt;
}): void {
  if (!requiresNative720X2CinematicProof(args.profile)) return;

  const proof = args.proof;
  if (!proof) {
    throw new Error(
      "native-720p x2 cinematic production is blocked until an explicit cinematic proof receipt is supplied",
    );
  }
  if (proof.version !== CINEMATIC_PROOF_ADMISSION_VERSION) {
    throw new Error("cinematic proof admission receipt has an unsupported version");
  }
  assertSha256("profileFingerprint", proof.profileFingerprint);
  assertSha256("finalMasterSha256", proof.finalMasterSha256);
  assertSha256("visualReviewReceiptFingerprint", proof.visualReviewReceiptFingerprint);
  assertSha256("cinematicFinalMasterQaReceiptFingerprint", proof.cinematicFinalMasterQaReceiptFingerprint);
  assertSha256("receiptSha256", proof.receiptSha256);

  const expectedReceiptSha256 = cinematicProofAdmissionReceiptFingerprint(proof);
  if (proof.receiptSha256 !== expectedReceiptSha256) {
    throw new Error("cinematic proof admission receipt integrity fingerprint does not match");
  }
  if (proof.profileFingerprint !== cinematicProofProfileFingerprint(args.profile)) {
    throw new Error("cinematic proof admission receipt does not match the exact requested native-720p x2 profile");
  }

  const approvedProof = APPROVED_NATIVE_720_X2_PROOF_RECEIPTS
    .find((candidate) => candidate.profileFingerprint === proof.profileFingerprint);
  if (!approvedProof) {
    throw new Error(
      "native-720p x2 cinematic production is blocked: no immutable approved proof receipt is registered for the exact requested profile",
    );
  }
  if (!sameCinematicProofAdmissionReceipt(proof, approvedProof)) {
    throw new Error(
      "cinematic proof admission receipt does not match the immutable approved proof record for the exact requested profile",
    );
  }
}
