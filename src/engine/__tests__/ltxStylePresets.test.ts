import assert from "node:assert/strict";
import { DEFAULT_LTX_STYLE_ID, getLtxStyle, LTX_STYLES } from "@/engine/ltxStylePresets";

// Mirrors the AdapterIdSchema regex in src/lib/ltxCreativeAdapter.ts (not
// exported from there, so the shape is asserted independently here).
const ADAPTER_ID_PATTERN = /^ltx-creative-[a-z0-9][a-z0-9-]{1,78}$/;

const styleIds = Object.keys(LTX_STYLES);
assert.ok(styleIds.length > 0, "LTX_STYLES must not be empty");

for (const id of styleIds) {
  const style = LTX_STYLES[id]!;
  assert.equal(style.id, id, `style key "${id}" must match its own id field`);
  assert.ok(style.label.trim().length > 0, `${id}: label must be non-empty`);
  assert.ok(style.worldDescription.trim().length > 0, `${id}: worldDescription must be non-empty`);

  const { appearance, lightingColor, cameraDoctrine, soundscapeDefault } = style.promptGuidance;
  assert.ok(appearance.trim().length > 0, `${id}: promptGuidance.appearance must be non-empty`);
  assert.ok(lightingColor.trim().length > 0, `${id}: promptGuidance.lightingColor must be non-empty`);
  assert.ok(cameraDoctrine.trim().length > 0, `${id}: promptGuidance.cameraDoctrine must be non-empty`);
  assert.ok(soundscapeDefault.trim().length > 0, `${id}: promptGuidance.soundscapeDefault must be non-empty`);

  for (const adapterId of style.candidateAdapterIds) {
    assert.match(
      adapterId,
      ADAPTER_ID_PATTERN,
      `${id}: candidateAdapterIds entry "${adapterId}" must match the ltx-creative-* adapter id shape`,
    );
  }
}

// Required six styles are present.
for (const id of [
  "cinematic_heist_noir",
  "documentary_mannequin",
  "anime",
  "photorealistic",
  "watercolor",
  "music_video_cinematic",
]) {
  assert.ok(id in LTX_STYLES, `LTX_STYLES must include "${id}"`);
}

// Default style id.
assert.equal(DEFAULT_LTX_STYLE_ID, "cinematic_heist_noir");

// getLtxStyle() with no arg returns the default (backward-compatibility contract).
assert.equal(getLtxStyle().id, "cinematic_heist_noir");
assert.equal(getLtxStyle(undefined).id, "cinematic_heist_noir");

// getLtxStyle() with an unknown id falls back to default rather than throwing.
assert.doesNotThrow(() => getLtxStyle("not-a-real-style"));
assert.equal(getLtxStyle("not-a-real-style").id, "cinematic_heist_noir");
assert.equal(getLtxStyle("").id, "cinematic_heist_noir");

// getLtxStyle() with a known id returns that exact style.
assert.equal(getLtxStyle("anime").id, "anime");
assert.equal(getLtxStyle("watercolor").label, "Watercolor");

console.log("ltxStylePresets: all assertions passed");
