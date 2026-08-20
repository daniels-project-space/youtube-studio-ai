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
  /qualityCriteria:\s*\[\.\.\.channelReviewProfile\.qualityCriteria, \.\.\.casefileCinematicQualityCriteria\]/,
  "qa_visual must bind both channel criteria and source-bound Casefile mechanics into reviewRender intent",
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
  /const casefileCinematicReferenceCriteria: VisualReviewReferenceCriterion\[\]/,
  "only the source-bound Casefile path may add typed v5 visual criteria",
);
assert.match(
  source,
  /requirement\.id === "evidence-bearing-visual-rhythm"[\s\S]{0,700}requirement\.id === "rights-aware-casefile-presentation"/,
  "typed QA criteria must remain limited to the two visually observable Casefile standards",
);
assert.match(
  source,
  /referenceCriteria: casefileCinematicReferenceCriteria/,
  "the final reviewer must receive typed Casefile criteria, not only prose QualityBar guidance",
);
assert.match(
  source,
  /reviewReceiptFingerprint: visualReview\.reviewReceiptFingerprint[\s\S]{0,600}referenceCriteriaComplete: visualReview\.referenceCriteriaComplete/,
  "QA must retain the immutable v5 review receipt and its completeness state",
);

console.log("reference-quality final-QA binding test passed");
