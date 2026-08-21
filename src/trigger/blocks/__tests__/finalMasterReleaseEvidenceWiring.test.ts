import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { artifactContract } from "@/engine/artifactSchemas";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import {
  compactQaVisualReviewEvidenceForStage,
  persistQaVisualStageOutputs,
} from "@/trigger/blocks/narratedBlocks";

registerAllBlocks();

const qa = getManifest("qa_visual");
const upload = getManifest("upload_draft");
const cleanup = getManifest("cleanup");
assert(qa && upload && cleanup, "final-master QA, upload, and cleanup blocks must all be registered");

for (const key of ["finalMasterReleaseCertificate", "finalMasterReleaseCertificateKey"]) {
  assert(key in qa.optionalProduces, `qa_visual must optionally produce ${key} after production QA`);
  assert(!(key in qa.produces), `draft QA must not be required to return ${key}`);
}
assert("finalMasterReleaseCertificateKey" in upload.consumes, "upload_draft must consume the durable certificate key");
assert("finalMasterReleaseCertificateKey" in cleanup.consumes, "cleanup must consume the durable certificate key");
assert(!("finalMasterReleaseCertificate" in upload.consumes), "upload resumes by rehydrating the certificate from R2");
assert(!("finalMasterReleaseCertificate" in cleanup.consumes), "cleanup resumes by rehydrating the certificate from R2");
assert("videoKey" in qa.consumes, "qa_visual must bind its release certificate to the durable final-master key");
assert.equal(
  artifactContract("finalMasterReleaseCertificate").persist,
  "reference",
  "the complete certificate belongs in durable R2 evidence while the immutable runArtifact retains lineage",
);
assert(
  "finalMasterReleaseCertificateReference" in qa.optionalProduces,
  "production QA must emit a compact certificate reference for audit projection",
);
assert(
  !("finalMasterReleaseCertificateReference" in qa.produces),
  "draft QA must not fabricate a release-certificate reference",
);
assert.equal(
  artifactContract("finalMasterReleaseCertificateReference").persist,
  "reference",
  "the compact R2 certificate reference must remain independently durable when the full certificate is summarized",
);

const denseReviewEvidence = compactQaVisualReviewEvidenceForStage({
  version: "video-review/v5",
  source: { durationSec: 600, sha256: "a".repeat(64) },
  manifestKey: "owner/alice/runs/run-qa/visual-review/manifest.json",
  frames: Array.from({ length: 20_000 }, (_, index) => ({
    id: `f-${index}`,
    tSec: index / 2,
    selectionReasons: ["uniform"],
    r2Key: `owner/alice/runs/run-qa/visual-review/frames/${index}.jpg`,
  })),
  coverage: {
    maxGapSec: 0.5,
    maxAllowedGapSec: 0.5,
    focusedWindows: [],
  },
});
assert.equal(denseReviewEvidence.frameCount, 20_000);
assert(!("frames" in denseReviewEvidence), "the stage summary must not duplicate every review-frame key");
const compactQaStage = persistQaVisualStageOutputs({
  qaPassed: true,
  reviewEvidence: denseReviewEvidence,
  finalMasterReleaseCertificate: { largeReceipt: "x".repeat(150_000) },
  finalMasterReleaseCertificateReference: { certificateFingerprint: "b".repeat(64) },
  finalMasterReleaseCertificateKey: "owner/alice/runs/run-qa/release-certificates/cert.json",
});
assert(!("finalMasterReleaseCertificate" in compactQaStage), "the full certificate belongs only in R2/artifact lineage");
assert.ok(JSON.stringify(compactQaStage).length < 10_000, "dense review evidence must remain Convex-safe in the QA stage row");

const narrated = readFileSync(join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"), "utf8");
const lofi = readFileSync(join(process.cwd(), "src/trigger/blocks/lofiBlocks.ts"), "utf8");
const releaseCertificateDeclaration = narrated.indexOf("let finalMasterReleaseCertificate:");
const productionReleaseGate = narrated.indexOf("if (productionQa) {", releaseCertificateDeclaration);
const receiptCreation = narrated.indexOf("createVisualReviewReleaseReceipt(");
assert(
  releaseCertificateDeclaration >= 0 && productionReleaseGate >= 0 && productionReleaseGate < receiptCreation,
  "only production QA may persist durable release evidence; draft probes must remain certificate-free",
);
assert.match(
  narrated,
  /createVisualReviewReleaseReceipt\([\s\S]*?createFinalMasterReleaseCertificate\([\s\S]*?finalMasterReleaseCertificateKey/,
  "QA must persist the verdict-bearing visual-review receipt before creating the master-bound release certificate",
);
assert.match(
  narrated,
  /createFinalMasterReleaseCertificate\([\s\S]*?putObject\([\s\S]*?createFinalMasterReleaseCertificateReference\(/,
  "QA must create the compact reference only after the authoritative certificate is written to R2",
);
assert.match(
  narrated,
  /prepareFinalMasterNarrationTranscriptAudit\([\s\S]*?finalMasterNarrationTranscriptAuditObjectKey\([\s\S]*?putObject\(\s*finalMasterNarrationAuditKey[\s\S]*?createFinalMasterReleaseCertificate\(/,
  "the full timestamp narration audit must be content-addressed and stored before its compact certificate receipt exists",
);
assert.match(
  narrated,
  /requireFrozenReferenceQualityContract\(qualityBar\)[\s\S]*?createUnmeasuredReferenceQualityFinalMasterBinding\([\s\S]*?finalMasterSha256: finalMasterSha256AfterVisualReview/,
  "new production QA must seal its calibrated frozen channel reference contract to the exact reviewed master without inventing a measured pass",
);
const referenceContractAdmission = narrated.indexOf("requireFrozenReferenceQualityContract(qualityBar)");
const firstVisualGrader = narrated.indexOf("evaluateVisualFrames(vframes");
assert(
  referenceContractAdmission >= 0 && firstVisualGrader >= 0 && referenceContractAdmission < firstVisualGrader,
  "a missing or partial frozen reference contract must stop production QA before paid visual grading",
);
assert.match(
  narrated,
  /finalMasterSha256: finalMasterSha256AfterVisualReview/,
  "QA must return the final-master SHA for every lane, not only cinematic QA",
);
assert.match(
  lofi,
  /loadDurableFinalMasterReleaseCertificate\([\s\S]*?getObjectBytes\(certificateKey\)[\s\S]*?verifyFinalMasterReleaseEvidenceForUpload\([\s\S]*?retainedFinalMasterReleaseObjectKeys[\s\S]*?assertReleaseCertificateVisualReviewBindings[\s\S]*?fileSha256\(filePath\)/,
  "upload must reload bounded durable certificate/evidence and hash the exact local master before publishing",
);
assert.match(
  lofi,
  /parseFinalMasterNarrationTranscriptAuditBytes\([\s\S]*?assertFinalMasterNarrationTranscriptAuditBinding\(/,
  "upload must re-fetch and bind the complete narration timestamp audit when the compact certificate receipt references one",
);
const uploadCall = lofi.indexOf("await verifyFinalMasterReleaseEvidenceForUpload(");
const connectorCall = lofi.indexOf("requireYouTubeConnector(client");
assert(
  uploadCall >= 0 && connectorCall >= 0 && uploadCall < connectorCall,
  "release evidence must be revalidated before connector lookup or dispatch",
);
assert.match(
  lofi,
  /referenceQuality\?\.assessment === "unmeasured"[\s\S]{0,500}makes no reference-quality attestation claim/,
  "an unmeasured binding must be logged honestly rather than promoted to an attestation",
);
assert.doesNotMatch(
  lofi,
  /assertReferenceQualityExternalReleaseAllowed/,
  "reference-quality disclosure must not create a blanket public/scheduled publication veto",
);
const unmeasuredReferenceNotice = lofi.indexOf("reference-quality contract is sealed but unmeasured");
const publicScheduledPolicy = lofi.indexOf("if (publishMode === \"public\" || publishMode === \"scheduled\") {");
assert(
  unmeasuredReferenceNotice >= 0 && publicScheduledPolicy >= 0 && unmeasuredReferenceNotice < publicScheduledPolicy,
  "public and scheduled runs must retain the unmeasured disclosure without turning it into a release block",
);
assert.match(
  lofi.slice(publicScheduledPolicy, publicScheduledPolicy + 1_000),
  /evaluateChannelPublishAction/,
  "public and scheduled releases must still use the existing authenticated channel-policy gate",
);
assert.match(
  lofi,
  /retainedFinalMasterReleaseObjectKeys\([\s\S]*?\.{3}retainedReleaseEvidence[\s\S]*?deleteObjects\(del\)/,
  "cleanup must whitelist the certificate's manifest, receipt, and frame evidence before deleting intermediates",
);

console.log("final-master release evidence wiring test passed");
