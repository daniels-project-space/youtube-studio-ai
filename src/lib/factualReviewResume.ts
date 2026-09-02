/**
 * One-shot, globally idempotent replay of an owner-approved factual-review
 * receipt. This module has no provider or Trigger dependency so its identity
 * rules are directly testable.
 */
import {
  normalizeScheduledPlanPayload,
  type ScheduledPlanRunPayload,
} from "./scheduledPlanRuntime";

export const FACTUAL_REVIEW_RESUME_SCHEDULE_VERSION = "factual-review-resume-schedule/v1" as const;

export interface FactualReviewResumePayload {
  readonly channelId: string;
  readonly runId: string;
  readonly invocationSha256: string;
  readonly factualReviewResume: {
    readonly checkpointId: string;
    readonly checkpointFingerprint: string;
    readonly approvalFingerprint: string;
    readonly invocationSha256: string;
  };
  /**
   * The exact calendar admission envelope. This includes the content-addressed
   * weekly-preparation pointer when one was present at the original claim.
   */
  readonly scheduledPlan?: ScheduledPlanRunPayload;
}

function required(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`factual review resume ${label} is invalid`);
  }
  return value;
}

function fingerprint(value: unknown, label: string): string {
  const output = required(value, label, 80);
  if (!/^[a-f0-9]{64}$/.test(output)) throw new Error(`factual review resume ${label} must be sha256`);
  return output;
}

export function factualReviewResumeSchedule(
  input: FactualReviewResumePayload,
  options?: { readonly deliveryAttempt?: number },
): {
  readonly concurrencyKey: string;
  readonly idempotencySeed: string;
  readonly payload: FactualReviewResumePayload;
} {
  const channelId = required(input.channelId, "channel id");
  const runId = required(input.runId, "run id");
  const invocationSha256 = fingerprint(input.invocationSha256, "invocation fingerprint");
  const checkpointId = required(input.factualReviewResume.checkpointId, "checkpoint id");
  const checkpointFingerprint = fingerprint(
    input.factualReviewResume.checkpointFingerprint,
    "checkpoint fingerprint",
  );
  const approvalFingerprint = fingerprint(
    input.factualReviewResume.approvalFingerprint,
    "approval fingerprint",
  );
  if (fingerprint(input.factualReviewResume.invocationSha256, "nested invocation fingerprint") !== invocationSha256) {
    throw new Error("factual review resume invocation fingerprints do not match");
  }
  const deliveryAttempt = options?.deliveryAttempt ?? 1;
  if (!Number.isSafeInteger(deliveryAttempt) || deliveryAttempt < 1 || deliveryAttempt > 100) {
    throw new Error("factual review resume delivery attempt is invalid");
  }
  // Do this before the Trigger receipt is minted. A factual-review continuation
  // must be just as unable to silently drop or substitute a frozen preparation
  // packet as the original scheduled worker.
  const scheduledPlan = input.scheduledPlan
    ? normalizeScheduledPlanPayload(input.scheduledPlan)
    : undefined;
  const receiptSeed = [
    FACTUAL_REVIEW_RESUME_SCHEDULE_VERSION,
    runId,
    checkpointId,
    checkpointFingerprint,
    approvalFingerprint,
    invocationSha256,
  ].join(":");
  return {
    concurrencyKey: channelId,
    // Keep the original receipt identity for delivery one so existing queued
    // work remains deduplicated across deployment. A later delivery after a
    // bounded queue expiry needs a distinct Trigger key, but carries the
    // exact same owner-approved payload and immutable fingerprints.
    idempotencySeed:
      deliveryAttempt === 1 ? receiptSeed : `${receiptSeed}:delivery:${deliveryAttempt}`,
    payload: {
      ...input,
      ...(scheduledPlan ? { scheduledPlan } : {}),
    },
  };
}
