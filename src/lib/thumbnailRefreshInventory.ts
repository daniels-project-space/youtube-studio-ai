import { NANO_BANANA_THUMBNAIL_PROFILE } from "@/lib/nanoBananaThumbnailContract";

/**
 * A compact, durable provenance marker for a thumbnail produced by the
 * current Golden thumbnail module. It deliberately says nothing about visual
 * quality, CTR, owner approval, or an external YouTube replacement.
 *
 * The owner/run/key binding prevents a marker copied from one run being used
 * to make a different thumbnail look current. A later refresh proposal must
 * still be created and explicitly accepted by its owner before it can touch a
 * YouTube thumbnail.
 */
export const THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION =
  "thumbnail-current-candidate-evidence/v1" as const;

export type ThumbnailCurrentCandidateEvidence = {
  version: typeof THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION;
  ownerId: string;
  channelId: string;
  runId: string;
  r2Key: string;
  artifactSha256: string;
  generatorModule: "thumbnail_gen";
  contractVersion: typeof NANO_BANANA_THUMBNAIL_PROFILE.contractVersion;
  providerRoute: typeof NANO_BANANA_THUMBNAIL_PROFILE.route;
  providerRequestSha256: string;
  providerResponseSha256: string;
  /** The pipeline admitted this exact candidate for its normal draft flow. */
  publishable: true;
  /** Provenance-only: never an owner acceptance or an external replacement. */
  reviewState: "candidate_only";
};

export type ThumbnailRefreshEvidenceStatus =
  | "current_golden_candidate"
  | "legacy_unverified"
  | "evidence_invalid"
  | "missing_thumbnail";

export type ThumbnailRefreshAction =
  | "no_refresh_action"
  | "owner_review_required";

export type ThumbnailRefreshEvidenceAssessment = {
  status: ThumbnailRefreshEvidenceStatus;
  action: ThumbnailRefreshAction;
  reason: string;
};

export type ThumbnailRefreshAsset = {
  ownerId: string;
  channelId: string;
  runId?: string;
  kind: string;
  r2Key: string;
  meta?: unknown;
};

const SHA256 = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

/**
 * Builds the only thumbnail provenance record that counts as current-Golden
 * evidence in the refresh inventory. This is intentionally strict: an asset
 * is not made current merely because it happens to have a familiar filename
 * or provider route.
 */
export function createThumbnailCurrentCandidateEvidence(
  value: Omit<
    ThumbnailCurrentCandidateEvidence,
    "version" | "generatorModule" | "contractVersion" | "providerRoute" | "publishable" | "reviewState"
  >,
): ThumbnailCurrentCandidateEvidence {
  if (
    !nonEmpty(value.ownerId) ||
    !nonEmpty(value.channelId) ||
    !nonEmpty(value.runId) ||
    !nonEmpty(value.r2Key) ||
    !sha256(value.artifactSha256) ||
    !sha256(value.providerRequestSha256) ||
    !sha256(value.providerResponseSha256)
  ) {
    throw new Error("thumbnail current-candidate evidence requires bound identities and SHA-256 receipts");
  }
  return {
    version: THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION,
    ownerId: value.ownerId,
    channelId: value.channelId,
    runId: value.runId,
    r2Key: value.r2Key,
    artifactSha256: value.artifactSha256,
    generatorModule: "thumbnail_gen",
    contractVersion: NANO_BANANA_THUMBNAIL_PROFILE.contractVersion,
    providerRoute: NANO_BANANA_THUMBNAIL_PROFILE.route,
    providerRequestSha256: value.providerRequestSha256,
    providerResponseSha256: value.providerResponseSha256,
    publishable: true,
    reviewState: "candidate_only",
  };
}

function parseEvidence(value: unknown): ThumbnailCurrentCandidateEvidence | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION ||
    !nonEmpty(value.ownerId) ||
    !nonEmpty(value.channelId) ||
    !nonEmpty(value.runId) ||
    !nonEmpty(value.r2Key) ||
    !sha256(value.artifactSha256) ||
    value.generatorModule !== "thumbnail_gen" ||
    value.contractVersion !== NANO_BANANA_THUMBNAIL_PROFILE.contractVersion ||
    value.providerRoute !== NANO_BANANA_THUMBNAIL_PROFILE.route ||
    !sha256(value.providerRequestSha256) ||
    !sha256(value.providerResponseSha256) ||
    value.publishable !== true ||
    value.reviewState !== "candidate_only"
  ) {
    return null;
  }
  return value as ThumbnailCurrentCandidateEvidence;
}

/**
 * Evaluates persisted provenance only. It performs no image analysis and does
 * not create, upload, accept, or replace a thumbnail anywhere.
 */
export function assessThumbnailRefreshEvidence(
  asset: ThumbnailRefreshAsset | null | undefined,
): ThumbnailRefreshEvidenceAssessment {
  if (!asset) {
    return {
      status: "missing_thumbnail",
      action: "owner_review_required",
      reason: "No thumbnail asset is recorded for this finished video.",
    };
  }
  if (asset.kind !== "thumbnail" || !nonEmpty(asset.ownerId) || !nonEmpty(asset.channelId) ||
    !nonEmpty(asset.runId) || !nonEmpty(asset.r2Key)) {
    return {
      status: "evidence_invalid",
      action: "owner_review_required",
      reason: "The thumbnail asset is not fully owner/run-bound, so it cannot be treated as current evidence.",
    };
  }

  const meta = isRecord(asset.meta) ? asset.meta : null;
  const evidence = parseEvidence(meta?.thumbnailCurrentCandidateEvidence);
  if (!evidence) {
    return {
      status: "legacy_unverified",
      action: "owner_review_required",
      reason: "No current Golden thumbnail provenance marker is recorded for this asset.",
    };
  }
  if (
    evidence.ownerId !== asset.ownerId ||
    evidence.channelId !== asset.channelId ||
    evidence.runId !== asset.runId ||
    evidence.r2Key !== asset.r2Key
  ) {
    return {
      status: "evidence_invalid",
      action: "owner_review_required",
      reason: "The current-candidate marker does not match this asset's owner, run, channel, or R2 key.",
    };
  }
  return {
    status: "current_golden_candidate",
    action: "no_refresh_action",
    reason: "Current Golden generator provenance is recorded. This is still not an owner acceptance or an external thumbnail replacement.",
  };
}
