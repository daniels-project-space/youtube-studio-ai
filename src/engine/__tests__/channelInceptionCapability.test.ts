import assert from "node:assert/strict";

import {
  familyChannelInceptionCapability,
  familySupervisedChannelInceptionCapability,
} from "@/engine/channelInceptionCapability";

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

for (const family of ["sleep", "shorts"] as const) {
  const capability = familyChannelInceptionCapability(family);
  assert.equal(capability.mode, "registered_non_gemini");
  if (capability.mode === "registered_non_gemini") {
    assert.deepEqual(
      capability.coveredStages,
      [
        "metadata-only-niche-research",
        "claude-positioning-style-dna-show-bible",
        "provider-metadata-voice-selection-and-local-cold-open",
        "novita-channel-art-and-non-google-vision-qa",
        "non-google-starter-topics-and-sealed-thumbnail-slate",
        "draft-only-publication-state",
      ],
      `${family} must opt into every creator stage, not only the episode planner`,
    );
    assert.match(capability.provenance, /sealed thumbnail-only Gemini exception/);
  }
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

const children = familySupervisedChannelInceptionCapability("children_learning");
assert.equal(children?.mode, "registered_supervised_non_gemini");
assert.equal(children?.reviewScope, "private_human_child_editor_review_only");
assert.equal(children?.reviewHref, undefined, "the creator must not invent a children review desk that does not exist");
assert.ok(
  children?.requiredArtifacts.some((artifact) => artifact.includes("Show Bible")),
  "the selectable children route must name its real private-review intake material",
);

const casefile = familySupervisedChannelInceptionCapability("cinematic", { casefileCinematic: true });
assert.equal(casefile?.mode, "registered_supervised_non_gemini");
assert.equal(casefile?.reviewScope, "private_human_review_only");
assert.equal(casefile?.reviewHref, "/casefile");
assert.equal(
  familySupervisedChannelInceptionCapability("cinematic"),
  undefined,
  "a generic cinematic or fictional channel must not inherit Casefile private-review admission",
);

console.log("Channel inception capability admission tests passed");
