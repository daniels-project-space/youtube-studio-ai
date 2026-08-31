import assert from "node:assert/strict";

import {
  CHANNEL_PROGRAM_BRIEF_POSITIONING_TEXT_MAX_CHARS,
  CHANNEL_PROGRAM_BRIEF_VERSION,
  assertCanonicalChannelProgramBrief,
  assertPersistedProgramBriefIdentity,
  canonicalChannelProgramBrief,
  channelProgramBriefFingerprint,
  channelProgramBriefPositioningText,
  briefToCreativeCapabilityIntent,
  briefToFormatSelectionInput,
  createChannelProgramBrief,
  parseChannelProgramBrief,
  parseChannelProgramBriefDraft,
  SERIALIZED_PROGRAM_VERSION,
} from "@/engine/channelProgramBrief";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const canonical = createChannelProgramBrief({
  family: "whiteboard",
  nicheKey: "educational",
  subcategory: "how-to-tutorials",
  locale: "en-us",
  concept: "  Explain complex science mechanisms with causal whiteboard stories.  ",
  audience: " Curious adults who want a rigorous visual explanation ",
  sampleTopics: [
    " How a quantum computer measures a qubit ",
    "How a quantum computer measures a qubit",
    "Why satellites stay in orbit",
  ],
});

assert.deepEqual(canonical, {
  version: CHANNEL_PROGRAM_BRIEF_VERSION,
  family: "whiteboard",
  catalogFingerprint: sha256Hex(canonicalJson({
    family: {
      key: "whiteboard",
      label: "Whiteboard explainer (drawn cinema)",
    },
    niche: {
      key: "educational",
      label: "Educational",
    },
    subcategory: {
      id: "how-to-tutorials",
      displayName: "How things work",
    },
  })),
  nicheKey: "educational",
  subcategory: "How things work",
  locale: "en-US",
  concept: "Explain complex science mechanisms with causal whiteboard stories.",
  audience: "Curious adults who want a rigorous visual explanation",
  sampleTopics: [
    "How a quantum computer measures a qubit",
    "Why satellites stay in orbit",
  ],
});

assert.deepEqual(parseChannelProgramBriefDraft({
  nicheKey: "educational",
  subcategory: "how-to-tutorials",
  concept: "  Explain complex science mechanisms with causal whiteboard stories.  ",
}), {
  nicheKey: "educational",
  subcategory: "How things work",
  locale: "en",
  concept: "Explain complex science mechanisms with causal whiteboard stories.",
});

assert.deepEqual(assertCanonicalChannelProgramBrief(canonical), canonical);
assert.deepEqual(parseChannelProgramBrief(canonical), canonical);
assert.equal(canonicalChannelProgramBrief(canonical), canonicalJson(canonical));

const sportsIntentBrief = createChannelProgramBrief({
  family: "quizyear",
  nicheKey: "educational",
  locale: "en",
  concept: "Trace recurring sports championships through sourced Guess-the-Year challenges.",
  programIntent: { kind: "sports_championship_timeline" },
});
const certifiedQuizIntentBrief = createChannelProgramBrief({
  family: "quizyear",
  nicheKey: "educational",
  locale: "en",
  concept: "Trace recurring sports championships through sourced Guess-the-Year challenges.",
  programIntent: { kind: "certified_quiz", profile: "world_geography" },
});
assert.deepEqual(sportsIntentBrief.programIntent, { kind: "sports_championship_timeline" });
assert.notEqual(
  channelProgramBriefFingerprint(sportsIntentBrief),
  channelProgramBriefFingerprint(certifiedQuizIntentBrief),
  "a declared program intent must be part of the immutable program identity",
);
const serializedBrief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "educational",
  locale: "en",
  concept: "A recurring educational series with one clear lesson and a reliable viewer promise.",
  serializedProgram: {
    version: SERIALIZED_PROGRAM_VERSION,
    seriesTitle: "  Seven Days of Better Questions  ",
    seriesCount: 7,
  },
});
assert.deepEqual(serializedBrief.serializedProgram, {
  version: SERIALIZED_PROGRAM_VERSION,
  seriesTitle: "Seven Days of Better Questions",
  seriesCount: 7,
});
assert.notEqual(
  channelProgramBriefFingerprint(serializedBrief),
  channelProgramBriefFingerprint(createChannelProgramBrief({
    ...serializedBrief,
    serializedProgram: undefined,
  })),
  "serialized_program/v1 must be part of the canonical brief identity",
);
assert.throws(
  () => assertCanonicalChannelProgramBrief({
    ...serializedBrief,
    serializedProgram: {
      ...serializedBrief.serializedProgram,
      seriesTitle: " Seven Days of Better Questions ",
    },
  }),
  /noncanonical/,
  "a submitted serialized program must reject a whitespace variant instead of rewriting it",
);
assert.throws(
  () => createChannelProgramBrief({
    ...serializedBrief,
    serializedProgram: {
      version: SERIALIZED_PROGRAM_VERSION,
      seriesTitle: "Three useful lessons",
      seriesCount: 0,
    },
  }),
  /greater than 0/,
  "seriesCount is optional but, when declared, must be positive",
);
assert.throws(
  () => createChannelProgramBrief({
    ...canonical,
    programIntent: { kind: "fictional_scenario", profile: "ai_decision" },
  }),
  /fictional scenario program intents require the illustrated_explainer family/,
  "a structured program intent must remain compatible with its canonical family",
);
assert.throws(
  () => assertCanonicalChannelProgramBrief({
    ...sportsIntentBrief,
    programIntent: { kind: "certified_quiz", profile: "not-a-profile" },
  }),
  /programIntent/,
  "a submitted intent must remain within the certified enum rather than becoming loose route text",
);
assert.deepEqual(
  assertPersistedProgramBriefIdentity(
    { nicheKey: canonical.nicheKey, programBrief: canonical },
    {
      context: "program brief test identity",
      expectedFamily: canonical.family,
      expectedProgramBrief: canonical,
      requireProgramBrief: true,
    },
  ),
  canonical,
);
assert.throws(
  () => assertPersistedProgramBriefIdentity(
    { nicheKey: "history", programBrief: canonical },
    { context: "program brief test identity" },
  ),
  /nicheKey history must match canonical program brief nicheKey educational/,
);
assert.throws(
  () => assertPersistedProgramBriefIdentity(
    { nicheKey: canonical.nicheKey, programBrief: canonical },
    { context: "program brief test identity", expectedFamily: "music_loop" },
  ),
  /family whiteboard does not match expected family music_loop/,
);
assert.throws(
  () => assertPersistedProgramBriefIdentity({}, {
    context: "program brief test identity",
    requireProgramBrief: true,
  }),
  /is missing a canonical program brief/,
);

const reordered = {
  sampleTopics: canonical.sampleTopics,
  audience: canonical.audience,
  concept: canonical.concept,
  locale: canonical.locale,
  subcategory: canonical.subcategory,
  nicheKey: canonical.nicheKey,
  catalogFingerprint: canonical.catalogFingerprint,
  family: canonical.family,
  version: canonical.version,
};
assert.equal(
  channelProgramBriefFingerprint(canonical),
  channelProgramBriefFingerprint(reordered),
  "object key order must not alter the program identity",
);
assert.notEqual(
  channelProgramBriefFingerprint(canonical),
  channelProgramBriefFingerprint({ ...canonical, concept: "Explain why satellites stay in orbit with causal whiteboard stories." }),
  "a semantic concept change must invalidate the program identity",
);
assert.notEqual(
  channelProgramBriefFingerprint(canonical),
  channelProgramBriefFingerprint({ ...canonical, sampleTopics: [...canonical.sampleTopics].reverse() }),
  "declared sample-topic order is semantic and must be preserved",
);

assert.throws(
  () => assertCanonicalChannelProgramBrief({ ...canonical, concept: `  ${canonical.concept}  ` }),
  /noncanonical/,
  "submitted whitespace variants must not be silently rewritten after request-key binding",
);
assert.throws(
  () => parseChannelProgramBrief({ ...canonical, concept: `  ${canonical.concept}  ` }),
  /noncanonical/,
  "the full-brief parser must reject rather than rewrite a submitted variant",
);
assert.throws(
  () => canonicalChannelProgramBrief({ ...canonical, concept: `  ${canonical.concept}  ` }),
  /noncanonical/,
  "canonical JSON must reject a submitted variant instead of creating a second identity",
);
assert.throws(
  () => channelProgramBriefFingerprint({ ...canonical, concept: `  ${canonical.concept}  ` }),
  /noncanonical/,
  "the semantic fingerprint must only bind an already-canonical submitted brief",
);
assert.throws(
  () => assertCanonicalChannelProgramBrief({ ...canonical, catalogFingerprint: "0".repeat(64) }),
  /noncanonical/,
  "a tampered or stale catalog snapshot must be re-submitted against the live catalog",
);
const withoutCatalogFingerprint = { ...canonical };
Reflect.deleteProperty(withoutCatalogFingerprint, "catalogFingerprint");
assert.throws(
  () => assertCanonicalChannelProgramBrief(withoutCatalogFingerprint),
  /catalogFingerprint/,
  "a submitted brief must carry the current catalog snapshot",
);
assert.throws(
  () => assertCanonicalChannelProgramBrief({ ...canonical, subcategory: "how-to-tutorials" }),
  /noncanonical/,
  "submitted subcategory ids must become the current canonical subcategory value before submission",
);

for (const [field, invalid] of [
  ["family", "unregistered-family"],
  ["nicheKey", "unregistered-niche"],
  ["subcategory", "unregistered-subcategory"],
  ["locale", "definitely not a locale"],
] as const) {
  assert.throws(
    () => createChannelProgramBrief({ ...canonical, [field]: invalid }),
    /channel program brief/,
    `${field} must fail closed against the current catalog or locale rules`,
  );
}

assert.throws(
  () => createChannelProgramBrief({ ...canonical, concept: "too short" }),
  /concept/,
  "concept is a required substantive program promise",
);
assert.throws(
  () => createChannelProgramBrief({ ...canonical, sampleTopics: ["x"] }),
  /sampleTopics/,
  "sample topics are bounded individually after normalization",
);

const format = briefToFormatSelectionInput(canonical, {
  targetDurationSeconds: 420,
  maxPerVideoBudgetUsd: 3,
});
assert.deepEqual(format, {
  concept: canonical.concept,
  niche: "Educational — How things work",
  nicheKey: canonical.nicheKey,
  audience: canonical.audience,
  sampleTopics: canonical.sampleTopics,
  targetDurationSeconds: 420,
  maxPerVideoBudgetUsd: 3,
});
const capabilityIntent = briefToCreativeCapabilityIntent(canonical);
assert.deepEqual(capabilityIntent, {
  concept: canonical.concept,
  niche: "Educational — How things work",
  nicheKey: canonical.nicheKey,
  audience: canonical.audience,
  sampleTopics: canonical.sampleTopics,
});
assert.notEqual(format.sampleTopics, canonical.sampleTopics, "adapters must not leak mutable topic arrays");
assert.notEqual(capabilityIntent.sampleTopics, canonical.sampleTopics, "adapters must not leak mutable topic arrays");

const positioning = channelProgramBriefPositioningText(canonical);
assert.match(positioning, /Concept: Explain complex science mechanisms/);
assert.match(positioning, /Niche: Educational — How things work/);
assert.ok(positioning.length <= CHANNEL_PROGRAM_BRIEF_POSITIONING_TEXT_MAX_CHARS);

const longPositioning = channelProgramBriefPositioningText(createChannelProgramBrief({
  ...canonical,
  concept: "A ".repeat(300),
  sampleTopics: Array.from({ length: 12 }, (_, index) => `A distinct thoroughly scoped sample topic number ${index + 1} with enough detail`),
}));
assert.ok(longPositioning.length <= CHANNEL_PROGRAM_BRIEF_POSITIONING_TEXT_MAX_CHARS);

console.log("channel program brief contract tests passed");
