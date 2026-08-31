import assert from "node:assert/strict";

import { buildChannelProfile } from "@/engine/channelProfile";
import { mergeRuntimeModuleConfig } from "@/engine/runtimeModuleConfig";
import type { PipelineEntry } from "@/engine/types";
import { resolveCrew } from "@/lib/crew/crewProfile";

const entries: PipelineEntry[] = [
  { block: "editor_brief", params: { existing: "kept" } },
  { block: "novita_render_video", params: { generationProfile: "production" } },
];
const firstParams = {
  editor_brief: { existing: "kept" },
  novita_render_video: { generationProfile: "production" },
};

const merged = mergeRuntimeModuleConfig({
  entries,
  paramsByBlock: firstParams,
  moduleConfig: {
    editor_brief: { preset: "hype" },
    "show-bible": { preset: "documentary", criticStrictness: "strict" },
    retired_block: { ignored: true },
  },
});
assert.equal(merged.paramsByBlock.editor_brief.existing, "kept", "entry params survive a configured preset");
assert.equal(merged.paramsByBlock.novita_render_video.generationProfile, "production");
assert.deepEqual(
  merged.frozenModuleConfig["show-bible"],
  {
    preset: "documentary",
    criticStrictness: "strict",
    editorCadence: "slow",
    directorStyle: "classical",
  },
  "virtual Show-Bible settings are validated and frozen even though no literal block consumes them",
);
assert.equal(
  merged.paramsByBlock["show-bible"],
  undefined,
  "virtual runtime configuration must not fabricate a pipeline operation",
);
assert.equal(
  merged.applied.find((entry) => entry.blockId === "show-bible")?.virtual,
  true,
  "operator visibility distinguishes virtual runtime settings from literal block params",
);
const crewFromFrozenConfig = resolveCrew(buildChannelProfile({
  row: {
    _id: "runtime-config-test-channel",
    name: "Runtime config test",
    slug: "runtime-config-test",
    status: "active",
    template: "narrated_stock",
    budget: 10,
    identity: {},
  },
  archetype: "narrated_stock",
  pipeline: [],
  moduleOverrides: merged.frozenModuleConfig,
}));
assert.equal(crewFromFrozenConfig.criticStrictness, "strict");
assert.equal(crewFromFrozenConfig.editorCadence, "slow");
assert.deepEqual(merged.skippedBlockIds, ["retired_block"], "unselected historical config is harmlessly ignored");
assert.deepEqual(
  firstParams,
  {
    editor_brief: { existing: "kept" },
    novita_render_video: { generationProfile: "production" },
  },
  "freezing a runtime config must not mutate the mutable channel row projection",
);

assert.throws(
  () => mergeRuntimeModuleConfig({
    entries,
    paramsByBlock: firstParams,
    moduleConfig: { editor_brief: { unknown_knob: true } },
  }),
  /moduleConfig\[editor_brief\] is invalid: unknown knob 'unknown_knob'/,
  "a selected module typo must not silently run with defaults",
);
assert.throws(
  () => mergeRuntimeModuleConfig({
    entries,
    paramsByBlock: firstParams,
    moduleConfig: { "show-bible": { criticStrictness: "too-lenient" } },
  }),
  /moduleConfig\[show-bible\] is invalid/,
  "invalid virtual crew settings must fail before execution rather than falling back to generic defaults",
);
assert.throws(
  () => mergeRuntimeModuleConfig({
    entries,
    paramsByBlock: firstParams,
    moduleConfig: { editor_brief: [] },
  }),
  /moduleConfig\[editor_brief\] must be an object/,
);
assert.throws(
  () => mergeRuntimeModuleConfig({
    entries,
    paramsByBlock: firstParams,
    moduleConfig: { novita_render_video: { preset: "hero" } },
  }),
  /targets a non-configurable module with no customization surface/,
  "a renderer cannot accept an untyped runtime setting just because it is selected",
);
assert.throws(
  () => mergeRuntimeModuleConfig({
    entries,
    paramsByBlock: firstParams,
    moduleConfig: { novita_render_video: { generationProfile: "hero" } },
  }),
  /targets a non-configurable module with no customization surface/,
  "an untyped raw renderer override cannot bypass the module-surface contract",
);

const routeOwnedEntries: PipelineEntry[] = [
  { block: "topic_select", params: { targetSeconds: 600, seriesTitle: "Signal Atlas", seriesCount: 6 } },
  { block: "script_gen", params: { maxSeconds: 600, style: "essay" } },
  { block: "length_check", params: { minSeconds: 540, maxSeconds: 660 } },
  { block: "assemble", params: { durationSec: 600, deblurIntro: true } },
];
const routeOwnedParams = Object.fromEntries(
  routeOwnedEntries.map((entry) => [entry.block, { ...(entry.params ?? {}) }]),
);
assert.throws(
  () => mergeRuntimeModuleConfig({
    entries: routeOwnedEntries,
    paramsByBlock: routeOwnedParams,
    moduleConfig: { script_gen: { maxSeconds: 3600 } },
  }),
  /moduleConfig\[script_gen\]\.maxSeconds cannot set a route-owned format value/,
  "a saved module setting cannot turn a sealed ten-minute channel into a one-hour script at execution time",
);
assert.throws(
  () => mergeRuntimeModuleConfig({
    entries: routeOwnedEntries,
    paramsByBlock: routeOwnedParams,
    moduleConfig: { topic_select: { seriesCount: 12 } },
  }),
  /moduleConfig\[topic_select\]\.seriesCount cannot set a route-owned format value/,
  "serialized-program scope is owned by the sealed Program Brief rather than an execution-time control",
);
assert.throws(
  () => mergeRuntimeModuleConfig({
    entries: routeOwnedEntries,
    paramsByBlock: routeOwnedParams,
    moduleConfig: { assemble: { durationSec: 3600 } },
  }),
  /moduleConfig\[assemble\]\.durationSec cannot set a route-owned format value/,
  "a music-loop assembly cannot extend beyond the route's sealed runtime after cost and QA planning",
);
const craftOnly = mergeRuntimeModuleConfig({
  entries: routeOwnedEntries,
  paramsByBlock: routeOwnedParams,
  moduleConfig: { script_gen: { endWithSummary: true }, assemble: { deblurIntro: false } },
});
assert.equal(craftOnly.paramsByBlock.script_gen.maxSeconds, 600);
assert.equal(craftOnly.paramsByBlock.script_gen.endWithSummary, true);
assert.equal(craftOnly.paramsByBlock.assemble.durationSec, 600);
assert.equal(craftOnly.paramsByBlock.assemble.deblurIntro, false);

console.log("runtime module config merge tests passed");
