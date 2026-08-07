/**
 * Leave enough wall-clock time for the upload request to start without a
 * stale timestamp turning into an immediate public release. YouTube documents
 * that a past publishAt publishes immediately, so this is a safety boundary,
 * not a provider scheduling delay.
 */
export const SCHEDULED_UPLOAD_MIN_LEAD_MS = 5 * 60_000;

export type PublishPrivacyStatus = "private" | "unlisted" | "public";

function timestamp(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite epoch timestamp`);
  }
  return value;
}

/**
 * Resolve the first provider-dispatch time independently of public publishAt.
 * A future YouTube schedule is uploaded as soon as its ready artifact is
 * admitted unless the caller explicitly asks for a later dispatch time.
 */
export function resolvePublishDispatchAt(args: {
  createdAt: number;
  dispatchRequestedAt?: number;
  publishAt?: number;
  privacyStatus: PublishPrivacyStatus;
}): number {
  const createdAt = timestamp(args.createdAt, "createdAt");
  const dispatchAt = timestamp(args.dispatchRequestedAt ?? createdAt, "dispatchRequestedAt");
  if (dispatchAt < createdAt) {
    throw new Error("dispatchRequestedAt cannot precede intent creation");
  }
  if (args.publishAt === undefined) return dispatchAt;

  const publishAt = timestamp(args.publishAt, "publishAt");
  if (args.privacyStatus !== "private") {
    throw new Error("scheduled YouTube publication requires private upload privacy");
  }
  if (publishAt - dispatchAt < SCHEDULED_UPLOAD_MIN_LEAD_MS) {
    throw new Error(
      `scheduled publishAt must be at least ${SCHEDULED_UPLOAD_MIN_LEAD_MS / 60_000} minutes after dispatch`,
    );
  }
  return dispatchAt;
}

export function scheduledPublishWindowElapsed(args: {
  now: number;
  publishAt?: number;
}): boolean {
  if (args.publishAt === undefined) return false;
  return args.publishAt - args.now < SCHEDULED_UPLOAD_MIN_LEAD_MS;
}

/**
 * One-time compatibility repair for intents written before dispatchAt existed.
 * Retry rows are deliberately excluded so an idempotent createOrGet call can
 * never erase their backoff.
 */
export function reconcileLegacyDispatchTiming(args: {
  status: string;
  attempts: number;
  dispatchAt?: number;
  nextAttemptAt: number;
  requestedDispatchAt: number;
}): { dispatchAt: number; nextAttemptAt: number } | undefined {
  if (
    args.dispatchAt !== undefined ||
    args.attempts !== 0 ||
    (args.status !== "approved" && args.status !== "scheduled")
  ) {
    return undefined;
  }
  return {
    dispatchAt: args.requestedDispatchAt,
    nextAttemptAt: Math.min(args.nextAttemptAt, args.requestedDispatchAt),
  };
}

export function isPublishIntentDispatchDue(
  intent: { status: string; nextAttemptAt: number },
  now: number,
): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(intent.nextAttemptAt)) return false;
  return (
    (intent.status === "approved" ||
      intent.status === "scheduled" ||
      intent.status === "retry_wait") &&
    intent.nextAttemptAt <= now
  );
}
