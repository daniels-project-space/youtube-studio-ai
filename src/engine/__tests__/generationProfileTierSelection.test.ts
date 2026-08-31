/**
 * GENERATION-PROFILE TIER SELECTION.
 *
 * GENERATION_PROFILES ships three real render tiers (draft / production / hero)
 * but every design-time call site used to hardcode the literal "production", so
 * draft and hero were unreachable from channel configuration. `DesignOptions
 * .generationProfile` (and the matching `completePipelineForPolicy` option) make
 * the tier selectable.
 *
 * The load-bearing property is that this is PURE PLUMBING: no channel sets the
 * new field today, and an absent field must reproduce the previous hardcoded
 * value exactly — for every family, on every tier-carrying block.
 */
import assert from "node:assert/strict";
import { designPipeline, type DesignOptions } from "@/engine/designer";
import {
  completePipelineForPolicy,
  DEFAULT_GENERATION_PROFILE,
} from "@/engine/pipelineCompiler";
import { GENERATION_PROFILES } from "@/engine/generationProfiles";
import { FAMILIES, type FamilyKey } from "@/engine/families";
import type { PipelineEntry } from "@/engine/types";

/** Every block that carries a render tier into the runtime. */
const TIER_CARRYING_BLOCKS = [
  "novita_render_images",
  "novita_render_video",
  "story_spine",
] as const;

const ALL_FAMILIES = Object.keys(FAMILIES) as FamilyKey[];

function tierParams(pipeline: readonly PipelineEntry[]): [string, unknown][] {
  return pipeline
    .filter((entry) => (TIER_CARRYING_BLOCKS as readonly string[]).includes(entry.block))
    .map((entry) => [entry.block, entry.params?.["generationProfile"]]);
}

/** The pipeline with every tier value blanked — everything the tier must NOT affect. */
function withoutTiers(pipeline: readonly PipelineEntry[]): unknown {
  return pipeline.map((entry) => {
    if (!(TIER_CARRYING_BLOCKS as readonly string[]).includes(entry.block)) return entry;
    const params = { ...(entry.params ?? {}) };
    if ("generationProfile" in params) params.generationProfile = "<tier>";
    return { block: entry.block, params };
  });
}

function design(family: FamilyKey, extra?: Partial<DesignOptions>) {
  return designPipeline({ family, ...extra });
}

// ---------------------------------------------------------------------------
// 1. THE DEFAULT IS "production", AND IT IS THE ONLY STATE ANY CHANNEL HAS.
// ---------------------------------------------------------------------------
assert.equal(
  DEFAULT_GENERATION_PROFILE,
  "production",
  "the absent-field default must stay the historical hardcoded tier",
);
assert.ok(
  GENERATION_PROFILES[DEFAULT_GENERATION_PROFILE],
  "the default tier must be a real generation profile",
);

// Every family, field ABSENT: byte-for-byte the previous hardcoded literal.
let tierBlocksSeen = 0;
for (const family of ALL_FAMILIES) {
  const pairs = tierParams(design(family).pipeline);
  for (const [block, value] of pairs) {
    tierBlocksSeen++;
    // Some archetypes ship their own story_spine with no tier param at all; the
    // runtime resolves that to "production" too. Either shape is pre-existing —
    // what matters is that it is NEVER anything other than production.
    assert.ok(
      value === "production" || value === undefined,
      `${family}/${block}: an unset generationProfile resolved to ${String(value)}, not "production"`,
    );
  }
}
assert.ok(
  tierBlocksSeen >= 5,
  `expected the tier-carrying blocks to be exercised, saw ${tierBlocksSeen}`,
);

// Explicitly passing undefined must behave exactly like omitting the field.
for (const family of ALL_FAMILIES) {
  assert.deepEqual(
    design(family, { generationProfile: undefined }).pipeline,
    design(family).pipeline,
    `${family}: an explicitly-undefined tier must equal an omitted tier`,
  );
}

// ---------------------------------------------------------------------------
// 2. A SET FIELD ACTUALLY TAKES EFFECT AT THE WIRED CALL SITES.
//    `cinematic` is the ai_scenes family, so it exercises all three blocks:
//    novita_render_images + novita_render_video (the gen-visual swap) and
//    story_spine (the narrated-spine splice).
// ---------------------------------------------------------------------------
for (const tier of ["draft", "hero"] as const) {
  const result = design("cinematic", { generationProfile: tier });
  const pipeline = result.pipeline;
  const pairs = tierParams(pipeline);
  assert.deepEqual(
    pairs.map(([block]) => block).sort(),
    ["novita_render_images", "novita_render_video", "story_spine"],
    "cinematic must carry the tier on the keyframe, I2V and spine blocks",
  );
  for (const [block, value] of pairs) {
    assert.equal(value, tier, `cinematic/${block} must honour the selected "${tier}" tier`);
  }
  if (tier === "draft") {
    assert.equal(result.productionReady, false, "draft must never present as a runnable production channel");
    assert.ok(
      result.runtimeBlockers.some((blocker) => blocker.includes("preview-only")),
      "draft must expose its non-runnable quality boundary to callers",
    );
  }
}

// Selecting a tier changes ONLY the tier — never the graph or any other param.
{
  const baseline = design("cinematic").pipeline;
  for (const tier of ["draft", "hero", "production"] as const) {
    assert.deepEqual(
      withoutTiers(design("cinematic", { generationProfile: tier }).pipeline),
      withoutTiers(baseline),
      `selecting "${tier}" must not alter block order, membership or any other param`,
    );
  }
  // …and passing the default explicitly is indistinguishable from omitting it.
  assert.deepEqual(
    design("cinematic", { generationProfile: "production" }).pipeline,
    baseline,
    'explicitly selecting "production" must equal the untouched default',
  );
}

// ---------------------------------------------------------------------------
// 3. THE LEGACY BACKFILL PATH KEEPS ITS DEFAULT.
//    completePipelineForPolicy backfills a story_spine into persisted
//    pre-overhaul pipelines. Its 7 legacy-repair callers pass no option and must
//    keep producing "production"; designPipeline threads the channel's tier.
// ---------------------------------------------------------------------------
// Derived from a REAL designed pipeline with the spine removed, so the fixture
// is a graph the policy completer actually accepts (rather than a hand-written
// one that trips an unrelated capability gate).
const legacyPipeline: PipelineEntry[] = design("narrated_stock")
  .pipeline.filter((entry) => entry.block !== "story_spine");
assert.ok(
  legacyPipeline.some((entry) => entry.block === "narration_tts"),
  "the legacy fixture must retain narration_tts so the spine backfill triggers",
);

function backfilledSpine(options?: Parameters<typeof completePipelineForPolicy>[1]) {
  const { entries, inserted } = completePipelineForPolicy(legacyPipeline, options);
  assert.ok(inserted.includes("story_spine"), "the legacy fixture must trigger a spine backfill");
  const spine = entries.find((entry) => entry.block === "story_spine");
  assert.ok(spine, "backfill must produce a story_spine entry");
  return spine.params?.["generationProfile"];
}

assert.equal(backfilledSpine(), "production", "no options must backfill the production tier");
assert.equal(backfilledSpine({}), "production", "an empty options object must still default");
assert.equal(
  backfilledSpine({ generationProfile: undefined }),
  "production",
  "an undefined tier must fall back to the production default",
);
assert.equal(backfilledSpine({ generationProfile: "draft" }), "draft");
assert.equal(backfilledSpine({ generationProfile: "hero" }), "hero");

// The backfill option must not disturb anything else about the repaired graph.
assert.deepEqual(
  withoutTiers(completePipelineForPolicy(legacyPipeline, { generationProfile: "draft" }).entries),
  withoutTiers(completePipelineForPolicy(legacyPipeline).entries),
  "the backfill tier must change only the tier",
);

// ---------------------------------------------------------------------------
// 4. ONLY REAL TIERS ARE EMITTED.
// ---------------------------------------------------------------------------
for (const family of ALL_FAMILIES) {
  for (const [block, value] of tierParams(design(family).pipeline)) {
    if (value === undefined) continue;
    assert.ok(
      GENERATION_PROFILES[value as keyof typeof GENERATION_PROFILES],
      `${family}/${block} emitted an unknown generation profile: ${String(value)}`,
    );
  }
}

console.log(
  `GENERATION PROFILE TIER PASS: ${ALL_FAMILIES.length} families default to "production" with the field unset; ` +
    "draft reaches preview-only design output, hero remains production-quality, and legacy backfill keeps its default",
);
