import { canonicalJson } from "@/lib/canonicalJson";
import type { LegacyVideoRetirementReason } from "@/lib/legacyVideoCleanup";
import { LEGACY_VIDEO_RETIREMENT_REASONS } from "@/lib/legacyVideoCleanup";
import { sha256Hex } from "@/lib/sha256";

export const YOUTUBE_VIDEO_RETIREMENT_VERSION =
  "youtube-video-retirement/v1" as const;

export type YouTubeVideoRetirementIdentity = Readonly<{
  ownerId: string;
  channelId: string;
  runId: string;
  youtubeVideoId: string;
  expectedYoutubeChannelId: string;
  connectorId: string;
  connectorVersion: number;
  reason: LegacyVideoRetirementReason;
}>;

export type YouTubeVideoRetirementDispatch =
  YouTubeVideoRetirementIdentity & Readonly<{
    version: typeof YOUTUBE_VIDEO_RETIREMENT_VERSION;
    retirementId: string;
    planFingerprint: string;
    approval: unknown;
    approvalFingerprint: string;
    dispatchKey: string;
    dispatchAttempt: number;
  }>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 300 ||
    /[\u0000-\u001f]/.test(normalized)
  ) {
    throw new Error(`YouTube retirement ${label} is invalid`);
  }
  return normalized;
}

function exactIdentity(input: YouTubeVideoRetirementIdentity) {
  if (
    !Number.isSafeInteger(input.connectorVersion) ||
    input.connectorVersion < 1 ||
    !LEGACY_VIDEO_RETIREMENT_REASONS.includes(input.reason)
  ) {
    throw new Error("YouTube retirement connector or reason is invalid");
  }
  return {
    ownerId: required(input.ownerId, "owner"),
    channelId: required(input.channelId, "channel"),
    runId: required(input.runId, "run"),
    youtubeVideoId: required(input.youtubeVideoId, "video"),
    expectedYoutubeChannelId: required(
      input.expectedYoutubeChannelId,
      "expected channel",
    ),
    connectorId: required(input.connectorId, "connector"),
    connectorVersion: input.connectorVersion,
    reason: input.reason,
  } satisfies YouTubeVideoRetirementIdentity;
}

export function youtubeVideoRetirementPlanFingerprint(
  input: YouTubeVideoRetirementIdentity,
): string {
  return sha256Hex(canonicalJson(exactIdentity(input)));
}

export function youtubeVideoRetirementDispatchKey(input: {
  retirementId: string;
  planFingerprint: string;
}): string {
  if (!/^[a-f0-9]{64}$/.test(input.planFingerprint)) {
    throw new Error("YouTube retirement plan fingerprint is invalid");
  }
  const digest = sha256Hex(canonicalJson({
    retirementId: required(input.retirementId, "record"),
    planFingerprint: input.planFingerprint,
  }));
  return `youtube-video-retirement:${digest}`;
}

export function youtubeVideoRetirementApprovalSubject(input: {
  retirementId: string;
  planFingerprint: string;
  dispatchKey: string;
}): string {
  const digest = sha256Hex(canonicalJson({
    retirementId: required(input.retirementId, "record"),
    planFingerprint: input.planFingerprint,
    dispatchKey: required(input.dispatchKey, "dispatch key"),
  }));
  return `youtube-video-retirement-approval:${digest}`;
}

export function assertYoutubeVideoRetirementDispatch(
  value: unknown,
): YouTubeVideoRetirementDispatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("YouTube retirement dispatch is missing");
  }
  const input = value as Partial<YouTubeVideoRetirementDispatch>;
  if (
    input.version !== YOUTUBE_VIDEO_RETIREMENT_VERSION ||
    typeof input.retirementId !== "string" ||
    typeof input.ownerId !== "string" ||
    typeof input.channelId !== "string" ||
    typeof input.runId !== "string" ||
    typeof input.youtubeVideoId !== "string" ||
    typeof input.expectedYoutubeChannelId !== "string" ||
    typeof input.connectorId !== "string" ||
    typeof input.connectorVersion !== "number" ||
    !LEGACY_VIDEO_RETIREMENT_REASONS.includes(
      input.reason as LegacyVideoRetirementReason,
    ) ||
    typeof input.planFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.planFingerprint) ||
    typeof input.approvalFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.approvalFingerprint) ||
    typeof input.dispatchKey !== "string" ||
    !Number.isSafeInteger(input.dispatchAttempt) ||
    (input.dispatchAttempt ?? -1) < 0
  ) {
    throw new Error("YouTube retirement dispatch is invalid");
  }
  const identity = exactIdentity(input as YouTubeVideoRetirementIdentity);
  if (youtubeVideoRetirementPlanFingerprint(identity) !== input.planFingerprint) {
    throw new Error("YouTube retirement plan fingerprint changed");
  }
  const expectedDispatchKey = youtubeVideoRetirementDispatchKey({
    retirementId: input.retirementId,
    planFingerprint: input.planFingerprint,
  });
  if (input.dispatchKey !== expectedDispatchKey) {
    throw new Error("YouTube retirement dispatch key changed");
  }
  return input as YouTubeVideoRetirementDispatch;
}

export function youtubeVideoRetirementTriggerRequest(
  value: YouTubeVideoRetirementDispatch,
) {
  const dispatch = assertYoutubeVideoRetirementDispatch(value);
  return {
    taskId: "youtube-video-retirement" as const,
    payload: {
      ownerId: dispatch.ownerId,
      channelId: dispatch.channelId,
      runId: dispatch.runId,
      retirementId: dispatch.retirementId,
      planFingerprint: dispatch.planFingerprint,
    },
    concurrencyKey: dispatch.channelId,
    idempotencySeed: dispatch.dispatchKey,
  };
}
