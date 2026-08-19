import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src", "trigger", "blocks", "narratedBlocks.ts"),
  "utf8",
);

assert.match(
  source,
  /const requiresAdaptiveShotAnalysis = productionQa && rv\.visualPacing\.policy\.mode !== "exempt"/,
  "every non-exempt production lane must require the baked adaptive scene analyzer",
);
assert.match(
  source,
  /if \(requiresAdaptiveShotAnalysis \|\| cinematicBinding \|\| authoredShotManifest\)/,
  "generic production QA must run the same final-master analyzer used by cinematic integrity",
);
assert.match(
  source,
  /adaptiveSceneDetector=[\s\S]*adaptiveSceneSource=[\s\S]*adaptiveSceneCount=/,
  "quality evidence must retain detector, exact master hash, and observed scene count",
);
assert.match(
  source,
  /adaptiveShotAnalysis: finalShotAnalysis/,
  "the operator-facing QA report must persist the adaptive analysis summary",
);

console.log("adaptive shot-analysis final-QA binding test passed");
