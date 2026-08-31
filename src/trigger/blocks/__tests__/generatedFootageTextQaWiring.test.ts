import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src");
const generatedFootage = readFileSync(join(root, "trigger", "blocks", "genFootageBlocks.ts"), "utf8");
const assembly = readFileSync(join(root, "trigger", "blocks", "narratedBlocks.ts"), "utf8");
const contracts = readFileSync(join(root, "engine", "moduleContracts.ts"), "utf8");

assert.match(
  generatedFootage,
  /produces:\s*\[\s*"footageClips",\s*"footageKeys",\s*"generatedFootageSceneManifest",\s*"footageOnScreenTextCues",\s*"ltxStyleId",\s*"ltxStyleSelection",\s*\]/,
  "generated footage must publish deterministic-overlay OCR obligations and the sealed LTX style receipt separately from raw clips",
);
assert.match(
  generatedFootage,
  /const footageTextCues = footageOnScreenTextCues\(/,
  "only successful compositing may mint the expected-text cue set",
);
assert.match(
  generatedFootage,
  /required name-card overlay failed on scene/,
  "a planned name card may not silently disappear after LTX has rendered",
);
assert.match(
  generatedFootage,
  /required evidence overlay failed on scene/,
  "a planned evidence overlay may not silently disappear after LTX has rendered",
);

assert.match(
  assembly,
  /shiftFootageOnScreenTextCues\(ctx\.store\["footageOnScreenTextCues"\], introSec\)/,
  "timeline assembly must shift body-relative text evidence to the actual final-master clock",
);
assert.match(
  assembly,
  /onScreenTextCues: finalMasterFootageOnScreenTextCues/,
  "final QA must receive the shifted cue set on both full and surgical assembly paths",
);
assert.match(
  contracts,
  /"footageKeys", "thirdPartyStockEvidence", "footageOnScreenTextCues"/,
  "the new cross-block proof input must be explicitly declared for runtime admission",
);

console.log("GENERATED FOOTAGE TEXT FINAL-QA WIRING PASS");
