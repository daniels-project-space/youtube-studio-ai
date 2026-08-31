import {
  MAX_REMOTE_CHILD_WAIT_LEASE_MS,
  RENDER_CHILD_WAIT_DISPATCH_GRACE_MS,
} from "./renderChildLease";
import type { ThirdPartyStockEvidenceReference } from "@/lib/thirdPartyStockEvidence";

/** Immutable wire contract for one base-run → language-sibling handoff. */
export const BUNDLE_FANOUT_VERSION = "bundle_fanout/v1" as const;

/** A transient Trigger outage must surface for reconciliation instead of retrying forever. */
export const BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS = 5;
export const BUNDLE_FANOUT_DISPATCH_RETRY_BASE_MS = 15_000;
export const BUNDLE_FANOUT_DISPATCH_RETRY_MAX_MS = 4 * 60_000;
export const BUNDLE_FANOUT_DISPATCH_LEASE_MS = 2 * 60_000;
export const BUNDLE_FANOUT_DISPATCH_MAX_LIFETIME_MS = 30 * 60_000;

/**
 * A same-channel child may sit behind one admitted checkpointed remote render.
 * Keep that exceptional queue wait bounded to its documented maximum plus the
 * child's own Trigger handoff grace; ordinary queued runs retain their 3-hour
 * reaper policy.
 */
export const BUNDLE_FANOUT_QUEUE_WAIT_MAX_MS =
  MAX_REMOTE_CHILD_WAIT_LEASE_MS + RENDER_CHILD_WAIT_DISPATCH_GRACE_MS;

/** Keep the durable Convex receipt and Trigger payload comfortably below their document limits. */
export const BUNDLE_FANOUT_MAX_ENVELOPE_JSON_CHARS = 250_000;
export const BUNDLE_FANOUT_MAX_FOOTAGE_KEYS = 160;

export interface BundleFanoutReuse {
  readonly language: string;
  readonly topic?: string;
  readonly script?: unknown;
  readonly footageKeys: readonly string[];
  /** Immutable evidence copied with the reusable footage, when it is stock. */
  readonly thirdPartyStockEvidence?: ThirdPartyStockEvidenceReference;
  readonly musicKey?: string;
}

export interface BundleFanoutEnvelope {
  readonly version: typeof BUNDLE_FANOUT_VERSION;
  readonly ownerId: string;
  readonly baseRunId: string;
  readonly baseChannelId: string;
  readonly siblingChannelId: string;
  /** Stable across base-stage replay, the dispatcher, and a lost Trigger response. */
  readonly dispatchKey: string;
  readonly reuse: BundleFanoutReuse;
  /** SHA-256 of the exact canonical envelope excluding this field. */
  readonly dispatchEnvelopeFingerprint: string;
}

function requiredIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 300) {
    throw new Error(`${label} must contain 1-300 characters`);
  }
  return normalized;
}

/** Stable identity for exactly one sibling handoff from one base pipeline run. */
export function bundleFanoutDispatchKey(baseRunId: string, siblingChannelId: string): string {
  const base = requiredIdentity(baseRunId, "bundle fanout baseRunId");
  const sibling = requiredIdentity(siblingChannelId, "bundle fanout siblingChannelId");
  return `${BUNDLE_FANOUT_VERSION}:${base}:${sibling}`;
}

/** Exponential but bounded re-entry. Attempts beyond the cap require manual reconciliation. */
export function bundleFanoutDispatchRetryDelayMs(attempt: number): number {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    attempt > BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS
  ) {
    throw new Error("bundle fanout dispatch attempt is invalid or exhausted");
  }
  return Math.min(
    BUNDLE_FANOUT_DISPATCH_RETRY_BASE_MS * (2 ** (attempt - 1)),
    BUNDLE_FANOUT_DISPATCH_RETRY_MAX_MS,
  );
}

export function bundleFanoutNextDispatchAt(now: number, attempt: number): number {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("bundle fanout dispatch clock is invalid");
  }
  return now + bundleFanoutDispatchRetryDelayMs(attempt);
}

export function bundleFanoutDispatchIsTerminal(attempt: number): boolean {
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new Error("bundle fanout dispatch attempt is invalid");
  }
  return attempt >= BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS;
}
