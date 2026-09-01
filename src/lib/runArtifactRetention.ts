export const RUN_ARTIFACT_RETENTION_VERSION = "run-artifact-retention/v1" as const;
export const RUN_ARTIFACT_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;
export const RUN_ARTIFACT_RETENTION_LEASE_MS = 90 * 60 * 1_000;

export type RunArtifactReleaseMode = "private_draft" | "scheduled" | "public";

export interface RunArtifactRetentionSchedule {
  readonly version: typeof RUN_ARTIFACT_RETENTION_VERSION;
  readonly releaseMode: RunArtifactReleaseMode;
  readonly releaseAt?: number;
  readonly retainUntil?: number;
  readonly status: "awaiting_release" | "pending";
}

function safeTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative millisecond timestamp`);
  }
  return value as number;
}

export function scheduleRunArtifactRetention(args: {
  readonly releaseMode: RunArtifactReleaseMode;
  readonly uploadedAt: number;
  readonly scheduledPublishAt?: number;
}): RunArtifactRetentionSchedule {
  const uploadedAt = safeTimestamp(args.uploadedAt, "artifact upload time");
  if (args.releaseMode === "private_draft") {
    if (args.scheduledPublishAt !== undefined) {
      throw new Error("private-draft artifact retention cannot carry a scheduled publish time");
    }
    return {
      version: RUN_ARTIFACT_RETENTION_VERSION,
      releaseMode: "private_draft",
      status: "awaiting_release",
    };
  }

  const releaseAt = args.releaseMode === "scheduled"
    ? safeTimestamp(args.scheduledPublishAt, "scheduled publish time")
    : uploadedAt;
  if (args.releaseMode === "scheduled" && releaseAt < uploadedAt) {
    throw new Error("scheduled artifact release cannot precede its upload");
  }
  const retainUntil = safeTimestamp(
    releaseAt + RUN_ARTIFACT_RETENTION_MS,
    "artifact retention deadline",
  );
  return {
    version: RUN_ARTIFACT_RETENTION_VERSION,
    releaseMode: args.releaseMode,
    releaseAt,
    retainUntil,
    status: "pending",
  };
}

export function validateRunArtifactKeepNames(value: readonly string[]): string[] {
  const normalized = [...new Set(value.map((name) => name.trim()))].sort();
  if (
    normalized.length < 1 ||
    normalized.length > 20 ||
    normalized.some((name) =>
      !name ||
      name.length > 120 ||
      name.includes("/") ||
      name.includes("\\") ||
      name === "." ||
      name === ".." ||
      /[\u0000-\u001f]/.test(name))
  ) {
    throw new Error("artifact retention keep names must be bounded run-local filenames");
  }
  return normalized;
}

export function expectedChannelKeyPrefix(args: {
  readonly ownerId: string;
  readonly channelSlug: string;
}): string {
  const clean = (value: string) => value.replace(/^\/+|\/+$/g, "");
  const ownerId = clean(args.ownerId);
  const channelSlug = clean(args.channelSlug);
  if (!ownerId || !channelSlug || ownerId.includes("/") || channelSlug.includes("/")) {
    throw new Error("artifact retention owner/channel namespace is invalid");
  }
  return `owner/${ownerId}/channel/${channelSlug}/`;
}

export function validateRunArtifactRetentionObjectKeys(args: {
  readonly keyPrefix: string;
  readonly runId: string;
  readonly certificateKey: string;
  readonly additionalCertificateKeys?: readonly string[];
}): { keyPrefix: string; certificateKey: string; additionalCertificateKeys: string[] } {
  const runPrefix = `${args.keyPrefix}runs/${args.runId}/`;
  if (!args.keyPrefix || !args.runId || !args.certificateKey.startsWith(runPrefix)) {
    throw new Error("artifact retention certificate is outside its exact run namespace");
  }
  const additionalCertificateKeys = [...new Set(args.additionalCertificateKeys ?? [])].sort();
  if (
    additionalCertificateKeys.length > 10 ||
    additionalCertificateKeys.includes(args.certificateKey) ||
    additionalCertificateKeys.some((key) => !key.startsWith(runPrefix))
  ) {
    throw new Error("artifact retention derivative certificate is outside its exact run namespace");
  }
  return {
    keyPrefix: args.keyPrefix,
    certificateKey: args.certificateKey,
    additionalCertificateKeys,
  };
}

export function dueRunArtifactRetentionLease(args: {
  readonly now: number;
  readonly token: string;
}): { leaseToken: string; leaseExpiresAt: number } {
  const now = safeTimestamp(args.now, "artifact retention claim time");
  if (!/^[a-f0-9]{32,128}$/.test(args.token)) {
    throw new Error("artifact retention lease token is invalid");
  }
  return {
    leaseToken: args.token,
    leaseExpiresAt: safeTimestamp(
      now + RUN_ARTIFACT_RETENTION_LEASE_MS,
      "artifact retention lease expiry",
    ),
  };
}
