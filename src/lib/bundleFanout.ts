import { createHash } from "node:crypto";

import { canonicalJson } from "@/lib/canonicalJson";
import {
  BUNDLE_FANOUT_MAX_ENVELOPE_JSON_CHARS,
  BUNDLE_FANOUT_MAX_FOOTAGE_KEYS,
  BUNDLE_FANOUT_VERSION,
  bundleFanoutDispatchKey,
  type BundleFanoutEnvelope,
  type BundleFanoutReuse,
} from "@/lib/bundleFanoutContract";
import {
  ThirdPartyStockEvidenceReferenceSchema,
  type ThirdPartyStockEvidenceReference,
} from "@/lib/thirdPartyStockEvidence";

export {
  BUNDLE_FANOUT_DISPATCH_LEASE_MS,
  BUNDLE_FANOUT_DISPATCH_MAX_LIFETIME_MS,
  BUNDLE_FANOUT_DISPATCH_RETRY_BASE_MS,
  BUNDLE_FANOUT_DISPATCH_RETRY_MAX_MS,
  BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS,
  BUNDLE_FANOUT_QUEUE_WAIT_MAX_MS,
  BUNDLE_FANOUT_MAX_ENVELOPE_JSON_CHARS,
  BUNDLE_FANOUT_MAX_FOOTAGE_KEYS,
  BUNDLE_FANOUT_VERSION,
  bundleFanoutDispatchIsTerminal,
  bundleFanoutDispatchKey,
  bundleFanoutDispatchRetryDelayMs,
  bundleFanoutNextDispatchAt,
  type BundleFanoutEnvelope,
  type BundleFanoutReuse,
} from "@/lib/bundleFanoutContract";

export interface BundleFanoutDispatchPayload {
  readonly channelId: string;
  readonly runId: string;
  readonly reuse: {
    readonly language: string;
    readonly topic?: string;
    readonly script?: unknown;
    readonly footageKeys: string[];
    readonly thirdPartyStockEvidence?: ThirdPartyStockEvidenceReference;
    readonly musicKey?: string;
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label, maxLength);
}

function jsonClone<T>(value: T, label: string): T {
  let encoded: string;
  try {
    encoded = canonicalJson(value);
  } catch (error) {
    throw new Error(
      `${label} is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof encoded !== "string") throw new Error(`${label} is not JSON-serializable`);
  return JSON.parse(encoded) as T;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedReuse(value: BundleFanoutReuse): BundleFanoutReuse {
  const source = record(value, "bundle fanout reuse");
  const rawFootage = source.footageKeys;
  if (!Array.isArray(rawFootage) || rawFootage.length > BUNDLE_FANOUT_MAX_FOOTAGE_KEYS) {
    throw new Error(`bundle fanout footageKeys must contain 0-${BUNDLE_FANOUT_MAX_FOOTAGE_KEYS} entries`);
  }
  const footageKeys = rawFootage.map((key, index) =>
    requiredString(key, `bundle fanout footageKeys[${index}]`, 2_000),
  );
  if (new Set(footageKeys).size !== footageKeys.length) {
    throw new Error("bundle fanout footageKeys must be unique");
  }
  const script = source.script === undefined
    ? undefined
    : jsonClone(source.script, "bundle fanout script");
  const thirdPartyStockEvidence = source.thirdPartyStockEvidence === undefined
    ? undefined
    : ThirdPartyStockEvidenceReferenceSchema.parse(source.thirdPartyStockEvidence);
  return Object.freeze({
    language: requiredString(source.language, "bundle fanout language", 64),
    ...(optionalString(source.topic, "bundle fanout topic", 20_000) !== undefined
      ? { topic: optionalString(source.topic, "bundle fanout topic", 20_000) }
      : {}),
    ...(script !== undefined ? { script } : {}),
    footageKeys: Object.freeze(footageKeys),
    ...(thirdPartyStockEvidence !== undefined ? { thirdPartyStockEvidence } : {}),
    ...(optionalString(source.musicKey, "bundle fanout musicKey", 2_000) !== undefined
      ? { musicKey: optionalString(source.musicKey, "bundle fanout musicKey", 2_000) }
      : {}),
  });
}

function envelopeWithoutFingerprint(input: {
  ownerId: string;
  baseRunId: string;
  baseChannelId: string;
  siblingChannelId: string;
  reuse: BundleFanoutReuse;
}): Omit<BundleFanoutEnvelope, "dispatchEnvelopeFingerprint"> {
  const ownerId = requiredString(input.ownerId, "bundle fanout ownerId", 300);
  const baseRunId = requiredString(input.baseRunId, "bundle fanout baseRunId", 300);
  const baseChannelId = requiredString(input.baseChannelId, "bundle fanout baseChannelId", 300);
  const siblingChannelId = requiredString(input.siblingChannelId, "bundle fanout siblingChannelId", 300);
  return {
    version: BUNDLE_FANOUT_VERSION,
    ownerId,
    baseRunId,
    baseChannelId,
    siblingChannelId,
    dispatchKey: bundleFanoutDispatchKey(baseRunId, siblingChannelId),
    reuse: normalizedReuse(input.reuse),
  };
}

/**
 * Freeze the exact reuse payload before the external Trigger boundary.  A later
 * replay must dispatch this receipt, never re-derive a mutable sibling payload.
 */
export function bundleFanoutEnvelope(input: {
  ownerId: string;
  baseRunId: string;
  baseChannelId: string;
  siblingChannelId: string;
  reuse: BundleFanoutReuse;
}): BundleFanoutEnvelope {
  const candidate = envelopeWithoutFingerprint(input);
  const canonical = canonicalJson(candidate);
  if (canonical.length > BUNDLE_FANOUT_MAX_ENVELOPE_JSON_CHARS) {
    throw new Error(
      `bundle fanout envelope exceeds ${BUNDLE_FANOUT_MAX_ENVELOPE_JSON_CHARS} JSON characters`,
    );
  }
  const frozenCandidate = jsonClone(candidate, "bundle fanout envelope");
  return Object.freeze({
    ...frozenCandidate,
    dispatchEnvelopeFingerprint: sha256(canonical),
  });
}

/** Parse and authenticate a stored `v.any()` receipt before a dispatcher trusts it. */
export function parseBundleFanoutEnvelope(value: unknown): BundleFanoutEnvelope {
  const source = record(value, "bundle fanout envelope");
  if (source.version !== BUNDLE_FANOUT_VERSION) {
    throw new Error("bundle fanout envelope version is invalid");
  }
  const expected = bundleFanoutEnvelope({
    ownerId: source.ownerId as string,
    baseRunId: source.baseRunId as string,
    baseChannelId: source.baseChannelId as string,
    siblingChannelId: source.siblingChannelId as string,
    reuse: source.reuse as BundleFanoutReuse,
  });
  if (source.dispatchKey !== expected.dispatchKey) {
    throw new Error("bundle fanout envelope dispatch key is not bound to its base run and sibling");
  }
  if (source.dispatchEnvelopeFingerprint !== expected.dispatchEnvelopeFingerprint) {
    throw new Error("bundle fanout envelope fingerprint is invalid or payload changed");
  }
  return expected;
}

/** Global idempotency must stay tied to the immutable child identity, not a retry attempt. */
export function bundleFanoutDispatchSchedule(input: {
  runId: string;
  envelope: unknown;
}): {
  readonly payload: BundleFanoutDispatchPayload;
  readonly concurrencyKey: string;
  readonly idempotencySeed: string;
} {
  const runId = requiredString(input.runId, "bundle fanout child runId", 300);
  const envelope = parseBundleFanoutEnvelope(input.envelope);
  return Object.freeze({
    payload: Object.freeze({
      channelId: envelope.siblingChannelId,
      runId,
      reuse: Object.freeze({
        language: envelope.reuse.language,
        ...(envelope.reuse.topic !== undefined ? { topic: envelope.reuse.topic } : {}),
        ...(envelope.reuse.script !== undefined ? { script: envelope.reuse.script } : {}),
        footageKeys: [...envelope.reuse.footageKeys],
        ...(envelope.reuse.thirdPartyStockEvidence !== undefined
          ? { thirdPartyStockEvidence: envelope.reuse.thirdPartyStockEvidence }
          : {}),
        ...(envelope.reuse.musicKey !== undefined ? { musicKey: envelope.reuse.musicKey } : {}),
      }),
    }),
    concurrencyKey: envelope.siblingChannelId,
    idempotencySeed: envelope.dispatchKey,
  });
}
