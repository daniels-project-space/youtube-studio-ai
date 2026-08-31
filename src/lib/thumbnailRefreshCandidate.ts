import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const THUMBNAIL_REFRESH_MAXIMUM_COST_USD = 0.4;
export const THUMBNAIL_REFRESH_DISPATCH_VERSION = "thumbnail-refresh-candidate/v1";

export type ThumbnailRefreshCandidateDispatch = Readonly<{
  version: typeof THUMBNAIL_REFRESH_DISPATCH_VERSION;
  ownerId: string;
  channelId: string;
  sourceRunId: string;
  candidateRunId: string;
  replayFingerprint: string;
  maximumCostUsd: number;
  approval: unknown;
  approvalFingerprint: string;
  dispatchKey: string;
  dispatchAttempt: number;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 300 || /[\u0000-\u001f]/.test(normalized)) {
    throw new Error(`thumbnail refresh ${label} is invalid`);
  }
  return normalized;
}

export function thumbnailRefreshDispatchKey(args: {
  ownerId: string;
  sourceRunId: string;
  replayFingerprint: string;
}): string {
  if (!/^[a-f0-9]{64}$/.test(args.replayFingerprint)) {
    throw new Error("thumbnail refresh replay fingerprint is invalid");
  }
  const digest = sha256Hex(canonicalJson({
    ownerId: required(args.ownerId, "owner"),
    sourceRunId: required(args.sourceRunId, "source run"),
    replayFingerprint: args.replayFingerprint,
  }));
  return `thumbnail-refresh:${digest}`;
}

export function thumbnailRefreshCandidateApprovalSubject(args: {
  ownerId: string;
  channelId: string;
  sourceRunId: string;
  candidateRunId: string;
  replayFingerprint: string;
  maximumCostUsd: number;
  dispatchKey: string;
}): string {
  if (
    !Number.isFinite(args.maximumCostUsd) ||
    args.maximumCostUsd <= 0 ||
    args.maximumCostUsd > THUMBNAIL_REFRESH_MAXIMUM_COST_USD
  ) {
    throw new Error("thumbnail refresh cost authority is invalid");
  }
  const digest = sha256Hex(canonicalJson({
    ownerId: required(args.ownerId, "owner"),
    channelId: required(args.channelId, "channel"),
    sourceRunId: required(args.sourceRunId, "source run"),
    candidateRunId: required(args.candidateRunId, "candidate run"),
    replayFingerprint: args.replayFingerprint,
    maximumCostUsd: args.maximumCostUsd,
    dispatchKey: required(args.dispatchKey, "dispatch key"),
  }));
  return `thumbnail-refresh-candidate:${digest}`;
}

export function assertThumbnailRefreshCandidateDispatch(
  value: unknown,
): ThumbnailRefreshCandidateDispatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("thumbnail refresh dispatch is missing");
  }
  const input = value as Partial<ThumbnailRefreshCandidateDispatch>;
  if (
    input.version !== THUMBNAIL_REFRESH_DISPATCH_VERSION ||
    typeof input.ownerId !== "string" ||
    typeof input.channelId !== "string" ||
    typeof input.sourceRunId !== "string" ||
    typeof input.candidateRunId !== "string" ||
    typeof input.replayFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.replayFingerprint) ||
    typeof input.maximumCostUsd !== "number" ||
    input.maximumCostUsd <= 0 ||
    input.maximumCostUsd > THUMBNAIL_REFRESH_MAXIMUM_COST_USD ||
    typeof input.approvalFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.approvalFingerprint) ||
    typeof input.dispatchKey !== "string" ||
    !Number.isSafeInteger(input.dispatchAttempt) ||
    (input.dispatchAttempt ?? 0) < 0
  ) {
    throw new Error("thumbnail refresh dispatch is invalid");
  }
  const expectedKey = thumbnailRefreshDispatchKey({
    ownerId: input.ownerId,
    sourceRunId: input.sourceRunId,
    replayFingerprint: input.replayFingerprint,
  });
  if (input.dispatchKey !== expectedKey) {
    throw new Error("thumbnail refresh dispatch key does not match its frozen replay");
  }
  return input as ThumbnailRefreshCandidateDispatch;
}

export function thumbnailRefreshTriggerRequest(
  dispatch: ThumbnailRefreshCandidateDispatch,
) {
  const sealed = assertThumbnailRefreshCandidateDispatch(dispatch);
  return {
    taskId: "thumbnail-refresh-candidate" as const,
    payload: {
      ownerId: sealed.ownerId,
      channelId: sealed.channelId,
      sourceRunId: sealed.sourceRunId,
      candidateRunId: sealed.candidateRunId,
      replayFingerprint: sealed.replayFingerprint,
    },
    concurrencyKey: sealed.channelId,
    idempotencySeed: sealed.dispatchKey,
  };
}
