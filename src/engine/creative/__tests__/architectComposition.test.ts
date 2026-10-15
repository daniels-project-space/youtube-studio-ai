import assert from "node:assert/strict";

import { channelPipelineValidationSeedKeys } from "@/engine/channelPipelineSeedKeys";
import { designPipeline } from "@/engine/designer";
import {
  pipelineEpisodeLengthSeconds,
  restorePipelineDurationContract,
} from "@/engine/designerCore";
import { familyDurationContract, FAMILIES, type FamilyKey } from "@/engine/families";
import { validatePipeline } from "@/engine/validate";
import { applyArchitectPlan, type ArchitectPlan } from "../architect";

const emptyPlan: ArchitectPlan = {
  summary: "Keep the valid composition",
  decisions: [],
  antiRepetition: [],
  missingCapabilities: [],
  groundingActions: [],
};

function blockOrder(entries: ReturnType<typeof designPipeline>["pipeline"]) {
  return entries.map(({ block }) => block);
}

for (const family of Object.keys(FAMILIES) as FamilyKey[]) {
  const design = designPipeline({
    family,
    nicheKey: "history",
    lengthMinutes: familyDurationContract(family).defaultSeconds / 60,
    publishMode: "draft",
  });
  assert.equal(
    pipelineEpisodeLengthSeconds(design.pipeline, family),
    design.episodeLengthSeconds,
    `${family}: manual architect must recover the exact saved duration from its baseline pipeline`,
  );
  assert.ok(design.available, `${family} should provide its authored module floor`);
  const result = applyArchitectPlan(design.pipeline, emptyPlan, { family });
  assert.deepEqual(blockOrder(result.pipeline), blockOrder(design.pipeline), `${family}: no-op must preserve module order`);
  assert.deepEqual(result.report.applied, []);
  assert.deepEqual(result.report.rejected, [], `${family}: seed-backed final validation must not discard a valid floor`);
  const initialGate = design.pipeline.find(({ block }) => block === "length_check")?.params;
  const architectGate = result.pipeline.find(({ block }) => block === "length_check")?.params;
  assert.deepEqual(
    { minSeconds: architectGate?.minSeconds, maxSeconds: architectGate?.maxSeconds },
    { minSeconds: initialGate?.minSeconds, maxSeconds: initialGate?.maxSeconds },
    `${family}: architect must preserve the authored family duration gate`,
  );
  assert.doesNotThrow(() => validatePipeline(
    result.pipeline,
    channelPipelineValidationSeedKeys(design.contentLane, undefined, result.pipeline),
  ));
}

const narrated = designPipeline({ family: "narrated_stock", nicheKey: "history", publishMode: "draft" });
const durationAndTonePlan: ArchitectPlan = {
  ...emptyPlan,
  decisions: [{
    action: "set_params",
    block: "script_gen",
    params: { maxSeconds: 60, style: "crime" },
    why: "Shorten the format while retaining a crime voice.",
  }],
};
const protectedNarrated = applyArchitectPlan(narrated.pipeline, durationAndTonePlan, { family: "narrated_stock" });
assert.equal(
  protectedNarrated.pipeline.find((entry) => entry.block === "script_gen")?.params?.maxSeconds,
  narrated.episodeLengthSeconds,
  "the architect toolbox must not let a channel-level duration become a module knob",
);
assert.equal(
  protectedNarrated.pipeline.find((entry) => entry.block === "script_gen")?.params?.style,
  "crime",
  "the architect may still tune the script's independent style control",
);
assert.ok(
  protectedNarrated.report.rejected.some((entry) => entry.reason?.includes("maxSeconds")),
  "the duration attempt must be visible as a rejected, out-of-contract parameter",
);
const shortenedNarrated = narrated.pipeline.map((entry) => entry.block === "script_gen"
  ? { ...entry, params: { ...entry.params, maxSeconds: 60 } }
  : entry);
const restoredNarrated = restorePipelineDurationContract(
  narrated.pipeline,
  shortenedNarrated,
  "narrated_stock",
);
assert.equal(
  restoredNarrated.pipeline.find((entry) => entry.block === "script_gen")?.params?.maxSeconds,
  narrated.episodeLengthSeconds,
  "manual architect normalization must restore the operator's narration target after an allowed script_gen edit",
);

const musicLoop = designPipeline({ family: "music_loop", nicheKey: "lofi", publishMode: "draft" });
const durationAndIntroPlan: ArchitectPlan = {
  ...emptyPlan,
  decisions: [{
    action: "set_params",
    block: "assemble",
    params: { durationSec: 3_600, deblurIntro: false },
    why: "Shorten the stream while removing the intro.",
  }],
};
const protectedLoop = applyArchitectPlan(musicLoop.pipeline, durationAndIntroPlan, { family: "music_loop" });
assert.equal(
  protectedLoop.pipeline.find((entry) => entry.block === "assemble")?.params?.durationSec,
  musicLoop.episodeLengthSeconds,
  "the architect toolbox must not change Lo-Fi's operator-owned final stream length",
);
assert.equal(
  protectedLoop.pipeline.find((entry) => entry.block === "assemble")?.params?.deblurIntro,
  false,
  "the architect may still tune assembly's independent intro treatment",
);
const shortenedLoop = musicLoop.pipeline.map((entry) => entry.block === "assemble"
  ? { ...entry, params: { ...entry.params, durationSec: 3_600 } }
  : entry);
const restoredLoop = restorePipelineDurationContract(musicLoop.pipeline, shortenedLoop, "music_loop");
assert.equal(
  restoredLoop.pipeline.find((entry) => entry.block === "assemble")?.params?.durationSec,
  musicLoop.episodeLengthSeconds,
  "manual architect normalization must restore the exact Lo-Fi master duration after an allowed assemble edit",
);
const eightHourLoop = designPipeline({
  family: "music_loop",
  lengthMinutes: 480,
  nicheKey: "lofi",
  publishMode: "draft",
});
assert.equal(
  pipelineEpisodeLengthSeconds(eightHourLoop.pipeline, "music_loop"),
  28_800,
  "duration recovery must retain the operator-selected top of Lo-Fi's one-to-eight-hour range",
);

const shortPlan: ArchitectPlan = {
  ...emptyPlan,
  summary: "Add a private discovery cut",
  decisions: [{
    action: "add",
    block: "shorts_spinoff",
    params: { shortDurSec: 45 },
    why: "Create a concise discovery version for this channel.",
  }],
};
const composed = applyArchitectPlan(narrated.pipeline, shortPlan, { family: "narrated_stock" });
assert.equal(composed.report.applied.length, 1, "a compatible real module should compose into the authored floor");
assert.deepEqual(composed.report.rejected, []);
const blocks = composed.pipeline.map((entry) => entry.block);
assert.ok(blocks.indexOf("upload_draft") < blocks.indexOf("shorts_spinoff"),
  "the composed Shorts module must follow its upload/watch URL producer");
const lane = narrated.contentLane;
assert.ok(lane);
assert.doesNotThrow(() => validatePipeline(
  composed.pipeline,
  channelPipelineValidationSeedKeys(lane, undefined, composed.pipeline),
));

const duplicatePlan: ArchitectPlan = {
  ...emptyPlan,
  decisions: [{ action: "add", block: "visual_inserts", why: "Already selected by the base graph." }],
};
const rejectedDuplicate = applyArchitectPlan(narrated.pipeline, duplicatePlan, { family: "narrated_stock" });
assert.deepEqual(blockOrder(rejectedDuplicate.pipeline), blockOrder(narrated.pipeline));
assert.deepEqual(rejectedDuplicate.report.rejected.map(({ reason }) => reason), ["already present"],
  "rejecting one bad architect operation must not convert seed-backed final validation into a floor fallback");

console.log("ARCHITECT COMPOSITION PASS: seeded floors, compatible module addition, and isolated rejection");
