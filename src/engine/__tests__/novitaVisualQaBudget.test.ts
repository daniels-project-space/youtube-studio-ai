import assert from "node:assert/strict";

import { MODULE_CONTRACTS } from "@/engine/moduleContracts";
import {
  NOVITA_VIDEO_QA_RENDERED_FRAMES_PER_GRADE,
  NOVITA_VISUAL_QA_MAX_IMAGES_PER_GRADER_CALL,
  NOVITA_VISUAL_QA_MAX_INITIAL_IMAGE_CANDIDATES,
  NOVITA_VIDEO_QA_TERMINAL_GRADES_PER_ATTEMPT,
  novitaCinematicQaMaxGraderCallsPerShot,
  novitaVisualQaReferenceBatchCount,
} from "@/engine/novitaVisualQaBudget";
import { NOVITA_CINEMATIC_QA_REPAIR_CAP, PRICE } from "@/engine/pricing";
import { VISUAL_MATTER_MAX_REFERENCE_ASSETS_PER_SHOT } from "@/engine/visualMatter";

assert.equal(VISUAL_MATTER_MAX_REFERENCE_ASSETS_PER_SHOT, 10);
assert.equal(NOVITA_VISUAL_QA_MAX_IMAGES_PER_GRADER_CALL, 5);
assert.equal(NOVITA_VISUAL_QA_MAX_INITIAL_IMAGE_CANDIDATES, 4);
assert.equal(NOVITA_VIDEO_QA_RENDERED_FRAMES_PER_GRADE, 3);
assert.equal(NOVITA_VIDEO_QA_TERMINAL_GRADES_PER_ATTEMPT, 1);
assert.equal(NOVITA_CINEMATIC_QA_REPAIR_CAP, 2);

assert.equal(
  novitaVisualQaReferenceBatchCount(VISUAL_MATTER_MAX_REFERENCE_ASSETS_PER_SHOT, 4),
  10,
  "four initial still candidates leave room for one locked reference per vision request",
);
assert.equal(
  novitaVisualQaReferenceBatchCount(VISUAL_MATTER_MAX_REFERENCE_ASSETS_PER_SHOT, 1),
  3,
  "one-candidate repair grading retains every locked reference across three calls",
);
assert.equal(
  novitaVisualQaReferenceBatchCount(VISUAL_MATTER_MAX_REFERENCE_ASSETS_PER_SHOT, 3),
  5,
  "start/middle/end video grading retains every locked reference across five calls",
);
assert.equal(novitaCinematicQaMaxGraderCallsPerShot("image"), 16);
assert.equal(novitaCinematicQaMaxGraderCallsPerShot("video"), 18);

const envelope = (block: "qa_assets" | "qa_shots") => {
  const calculate = MODULE_CONTRACTS[block].maxCostUsdFor;
  assert.ok(calculate, `${block} must declare a configuration-specific cost envelope`);
  return calculate({ shotCount: 1 }, { entries: [{ block, params: { shotCount: 1 } }], index: 0 });
};

assert.equal(
  envelope("qa_assets"),
  NOVITA_CINEMATIC_QA_REPAIR_CAP * PRICE.novitaImageMaxUsd + 16 * PRICE.visionGraderUsd,
  "qa_assets must reserve every initial/repair reference batch rather than one grader per take",
);
assert.equal(
  envelope("qa_shots"),
  NOVITA_CINEMATIC_QA_REPAIR_CAP * PRICE.novitaVideoMaxUsd + 18 * PRICE.visionGraderUsd,
  "qa_shots must reserve every initial/repair reference batch and terminal-continuity grade",
);
assert.ok(
  (MODULE_CONTRACTS.qa_assets.maxCostUsd ?? 0) >= 50 * envelope("qa_assets"),
  "the hard image-QA ceiling must still admit the default 50-shot full-evidence run",
);
assert.ok(
  (MODULE_CONTRACTS.qa_shots.maxCostUsd ?? 0) >= 50 * envelope("qa_shots"),
  "the hard video-QA ceiling must still admit the default 50-shot full-evidence run",
);

console.log("NOVITA VISUAL QA BUDGET PASS: bounded full-evidence grader reservations are exact");
