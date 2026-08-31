import assert from "node:assert/strict";

import type {
  DataModel,
  Doc,
  TableNames,
} from "../../../convex/_generated/dataModel.js";
import { buildQualityEvidence } from "@/engine/qualityEvidence";
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  createFinalMasterReleaseCertificate,
  finalMasterReleaseCertificateKey,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import { createFinalMasterQualityEvidenceBinding } from "@/lib/finalMasterQualityEvidenceBinding";
import {
  VIDEO_RELEASE_PROVENANCE_VERSION,
  videoReleaseProvenanceClaimFromCertificate,
} from "@/lib/videoReleaseProvenance";
import {
  assertVideoReleaseProvenanceWrite,
  assertVideoReleaseProvenanceDatabaseBinding,
  observedVideoReleaseProvenanceFromRecord,
  sameImmutableVideoReleaseProvenance,
  sameRetryableVideoReleaseProvenance,
} from "@/lib/videoReleaseProvenanceIntegrity";

type Equal<Left, Right> = (
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false
);
type Assert<Condition extends true> = Condition;

// Keep the source-level provenance seam aligned with Convex's schema-derived
// generated model. This is intentionally outside `convex/_generated/`: that
// declaration correctly derives all table/index types from `typeof schema`.
type ProvenanceIndexes = DataModel["videoReleaseProvenance"]["indexes"];
type ProvenanceDocument = Doc<"videoReleaseProvenance">;
type VideoAnalyticsDocument = Doc<"videoAnalytics">;
type ObservedReleaseProvenance = NonNullable<
  VideoAnalyticsDocument["observedReleaseProvenance"]
>;
type _ProvenanceTableIsRegistered = Assert<
  "videoReleaseProvenance" extends TableNames ? true : false
>;
type _ByOwnerYoutubeVideoIndexMatchesSchema = Assert<
  Equal<
    ProvenanceIndexes["by_owner_youtube_video"],
    ["ownerId", "youtubeVideoId", "_creationTime"]
  >
>;
type _ByYoutubeVideoIndexMatchesSchema = Assert<
  Equal<
    ProvenanceIndexes["by_youtube_video"],
    ["youtubeVideoId", "_creationTime"]
  >
>;
type _ByChannelIndexMatchesSchema = Assert<
  Equal<
    ProvenanceIndexes["by_channel"],
    ["channelId", "_creationTime"]
  >
>;
type _ByRunIndexMatchesSchema = Assert<
  Equal<ProvenanceIndexes["by_run"], ["runId", "_creationTime"]>
>;
type _ProvenanceDocumentFieldsMatchSchema = Pick<
  ProvenanceDocument,
  | "ownerId"
  | "channelId"
  | "runId"
  | "publishIntentId"
  | "youtubeVideoId"
  | "version"
  | "releaseCertificateKey"
  | "releaseCertificateFingerprint"
  | "finalMasterSha256"
  | "qualityBindingVersion"
  | "qualityBindingFingerprint"
  | "qualityEvidenceFingerprint"
  | "contentLaneKey"
  | "renderer"
  | "programRoute"
  | "releaseEvidenceStatus"
  | "evidenceStatus"
  | "storyMeasurementCoverage"
  | "uploadedAt"
  | "recordedAt"
>;
type _ObservedReleaseProvenanceFieldsMatchSchema = Pick<
  ObservedReleaseProvenance,
  | "programRoute"
  | "evidenceStatus"
  | "storyMeasurementCoverage"
>;

const keyPrefix = "owner/alice/channel/provenance/";
const runId = "run-provenance";
const masterSha256 = "a".repeat(64);
const lane = { key: "narrated_documentary", renderer: "stock_footage" };
const visualReview = {
  reviewFingerprint: "review-provenance",
  reviewReceiptVersion: "visual-review-release-receipt/v1",
  reviewReceiptFingerprint: "b".repeat(64),
  releaseReceiptFingerprint: "c".repeat(64),
};
const qualityEvidence = buildQualityEvidence({
  episode: { lane, topic: "A release-provenance test" },
  technical: { passed: true, evaluator: "container-check", evidence: ["valid"] },
  visual: { passed: true, evaluator: "visual-review", evidence: ["durable"] },
  temporal: { passed: true, evaluator: "pacing-review", evidence: ["valid"] },
  narrative: { passed: true, evaluator: "story-review", evidence: ["valid"] },
  audio: {
    score: 8,
    minimumScore: 7,
    evaluator: "audio-review",
    evidence: ["valid"],
  },
  brand: { passed: true, evaluator: "brand-review", evidence: ["valid"] },
});
const binding = createFinalMasterQualityEvidenceBinding({
  finalMaster: { sha256: masterSha256, durationSec: 120 },
  visualReview,
  contentLane: lane,
  programRoute: {
    routeFingerprint: "d".repeat(64),
    family: "narrated_stock",
    contentLaneKey: lane.key,
    programBriefFingerprint: "f".repeat(64),
  },
  qualityEvidence,
});
const frameKey = `${keyPrefix}runs/${runId}/visual-review/frames/f001.jpg`;
const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/final.mp4`,
    sha256: masterSha256,
    byteLength: 1_024,
    durationSec: 120,
  },
  visualReview: {
    evidenceManifestKey: `${keyPrefix}runs/${runId}/visual-review/manifest.json`,
    evidenceFrameKeys: [frameKey],
    evidenceFrameArtifacts: [{
      r2Key: frameKey,
      contentSha256: "e".repeat(64),
      byteLength: 128,
    }],
    receiptKey: visualReviewReleaseReceiptKey(
      keyPrefix,
      runId,
      visualReview.releaseReceiptFingerprint,
    ),
    ...visualReview,
  },
  qualityEvidence: binding,
});
const certificateKey = finalMasterReleaseCertificateKey(
  keyPrefix,
  runId,
  certificate.certificateFingerprint,
);

const claim = videoReleaseProvenanceClaimFromCertificate({
  certificate,
  releaseCertificateKey: certificateKey,
  expectedFinalMasterSha256: masterSha256,
});
assert.ok(claim, "a shared quality binding creates an observational provenance claim");
assert.deepEqual(claim, {
  version: VIDEO_RELEASE_PROVENANCE_VERSION,
  releaseCertificateKey: certificateKey,
  releaseCertificateFingerprint: certificate.certificateFingerprint,
  finalMasterSha256: masterSha256,
  qualityBindingVersion: binding.version,
  qualityBindingFingerprint: binding.bindingFingerprint,
  qualityEvidenceFingerprint: binding.qualityEvidenceFingerprint,
  contentLaneKey: lane.key,
  renderer: lane.renderer,
  programRoute: binding.programRoute,
  evidenceStatus: binding.evidenceCoverage,
  storyMeasurementCoverage: binding.storyMeasurementCoverage,
});
assert.equal("qualityScore" in claim, false, "provenance stores no quality score");
assert.equal("outcome" in claim, false, "provenance stores no outcome claim");

const write = {
  ownerId: "owner-alice",
  channelId: "channel-alice",
  runId: "run-alice",
  publishIntentId: "intent-alice",
  youtubeVideoId: "youtube-video-alice",
  ...claim,
};
assert.doesNotThrow(
  () => assertVideoReleaseProvenanceWrite(write),
  "the certificate projection is accepted by the immutable write validator",
);
const databaseBinding = {
  channel: { ownerId: write.ownerId },
  run: {
    ownerId: write.ownerId,
    channelId: write.channelId,
    youtubeVideoId: write.youtubeVideoId,
    releaseEvidenceStatus: "release_evidence_recorded",
    releaseEvidenceCertificateKey: write.releaseCertificateKey,
    releaseEvidenceCertificateFingerprint: write.releaseCertificateFingerprint,
  },
  intent: {
    ownerId: write.ownerId,
    channelId: write.channelId,
    runId: write.runId,
    status: "uploaded",
    youtubeVideoId: write.youtubeVideoId,
    videoSha256: write.finalMasterSha256,
    completedAt: 1_700_000_000_000,
  },
};
assert.deepEqual(
  assertVideoReleaseProvenanceDatabaseBinding({ write, ...databaseBinding }),
  { uploadedAt: databaseBinding.intent.completedAt },
  "the immutable row must match the durable channel, run, and uploaded intent",
);
assert.throws(
  () => assertVideoReleaseProvenanceDatabaseBinding({
    write,
    ...databaseBinding,
    channel: { ownerId: "owner-other" },
  }),
  /channel owner mismatch/,
  "cross-owner mappings fail closed",
);
assert.throws(
  () => assertVideoReleaseProvenanceDatabaseBinding({
    write,
    ...databaseBinding,
    run: { ...databaseBinding.run, youtubeVideoId: "youtube-video-other" },
  }),
  /run YouTube video mismatch/,
  "cross-video mappings fail closed",
);
assert.throws(
  () => assertVideoReleaseProvenanceDatabaseBinding({
    write,
    ...databaseBinding,
    run: {
      ...databaseBinding.run,
      releaseEvidenceCertificateFingerprint: "f".repeat(64),
    },
  }),
  /run release certificate mismatch/,
  "a run cannot be linked to a different certificate",
);
assert.throws(
  () => assertVideoReleaseProvenanceDatabaseBinding({
    write,
    ...databaseBinding,
    intent: { ...databaseBinding.intent, runId: "run-other" },
  }),
  /publish upload identity mismatch/,
  "cross-run mappings fail closed",
);
assert.equal(
  sameImmutableVideoReleaseProvenance(write, { ...write }),
  true,
  "an exact retry is idempotent",
);
assert.equal(
  sameImmutableVideoReleaseProvenance(write, {
    ...write,
    qualityBindingFingerprint: "f".repeat(64),
  }),
  false,
  "a retry cannot replace immutable quality-binding provenance",
);
const planOnlyWrite = {
  ...write,
  storyMeasurementCoverage: "plan_only" as const,
};
assert.doesNotThrow(
  () => assertVideoReleaseProvenanceWrite(planOnlyWrite),
  "plan-only story provenance is a valid observational write",
);
assert.equal(
  sameImmutableVideoReleaseProvenance(write, planOnlyWrite),
  false,
  "a retry cannot replace the immutable story-measurement scope",
);
const observedPlanOnly = observedVideoReleaseProvenanceFromRecord({
  _id: "provenance-row-plan-only",
  ...planOnlyWrite,
  releaseEvidenceStatus: "release_evidence_recorded" as const,
  uploadedAt: 1_700_000_000_000,
  recordedAt: 1_700_000_000_100,
});
assert.equal(
  observedPlanOnly.storyMeasurementCoverage,
  "plan_only",
  "analytics retains the plan-only distinction without inferring final-master coverage",
);
assert.deepEqual(
  observedPlanOnly.programRoute,
  binding.programRoute,
  "analytics preserves the optional program-brief route binding",
);
assert.equal(
  "qualityScore" in observedPlanOnly,
  false,
  "analytics provenance remains observational rather than a quality score",
);
const { storyMeasurementCoverage: _historicalStoryScope, ...legacyWrite } = write;
assert.doesNotThrow(
  () => assertVideoReleaseProvenanceWrite(legacyWrite),
  "historical writes without a story-measurement scope remain readable",
);
const observedLegacy = observedVideoReleaseProvenanceFromRecord({
  _id: "provenance-row-legacy",
  ...legacyWrite,
  releaseEvidenceStatus: "release_evidence_recorded" as const,
  uploadedAt: 1_700_000_000_000,
  recordedAt: 1_700_000_000_100,
});
assert.equal(
  "storyMeasurementCoverage" in observedLegacy,
  false,
  "analytics preserves the absence of a story scope on historical provenance",
);
const historicalProgramRoute = legacyWrite.programRoute === undefined
  ? undefined
  : (() => {
      const { programBriefFingerprint: _historicalBrief, ...route } = legacyWrite.programRoute;
      return route;
    })();
const historicalWrite = {
  ...legacyWrite,
  ...(historicalProgramRoute === undefined ? {} : { programRoute: historicalProgramRoute }),
};
assert.equal(
  sameImmutableVideoReleaseProvenance(historicalWrite, write),
  false,
  "strict equality distinguishes metadata added after a historical record",
);
assert.equal(
  sameRetryableVideoReleaseProvenance(historicalWrite, write),
  true,
  "a retry accepts a stored historical row that lacks optional story and brief metadata",
);
assert.equal(
  sameRetryableVideoReleaseProvenance(write, historicalWrite),
  false,
  "retry compatibility is directional so a stored value can never be erased",
);

assert.throws(
  () => videoReleaseProvenanceClaimFromCertificate({
    certificate,
    releaseCertificateKey: certificateKey,
    expectedFinalMasterSha256: "f".repeat(64),
  }),
  /different uploaded final master/,
  "a certificate cannot be linked to different uploaded bytes",
);

const legacyCertificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/legacy-final.mp4`,
    sha256: masterSha256,
    byteLength: 1_024,
    durationSec: 120,
  },
  visualReview: {
    evidenceManifestKey: `${keyPrefix}runs/${runId}/visual-review/legacy-manifest.json`,
    evidenceFrameKeys: [frameKey],
    evidenceFrameArtifacts: [{
      r2Key: frameKey,
      contentSha256: "e".repeat(64),
      byteLength: 128,
    }],
    receiptKey: visualReviewReleaseReceiptKey(
      keyPrefix,
      runId,
      visualReview.releaseReceiptFingerprint,
    ),
    ...visualReview,
  },
});
assert.equal(
  videoReleaseProvenanceClaimFromCertificate({
    certificate: legacyCertificate,
    releaseCertificateKey: finalMasterReleaseCertificateKey(
      keyPrefix,
      runId,
      legacyCertificate.certificateFingerprint,
    ),
    expectedFinalMasterSha256: masterSha256,
  }),
  undefined,
  "a pre-binding certificate remains unlinked instead of receiving inferred provenance",
);

console.log("video release provenance tests passed");
