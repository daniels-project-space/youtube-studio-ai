export const RUN_ARTIFACT_RETENTION_VERSION = "run-artifact-retention/v1" as const;
export const RUN_ARTIFACT_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;
export const RUN_ARTIFACT_RETENTION_LEASE_MS = 90 * 60 * 1_000;
export const RUN_ARTIFACT_RELEASE_CHECK_MS = 6 * 60 * 60 * 1_000;
export const RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS = 5 * 60 * 1_000;

/** Exact immutable cleanup scope, shared by the claimant and authority check. */
export function runArtifactCleanupBinding(row: {
  ownerId: string; channelId: string; runId: string; keyPrefix: string; certificateKey: string;
  additionalCertificateKeys: readonly string[]; keepNames: readonly string[];
  releaseVideoId?: string; releaseYouTubeChannelId?: string;
}): string {
  return JSON.stringify(["run-artifact-cleanup-scope/v1", row.ownerId, row.channelId, row.runId,
    row.keyPrefix, row.certificateKey, row.additionalCertificateKeys, row.keepNames,
    row.releaseVideoId, row.releaseYouTubeChannelId]);
}

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

  if (args.releaseMode === "scheduled") {
    const planned = safeTimestamp(args.scheduledPublishAt, "scheduled publish time");
    if (planned < uploadedAt) throw new Error("scheduled artifact release cannot precede its upload");
  } else if (args.scheduledPublishAt !== undefined) {
    throw new Error("public artifact retention cannot carry a scheduled publish time");
  }
  // Upload completion and a requested schedule are intent. YouTube can keep
  // either private, reject processing, or publish later. Only a later public
  // videos.list observation is allowed to start the deletion clock.
  return {
    version: RUN_ARTIFACT_RETENTION_VERSION,
    releaseMode: args.releaseMode,
    status: "awaiting_release",
  };
}

export interface RunArtifactReleaseObservation {
  videoId: string;
  channelId: string;
  privacyStatus?: string;
  uploadStatus?: string;
  publishedAt?: string;
}

export type RunArtifactReleaseDecision =
  | { released: true; releaseAt: number; retainUntil: number }
  | { released: false; reason: string };

/**
 * YouTube documents publishedAt as upload time for private/unlisted owner
 * responses, but public-release time after a private video becomes public:
 * https://developers.google.com/youtube/v3/docs/videos#snippet.publishedAt
 * Read it only after the exact video is public and successfully processed.
 */
export function evaluateRunArtifactRelease(args: {
  expectedVideoId: string;
  expectedChannelId: string;
  observedAt: number;
  observation: RunArtifactReleaseObservation | null;
}): RunArtifactReleaseDecision {
  safeTimestamp(args.observedAt, "release observation time");
  const video = args.observation;
  if (!video) return { released: false, reason: "YouTube video is missing or inaccessible" };
  if (!args.expectedVideoId || !args.expectedChannelId ||
      video.videoId !== args.expectedVideoId || video.channelId !== args.expectedChannelId) {
    return { released: false, reason: "YouTube video or channel identity does not match the saved run" };
  }
  if (video.privacyStatus !== "public") {
    return { released: false, reason: "YouTube has not confirmed a public release" };
  }
  if (video.uploadStatus !== "processed") {
    return { released: false, reason: "YouTube has not confirmed successful video processing" };
  }
  const releaseAt = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
  if (!Number.isSafeInteger(releaseAt) || releaseAt < 0 || releaseAt > args.observedAt) {
    return { released: false, reason: "YouTube public-release timestamp is missing or invalid" };
  }
  return {
    released: true,
    releaseAt,
    retainUntil: safeTimestamp(releaseAt + RUN_ARTIFACT_RETENTION_MS, "artifact retention deadline"),
  };
}

export function hasFreshRunArtifactRelease(args: {
  now: number;
  releaseConfirmedAt?: number;
  releaseObservationAt?: number;
  releaseAt?: number;
  retainUntil?: number;
}): boolean {
  return Number.isSafeInteger(args.now) &&
    Number.isSafeInteger(args.releaseConfirmedAt) &&
    Number.isSafeInteger(args.releaseObservationAt) &&
    Number.isSafeInteger(args.releaseAt) &&
    Number.isSafeInteger(args.retainUntil) &&
    args.releaseObservationAt! <= args.now &&
    args.releaseObservationAt! >= args.now - RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS &&
    args.retainUntil === args.releaseAt! + RUN_ARTIFACT_RETENTION_MS &&
    args.retainUntil <= args.now;
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
