import assert from "node:assert/strict";
import {
  clampFamilyEpisodeLengthMinutes,
  familyDurationContract,
  familyEpisodeLengthError,
  FAMILIES,
  resolveFamilyEpisodeLengthSeconds,
  type FamilyKey,
} from "@/engine/families";
import { designPipeline, enforceLengthContract } from "@/engine/designer";
import type { PipelineEntry } from "@/engine/types";
import { DEFAULT_LTX_STYLE_ID, getLtxStyle } from "@/engine/ltxStylePresets";

function corrupt(
  pipeline: readonly PipelineEntry[],
  blocks: readonly string[],
): PipelineEntry[] {
  return pipeline.map((entry) => blocks.includes(entry.block)
    ? { ...entry, params: { ...(entry.params ?? {}), targetSeconds: 999, panels: 999, minSeconds: 999, maxSeconds: 999, durationSec: 999, trackCount: 99 } }
    : entry,
  );
}

function params(pipeline: readonly PipelineEntry[], block: string): Record<string, unknown> {
  const entry = pipeline.find((candidate) => candidate.block === block);
  assert(entry, `expected ${block} in designed pipeline`);
  return (entry.params ?? {}) as Record<string, unknown>;
}

// A format's cadence is a production capability, not merely a wizard widget.
// Keep the client clamp, API validation, and compiler inputs anchored to one
// contract for every channel family.
for (const family of Object.keys(FAMILIES) as FamilyKey[]) {
  const contract = familyDurationContract(family);

  assert.equal(
    resolveFamilyEpisodeLengthSeconds(family, undefined),
    contract.defaultSeconds,
    `${family} must use its authored default when no duration is supplied`,
  );
  assert.equal(
    familyEpisodeLengthError(family, contract.minimumSeconds / 60),
    undefined,
    `${family} must accept its minimum episode duration`,
  );
  assert.equal(
    familyEpisodeLengthError(family, contract.maximumSeconds / 60),
    undefined,
    `${family} must accept its maximum episode duration`,
  );
  assert.match(
    familyEpisodeLengthError(family, (contract.minimumSeconds - 1) / 60) ?? "",
    /supports|needs a positive/,
    `${family} must reject a duration below its capability window`,
  );
  assert.match(
    familyEpisodeLengthError(family, (contract.maximumSeconds + 1) / 60) ?? "",
    /supports/,
    `${family} must reject a duration above its capability window`,
  );

  const clamped = clampFamilyEpisodeLengthMinutes(family, 10_000) * 60;
  assert.equal(
    clamped,
    contract.maximumSeconds,
    `${family} wizard clamp must never advertise a duration the compiler cannot honor`,
  );
}

assert.throws(
  () => designPipeline({ family: "cinematic", lengthMinutes: 5.01 }),
  /supports 1 min–5 min/,
  "cinematic must preserve its 50-shot, $130 production envelope rather than overrun it",
);
const boundedCinematic = designPipeline({ family: "cinematic", lengthMinutes: 5 });
assert.equal(boundedCinematic.productionReady, false, "the unavailable Novita runtime must remain fail-closed");
assert.ok(boundedCinematic.compilation, "the bounded cinematic contract must still compile for exact cost planning");
assert.deepEqual(
  {
    minSeconds: params(boundedCinematic.pipeline, "length_check").minSeconds,
    maxSeconds: params(boundedCinematic.pipeline, "length_check").maxSeconds,
  },
  { minSeconds: 180, maxSeconds: 300 },
  "a five-minute cinematic episode must never tolerate a sixth minute through its final length gate",
);

{
  const shorts = designPipeline({ family: "shorts", lengthMinutes: 50 / 60 });
  assert.deepEqual(
    {
      minSeconds: params(shorts.pipeline, "length_check").minSeconds,
      maxSeconds: params(shorts.pipeline, "length_check").maxSeconds,
    },
    { minSeconds: 30, maxSeconds: 60 },
    "the initial Shorts design must cap its production gate at YouTube's authored 60-second contract",
  );
  const repaired = enforceLengthContract(
    corrupt(shorts.pipeline, ["topic_select", "script_gen", "length_check"]),
    shorts.episodeLengthSeconds,
    "shorts",
  ).pipeline;
  assert.equal(params(repaired, "topic_select").targetSeconds, 50);
  assert.equal(params(repaired, "script_gen").maxSeconds, 50);
  assert.deepEqual(
    {
      minSeconds: params(repaired, "length_check").minSeconds,
      maxSeconds: params(repaired, "length_check").maxSeconds,
    },
    { minSeconds: 30, maxSeconds: 60 },
    "the post-architect repair pass must preserve the same 15–60 second Shorts envelope",
  );
}

const documentary = designPipeline({
  family: "documentary_collage_short",
  lengthMinutes: 52 / 60,
});
assert.equal(documentary.episodeLengthSeconds, 52);
for (const block of ["topic_select", "script_gen", "short_strategy", "documotion_short"]) {
  const entry = documentary.pipeline.find((candidate) => candidate.block === block);
  assert.equal(
    Number(entry?.params?.[block === "script_gen" ? "maxSeconds" : "targetSeconds"]),
    52,
    `documentary ${block} must use the legal requested 52-second editorial window`,
  );
}

// The final coordinator reapplies this law after all synthesis/customization.
// Exercise deliberately corrupted legal entries: a renderer must never inherit
// an unrelated target length merely because an upstream module was customized.
{
  const repaired = enforceLengthContract(
    corrupt(documentary.pipeline, ["topic_select", "short_strategy", "documotion_short", "length_check"]),
    documentary.episodeLengthSeconds,
    "documentary_collage_short",
  ).pipeline;
  assert.equal(params(repaired, "topic_select").targetSeconds, 52);
  assert.equal(params(repaired, "short_strategy").targetSeconds, 52);
  assert.equal(params(repaired, "documotion_short").targetSeconds, 52);
  assert.deepEqual(
    { minSeconds: params(repaired, "length_check").minSeconds, maxSeconds: params(repaired, "length_check").maxSeconds },
    { minSeconds: 20, maxSeconds: 60 },
    "a native documentary Short keeps the renderer's proven 20–60 second QA envelope",
  );
}

{
  const comic = designPipeline({ family: "comic", lengthMinutes: 176 / 60 });
  const repaired = enforceLengthContract(
    corrupt(comic.pipeline, ["topic_select", "motion_comic"]),
    comic.episodeLengthSeconds,
    "comic",
  ).pipeline;
  assert.equal(params(repaired, "topic_select").targetSeconds, 176);
  assert.equal(params(repaired, "motion_comic").targetSeconds, 176);
  assert.equal(params(repaired, "motion_comic").panels, 8);
}

{
  const quiz = designPipeline({ family: "quizyear" });
  const repaired = enforceLengthContract(
    corrupt(quiz.pipeline, ["quiz_year"]),
    quiz.episodeLengthSeconds,
    "quizyear",
  ).pipeline;
  assert.equal(quiz.episodeLengthSeconds, 80);
  assert.ok(
    repaired.some((entry) => entry.block === "quiz_topic_plan"),
    "the fixed-cadence QuizYear route owns a deterministic curated planner instead of topic_select",
  );
  assert.equal(
    repaired.some((entry) => entry.block === "topic_select"),
    false,
    "the no-Gemini QuizYear route must not retain generic topic selection",
  );
  assert.equal(params(repaired, "quiz_year").targetSeconds, 80);
}

{
  const lofi = designPipeline({ family: "music_loop", lengthMinutes: 3 });
  const repaired = enforceLengthContract(
    corrupt(lofi.pipeline, ["topic_select", "assemble", "music"]),
    lofi.episodeLengthSeconds,
    "music_loop",
  ).pipeline;
  assert.equal(params(repaired, "topic_select").targetSeconds, 180);
  assert.equal(params(repaired, "assemble").durationSec, 180);
  assert.equal(params(repaired, "music").trackCount, 2);
}

{
  const narrated = designPipeline({ family: "narrated_stock", lengthMinutes: 10 });
  const repaired = enforceLengthContract(
    corrupt(narrated.pipeline, ["topic_select", "director_brief"]),
    narrated.episodeLengthSeconds,
    "narrated_stock",
  ).pipeline;
  assert.equal(params(repaired, "topic_select").targetSeconds, 600);
  assert.equal(params(repaired, "director_brief").targetSeconds, 600);
}

assert.throws(
  () => designPipeline({ family: "quizyear", lengthMinutes: 1 }),
  /supports 80 sec fixed/,
  "a fixed-cadence quiz must never silently morph into a different game length",
);

// --- Wave: cinematic family LTX style-id wiring ---------------------------
// The gen_footage render path uses FAMILIES.cinematic.styleId as its safe
// fallback. A channel's sealed visual identity may now select a different,
// explicit LTX treatment only when one clear registry match exists; existing
// or ambiguous channels retain this historical default.
assert.equal(
  FAMILIES.cinematic.styleId,
  "cinematic_heist_noir",
  "the cinematic family must default to its historical LTX visual-style preset",
);
assert.equal(
  FAMILIES.cinematic.styleId,
  DEFAULT_LTX_STYLE_ID,
  "the cinematic family's default style must stay the LTX registry's own DEFAULT_LTX_STYLE_ID",
);
assert.equal(
  getLtxStyle(FAMILIES.cinematic.styleId).id,
  "cinematic_heist_noir",
  "FAMILIES.cinematic.styleId must resolve through getLtxStyle to a valid, matching LtxStyleDef",
);
// No other family has a catalog-owned LTX visual default. Individual admitted
// modules may carry a sealed runtime style selection, but the family catalog
// must not guess one for them.
for (const family of Object.keys(FAMILIES) as FamilyKey[]) {
  if (family === "cinematic") continue;
  assert.equal(
    FAMILIES[family].styleId,
    undefined,
    `${family} does not render through the LTX I2V contract yet and must not carry a styleId`,
  );
}

console.log("family duration contract test passed");
