import assert from "node:assert/strict";

import { familyChannelInceptionCapability } from "@/engine/channelInceptionCapability";

const quizyear = familyChannelInceptionCapability("quizyear");
assert.equal(quizyear.mode, "registered_non_gemini");
if (quizyear.mode === "registered_non_gemini") {
  assert.deepEqual(
    quizyear.coveredStages,
    [
      "deterministic-positioning",
      "local-avatar-and-banner",
      "source-first-starter-slate",
      "immutable-artifact-persistence",
      "draft-only-publication-state",
    ],
  );
  assert.match(quizyear.provenance, /CC0 Wikidata/);
}

const narrated = familyChannelInceptionCapability("narrated_stock");
assert.equal(narrated.mode, "registered_non_gemini");
if (narrated.mode === "registered_non_gemini") {
  assert.deepEqual(
    narrated.coveredStages,
    [
      "metadata-only-niche-research",
      "claude-positioning-style-dna-show-bible",
      "provider-metadata-voice-selection-and-local-cold-open",
      "novita-channel-art-and-non-google-vision-qa",
      "non-google-starter-topics-and-sealed-thumbnail-slate",
      "draft-only-publication-state",
    ],
  );
  assert.match(narrated.provenance, /sealed thumbnail-only Gemini exception/);
}

const illustrated = familyChannelInceptionCapability("illustrated_explainer");
assert.equal(illustrated.mode, "registered_non_gemini");
if (illustrated.mode === "registered_non_gemini") {
  assert.deepEqual(
    illustrated.coveredStages,
    [
      "deterministic-positioning",
      "local-avatar-and-banner",
      "fictional-no-external-claims-starter-slate",
      "immutable-artifact-persistence",
      "draft-only-publication-state",
    ],
  );
  assert.match(illustrated.provenance, /local SVG scenario-board/);
  assert.doesNotMatch(illustrated.provenance, /Gemini|Google|Nano Banana/i);
}

const unregisteredFutureFamily = familyChannelInceptionCapability("cinematic");
assert.equal(
  unregisteredFutureFamily.mode,
  "unregistered",
  "future non-Gemini episode planners must opt into creator capability independently",
);

console.log("Channel inception capability admission tests passed");
