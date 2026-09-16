import assert from "node:assert/strict";
import { isMiniMaxH3CapacityHoldError, summarizeMiniMaxH3Receipt } from "@/lib/minimaxH3Status";

for (const message of [
  "weekly MiniMax H3 Salad capacity check could not admit an exact desktop RTX 5090 class",
  "weekly MiniMax H3 Salad capacity is insufficient for the requested wave",
  "weekly MiniMax H3 Salad capacity check failed before dispatch",
  "weekly MiniMax H3 Salad account capacity check failed before dispatch",
  "weekly MiniMax H3 Salad account capacity is occupied (2/3 slots)",
  "Salad fleet reservation capacity is occupied (3/3); requested 2 slots",
]) assert.equal(isMiniMaxH3CapacityHoldError(message), true, `capacity hold should match: ${message}`);
for (const message of [
  "weekly MiniMax H3 Salad worker returned an ambiguous provider error",
  "MiniMax H3 Salad capacity is insufficient", // missing the weekly task prefix
  "weekly MiniMax H3 Salad provider request failed after dispatch",
  "Salad fleet reservation lease token mismatch",
]) assert.equal(isMiniMaxH3CapacityHoldError(message), false, `non-admission error should not match: ${message}`);

const output = (name: string, costUsd = 0.2) => ({
  r2Key: `owner/daniel/channels/h3/${name}.mp4`,
  contentSha256: "a".repeat(64),
  byteLength: 1024,
  costUsd,
});
const provider = (mode: "medium" | "high") => ({ runtime: { capacityMode: mode } });

const medium = summarizeMiniMaxH3Receipt({
  schema: "minimax-h3-weekly-batch/v1", orderKey: "week-1", requestKeys: ["a"],
  outputs: [output("medium")], providerReceipts: [provider("medium")], totalCostUsd: 0.2,
}, "daniel");
assert.deepEqual(medium, {
  kind: "weekly", requestCount: 1, completedCount: 1, totalCostUsd: 0.2, capacityMode: "medium",
});

const mixed = summarizeMiniMaxH3Receipt({
  schema: "minimax-h3-weekly-batch/v1", orderKey: "week-2", requestKeys: ["a", "b"],
  outputs: [output("a"), output("b")], providerReceipts: [provider("medium"), provider("high")], totalCostUsd: 0.4,
}, "daniel");
assert.equal(mixed.capacityMode, "mixed");

const legacy = summarizeMiniMaxH3Receipt({
  schema: "minimax-h3-weekly-batch/v1", orderKey: "week-legacy", requestKeys: ["a"], outputs: [output("legacy")], totalCostUsd: 0.2,
}, "daniel");
assert.equal(legacy.capacityMode, undefined, "older summaries remain readable without inventing a tier");

assert.throws(() => summarizeMiniMaxH3Receipt({
  schema: "minimax-h3-weekly-batch/v1", orderKey: "foreign", requestKeys: ["a"], outputs: [{ ...output("foreign"), r2Key: "owner/other/channels/h3/foreign.mp4" }], totalCostUsd: 0,
}, "daniel"), /weekly receipt is malformed/);
assert.throws(() => summarizeMiniMaxH3Receipt({
  schema: "minimax-h3-weekly-batch/v1", orderKey: "bad-tier", requestKeys: ["a"], outputs: [output("bad-tier")], providerReceipts: [provider("medium"), provider("high")], totalCostUsd: 0.2,
}, "daniel"), /provider provenance is malformed/);

const onDemand = summarizeMiniMaxH3Receipt({
  schema: "minimax-h3-on-demand/v1", requestKey: "request-1", output: output("on-demand", 0.1),
}, "daniel");
assert.equal(onDemand.capacityMode, "spot");

console.log("MiniMax H3 status receipt projection tests passed");
