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
for (const key of ["footageKeys", "thirdPartyStockEvidence"]) {
  assert(key in qa.optionalConsumes, `qa_visual must declare optional stock-provenance input ${key}`);
}
for (const key of [
  "studioLtxCreativeAdapterSelection",
  "studioLtxCreativeAdapterSelectionsByShot",
  "studioAssetRecipeProjection",
  "studioAudioRecipeProjection",
  "studioOverlayRecipeProjection",
  "studioMotionGraphicsRecipeProjection",
  "studioTransitionRecipeProjection",
  "studioPostproductionDecision",
]) {
  assert(key in qa.optionalConsumes, `qa_visual must declare optional Studio LTX provenance input ${key}`);
}
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
const dispatcher = readFileSync(join(process.cwd(), "src/lib/publishDispatcher.ts"), "utf8");
const publishIntents = readFileSync(join(process.cwd(), "convex/publishIntents.ts"), "utf8");
const releaseCertificateDeclaration = narrated.indexOf("let finalMasterReleaseCertificate:");
const productionReleaseGate = narrated.indexOf("if (productionQa) {", releaseCertificateDeclaration);
const receiptCreation = narrated.indexOf("createVisualReviewReleaseReceipt(");
const qaStockEvidenceLoad = narrated.indexOf('consumer: "qa_visual"');
const certificateCreation = narrated.indexOf("const persistedFinalMasterReleaseCertificate = createFinalMasterReleaseCertificate(");
assert(
  releaseCertificateDeclaration >= 0 && productionReleaseGate >= 0 && productionReleaseGate < receiptCreation,
  "only production QA may persist durable release evidence; draft probes must remain certificate-free",
);
assert(
  qaStockEvidenceLoad >= 0 && certificateCreation >= 0 && qaStockEvidenceLoad < certificateCreation,
  "production QA must reload stock provenance before minting the release certificate",
);
assert.match(
  narrated.slice(qaStockEvidenceLoad, certificateCreation + 3_000),
  /\.\.\.\(thirdPartyStockEvidence \? \{ thirdPartyStockEvidence \} : \{\}\)/,
  "the revalidated stock-evidence reference must be sealed into the release certificate",
);
assert.match(
  narrated,
  /createVisualReviewReleaseReceipt\([\s\S]*?createFinalMasterReleaseCertificate\([\s\S]*?finalMasterReleaseCertificateKey/,
  "QA must persist the verdict-bearing visual-review receipt before creating the master-bound release certificate",
);
assert.match(
  narrated,
  /createFinalMasterQualityEvidenceBinding\([\s\S]*?finalMasterSha256AfterVisualReview[\s\S]*?qualityEvidence[\s\S]*?createFinalMasterReleaseCertificate\([\s\S]*?qualityEvidence: finalMasterQualityEvidence/,
  "shared qa_visual must seal its typed quality receipt to the exact reviewed master before issuing the release certificate",
);
assert.match(
  narrated,
  /createStudioLtxReleaseAdapterBinding\(\{[\s\S]*?shotRenderManifest: ctx\.store\["shotRenderManifest"\][\s\S]*?globalSelection: ctx\.store\["studioLtxCreativeAdapterSelection"\][\s\S]*?perShotSelections: ctx\.store\["studioLtxCreativeAdapterSelectionsByShot"\][\s\S]*?createFinalMasterReleaseCertificate\([\s\S]*?studioLtxAdapterBinding/,
  "when Studio selected an LTX adapter, qa_visual must bind the exact persisted shot manifest decision into the final certificate",
);
assert.match(
  narrated,
  /studioAssetRecipeProjectionFromUnknown\(ctx\.store\["studioAssetRecipeProjection"\]\)[\s\S]*?studioPostproductionRecipeProjectionFromUnknown\(ctx\.store\["studioAudioRecipeProjection"\][\s\S]*?createStudioAssetReleaseUsageReceipt\([\s\S]*?visualMatter\?\.treatment \? \{ treatment: visualMatter\.treatment\.key \} : \{\}[\s\S]*?createFinalMasterReleaseCertificate\([\s\S]*?studioAssetReleaseUsage/,
  "qa_visual must seal only actual Studio recipe projections, treatment, and persisted LTX choices into a passing final-master usage receipt before certificate creation",
);
assert.match(
  narrated,
  /studioPostproductionDecisionReceiptFromUnknown\([\s\S]*?selectionSource === "studio_asset"[\s\S]*?studioPostproductionDecisions: \[studioPostproductionDecision\]/,
  "QA must distinguish a transition actually selected by Studio from an upstream template overridden before assembly, and seal the exact decision into the certificate",
);
assert.match(
  narrated,
  /Number\(ctx\.store\["quotesApplied"\] \?\? 0\) > 0[\s\S]*?studioOverlayRecipeProjection[\s\S]*?Number\(ctx\.store\["insertsApplied"\] \?\? 0\) > 0[\s\S]*?studioMotionGraphicsRecipeProjection/,
  "release usage must credit overlay and motion-graphics recipes only when the final assembler reports a surviving on-screen application",
);
assert.match(
  narrated,
  /createStudioPostproductionPromotionCandidates\([\s\S]*?decision: studioPostproductionDecision[\s\S]*?recordStudioAssetPromotionCandidates/,
  "a reusable transition candidate must be derived only from the sealed final-master decision after the certificate has been persisted",
);
assert.match(
  narrated,
  /routeSeedFingerprint: channelProgramRouteRunSeedFingerprint\(qualityEvidenceProgramRoute\)[\s\S]*?createReferenceQualityMechanicsLedger\([\s\S]*?createFinalMasterReleaseCertificate\([\s\S]*?referenceQualityMechanics/,
  "route-aware mechanics provenance must be derived after durable QA receipts and cross-bound to the same frozen route seed before certificate creation",
);
assert.match(
  narrated,
  /createFinalMasterQualityEvidenceBinding\([\s\S]*?const referenceQualityMechanics = qualityEvidenceProgramRoute[\s\S]*?createReferenceQualityMechanicsLedger\([\s\S]*?finalMasterQualityEvidenceBinding: finalMasterQualityEvidence/,
  "reference-quality mechanics must consume the sealed final-master quality binding rather than a loose audio score",
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
  /createVisualReviewReleaseReceipt\([\s\S]*?putObject\(\s*visualReviewReceiptKey[\s\S]*?putObject\(\s*finalMasterNarrationAuditKey[\s\S]*?createReferenceQualityEvidenceBridgeV2\([\s\S]*?createFinalMasterReleaseCertificate\(/,
  "a V2 measured audio bridge may be created only after the visual release receipt and full narration audit are durable",
);
assert.match(
  narrated,
  /createFinalMasterReleaseCertificate\([\s\S]*?putObject\([\s\S]*?parseFinalMasterReleaseCertificateBytes\([\s\S]*?verifyFinalMasterReleaseEvidenceObjects\([\s\S]*?createFinalMasterReleaseCertificateReference\(/,
  "QA must reload and cross-validate durable certificate evidence before exposing its compact reference",
);
assert.match(
  narrated,
  /verifyFinalMasterReleaseEvidenceObjects\([\s\S]*?recordStudioAssetReleaseUsage\([\s\S]*?certificateFingerprint: durableFinalMasterReleaseCertificate\.certificateFingerprint[\s\S]*?finalMasterReleaseCertificate = durableFinalMasterReleaseCertificate/,
  "Studio asset feedback may be recorded only after durable final-master evidence has reloaded successfully, and never changes the current release result",
);
assert.match(
  narrated,
  /verifyFinalMasterReleaseEvidenceObjects\([\s\S]*?createStudioAssetPromotionCandidates\([\s\S]*?finalMasterReleaseCertificateFingerprint: durableFinalMasterReleaseCertificate\.certificateFingerprint,[\s\S]*?recordStudioAssetPromotionCandidates\([\s\S]*?finalMasterReleaseCertificate = durableFinalMasterReleaseCertificate/,
  "a reusable Studio recipe candidate may be captured only after durable final-master evidence has reloaded, and its best-effort storage cannot alter the completed release",
);
assert.match(
  narrated,
  /requireFrozenReferenceQualityContract\(qualityBar\)[\s\S]*?referenceQualityBinding[\s\S]*?createFinalMasterReleaseCertificate\(/,
  "new production QA must seal its calibrated frozen channel reference contract before attaching either V1 provenance or the narrow V2 bridge",
);
const referenceContractAdmission = narrated.indexOf("requireFrozenReferenceQualityContract(qualityBar)");
const firstVisualReview = narrated.indexOf("const visualReview = await reviewRender(");
assert(
  referenceContractAdmission >= 0 && firstVisualReview >= 0 && referenceContractAdmission < firstVisualReview,
  "a missing or partial frozen reference contract must stop production QA before paid final visual review",
);
const treatmentCriteria = narrated.indexOf("visualTreatmentReferenceCriteria(visualMatter?.treatment)");
const reviewReferenceCriteria = narrated.indexOf("const reviewReferenceCriteria = [", treatmentCriteria);
assert(
  treatmentCriteria >= 0 && reviewReferenceCriteria > treatmentCriteria && reviewReferenceCriteria < firstVisualReview,
  "production QA must materialize sealed treatment benchmarks as explicit reviewer criteria before final review",
);
assert.match(
  narrated.slice(reviewReferenceCriteria, firstVisualReview),
  /\.\.\.visualTreatmentCriteria/,
  "treatment-specific criteria must join the reference-criterion receipt set that production QA requires complete",
);
assert.doesNotMatch(
  narrated,
  /evaluateVisualFrames\(/,
  "shared qa_visual must not retain a duplicate overview visual-grading call beside the final visual review",
);
assert.match(
  narrated,
  /createVisualReviewReleaseReceipt\([\s\S]*?broadQualityScore: visualReview\.broadQualityScore/,
  "the wide-sample visual score must be retained in the fingerprinted release receipt",
);
assert.match(
  narrated,
  /visual: visualReview\.ran\s*\?\s*\{[\s\S]*?productionQa && visualReview\.broadQualityScore[\s\S]*?score: visualReview\.broadQualityScore\.score,[\s\S]*?minimumScore: videoMinimum,[\s\S]*?evaluator: "scene\/cue-aware evidence-backed visual review"/,
  "production QA must bind its validated wide-sample score and lane floor into the visual quality evidence before release certification",
);
assert.match(
  narrated,
  /productionQa && visualReview\.broadQualityScore[\s\S]*?score: visualReview\.broadQualityScore\.score,[\s\S]*?minimumScore: videoMinimum[\s\S]*?if \(!qualityEvidence\.release\.hardGateReady\)[\s\S]*?if \(productionQa\) \{[\s\S]*?createFinalMasterReleaseCertificate\(/,
  "a below-floor production wide-sample score must trip the shared hard gate before a release certificate can be created",
);
assert.match(
  narrated,
  /createFinalMasterQualityEvidenceBinding\([\s\S]*?const finalMasterVisualPacing = createFinalMasterVisualPacingBinding\([\s\S]*?visualPacing: rv\.visualPacing,[\s\S]*?createFinalMasterReleaseCertificate\([\s\S]*?visualPacing: finalMasterVisualPacing/,
  "production QA must bind the exact deterministic final-master pacing receipt to matching review and quality evidence before certificate creation",
);
assert.match(
  narrated,
  /automaticPackageOpeningRequired[\s\S]*?packageToOpeningOpeningCriterion\([\s\S]*?reviewReferenceCriteria[\s\S]*?reviewRender\([\s\S]*?assertPackageToOpeningPlanBinding\([\s\S]*?createPackageToOpeningReceipt\([\s\S]*?referenceCriteria: visualReview\.referenceCriteria[\s\S]*?createFinalMasterReleaseCertificate\([\s\S]*?packageToOpening/,
  "automatic production QA must request the sealed opening promise from its existing final review, retain the cited opening evidence, and seal it with the exact package/master before certification",
);
assert.match(
  narrated,
  /createPackageToOpeningOmission\([\s\S]*?createFinalMasterReleaseCertificate\([\s\S]*?packageToOpeningOmission/,
  "legacy or structurally unmeasurable package/opening runs must carry an explicit bounded omission rather than a fabricated semantic claim",
);
assert.match(
  narrated,
  /finalMasterSha256: finalMasterSha256AfterVisualReview/,
  "QA must return the final-master SHA for every lane, not only cinematic QA",
);
assert.match(
  lofi,
  /loadDurableFinalMasterReleaseCertificate\([\s\S]*?getObjectBytes\(certificateKey\)[\s\S]*?verifyFinalMasterReleaseEvidenceForUpload\([\s\S]*?verifyFinalMasterReleaseEvidenceForLocalUpload\([\s\S]*?filePath,[\s\S]*?getObjectBytes/,
  "upload must reload durable evidence, re-read every sealed review-frame byte, and hash the exact local master before publishing",
);
assert.match(
  lofi,
  /verifyFinalMasterReleaseEvidenceForUpload\(\s*ctx,\s*filePath,\s*videoKey,\s*"local-upload"\s*,?\s*\)/,
  "the actual YouTube upload path must use the sealed local-source verifier instead of re-streaming the same master from R2",
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
const thumbnailTreatmentProof = lofi.indexOf("assertScenarioVisualTreatmentThumbnailProvenance({");
assert(
  thumbnailTreatmentProof >= 0 && thumbnailTreatmentProof < connectorCall,
  "fictional thumbnail bytes and provenance must be verified before connector lookup or upload dispatch",
);
const thumbnailQaTreatmentProof = narrated.indexOf("consumer: \"qa_visual\"");
const thumbnailVisionReview = narrated.indexOf("await evaluateThumbnail(");
assert(
  thumbnailQaTreatmentProof >= 0 &&
    thumbnailVisionReview >= 0 &&
    thumbnailQaTreatmentProof < thumbnailVisionReview,
  "qa_visual must byte-bind fictional thumbnail provenance before it can mint downstream QA evidence",
);
const thumbnailQaLegacyAdmission = narrated.indexOf("resolveScenarioVisualTreatmentForNewVisualArtifact({");
assert(
  thumbnailQaLegacyAdmission >= 0 && thumbnailQaLegacyAdmission < firstVisualReview,
  "route-bearing legacy fiction must be rejected before QA can purchase or certify a review",
);
const thumbnailPublishLegacyAdmission = lofi.indexOf("resolveScenarioVisualTreatmentForNewVisualArtifact({");
assert(
  thumbnailPublishLegacyAdmission >= 0 && thumbnailPublishLegacyAdmission < connectorCall,
  "route-bearing legacy fiction must be rejected before upload connector work",
);
const dispatcherThumbnailTreatmentGate = dispatcher.indexOf(
  "await assertPublishIntentThumbnailScenarioVisualTreatment(",
);
const dispatcherConnector = dispatcher.indexOf("requireYouTubeConnector(convex");
const dispatcherThumbnailApply = dispatcher.indexOf("await setVideoThumbnail(");
assert(
  dispatcherThumbnailTreatmentGate >= 0 &&
    dispatcherConnector >= 0 &&
    dispatcherThumbnailApply >= 0 &&
    dispatcherThumbnailTreatmentGate < dispatcherConnector &&
    dispatcherThumbnailTreatmentGate < dispatcherThumbnailApply,
  "delayed publish intents must re-check thumbnail treatment proof before connector or thumbnail application",
);
assert.match(
  lofi,
  /api\.publishIntents\.createOrGet[\s\S]*?thumbnailScenarioVisualTreatmentProvenance[\s\S]*?thumbnailScenarioVisualTreatmentProvenanceFingerprint/,
  "upload_draft must persist the admitted thumbnail proof with its delayed publish intent",
);
assert.match(
  publishIntents,
  /thumbnailScenarioVisualTreatmentProvenance:[\s\S]*?thumbnailScenarioVisualTreatmentProvenanceFingerprint:[\s\S]*?provenance\/fingerprint must be paired/,
  "the durable intent ledger must preserve a paired thumbnail treatment proof rather than an opaque optional hint",
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
  /pruneRunObjectsWithVerifiedFinalMasterEvidence[\s\S]*?retainedFinalMasterReleaseObjectKeys\([\s\S]*?verifyFinalMasterReleaseEvidenceObjects\([\s\S]*?deleteObjects\(deletable\)/,
  "cleanup must re-read the certificate's manifest, receipt, and frame bytes before deleting intermediates",
);

console.log("final-master release evidence wiring test passed");
