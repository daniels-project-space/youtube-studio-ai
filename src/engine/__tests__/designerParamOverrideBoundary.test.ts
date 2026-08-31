import assert from "node:assert/strict";

import { designPipeline } from "@/engine/designer";
import { sanitizeParamOverrides } from "@/engine/moduleCatalog";

const design = designPipeline({
  family: "narrated_stock",
  paramOverrides: {
    script_gen: {
      maxSeconds: 3600,
      style: "crime",
      fabricatedAuthority: "must-not-reach-a-block",
    },
    metadata: {
      injectedPrompt: "must-not-reach-a-block",
    },
  },
});

const script = design.pipeline.find((entry) => entry.block === "script_gen");
const metadata = design.pipeline.find((entry) => entry.block === "metadata");
assert.ok(script && metadata, "the baseline must contain script and metadata modules");
assert.equal(script.params?.style, "crime", "a documented editor control survives compiler-side allowlisting");
assert.equal(
  script.params?.maxSeconds,
  design.episodeLengthSeconds,
  "the family length contract remains authoritative over a raw script-duration override",
);
assert.equal(script.params?.fabricatedAuthority, undefined, "unknown direct overrides never reach a block");
assert.equal(metadata.params?.injectedPrompt, undefined, "unknown direct metadata overrides never reach a block");

const musicLoop = designPipeline({
  family: "music_loop",
  lengthMinutes: 10,
  paramOverrides: { music: { trackCount: 8 } },
});
const loopAssemble = musicLoop.pipeline.find((entry) => entry.block === "assemble");
const loopMusic = musicLoop.pipeline.find((entry) => entry.block === "music");
assert.equal(loopAssemble?.params?.durationSec, 600, "loop assembly duration is pinned to the selected family length");
assert.equal(loopMusic?.params?.trackCount, 2, "music track count cannot outgrow the selected loop duration");

assert.throws(
  () => designPipeline({
    family: "quizyear",
    quizProfile: "world_geography",
    paramOverrides: { quiz_year: { categories: "general_knowledge" } },
  }),
  /categories and topics are owned by the certified QuizYear profile/,
  "route-owned quiz identity must be rejected before generic sanitization could hide the attempted override",
);

assert.deepEqual(
  sanitizeParamOverrides({
    script_gen: { maxSeconds: 3600, style: "crime" },
    length_check: { minSeconds: 1, maxSeconds: 5400 },
    assemble: { durationSec: 3600, deblurIntro: false },
  }),
  {
    script_gen: { style: "crime" },
    assemble: { deblurIntro: false },
  },
  "the operator surface only forwards craft controls; format duration is selected once at channel-design time",
);

console.log("designer param-override authority boundary tests passed");
