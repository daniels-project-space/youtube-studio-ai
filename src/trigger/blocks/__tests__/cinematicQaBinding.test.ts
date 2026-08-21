import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"), "utf8");
const cinematicQaEvidenceContractSource = readFileSync(join(process.cwd(), "src/lib/cinematicQaEvidenceContract.ts"), "utf8");
const qaStart = source.indexOf("export const qaVisual: Block");
const timelineStart = source.indexOf("export const timelineAssemble: Block");
const qaSource = source.slice(qaStart);
const timelineSource = source.slice(timelineStart, qaStart);
const binding = qaSource.indexOf("assertCinematicSequenceRenderBinding({");
const profileGate = qaSource.indexOf("assertCinematicFinalMasterQaProfile(ctx.params[\"qaProfile\"])");
const overviewVision = qaSource.indexOf("const video_ = await evaluateVisualFrames(");
const reviewer = qaSource.indexOf("const visualReview = await reviewRender(");
const sourceHashBeforeReview = qaSource.indexOf("const finalMasterSha256BeforeVisualReview");
const sourceHashAfterReview = qaSource.indexOf("const finalMasterSha256AfterVisualReview");

assert(qaStart >= 0, "qa_visual must remain the final production review block");
assert(timelineStart >= 0, "timeline_assemble must remain the final-master assembly block");
assert(binding >= 0, "qa_visual must re-assert exact cinematic scene/edit/render binding");
assert(reviewer >= 0 && binding < reviewer, "cinematic clip receipts must be validated before final-master visual review");
assert(
  profileGate >= 0 && profileGate < overviewVision && profileGate < reviewer,
  "a source-bound cinematic master must reject qaProfile=draft before overview or final-master review can spend without the required evidence receipt",
);
assert(
  sourceHashBeforeReview >= 0 && sourceHashBeforeReview < reviewer && reviewer < sourceHashAfterReview,
  "the cinematic master must be hashed before final-review frame extraction and rehashed immediately after review",
);
assert.match(
  qaSource,
  /sourceSha256: finalMasterSha256BeforeVisualReview/,
  "final visual-review evidence must receive the exact pre-review master SHA-256",
);
assert.match(
  qaSource,
  /visualReview\.evidence\.source\.sha256 !== finalMasterSha256BeforeVisualReview[\s\S]*finalMasterSha256AfterVisualReview !== finalMasterSha256BeforeVisualReview/,
  "a changed or unbound cinematic master must fail closed after visual review",
);
assert.match(
  source,
  /assertCinematicAssemblyRoute\([\s\S]*useAssemblyEdl:/,
  "the unproven Assembly EDL route must be rejected before it can assemble a source-bound cinematic master",
);
assert.match(
  timelineSource,
  /createCinematicAssemblyHandoff\([\s\S]*narrationDurationSec:[\s\S]*cinematicFootageManifest = cinematicAssemblyHandoff\?\.manifest/,
  "timeline assembly must consume the validated, contiguous cinematic handoff instead of raw generated-footage metadata",
);
assert.match(
  timelineSource,
  /cinematicFootageManifest\.items\.entries\(\)[\s\S]*assembleAuthoredBody\([\s\S]*segDurationsSec: cinematicFootageManifest\.items\.map\(\(item\) => item\.t1 - item\.t0\)/,
  "the exact final-master concat must consume the reviewed clip order and timing windows",
);
assert.match(
  timelineSource,
  /item\.nameCardText[\s\S]*applyNameCardOverlay\(local, cardPath, \{[\s\S]*text: item\.nameCardText,[\s\S]*durationSec: item\.t1 - item\.t0,/,
  "a required Casefile name card must be applied deterministically to the local reviewed clip before exact final-master assembly",
);
assert.match(
  timelineSource,
  /required Casefile name-card overlay failed/,
  "Casefile assembly must fail closed if a required deterministic name-card overlay cannot be delivered",
);
assert.match(
  qaSource,
  /acceptedKeyframes=[\s\S]*acceptedMovingTakes=[\s\S]*acceptedTransitions=/,
  "final quality evidence must retain counts of accepted keyframes, moving LTX takes, and actual reviewed cuts",
);
assert.match(
  qaSource,
  /narrationDurationSec: target/,
  "QA must bind the cinematic sequence to the same narration timing used for final-master validation",
);
assert.match(
  qaSource,
  /expectedCinematicBinding:[\s\S]*caseId: cinematicSequenceInput!\.caseId[\s\S]*shotPlanFingerprint: cinematicSequenceInput!\.shotPlanFingerprint/,
  "final-master narration proof must bind the retained Story Spine to the exact Casefile and ShotPlan that admitted the cinematic sequence",
);
assert.match(
  qaSource,
  /cinematicFinalMasterQaEvidence\(/,
  "QA must translate cinematic EDL locks into final-master time before reviewing them",
);
assert.match(
  qaSource,
  /reviewCinematicFinalMasterQaEvidence\(/,
  "a cinematic final master must retain a strict per-lock, claim, and cut evidence receipt after the general review",
);
assert.match(
  qaSource,
  /cinematicFinalMasterQaReceipt\.finalMasterSha256 !== visualReview\.evidence\.source\.sha256/,
  "the strict cinematic receipt must be rejected unless it attests the same master SHA-256 as visual-review evidence",
);
assert.match(
  qaSource,
  /cinematicCaseSequenceContentFingerprint\(/,
  "the final-master receipt must be tied back to the originally admitted mannequin/cast sequence, not just generated clip ids",
);
assert.match(
  qaSource,
  /cinematicBodyOffsetSec/,
  "a prepended intro must offset cinematic lock and cut-review windows",
);
assert.match(
  qaSource,
  /requireCompleteFocusCoverage: cinematicSequencePresent/,
  "source-bound cinematic masters must review every declared cut window instead of honoring the generic focus-frame cap",
);
assert.match(
  qaSource,
  /analyzeShotBoundaries\(/,
  "final QA must run the pinned adaptive scene detector against cinematic final-master bytes",
);
assert.match(
  qaSource,
  /evaluateCinematicEditIntegrity\(/,
  "final QA must bind adaptive scene markers to the planned cinematic EDL cuts",
);
assert.match(
  qaSource,
  /evaluateAuthoredShotEditIntegrity\(/,
  "the shared LTX Story-Spine route must receive the same final-master cut-integrity check",
);
assert.match(
  qaSource,
  /authoredLtxCuts=/,
  "shared-LTX cut evidence must be retained in final quality evidence",
);
assert.match(
  qaSource,
  /cinematicFinalMasterQaEvidenceReceiptFingerprint\(cinematicFinalMasterQaReceipt\)/,
  "the strict final-master QA receipt must itself receive a stable content fingerprint",
);
assert.match(
  qaSource,
  /finalMasterSha256: cinematicFinalMasterSha256[\s\S]{0,360}cinematicFinalMasterQaReceiptFingerprint/,
  "QA output must retain both the exact final-master SHA-256 and strict cinematic receipt fingerprint",
);
assert.match(
  cinematicQaEvidenceContractSource,
  /unplannedInSceneTextFree:\s*z\.literal\(true\)/,
  "the strict cinematic lock judgement and receipt must require a literal sampled-frame in-scene text clearance",
);
assert.match(
  cinematicQaEvidenceContractSource,
  /readable, unreadable, or fabricated signs, papers, timetables, labels, glyphs[\s\S]*approved source-proof insert named above[\s\S]*deterministic planned overlays/,
  "the reviewer prompt must scope the text check to sampled evidence and exempt only approved source-proof or deterministic overlays",
);

console.log("cinematic QA binding test passed");
