import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const YOUTUBE_THUMBNAIL_REPLACEMENT_VERSION =
  "youtube-thumbnail-replacement/v1" as const;

export type YouTubeThumbnailReplacementIdentity = Readonly<{
  ownerId: string;
  channelId: string;
  sourceRunId: string;
  candidateRunId: string;
  youtubeVideoId: string;
  expectedYoutubeChannelId: string;
  connectorId: string;
  connectorVersion: number;
  candidateThumbnailKey: string;
  candidateArtifactSha256: string;
}>;

export type YouTubeThumbnailReplacementDispatch =
  YouTubeThumbnailReplacementIdentity & Readonly<{
    version: typeof YOUTUBE_THUMBNAIL_REPLACEMENT_VERSION;
    replacementId: string;
    planFingerprint: string;
    approval: unknown;
    approvalFingerprint: string;
    dispatchKey: string;
    dispatchAttempt: number;
  }>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_000 || /[\u0000-\u001f]/.test(normalized)) {
    throw new Error(`YouTube thumbnail replacement ${label} is invalid`);
  }
  return normalized;
}

function exactIdentity(input: YouTubeThumbnailReplacementIdentity) {
  if (
    !Number.isSafeInteger(input.connectorVersion) ||
    input.connectorVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(input.candidateArtifactSha256)
  ) throw new Error("YouTube thumbnail replacement connector or artifact is invalid");
  return {
    ownerId: required(input.ownerId, "owner"),
    channelId: required(input.channelId, "channel"),
    sourceRunId: required(input.sourceRunId, "source run"),
    candidateRunId: required(input.candidateRunId, "candidate run"),
    youtubeVideoId: required(input.youtubeVideoId, "video"),
    expectedYoutubeChannelId: required(input.expectedYoutubeChannelId, "expected channel"),
    connectorId: required(input.connectorId, "connector"),
    connectorVersion: input.connectorVersion,
    candidateThumbnailKey: required(input.candidateThumbnailKey, "candidate object"),
    candidateArtifactSha256: input.candidateArtifactSha256,
  } satisfies YouTubeThumbnailReplacementIdentity;
}

export function youtubeThumbnailReplacementPlanFingerprint(
  input: YouTubeThumbnailReplacementIdentity,
): string {
  return sha256Hex(canonicalJson(exactIdentity(input)));
}

export function youtubeThumbnailReplacementDispatchKey(input: {
  replacementId: string;
  planFingerprint: string;
}): string {
  if (!/^[a-f0-9]{64}$/.test(input.planFingerprint)) {
    throw new Error("YouTube thumbnail replacement plan fingerprint is invalid");
  }
  return `youtube-thumbnail-replacement:${sha256Hex(canonicalJson({
    replacementId: required(input.replacementId, "record"),
    planFingerprint: input.planFingerprint,
  }))}`;
}

export function youtubeThumbnailReplacementApprovalSubject(input: {
  replacementId: string;
  planFingerprint: string;
  dispatchKey: string;
}): string {
  return `youtube-thumbnail-replacement-approval:${sha256Hex(canonicalJson({
    replacementId: required(input.replacementId, "record"),
    planFingerprint: input.planFingerprint,
    dispatchKey: required(input.dispatchKey, "dispatch key"),
  }))}`;
}

export function assertYoutubeThumbnailReplacementDispatch(
  value: unknown,
): YouTubeThumbnailReplacementDispatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("YouTube thumbnail replacement dispatch is missing");
  }
  const input = value as Partial<YouTubeThumbnailReplacementDispatch>;
  if (
    input.version !== YOUTUBE_THUMBNAIL_REPLACEMENT_VERSION ||
    typeof input.replacementId !== "string" ||
    typeof input.ownerId !== "string" ||
    typeof input.channelId !== "string" ||
    typeof input.sourceRunId !== "string" ||
    typeof input.candidateRunId !== "string" ||
    typeof input.youtubeVideoId !== "string" ||
    typeof input.expectedYoutubeChannelId !== "string" ||
    typeof input.connectorId !== "string" ||
    typeof input.connectorVersion !== "number" ||
    typeof input.candidateThumbnailKey !== "string" ||
    typeof input.candidateArtifactSha256 !== "string" ||
    typeof input.planFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.planFingerprint) ||
    typeof input.approvalFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.approvalFingerprint) ||
    typeof input.dispatchKey !== "string" ||
    !Number.isSafeInteger(input.dispatchAttempt) ||
    (input.dispatchAttempt ?? -1) < 0
  ) throw new Error("YouTube thumbnail replacement dispatch is invalid");
  const identity = exactIdentity(input as YouTubeThumbnailReplacementIdentity);
  if (youtubeThumbnailReplacementPlanFingerprint(identity) !== input.planFingerprint) {
    throw new Error("YouTube thumbnail replacement plan fingerprint changed");
  }
  if (youtubeThumbnailReplacementDispatchKey({
    replacementId: input.replacementId,
    planFingerprint: input.planFingerprint,
  }) !== input.dispatchKey) {
    throw new Error("YouTube thumbnail replacement dispatch key changed");
  }
  return input as YouTubeThumbnailReplacementDispatch;
}

export function youtubeThumbnailReplacementTriggerRequest(
  value: YouTubeThumbnailReplacementDispatch,
) {
  const dispatch = assertYoutubeThumbnailReplacementDispatch(value);
  return {
    taskId: "youtube-thumbnail-replacement" as const,
    payload: {
      ownerId: dispatch.ownerId,
      channelId: dispatch.channelId,
      sourceRunId: dispatch.sourceRunId,
      candidateRunId: dispatch.candidateRunId,
      replacementId: dispatch.replacementId,
      planFingerprint: dispatch.planFingerprint,
    },
    concurrencyKey: dispatch.channelId,
    idempotencySeed: dispatch.dispatchKey,
  };
}
