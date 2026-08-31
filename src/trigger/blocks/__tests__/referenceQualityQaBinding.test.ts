import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src", "trigger", "blocks", "narratedBlocks.ts"),
  "utf8",
);

// Reference-quality standards are attached to QualityBar descriptions during
// channel design. They must reach the final-master reviewer as full bounded
// criteria, not be collapsed to short IDs such as "footage" or "pacing".
assert.match(
  source,
  /qualityCriteria:\s*\(qualityBar\?\.dimensions \?\? \[\]\)\.flatMap\(\(dimension\) =>[\s\S]{0,420}dimension\.description/,
  "qa_visual must extract persisted QualityBar descriptions for the reviewer",
);
assert.match(
  source,
  /qualityCriteria:\s*\[\s*\.\.\.channelReviewProfile\.qualityCriteria,\s*\.\.\.casefileCinematicQualityCriteria,[\s\S]{0,280}scenarioVisualTreatmentReviewCriteria/,
  "qa_visual must bind channel criteria, source-bound Casefile mechanics, and any sealed fictional treatment into reviewRender intent",
);
assert.match(
  source,
  /referenceQualityContractFor\("documentary_collage_short"\)/,
  "a verified Casefile cinematic sequence must use the existing Fern-calibrated documentary contract",
);
assert.match(
  source,
  /casefileReferenceComparison=mechanics-only-no-automatic-comparison/,
  "QA evidence must retain the honest no-similarity-comparison boundary",
);
assert.match(
  source,
  /const referenceQualityVisualCriteria =[\s\S]{0,520}referenceQualityVisualReviewCriteriaForRoute/,
  "production QA must translate only the frozen, frame-observable reference mechanic into typed reviewer criteria",
);
assert.match(
  source,
  /const casefileCinematicReferenceCriteria: VisualReviewReferenceCriterion\[\]/,
  "the source-bound Casefile path keeps its additional typed visual criteria",
);
assert.match(
  source,
  /const reviewReferenceCriteria = \[[\s\S]*?referenceQualityVisualCriteria/,
  "QA must merge Casefile and frozen reference-quality criteria before review",
);
assert.match(
  source,
  /referenceCriteria: reviewReferenceCriteria/,
  "the final reviewer must receive the merged typed criteria, not only prose QualityBar guidance",
);
assert.match(
  source,
  /reviewReceiptFingerprint: visualReview\.reviewReceiptFingerprint[\s\S]{0,600}referenceCriteriaComplete: visualReview\.referenceCriteriaComplete/,
  "QA must retain the immutable v5 review receipt and its completeness state",
);

console.log("reference-quality final-QA binding test passed");
