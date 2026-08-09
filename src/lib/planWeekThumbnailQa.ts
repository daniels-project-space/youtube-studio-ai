import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  thumbnailGatePassed,
  type ThumbnailGateVerdict,
} from "@/engine/qualityPolicy";

export const PLAN_WEEK_THUMBNAIL_QA_VERSION = "plan-week-thumbnail-qa/v1" as const;

export interface PlanWeekThumbnailQaCheckpoint {
  version: typeof PLAN_WEEK_THUMBNAIL_QA_VERSION;
  checkpointKey: string;
  providerRequestSha256: string;
  candidateSha256: string;
  qaRequestSha256: string;
  verdict: ThumbnailGateVerdict;
  verdictSha256: string;
  costUsd: number;
  usageFingerprint: string;
  createdAt: number;
}

const SHA256 = /^[a-f0-9]{64}$/;

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function validVerdict(value: unknown): value is ThumbnailGateVerdict {
  const verdict = value as Partial<ThumbnailGateVerdict> | null;
  return Boolean(
    verdict &&
    typeof verdict.textOk === "boolean" &&
    typeof verdict.faceClear === "boolean" &&
    Number.isFinite(verdict.punch) &&
    Number.isFinite(verdict.styleMatch) &&
    Number.isFinite(verdict.storyMatch) &&
    typeof verdict.uiClean === "boolean" &&
    typeof verdict.reason === "string",
  );
}

export function planWeekThumbnailQaVerdictSha256(verdict: ThumbnailGateVerdict): string {
  return hash(verdict);
}

export function makePlanWeekThumbnailQaCheckpoint(args: {
  checkpointKey: string;
  providerRequestSha256: string;
  candidateSha256: string;
  qaRequestSha256: string;
  verdict: ThumbnailGateVerdict;
  costUsd: number;
  usageFingerprint: string;
  createdAt?: number;
}): PlanWeekThumbnailQaCheckpoint {
  const checkpoint: PlanWeekThumbnailQaCheckpoint = {
    version: PLAN_WEEK_THUMBNAIL_QA_VERSION,
    checkpointKey: args.checkpointKey,
    providerRequestSha256: args.providerRequestSha256,
    candidateSha256: args.candidateSha256,
    qaRequestSha256: args.qaRequestSha256,
    verdict: args.verdict,
    verdictSha256: planWeekThumbnailQaVerdictSha256(args.verdict),
    costUsd: Number(args.costUsd.toFixed(6)),
    usageFingerprint: args.usageFingerprint,
    createdAt: args.createdAt ?? Date.now(),
  };
  if (!validatePlanWeekThumbnailQaCheckpoint(checkpoint, {
    checkpointKey: args.checkpointKey,
    providerRequestSha256: args.providerRequestSha256,
    candidateSha256: args.candidateSha256,
  })) {
    throw new Error("plan thumbnail QA checkpoint is invalid or below the production bar");
  }
  return checkpoint;
}

export function validatePlanWeekThumbnailQaCheckpoint(
  value: unknown,
  binding: {
    checkpointKey: string;
    providerRequestSha256: string;
    candidateSha256: string;
  },
): value is PlanWeekThumbnailQaCheckpoint {
  const checkpoint = value as Partial<PlanWeekThumbnailQaCheckpoint> | null;
  return Boolean(
    checkpoint &&
    checkpoint.version === PLAN_WEEK_THUMBNAIL_QA_VERSION &&
    checkpoint.checkpointKey === binding.checkpointKey &&
    checkpoint.providerRequestSha256 === binding.providerRequestSha256 &&
    checkpoint.candidateSha256 === binding.candidateSha256 &&
    SHA256.test(checkpoint.providerRequestSha256 ?? "") &&
    SHA256.test(checkpoint.candidateSha256 ?? "") &&
    SHA256.test(checkpoint.qaRequestSha256 ?? "") &&
    SHA256.test(checkpoint.usageFingerprint ?? "") &&
    validVerdict(checkpoint.verdict) &&
    thumbnailGatePassed(checkpoint.verdict) &&
    checkpoint.verdictSha256 === planWeekThumbnailQaVerdictSha256(checkpoint.verdict) &&
    typeof checkpoint.costUsd === "number" &&
    Number.isFinite(checkpoint.costUsd) &&
    checkpoint.costUsd >= 0 &&
    typeof checkpoint.createdAt === "number" &&
    Number.isFinite(checkpoint.createdAt) &&
    checkpoint.createdAt > 0
  );
}

export function planWeekThumbnailQaCheckpointSha256(
  checkpoint: PlanWeekThumbnailQaCheckpoint,
): string {
  return hash(checkpoint);
}
