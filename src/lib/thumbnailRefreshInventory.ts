import { NANO_BANANA_THUMBNAIL_PROFILE } from "@/lib/nanoBananaThumbnailContract";
import { FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE } from "@/lib/falNanoBananaLofiThumbnailContract";

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
export const LOFI_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION =
  "lofi-thumbnail-current-candidate-evidence/v1" as const;
export const ERNIE_NOVITA_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION =
  "ernie-novita-thumbnail-current-candidate-evidence/v1" as const;

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

export type LofiThumbnailCurrentCandidateEvidence = {
  version: typeof LOFI_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION;
  ownerId: string;
  channelId: string;
  runId: string;
  r2Key: string;
  artifactSha256: string;
  generatorModule: "thumbnail_gen";
  contractVersion: "lofi-nano-banana-reference-thumbnail/v1";
  providerRoute: typeof FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE.route;
  sideLane: "nano-banana-lofi-video-reference";
  sourceVideoKey: string;
  sourceFrameSha256: string;
  sourceFrameTimeSec: number;
  sourceWidth: number;
  sourceHeight: number;
  providerRequestSha256: string;
  providerResponseSha256: string;
  publishable: true;
  reviewState: "candidate_only";
};

/**
 * Proof for a native ERNIE BF16 thumbnail, including ERNIE's own exact
 * typography. No local typography compositor is permitted on this route:
 * the stored pixels are exactly the pixels ERNIE rendered and QA accepted.
 */
export type ErnieNovitaThumbnailCurrentCandidateEvidence = {
  version: typeof ERNIE_NOVITA_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION;
  ownerId: string;
  channelId: string;
  runId: string;
  r2Key: string;
  artifactSha256: string;
  generatorModule: "thumbnail_gen";
  contractVersion: "ernie-novita-thumbnail-scene/v1";
  providerRoute: "ernie-image-novita-4090";
  providerRequestSha256: string;
  providerResponseSha256: string;
  modelRepository: "Comfy-Org/ERNIE-Image";
  modelRevision: string;
  qualityProfile: "hq";
  sourceWidth: 1376;
  sourceHeight: 768;
  promptEnhancer: true;
  delivery: "native-ernie-bf16";
  typographyRenderer: "ernie-native-typography/v1";
  publishable: true;
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

export function createLofiThumbnailCurrentCandidateEvidence(
  value: Omit<
    LofiThumbnailCurrentCandidateEvidence,
    "version" | "generatorModule" | "contractVersion" | "providerRoute" | "sideLane" | "publishable" | "reviewState"
  >,
): LofiThumbnailCurrentCandidateEvidence {
  if (
    !nonEmpty(value.ownerId) ||
    !nonEmpty(value.channelId) ||
    !nonEmpty(value.runId) ||
    !nonEmpty(value.r2Key) ||
    !nonEmpty(value.sourceVideoKey) ||
    !sha256(value.artifactSha256) ||
    !sha256(value.sourceFrameSha256) ||
    !sha256(value.providerRequestSha256) ||
    !sha256(value.providerResponseSha256) ||
    !Number.isFinite(value.sourceFrameTimeSec) ||
    value.sourceFrameTimeSec < 0 ||
    !Number.isInteger(value.sourceWidth) ||
    value.sourceWidth < 3_840 ||
    !Number.isInteger(value.sourceHeight) ||
    value.sourceHeight < 2_160
  ) {
    throw new Error("Lo-Fi thumbnail evidence requires a bound, truthful 4K rendered-video frame");
  }
  return {
    ...value,
    version: LOFI_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION,
    generatorModule: "thumbnail_gen",
    contractVersion: "lofi-nano-banana-reference-thumbnail/v1",
    providerRoute: FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE.route,
    sideLane: "nano-banana-lofi-video-reference",
    publishable: true,
    reviewState: "candidate_only",
  };
}

export function createErnieNovitaThumbnailCurrentCandidateEvidence(
  value: Omit<
    ErnieNovitaThumbnailCurrentCandidateEvidence,
    "version" | "generatorModule" | "contractVersion" | "providerRoute" |
    "modelRepository" | "qualityProfile" | "sourceWidth" | "sourceHeight" |
    "promptEnhancer" | "delivery" | "typographyRenderer" | "publishable" | "reviewState"
  >,
): ErnieNovitaThumbnailCurrentCandidateEvidence {
  if (
    !nonEmpty(value.ownerId) ||
    !nonEmpty(value.channelId) ||
    !nonEmpty(value.runId) ||
    !nonEmpty(value.r2Key) ||
    !sha256(value.artifactSha256) ||
    !sha256(value.providerRequestSha256) ||
    !sha256(value.providerResponseSha256) ||
    typeof value.modelRevision !== "string" || !/^[a-f0-9]{40}$/.test(value.modelRevision)
  ) {
    throw new Error("ERNIE Novita thumbnail evidence requires bound identities and immutable request/receipt hashes");
  }
  return {
    ...value,
    version: ERNIE_NOVITA_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION,
    generatorModule: "thumbnail_gen",
    contractVersion: "ernie-novita-thumbnail-scene/v1",
    providerRoute: "ernie-image-novita-4090",
    modelRepository: "Comfy-Org/ERNIE-Image",
    qualityProfile: "hq",
    sourceWidth: 1376,
    sourceHeight: 768,
    promptEnhancer: true,
    delivery: "native-ernie-bf16",
    typographyRenderer: "ernie-native-typography/v1",
    publishable: true,
    reviewState: "candidate_only",
  };
}

function parseEvidence(
  value: unknown,
): ThumbnailCurrentCandidateEvidence | LofiThumbnailCurrentCandidateEvidence |
  ErnieNovitaThumbnailCurrentCandidateEvidence | null {
  if (!isRecord(value)) return null;
  if (value.version === ERNIE_NOVITA_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION) {
    if (
      !nonEmpty(value.ownerId) ||
      !nonEmpty(value.channelId) ||
      !nonEmpty(value.runId) ||
      !nonEmpty(value.r2Key) ||
      !sha256(value.artifactSha256) ||
      value.generatorModule !== "thumbnail_gen" ||
      value.contractVersion !== "ernie-novita-thumbnail-scene/v1" ||
      value.providerRoute !== "ernie-image-novita-4090" ||
      !sha256(value.providerRequestSha256) ||
      !sha256(value.providerResponseSha256) ||
      value.modelRepository !== "Comfy-Org/ERNIE-Image" ||
      typeof value.modelRevision !== "string" || !/^[a-f0-9]{40}$/.test(value.modelRevision) ||
      value.qualityProfile !== "hq" ||
      value.sourceWidth !== 1376 ||
      value.sourceHeight !== 768 ||
      value.promptEnhancer !== true ||
      value.delivery !== "native-ernie-bf16" ||
      value.typographyRenderer !== "ernie-native-typography/v1" ||
      value.publishable !== true ||
      value.reviewState !== "candidate_only"
    ) return null;
    return value as unknown as ErnieNovitaThumbnailCurrentCandidateEvidence;
  }
  if (value.version === LOFI_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION) {
    if (
      !nonEmpty(value.ownerId) ||
      !nonEmpty(value.channelId) ||
      !nonEmpty(value.runId) ||
      !nonEmpty(value.r2Key) ||
      !sha256(value.artifactSha256) ||
      value.generatorModule !== "thumbnail_gen" ||
      value.contractVersion !== "lofi-nano-banana-reference-thumbnail/v1" ||
      value.providerRoute !== FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE.route ||
      value.sideLane !== "nano-banana-lofi-video-reference" ||
      !nonEmpty(value.sourceVideoKey) ||
      !sha256(value.sourceFrameSha256) ||
      !sha256(value.providerRequestSha256) ||
      !sha256(value.providerResponseSha256) ||
      !Number.isFinite(value.sourceFrameTimeSec) ||
      !Number.isInteger(value.sourceWidth) ||
      Number(value.sourceWidth) < 3_840 ||
      !Number.isInteger(value.sourceHeight) ||
      Number(value.sourceHeight) < 2_160 ||
      value.publishable !== true ||
      value.reviewState !== "candidate_only"
    ) return null;
    return value as unknown as LofiThumbnailCurrentCandidateEvidence;
  }
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
    reason: evidence.version === LOFI_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION
      ? "Current Lo-Fi 15-second-frame Nano Banana provenance is recorded. This is still not an owner acceptance or an external thumbnail replacement."
      : evidence.version === ERNIE_NOVITA_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION
        ? "Current ERNIE-Novita native-image and native-typography provenance is recorded. This is still not an owner acceptance or an external thumbnail replacement."
        : "Current Golden generator provenance is recorded. This is still not an owner acceptance or an external thumbnail replacement.",
  };
}
