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

const unregisteredFutureFamily = familyChannelInceptionCapability("cinematic");
assert.equal(
  unregisteredFutureFamily.mode,
  "unregistered",
  "future non-Gemini episode planners must opt into creator capability independently",
);

console.log("Channel inception capability admission tests passed");
