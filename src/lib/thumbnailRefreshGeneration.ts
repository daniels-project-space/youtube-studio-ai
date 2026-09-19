import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * A generation profile is part of the candidate identity, not presentation
 * metadata. It lets a source retain an old, auditable candidate while the
 * active thumbnail contract can create one fresh successor without mutating
 * or reusing the historic artifact.
 */
export const NANO_BANANA_CURRENT_REFRESH_PROFILE =
  "nano-banana-current/v1" as const;

export type ThumbnailRefreshGenerationProfile =
  | typeof NANO_BANANA_CURRENT_REFRESH_PROFILE;

const SHA256 = /^[a-f0-9]{64}$/;

export function thumbnailRefreshCandidateFingerprint(args: {
  replayFingerprint: string;
  generationProfile?: ThumbnailRefreshGenerationProfile;
}): string {
  if (!SHA256.test(args.replayFingerprint)) {
    throw new Error("thumbnail refresh replay fingerprint is invalid");
  }
  // Candidates created before profiles existed retain their immutable
  // fingerprint. This is essential for their existing signed receipts.
  if (!args.generationProfile) return args.replayFingerprint;
  return sha256Hex(canonicalJson({
    version: "thumbnail-refresh-candidate-fingerprint/v1",
    generationProfile: args.generationProfile,
    replayFingerprint: args.replayFingerprint,
  }));
}
