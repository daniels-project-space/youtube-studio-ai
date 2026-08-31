/**
 * Database-independent integrity checks for the write-once upload provenance
 * record. The record is observational only: no score, outcome, or policy is
 * accepted here.
 */
export type ReleaseEvidenceCoverage = "complete" | "partial" | "unmeasured";
export type StoryMeasurementCoverage =
  | "unmeasured"
  | "plan_only"
  | "final_master"
  | "scope_undeclared";

export interface VideoReleaseProvenanceProgramRoute {
  routeFingerprint: string;
  family: string;
  contentLaneKey: string;
  /** Optional on historical routes that predate the program-brief binding. */
  programBriefFingerprint?: string;
}

export interface VideoReleaseProvenanceWrite {
  ownerId: string;
  channelId: string;
  runId: string;
  publishIntentId: string;
  youtubeVideoId: string;
  releaseCertificateKey: string;
  releaseCertificateFingerprint: string;
  finalMasterSha256: string;
  qualityBindingVersion: string;
  qualityBindingFingerprint: string;
  qualityEvidenceFingerprint: string;
  contentLaneKey: string;
  renderer: string;
  programRoute?: VideoReleaseProvenanceProgramRoute;
  evidenceStatus: ReleaseEvidenceCoverage;
  /** Scope only: `plan_only` is pre-render; `final_master` is never an all-covered claim. */
  storyMeasurementCoverage?: StoryMeasurementCoverage;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const STORY_MEASUREMENT_COVERAGES: readonly StoryMeasurementCoverage[] = [
  "unmeasured",
  "plan_only",
  "final_master",
  "scope_undeclared",
];

function assertText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`videoReleaseProvenance.record: ${label} is required`);
}

function assertSha256(value: string, label: string): void {
  if (!SHA256.test(value)) {
    throw new Error(`videoReleaseProvenance.record: ${label} must be a SHA-256 fingerprint`);
  }
}

function sameProgramRoute(
  left: VideoReleaseProvenanceWrite["programRoute"],
  right: VideoReleaseProvenanceWrite["programRoute"],
): boolean {
  return left?.routeFingerprint === right?.routeFingerprint &&
    left?.family === right?.family &&
    left?.contentLaneKey === right?.contentLaneKey &&
    left?.programBriefFingerprint === right?.programBriefFingerprint;
}

/**
 * The stored row is authoritative. A pre-extension row may lack either
 * optional field, but a retry may never erase or replace a value it stored.
 */
function storedProgramRouteMatches(
  stored: VideoReleaseProvenanceWrite["programRoute"],
  incoming: VideoReleaseProvenanceWrite["programRoute"],
): boolean {
  if (stored === undefined) return true;
  if (incoming === undefined) return false;
  return stored.routeFingerprint === incoming.routeFingerprint &&
    stored.family === incoming.family &&
    stored.contentLaneKey === incoming.contentLaneKey &&
    (stored.programBriefFingerprint === undefined ||
      stored.programBriefFingerprint === incoming.programBriefFingerprint);
}

function sameRequiredVideoReleaseProvenance(
  left: VideoReleaseProvenanceWrite,
  right: VideoReleaseProvenanceWrite,
): boolean {
  return left.ownerId === right.ownerId &&
    left.channelId === right.channelId &&
    left.runId === right.runId &&
    left.publishIntentId === right.publishIntentId &&
    left.youtubeVideoId === right.youtubeVideoId &&
    left.releaseCertificateKey === right.releaseCertificateKey &&
    left.releaseCertificateFingerprint === right.releaseCertificateFingerprint &&
    left.finalMasterSha256 === right.finalMasterSha256 &&
    left.qualityBindingVersion === right.qualityBindingVersion &&
    left.qualityBindingFingerprint === right.qualityBindingFingerprint &&
    left.qualityEvidenceFingerprint === right.qualityEvidenceFingerprint &&
    left.contentLaneKey === right.contentLaneKey &&
    left.renderer === right.renderer &&
    left.evidenceStatus === right.evidenceStatus;
}

export function assertVideoReleaseProvenanceWrite(
  value: VideoReleaseProvenanceWrite,
): void {
  assertText(value.ownerId, "owner id");
  assertText(value.channelId, "channel id");
  assertText(value.runId, "run id");
  assertText(value.publishIntentId, "publish intent id");
  assertText(value.youtubeVideoId, "YouTube video id");
  assertText(value.releaseCertificateKey, "release certificate key");
  assertText(value.qualityBindingVersion, "quality binding version");
  assertText(value.contentLaneKey, "content lane key");
  assertText(value.renderer, "renderer");
  assertSha256(value.releaseCertificateFingerprint, "release certificate fingerprint");
  assertSha256(value.finalMasterSha256, "final master digest");
  assertSha256(value.qualityBindingFingerprint, "quality binding fingerprint");
  assertSha256(value.qualityEvidenceFingerprint, "quality evidence fingerprint");
  if (value.programRoute) {
    assertText(value.programRoute.family, "program route family");
    assertText(value.programRoute.contentLaneKey, "program route content lane");
    assertSha256(value.programRoute.routeFingerprint, "program route fingerprint");
    if (value.programRoute.programBriefFingerprint !== undefined) {
      assertSha256(value.programRoute.programBriefFingerprint, "program brief fingerprint");
    }
    if (value.programRoute.contentLaneKey !== value.contentLaneKey) {
      throw new Error("videoReleaseProvenance.record: program route does not match content lane");
    }
  }
  if (
    value.storyMeasurementCoverage !== undefined &&
    !STORY_MEASUREMENT_COVERAGES.includes(value.storyMeasurementCoverage)
  ) {
    throw new Error("videoReleaseProvenance.record: invalid story measurement coverage");
  }
}

export function sameImmutableVideoReleaseProvenance(
  left: VideoReleaseProvenanceWrite,
  right: VideoReleaseProvenanceWrite,
): boolean {
  return sameRequiredVideoReleaseProvenance(left, right) &&
    sameProgramRoute(left.programRoute, right.programRoute) &&
    left.storyMeasurementCoverage === right.storyMeasurementCoverage;
}

/**
 * True only when an existing immutable row can safely satisfy a retry. This
 * direction intentionally tolerates metadata absent on the stored historical
 * row; the row is returned unchanged and is never backfilled.
 */
export function sameRetryableVideoReleaseProvenance(
  stored: VideoReleaseProvenanceWrite,
  incoming: VideoReleaseProvenanceWrite,
): boolean {
  return sameRequiredVideoReleaseProvenance(stored, incoming) &&
    storedProgramRouteMatches(stored.programRoute, incoming.programRoute) &&
    (stored.storyMeasurementCoverage === undefined ||
      stored.storyMeasurementCoverage === incoming.storyMeasurementCoverage);
}

/**
 * The point-in-time, observational subset copied into a video analytics row.
 * It deliberately preserves story scope without translating `plan_only` into
 * a final-master, quality, performance, or causal claim.
 */
export interface VideoReleaseProvenanceAnalyticsSource<
  ProvenanceId extends string = string,
  RunId extends string = string,
> {
  _id: ProvenanceId;
  version: "video-release-provenance/v1";
  runId: RunId;
  releaseCertificateKey: string;
  releaseCertificateFingerprint: string;
  finalMasterSha256: string;
  qualityBindingVersion: string;
  qualityBindingFingerprint: string;
  qualityEvidenceFingerprint: string;
  contentLaneKey: string;
  renderer: string;
  programRoute?: VideoReleaseProvenanceProgramRoute;
  releaseEvidenceStatus: "release_evidence_recorded";
  evidenceStatus: ReleaseEvidenceCoverage;
  storyMeasurementCoverage?: StoryMeasurementCoverage;
  uploadedAt: number;
  recordedAt: number;
}

export function observedVideoReleaseProvenanceFromRecord<
  ProvenanceId extends string,
  RunId extends string,
>(
  record: VideoReleaseProvenanceAnalyticsSource<ProvenanceId, RunId>,
) {
  return {
    provenanceId: record._id,
    version: record.version,
    runId: record.runId,
    releaseCertificateKey: record.releaseCertificateKey,
    releaseCertificateFingerprint: record.releaseCertificateFingerprint,
    finalMasterSha256: record.finalMasterSha256,
    qualityBindingVersion: record.qualityBindingVersion,
    qualityBindingFingerprint: record.qualityBindingFingerprint,
    qualityEvidenceFingerprint: record.qualityEvidenceFingerprint,
    contentLaneKey: record.contentLaneKey,
    renderer: record.renderer,
    ...(record.programRoute === undefined
      ? {}
      : {
          programRoute: {
            routeFingerprint: record.programRoute.routeFingerprint,
            family: record.programRoute.family,
            contentLaneKey: record.programRoute.contentLaneKey,
            ...(record.programRoute.programBriefFingerprint === undefined
              ? {}
              : { programBriefFingerprint: record.programRoute.programBriefFingerprint }),
          },
        }),
    releaseEvidenceStatus: record.releaseEvidenceStatus,
    evidenceStatus: record.evidenceStatus,
    ...(record.storyMeasurementCoverage === undefined
      ? {}
      : { storyMeasurementCoverage: record.storyMeasurementCoverage }),
    uploadedAt: record.uploadedAt,
    recordedAt: record.recordedAt,
  };
}

export function assertVideoReleaseProvenanceDatabaseBinding(args: {
  write: VideoReleaseProvenanceWrite;
  channel: { ownerId: string } | null;
  run: {
    ownerId: string;
    channelId: string;
    youtubeVideoId?: string;
    releaseEvidenceStatus?: unknown;
    releaseEvidenceCertificateKey?: string;
    releaseEvidenceCertificateFingerprint?: string;
  } | null;
  intent: {
    ownerId: string;
    channelId: string;
    runId?: string;
    status: string;
    youtubeVideoId?: string;
    videoSha256: string;
    completedAt?: number;
  } | null;
}): { uploadedAt: number } {
  const { write, channel, run, intent } = args;
  const completedAt = intent?.completedAt;
  if (!channel || channel.ownerId !== write.ownerId) {
    throw new Error("videoReleaseProvenance.record: channel owner mismatch");
  }
  if (!run || run.ownerId !== write.ownerId || run.channelId !== write.channelId) {
    throw new Error("videoReleaseProvenance.record: run owner/channel mismatch");
  }
  if (run.youtubeVideoId !== write.youtubeVideoId) {
    throw new Error("videoReleaseProvenance.record: run YouTube video mismatch");
  }
  if (
    run.releaseEvidenceStatus !== "release_evidence_recorded" ||
    run.releaseEvidenceCertificateKey !== write.releaseCertificateKey ||
    run.releaseEvidenceCertificateFingerprint !== write.releaseCertificateFingerprint
  ) {
    throw new Error("videoReleaseProvenance.record: run release certificate mismatch");
  }
  if (
    !intent ||
    intent.ownerId !== write.ownerId ||
    intent.channelId !== write.channelId ||
    intent.runId !== write.runId ||
    intent.status !== "uploaded" ||
    intent.youtubeVideoId !== write.youtubeVideoId ||
    intent.videoSha256 !== write.finalMasterSha256 ||
    typeof completedAt !== "number" ||
    !Number.isSafeInteger(completedAt) ||
    completedAt < 0
  ) {
    throw new Error("videoReleaseProvenance.record: publish upload identity mismatch");
  }
  return { uploadedAt: completedAt };
}
