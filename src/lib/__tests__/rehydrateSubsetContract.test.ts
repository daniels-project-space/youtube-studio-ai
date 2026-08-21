/**
 * Pins the render-child rehydration filter (src/trigger/render-block.ts).
 *
 * render-block runs on a FRESH worker and rebuilds the store from every
 * completed upstream block. It used to rehydrate all of them from R2 — narration,
 * every footage clip, intro card, overlays, music, avatar — even when the block
 * it was dispatched to run consumes none of that media. It now rehydrates only
 * the artifacts the target block's declared contract says it can read.
 *
 * That is only safe while BOTH hold, so both are asserted here:
 *   1. selectRehydrationSubset keeps each needed value together with the sibling
 *      R2 key rehydrateOutputs restores it from (dropping the sibling would
 *      silently un-rehydrate a genuinely needed artifact).
 *   2. No remote render block reads an R2-BACKED key it does not declare. Plain
 *      undeclared reads are fine (they are merged raw and never fetched); an
 *      undeclared *local-path* read would break real video assembly.
 */
import assert from "node:assert/strict";
import { selectRehydrationSubset } from "@/lib/rehydrate";
import { registerAllBlocks } from "@/engine/blocks";
import { allManifests, getManifest } from "@/engine/registry";
import { REMOTE_RENDER_BLOCK_IDS } from "@/lib/pipelineInvocationSnapshot";

// ---------------------------------------------------------------- 1. selection

const narrationOutputs = {
  narrationLocalPath: "/tmp/run/narration.mp3",
  narrationKey: "owners/o1/runs/r1/narration.mp3",
  narrationDurationSec: 612,
  sentenceTimings: [{ text: "hi", start: 0, end: 1 }],
};

// A consumer that needs nothing from this patch pays ZERO R2 GETs for it.
assert.equal(selectRehydrationSubset(narrationOutputs, new Set(["shotList"])), null);
assert.equal(selectRehydrationSubset({}, new Set(["narrationLocalPath"])), null);

// A needed local path drags its sibling R2 key along, or it could not be restored.
assert.deepEqual(
  selectRehydrationSubset(narrationOutputs, new Set(["narrationLocalPath"])),
  {
    narrationLocalPath: "/tmp/run/narration.mp3",
    narrationKey: "owners/o1/runs/r1/narration.mp3",
  },
);

// Non-media values pass through without dragging anything extra in.
assert.deepEqual(
  selectRehydrationSubset(narrationOutputs, new Set(["narrationDurationSec"])),
  { narrationDurationSec: 612 },
);

// Array-of-clips convention: footageClips←footageKeys, entityClips←entityKeys.
for (const [clips, keys] of [
  ["footageClips", "footageKeys"],
  ["entityClips", "entityKeys"],
] as const) {
  const outputs = { [clips]: ["/tmp/a.mp4", "/tmp/b.mp4"], [keys]: ["r2/a.mp4", "r2/b.mp4"], other: 1 };
  assert.deepEqual(selectRehydrationSubset(outputs, new Set([clips])), {
    [clips]: ["/tmp/a.mp4", "/tmp/b.mp4"],
    [keys]: ["r2/a.mp4", "r2/b.mp4"],
  });
}

// Url/Path suffixes resolve to the same `<base>Key` sibling as LocalPath does.
assert.deepEqual(
  selectRehydrationSubset({ musicUrl: "/tmp/m.mp3", musicKey: "r2/m.mp3" }, new Set(["musicUrl"])),
  { musicUrl: "/tmp/m.mp3", musicKey: "r2/m.mp3" },
);
assert.deepEqual(
  selectRehydrationSubset(
    { introCardPath: "/tmp/i.mp4", introCardKey: "r2/i.mp4" },
    new Set(["introCardPath"]),
  ),
  { introCardPath: "/tmp/i.mp4", introCardKey: "r2/i.mp4" },
);

// Nested overlay specs carry their own per-item `key`, so no sibling is needed.
const overlays = [{ path: "/tmp/q.png", key: "r2/q.png" }];
assert.deepEqual(selectRehydrationSubset({ quoteOverlays: overlays }, new Set(["quoteOverlays"])), {
  quoteOverlays: overlays,
});

// A missing sibling must not be invented — rehydrateOutputs simply can't restore it.
assert.deepEqual(
  selectRehydrationSubset({ videoLocalPath: "/tmp/v.mp4" }, new Set(["videoLocalPath"])),
  { videoLocalPath: "/tmp/v.mp4" },
);

// ------------------------------------------------- 2. contract-coverage guard

registerAllBlocks();

/** Output keys rehydrateOutputs would spend a real R2 GET on. */
const r2BackedKeys = new Set<string>(["quoteOverlays", "insertOverlays", "extraOverlays"]);
for (const manifest of allManifests()) {
  const produced = [...Object.keys(manifest.produces), ...Object.keys(manifest.optionalProduces)];
  const owned = new Set(produced);
  for (const key of produced) {
    const base = key.replace(/(LocalPath|Url|Path)$/, "");
    if (base !== key && owned.has(`${base}Key`)) r2BackedKeys.add(key);
    if (/Clips$/.test(key) && owned.has(`${key.replace(/Clips$/, "")}Keys`)) r2BackedKeys.add(key);
  }
}
// Sanity: the well-known heavy artifacts must be recognised as R2-backed, or the
// guard below would pass vacuously.
for (const key of ["narrationLocalPath", "footageClips", "entityClips", "introCardPath", "musicUrl"]) {
  assert.ok(r2BackedKeys.has(key), `expected ${key} to be recognised as R2-backed`);
}

/**
 * Every store key each remote render block actually reads, extracted from source.
 * Kept as an explicit list (not a live scan) so that ADDING an undeclared
 * R2-backed read to one of these blocks fails here instead of silently losing
 * the artifact at render time. Re-derive with the patterns in the comment below
 * if a block gains new ctx.store reads.
 *   ctx.store["X"] | str(ctx,"X") | const {X} = ctx.store
 */
const ACTUAL_STORE_READS: Record<string, readonly string[]> = {
  timeline_assemble: [
    "channelAvatarKey", "channelName", "chapterPlan", "cinematicEditDecisionList",
    "cinematicGeneratedScenePlan", "entityClips", "extraOverlays", "footageClips",
    "generatedFootageSceneManifest", "healClasses", "healHints", "insertOverlays",
    "introApplied", "introCardKey", "introCardPath", "introSec", "ltxStyleId", "musicUrl",
    "narrationDurationSec", "narrationLocalPath", "quoteOverlays", "script",
    "sentenceTimings", "shotQaReport", "shotRenderManifest", "visualCoverage",
  ],
  documotion_short: ["beatManifest", "contentLane", "documotionRender", "documotionVerdict", "topic"],
  novita_render_images: ["dpVisualSpecs", "shotList", "stillRenderManifest", "visualMatterManifest"],
  novita_render_video: [
    "assetQaReport", "dpVisualSpecs", "selectedStillManifest", "shotList",
    "shotRenderManifest", "visualMatterManifest",
  ],
};

assert.deepEqual(
  Object.keys(ACTUAL_STORE_READS).sort(),
  [...REMOTE_RENDER_BLOCK_IDS].sort(),
  "every remote render block must be covered by the contract guard",
);

for (const blockId of REMOTE_RENDER_BLOCK_IDS) {
  const manifest = getManifest(blockId);
  assert.ok(manifest, `${blockId} must be registered`);
  // Exactly the union render-block.ts builds.
  const declared = new Set<string>([
    ...manifest.block.consumes,
    ...Object.keys(manifest.consumes),
    ...Object.keys(manifest.optionalConsumes),
  ]);
  const undeclaredR2Reads = ACTUAL_STORE_READS[blockId].filter(
    (key) => r2BackedKeys.has(key) && !declared.has(key),
  );
  assert.deepEqual(
    undeclaredR2Reads,
    [],
    `${blockId} reads R2-backed store keys it does not declare (${undeclaredR2Reads.join(", ")}) — ` +
      `render-block would skip rehydrating them and the render would open missing files. ` +
      `Declare them in MODULE_CONTRACTS optionalConsumes.`,
  );
}

// timeline_assemble is the one remote block that genuinely needs heavy media —
// pin that the filter still lets all of it through (guards against a contract
// edit quietly starving the assembler).
{
  const manifest = getManifest("timeline_assemble")!;
  const declared = new Set<string>([
    ...manifest.block.consumes,
    ...Object.keys(manifest.consumes),
    ...Object.keys(manifest.optionalConsumes),
  ]);
  for (const key of [
    "footageClips", "entityClips", "narrationLocalPath", "introCardPath",
    "musicUrl", "quoteOverlays", "insertOverlays", "extraOverlays",
  ]) {
    assert.ok(declared.has(key), `timeline_assemble must still declare ${key}`);
  }
}

// The pure-render blocks consume NO R2-backed media — this is where the savings
// come from, so pin it: any of these gaining a media input should surface here.
for (const blockId of ["documotion_short", "novita_render_images", "novita_render_video"] as const) {
  const manifest = getManifest(blockId)!;
  const declared = [
    ...manifest.block.consumes,
    ...Object.keys(manifest.consumes),
    ...Object.keys(manifest.optionalConsumes),
  ];
  assert.deepEqual(
    declared.filter((key) => r2BackedKeys.has(key)),
    [],
    `${blockId} unexpectedly declares R2-backed media inputs`,
  );
}

console.log("rehydrateSubsetContract: ok");
