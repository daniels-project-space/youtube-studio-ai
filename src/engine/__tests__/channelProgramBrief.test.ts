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
const { catalogFingerprint: _catalogFingerprint, ...withoutCatalogFingerprint } = canonical;
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
