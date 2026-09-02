import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID = "owner_daniel" as const;
export const ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_KEY =
  "projects/thumbnail-refresh/ernie-native-v1/manifest.json" as const;
export const ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256 =
  "da68b70163fe25149b8144af7a7a9b7be4bc231d5a88e2b7fff4295953002d62" as const;
export const ERNIE_THUMBNAIL_REFRESH_BATCH_CANDIDATE_COUNT = 30 as const;
export const ERNIE_THUMBNAIL_REFRESH_BATCH_MODEL_REVISION =
  "01bcb3f1acdb1454ee579d2796ecc4c156873eea" as const;
export const ERNIE_THUMBNAIL_REFRESH_BATCH_IMAGE_PREFIX =
  "projects/thumbnail-refresh/ernie-native-v1/images/" as const;
export const ERNIE_THUMBNAIL_REFRESH_BATCH_CONFIRMATION = "APPLY 30" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9_-]{8,256}$/;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{6,64}$/;

export type ErnieThumbnailQa = Readonly<{
  textOk: boolean;
  faceClear: boolean;
  punch: number;
  styleMatch: number;
  storyMatch: number;
  uiClean: boolean;
  reason: string;
}>;

export type ErnieThumbnailRefreshBatchCandidate = Readonly<{
  sourceRunId: string;
  channelId: string;
  channelSlug: string;
  youtubeVideoId: string;
  ernieSceneKey: string;
  artifactSha256: string;
  providerRequestSha256: string;
  providerResponseSha256: string;
  batchReceiptKey: string;
  batchResultKey: string;
  elapsedSeconds: number;
  sourceReviewCount: number;
  qa: ErnieThumbnailQa;
}>;

export type ErnieThumbnailRefreshBatchManifest = Readonly<{
  version: 1;
  ownerId: typeof ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID;
  modelRevision: typeof ERNIE_THUMBNAIL_REFRESH_BATCH_MODEL_REVISION;
  candidates: readonly ErnieThumbnailRefreshBatchCandidate[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2_000 || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`ERNIE thumbnail batch ${label} is invalid`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  const normalized = nonEmptyString(value, label);
  if (!SHA256.test(normalized)) throw new Error(`ERNIE thumbnail batch ${label} is not a SHA-256 digest`);
  return normalized;
}

function qa(value: unknown): ErnieThumbnailQa {
  if (!isRecord(value)) throw new Error("ERNIE thumbnail batch QA is invalid");
  const parsed: ErnieThumbnailQa = {
    textOk: value.textOk as boolean,
    faceClear: value.faceClear as boolean,
    punch: value.punch as number,
    styleMatch: value.styleMatch as number,
    storyMatch: value.storyMatch as number,
    uiClean: value.uiClean as boolean,
    reason: nonEmptyString(value.reason, "QA reason"),
  };
  if (
    typeof parsed.textOk !== "boolean" || typeof parsed.faceClear !== "boolean" ||
    typeof parsed.uiClean !== "boolean" || !Number.isFinite(parsed.punch) ||
    !Number.isFinite(parsed.styleMatch) || !Number.isFinite(parsed.storyMatch) ||
    !parsed.textOk || !parsed.faceClear || !parsed.uiClean || parsed.punch < 7 ||
    parsed.styleMatch < 7 || parsed.storyMatch < 7
  ) throw new Error("ERNIE thumbnail batch candidate did not pass its complete QA gate");
  return parsed;
}

function candidate(value: unknown): ErnieThumbnailRefreshBatchCandidate {
  if (!isRecord(value)) throw new Error("ERNIE thumbnail batch candidate is invalid");
  const sourceRunId = nonEmptyString(value.sourceRunId, "source run");
  const youtubeVideoId = nonEmptyString(value.youtubeVideoId, "YouTube video");
  const ernieSceneKey = nonEmptyString(value.ernieSceneKey, "image key");
  if (!RUN_ID.test(sourceRunId) || !YOUTUBE_VIDEO_ID.test(youtubeVideoId)) {
    throw new Error("ERNIE thumbnail batch candidate identity is invalid");
  }
  if (ernieSceneKey !== `${ERNIE_THUMBNAIL_REFRESH_BATCH_IMAGE_PREFIX}${sourceRunId}.png`) {
    throw new Error("ERNIE thumbnail batch image key is not bound to its source run");
  }
  const parsed: ErnieThumbnailRefreshBatchCandidate = {
    sourceRunId,
    channelId: nonEmptyString(value.channelId, "channel"),
    channelSlug: nonEmptyString(value.channelSlug, "channel slug"),
    youtubeVideoId,
    ernieSceneKey,
    artifactSha256: sha(value.artifactSha256, "artifact"),
    providerRequestSha256: sha(value.providerRequestSha256, "provider request"),
    providerResponseSha256: sha(value.providerResponseSha256, "provider response"),
    batchReceiptKey: nonEmptyString(value.batchReceiptKey, "batch receipt key"),
    batchResultKey: nonEmptyString(value.batchResultKey, "batch result key"),
    elapsedSeconds: value.elapsedSeconds as number,
    sourceReviewCount: value.sourceReviewCount as number,
    qa: qa(value.qa),
  };
  if (
    !Number.isFinite(parsed.elapsedSeconds) || parsed.elapsedSeconds < 0 ||
    !Number.isSafeInteger(parsed.sourceReviewCount) || parsed.sourceReviewCount < 1 ||
    !parsed.batchReceiptKey.startsWith("projects/novita-thumbnail-batch/jobs/") ||
    !parsed.batchResultKey.startsWith("projects/novita-thumbnail-batch/jobs/")
  ) throw new Error("ERNIE thumbnail batch candidate provenance is invalid");
  return parsed;
}

/** Validate the remote document before it receives any Studio or YouTube authority. */
export function assertErnieThumbnailRefreshBatchManifest(value: unknown): ErnieThumbnailRefreshBatchManifest {
  if (!isRecord(value) || value.version !== 1 || value.ownerId !== ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID ||
    value.modelRevision !== ERNIE_THUMBNAIL_REFRESH_BATCH_MODEL_REVISION || !Array.isArray(value.candidates)) {
    throw new Error("ERNIE thumbnail batch manifest identity is invalid");
  }
  const candidates = value.candidates.map(candidate);
  if (candidates.length !== ERNIE_THUMBNAIL_REFRESH_BATCH_CANDIDATE_COUNT) {
    throw new Error("ERNIE thumbnail batch manifest candidate count changed");
  }
  const sourceIds = new Set(candidates.map((item) => item.sourceRunId));
  const videoIds = new Set(candidates.map((item) => item.youtubeVideoId));
  if (sourceIds.size !== candidates.length || videoIds.size !== candidates.length) {
    throw new Error("ERNIE thumbnail batch manifest contains duplicate run or video bindings");
  }
  return {
    version: 1,
    ownerId: ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID,
    modelRevision: ERNIE_THUMBNAIL_REFRESH_BATCH_MODEL_REVISION,
    candidates,
  };
}

export function ernieThumbnailRefreshBatchFingerprint(value: unknown): string {
  const manifest = assertErnieThumbnailRefreshBatchManifest(value);
  return sha256Hex(canonicalJson(manifest));
}

export function assertPinnedErnieThumbnailRefreshBatch(value: unknown): ErnieThumbnailRefreshBatchManifest {
  const manifest = assertErnieThumbnailRefreshBatchManifest(value);
  if (ernieThumbnailRefreshBatchFingerprint(manifest) !== ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256) {
    throw new Error("ERNIE thumbnail batch manifest hash changed from the reviewed set");
  }
  return manifest;
}

export function ernieThumbnailBatchApplyApprovalSubject(args: {
  ownerId: string;
  batchFingerprint: string;
}): string {
  if (args.ownerId !== ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID || !SHA256.test(args.batchFingerprint)) {
    throw new Error("ERNIE thumbnail batch application authority is invalid");
  }
  return `thumbnail-ernie-batch-apply:${sha256Hex(canonicalJson({
    ownerId: args.ownerId,
    manifestKey: ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_KEY,
    batchFingerprint: args.batchFingerprint,
  }))}`;
}

/** A proportional Novita spot estimate is retained for each imported candidate. */
export function ernieThumbnailRefreshCandidateCost(candidate: ErnieThumbnailRefreshBatchCandidate): number {
  const estimate = (candidate.elapsedSeconds / 3_600 * 0.335) / candidate.sourceReviewCount;
  return Math.min(0.4, Math.max(0, Number(estimate.toFixed(6))));
}
