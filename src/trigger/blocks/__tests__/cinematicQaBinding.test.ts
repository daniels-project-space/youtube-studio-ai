import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"), "utf8");
const qaStart = source.indexOf("export const qaVisual: Block");
const timelineStart = source.indexOf("export const timelineAssemble: Block");
const qaSource = source.slice(qaStart);
const timelineSource = source.slice(timelineStart, qaStart);
const binding = qaSource.indexOf("assertCinematicSequenceRenderBinding({");
const reviewer = qaSource.indexOf("const visualReview = await reviewRender(");

assert(qaStart >= 0, "qa_visual must remain the final production review block");
assert(timelineStart >= 0, "timeline_assemble must remain the final-master assembly block");
assert(binding >= 0, "qa_visual must re-assert exact cinematic scene/edit/render binding");
assert(reviewer >= 0 && binding < reviewer, "cinematic clip receipts must be validated before final-master visual review");
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

console.log("cinematic QA binding test passed");
