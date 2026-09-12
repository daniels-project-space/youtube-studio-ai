import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Discovered by the existing production-readiness runner. This exercises actual
// Python control flow/PIL frames, not providers, native encoding or visual QA.
// The override qualifies an isolated candidate before runtime adoption.
const renderer = process.env.MOTION_COMIC_REVEAL_RENDERER
  ? resolve(process.env.MOTION_COMIC_REVEAL_RENDERER)
  : resolve("scripts/mc_page_render.py");
const probe = spawnSync("python3", [
  "src/lib/__tests__/helpers/motionComicRevealHarness.py", renderer,
], {
  cwd: process.cwd(), encoding: "utf8", timeout: 180_000,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
});
assert.equal(probe.error, undefined, `Comic reveal probe did not execute: ${probe.error}`);
assert.equal(probe.status, 0, `Comic reveal probe failed:\n${probe.stdout}\n${probe.stderr}`);
const proof = JSON.parse(probe.stdout);
assert.equal(proof.casesPassed, 30);
assert.equal(proof.panelsCompleteAtSegmentEnd, 210);
assert.equal(proof.firstFramePartialArtAndVisibleHand, 30);
assert.equal(proof.missingOpeningRejected, true);
assert.equal(proof.legacyOpeningViolationDemonstrated, true);
assert.equal(proof.legacyShortPanelViolationDemonstrated, true);
assert.ok(proof.ordinaryNonOpeningFramesCompared > 6_000);
assert.equal(proof.ordinaryNonOpeningFramesChanged, 0);
console.log(`Motion Comic reveal: ${proof.casesPassed} actual-loop cases PASS; ${proof.panelsCompleteAtSegmentEnd} panels complete by segment end; ${proof.ordinaryNonOpeningFramesCompared} ordinary non-opening frames unchanged. Synthetic page geometry; no native-media/provider/visual-QA claim.`);
