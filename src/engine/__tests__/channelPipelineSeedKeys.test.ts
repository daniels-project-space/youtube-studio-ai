import assert from "node:assert/strict";
import { createChannelProgramBrief } from "../channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "../channelProgramRoute";
import { channelPipelineValidationSeedKeys } from "../channelPipelineSeedKeys";
import { childrenShowBibleSeedKeys } from "../childrenShowBible";
import { contentLaneForFamily } from "../contentLane";
import { designPipeline } from "../designer";
import { compilePipeline } from "../pipelineCompiler";
import { validatePipeline } from "../validate";

const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async () => { calls++; throw new Error("seed-key test forbids network"); };
try {
  for (const family of ["whiteboard", "comic", "loreshort", "narrated_stock"] as const) {
    const brief = createChannelProgramBrief({
      family, nicheKey: "educational", locale: "en",
      concept: "Explain one mechanism through an original, source-grounded visual story.",
    });
    const route = resolveChannelProgramRoute(brief);
    const seed = channelProgramRouteRunSeed({ route, programBrief: brief });
    const lane = contentLaneForFamily(family)!;
    const originalSeed = JSON.stringify(seed);
    const keys = channelPipelineValidationSeedKeys(lane, seed);
    assert.deepEqual(keys, ["contentLane", "channelProgramRoute"]);
    assert.equal(keys.includes("workedExampleRequest"), false, "no nonexistent producer can be claimed as a seed");
    const design = designPipeline({ family, nicheKey: brief.nicheKey, programBrief: brief, programRoute: route });
    const compiled = compilePipeline(validatePipeline(design.pipeline, keys));
    assert.deepEqual(compiled, design.compilation, `${family}: validation must agree with its actual designer`);

    const withoutRoute = channelPipelineValidationSeedKeys(lane);
    assert.deepEqual(withoutRoute, ["contentLane"]);
    if (family === "narrated_stock") {
      assert.deepEqual(compilePipeline(validatePipeline(design.pipeline, withoutRoute)), compiled);
    } else {
      assert.throws(() => validatePipeline(design.pipeline, withoutRoute), /channelProgramRoute.*not produced/);
    }
    for (const malformed of [null, false, "channelProgramRoute", {}, { routeFingerprint: route.fingerprint }]) {
      assert.throws(() => channelPipelineValidationSeedKeys(lane, malformed));
    }
    assert.throws(() => channelPipelineValidationSeedKeys(lane, { ...seed, channelProgramRoute: seed }));
    const otherLane = contentLaneForFamily(family === "whiteboard" ? "comic" : "whiteboard")!;
    assert.throws(() => channelPipelineValidationSeedKeys(otherLane, seed), /does not match.*content lane/);
    keys.push("test-only-mutation");
    assert.deepEqual(channelPipelineValidationSeedKeys(lane, seed), ["contentLane", "channelProgramRoute"]);
    assert.equal(JSON.stringify(seed), originalSeed, "projection must not rewrite the frozen route");
  }
  const children = contentLaneForFamily("children_learning")!;
  assert.deepEqual(channelPipelineValidationSeedKeys(children), ["contentLane", ...childrenShowBibleSeedKeys(children)]);
  assert.equal(calls, 0);
  console.log("Shared route seed projection passes: three prior failures, ordinary compilation parity, missing/malformed/foreign seeds and preserved children packets");
} finally {
  globalThis.fetch = originalFetch;
}
