import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Real renderer functions, not a copied implementation of the optimized path.
// The helper extracts their AST so importing the CLI cannot start an encode.
const result = spawnSync("python3", [join(process.cwd(), "src/lib/__tests__/helpers/motionComicStrokeOrderHarness.py")], {
  cwd: process.cwd(), encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
});
assert.equal(result.status, 0, `Actual comic stroke-order regression failed: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
const proof = JSON.parse(result.stdout);
assert.equal(proof.syntheticCases, 250);
assert.equal(proof.exactCasesPassed, 252);
assert.ok(proof.realCrop.largestConnectedPoints > 3);
assert.ok(proof.realCrop.trajectoryPoints >= proof.realCrop.largestConnectedPoints);
assert.ok(proof.maxSyntheticPoints >= 2048, "exercise large-list traversal and repeated tree rebuilds");
assert.equal(proof.emptyInputBehavior, "ValueError preserved");
console.log(`Motion comic stroke order: ${proof.exactCasesPassed} actual-function exact-sequence cases PASS; no providers or media encoding`);
