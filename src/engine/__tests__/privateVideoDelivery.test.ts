import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertPrivateVideoHasNoDelivery, isPrivateVideoDeliveryBlock } from "../privateVideoDelivery";
import { buildChannelInceptionProbePipeline } from "../channelInceptionProbePipeline";
import { buildRouteQualificationBenchmarkPipeline } from "@/lib/routeQualificationBenchmark";

const delivery = ["upload_draft", "notify", "cleanup", "shorts_spinoff", "crosspost", "emit_bundle"];
const production = [{ block: "topic_select" }, { block: "qa_visual" }, ...delivery.map(block => ({ block }))];
for (const block of delivery) {
  assert.equal(isPrivateVideoDeliveryBlock(block), true);
  assert.throws(() => assertPrivateVideoHasNoDelivery([{ block }]), /cannot contain delivery block/);
}
for (const privatePipeline of [buildChannelInceptionProbePipeline(production), buildRouteQualificationBenchmarkPipeline(production)]) {
  assertPrivateVideoHasNoDelivery(privatePipeline);
  assert.deepEqual(privatePipeline.map(entry => entry.block), ["topic_select", "qa_visual"]);
}
const runner = readFileSync("src/trigger/runPipeline.ts", "utf8");
const runtimeGuard = runner.indexOf("if (probeBudgetAdmission) assertPrivateVideoHasNoDelivery(entries)");
assert.ok(runtimeGuard > 0 && runtimeGuard < runner.indexOf("const resolved = validatePipeline(entries", runtimeGuard),
  "the effective private pipeline is checked before compilation and provider execution");
console.log("Private probe and benchmark share the no-delivery execution guard");
