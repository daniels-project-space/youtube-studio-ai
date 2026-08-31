/**
 * A durable reviewed-data-story admission is dispatched by a provider-free
 * outbox. This module owns only the immutable Trigger identity; it cannot
 * create a run, read facts, or start a provider.
 */
export const REVIEWED_DATA_STORY_INITIAL_DISPATCH_VERSION =
  "reviewed-data-story-initial-dispatch/v1" as const;

export interface ReviewedDataStoryInitialDispatchPayload {
  readonly channelId: string;
  readonly runId: string;
  readonly reviewedEvidencePackSelector: {
    readonly packId: string;
    readonly contentFingerprint: string;
  };
  readonly reviewedDataStoryInitialAdmission: {
    readonly admissionFingerprint: string;
  };
}

function required(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`reviewed data-story initial dispatch ${label} is invalid`);
  }
  return value;
}

function fingerprint(value: unknown, label: string): string {
  const output = required(value, label, 80);
  if (!/^[a-f0-9]{64}$/.test(output)) {
    throw new Error(`reviewed data-story initial dispatch ${label} must be sha256`);
  }
  return output;
}

export function reviewedDataStoryInitialDispatchSchedule(
  input: ReviewedDataStoryInitialDispatchPayload,
  options?: { readonly deliveryAttempt?: number },
): {
  readonly concurrencyKey: string;
  readonly idempotencySeed: string;
  readonly payload: ReviewedDataStoryInitialDispatchPayload;
} {
  const channelId = required(input.channelId, "channel id");
  const runId = required(input.runId, "run id");
  const packId = required(input.reviewedEvidencePackSelector.packId, "pack id");
  const contentFingerprint = fingerprint(
    input.reviewedEvidencePackSelector.contentFingerprint,
    "pack content fingerprint",
  );
  const admissionFingerprint = fingerprint(
    input.reviewedDataStoryInitialAdmission.admissionFingerprint,
    "admission fingerprint",
  );
  const deliveryAttempt = options?.deliveryAttempt ?? 1;
  if (!Number.isSafeInteger(deliveryAttempt) || deliveryAttempt < 1 || deliveryAttempt > 2) {
    throw new Error("reviewed data-story initial dispatch delivery attempt is invalid");
  }
  const receiptSeed = [
    REVIEWED_DATA_STORY_INITIAL_DISPATCH_VERSION,
    runId,
    packId,
    contentFingerprint,
    admissionFingerprint,
  ].join(":");
  return Object.freeze({
    concurrencyKey: channelId,
    idempotencySeed: deliveryAttempt === 1 ? receiptSeed : `${receiptSeed}:delivery:${deliveryAttempt}`,
    payload: input,
  });
}
