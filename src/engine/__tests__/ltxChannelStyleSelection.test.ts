import assert from "node:assert/strict";
import { selectLtxStyleForChannel } from "@/engine/ltxStylePresets";

const watercolor = selectLtxStyleForChannel({
  familyDefaultStyleId: "cinematic_heist_noir",
  styleDNA: {
    colorGrade: "muted watercolour washes with paper grain",
    composition: "quiet pencil sketch foreground and soft background",
  },
});
assert.deepEqual(watercolor, {
  styleId: "watercolor",
  source: "channel_identity",
  matchedSignals: [
    "muted watercolour washes with paper grain",
    "quiet pencil sketch foreground and soft background",
  ],
});

const anime = selectLtxStyleForChannel({
  familyDefaultStyleId: "cinematic_heist_noir",
  visualBrief: { promptStyle: "high-energy cel-shaded anime with expressive action poses" },
});
assert.equal(anime.styleId, "anime");
assert.equal(anime.source, "channel_identity");

const explicit = selectLtxStyleForChannel({
  explicitStyleId: "documentary_mannequin",
  familyDefaultStyleId: "cinematic_heist_noir",
  visualBrief: { promptStyle: "watercolor anime concept art" },
});
assert.deepEqual(explicit, {
  styleId: "documentary_mannequin",
  source: "persisted",
  matchedSignals: [],
});

const ambiguous = selectLtxStyleForChannel({
  familyDefaultStyleId: "cinematic_heist_noir",
  visualBrief: { promptStyle: "watercolor anime hybrid concept art" },
});
assert.deepEqual(ambiguous, {
  styleId: "cinematic_heist_noir",
  source: "family_default",
  matchedSignals: [],
});

const unknown = selectLtxStyleForChannel({
  explicitStyleId: "invented-style",
  familyDefaultStyleId: "invented-default",
});
assert.equal(unknown.styleId, "cinematic_heist_noir");
assert.equal(unknown.source, "family_default");

console.log("LTX channel style-selection tests passed");
