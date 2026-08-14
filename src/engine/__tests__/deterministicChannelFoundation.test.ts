import assert from "node:assert/strict";

import {
  QUIZYEAR_DETERMINISTIC_FOUNDATION_PROFILE,
  buildDeterministicChannelFoundation,
  verifyDeterministicFoundationPersistence,
} from "@/engine/deterministicChannelFoundation";

const digest = (char: string) => char.repeat(64);

const input = {
  profile: QUIZYEAR_DETERMINISTIC_FOUNDATION_PROFILE,
  family: "quizyear" as const,
  channelName: "Quiz & Curiosity",
  storagePrefix: "channels/owner_test/quiz-curiosity",
  sources: [
    {
      id: "wikidata-q405",
      sourceUrl: "https://www.wikidata.org/wiki/Q405",
      contentFingerprint: digest("a"),
      license: "CC0-1.0",
      retrievedAt: 1_700_000_001,
      claim: "The source packet identifies the cited factual subject.",
    },
    {
      id: "wikidata-q193",
      sourceUrl: "https://www.wikidata.org/wiki/Q193",
      contentFingerprint: digest("b"),
      license: "CC0-1.0",
      retrievedAt: 1_700_000_002,
      claim: "The source packet identifies the cited factual subject.",
    },
    {
      id: "wikidata-q42",
      sourceUrl: "https://www.wikidata.org/wiki/Q42",
      contentFingerprint: digest("c"),
      license: "CC0-1.0",
      retrievedAt: 1_700_000_003,
      claim: "The source packet identifies the cited factual subject.",
    },
  ],
  starterSlate: [
    {
      id: "space-round",
      ordinal: 1,
      title: "Space Exploration Trivia Challenge #1",
      premise: "A fair timed round built from cited space-exploration facts.",
      keywords: ["space trivia", "astronomy quiz"],
      sourceIds: ["wikidata-q405"],
    },
    {
      id: "science-round",
      ordinal: 2,
      title: "Science Discovery Trivia Challenge #1",
      premise: "A fair timed round built from cited science-history facts.",
      keywords: ["science trivia", "discovery quiz"],
      sourceIds: ["wikidata-q193"],
    },
    {
      id: "landmark-round",
      ordinal: 3,
      title: "Landmark Trivia Challenge #1",
      premise: "A fair timed round built from cited landmark facts.",
      keywords: ["landmark trivia", "architecture quiz"],
      sourceIds: ["wikidata-q42"],
    },
  ],
};

const foundation = buildDeterministicChannelFoundation(input);
const reordered = buildDeterministicChannelFoundation({
  ...input,
  sources: [...input.sources].reverse(),
  starterSlate: [...input.starterSlate].reverse(),
});

assert.equal(foundation.foundationFingerprint, reordered.foundationFingerprint);
assert.equal(foundation.cost.maximumProviderCostUsd, 0);
assert.equal(foundation.cost.providerCalls, "forbidden");
assert.equal(foundation.publishing.initialState, "draft");
assert.equal(foundation.publishing.automaticPublishAllowed, false);
assert.equal(foundation.positioning.provenance.starterSlateFingerprint, foundation.starterSlate.fingerprint);
assert.deepEqual(foundation.starterSlate.entries.map((entry) => entry.ordinal), [1, 2, 3]);
assert.match(foundation.brandAssets[0].key, new RegExp(`${foundation.foundationFingerprint}/brand/avatar\\.svg$`));
assert.match(foundation.brandAssets[1].key, new RegExp(`${foundation.foundationFingerprint}/brand/banner\\.svg$`));
const avatar = new TextDecoder().decode(foundation.brandAssets[0].bytes);
const banner = new TextDecoder().decode(foundation.brandAssets[1].bytes);
assert.doesNotMatch(avatar, /<text\b/i);
assert.match(banner, /Quiz &amp; Curiosity/);
assert.doesNotMatch(banner, /<script|<image|\bhref\s*=/i);

const receipt = verifyDeterministicFoundationPersistence(foundation, {
  positioningFingerprint: foundation.positioning.fingerprint,
  starterSlate: foundation.manifestArtifact,
  avatar: foundation.brandAssets[0],
  banner: foundation.brandAssets[1],
  providerCostUsd: 0,
  publishingState: "draft",
});
assert.equal(receipt.providerCostUsd, 0);
assert.equal(receipt.publishingState, "draft");
assert.match(receipt.fingerprint, /^[a-f0-9]{64}$/);

assert.throws(
  () => verifyDeterministicFoundationPersistence(foundation, {
    positioningFingerprint: foundation.positioning.fingerprint,
    starterSlate: foundation.manifestArtifact,
    avatar: foundation.brandAssets[0],
    banner: foundation.brandAssets[1],
    providerCostUsd: 0.01,
    publishingState: "draft",
  }),
  /zero provider cost/,
);
assert.throws(
  () => buildDeterministicChannelFoundation({
    ...input,
    starterSlate: [{ ...input.starterSlate[0], sourceIds: ["unknown-source"] }, ...input.starterSlate.slice(1)],
  }),
  /unknown source/,
);
assert.throws(
  () => buildDeterministicChannelFoundation({
    ...input,
    sources: [{ ...input.sources[0], sourceUrl: "https://example.invalid/source" }, ...input.sources.slice(1)],
  }),
  /not allowed/,
);

console.log("Deterministic channel foundation tests passed");
