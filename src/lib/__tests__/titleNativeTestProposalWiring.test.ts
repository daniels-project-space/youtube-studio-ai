import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const proposal = readFileSync(resolve(root, "src/lib/titleCtrSwap.ts"), "utf8");
const worker = readFileSync(resolve(root, "src/trigger/titleCtrSwap.ts"), "utf8");

assert.match(proposal, /action: "propose_native_test" \| "hold"/);
assert.match(proposal, /admitNativeTitleTestOutcome/);
assert.match(proposal, /NativeTitleTestVariantObservation/);
assert.match(proposal, /exact 2–3 title slate/);
assert.match(proposal, /watch-time-share evidence/);
assert.doesNotMatch(proposal, /function judgeSwapOutcome/);
assert.match(worker, /planNativeTitleTestProposals/);
assert.match(worker, /action === "propose_native_test"/);
assert.doesNotMatch(worker, /updateVideoMetadata/);
assert.doesNotMatch(worker, /action === "swap"/);

console.log("titleNativeTestProposal wiring: no sequential title-write action remains");
