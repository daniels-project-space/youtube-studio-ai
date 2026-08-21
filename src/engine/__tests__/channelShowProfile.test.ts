import assert from "node:assert/strict";

import {
  assertChannelShowProfile,
  assertChannelShowProfilePipelineCompatibility,
  assertChannelShowProfileProgramBinding,
  channelShowProfileCapabilityKeys,
  channelShowProfileFingerprint,
  createChannelShowProfile,
  parseChannelShowProfile,
} from "@/engine/channelShowProfile";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { creativeCapabilitySelection } from "@/engine/creative/creativeCapabilityCatalog";
import { designPipeline } from "@/engine/designer";

const brief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "business",
  locale: "en",
  concept: "A source-attributed data storytelling channel with animated charts and ranked comparisons.",
});
const capabilitySelections = [creativeCapabilitySelection("source_attributed_data_story")];
const design = designPipeline({
  family: brief.family,
  nicheKey: brief.nicheKey,
  locale: brief.locale,
  programBrief: brief,
  capabilitySelections,
});

const profile = createChannelShowProfile({
  programBrief: brief,
  capabilitySelections,
  pipeline: design.pipeline,
});

assert.deepEqual(
  assertChannelShowProfile({
    profile,
    programBrief: brief,
    capabilitySelections,
    pipeline: design.pipeline,
  }),
  profile,
  "a profile must replay only its exact admitted composition",
);
assert.equal(channelShowProfileFingerprint(profile), profile.fingerprint);
assert.deepEqual(
  assertChannelShowProfileProgramBinding({ profile, programBrief: brief }),
  profile,
  "planning can bind a profile to the durable program before a compiler output is rehydrated",
);
assert.deepEqual(
  assertChannelShowProfilePipelineCompatibility({ profile, programBrief: brief, pipeline: design.pipeline }),
  profile,
  "later pipeline validation preserves selected capability obligations without freezing every safe refinement",
);
assert.deepEqual(channelShowProfileCapabilityKeys(profile), ["source_attributed_data_story"]);
assert.notEqual(
  channelShowProfileCapabilityKeys(profile),
  profile.selectedCapabilityKeys,
  "capability keys must not leak a mutable persisted array",
);

const rekeyed = {
  fingerprint: profile.fingerprint,
  designedPipelineFingerprint: profile.designedPipelineFingerprint,
  selectedCapabilityKeys: profile.selectedCapabilityKeys,
  creativeCapabilityCatalogFingerprint: profile.creativeCapabilityCatalogFingerprint,
  contentLaneFingerprint: profile.contentLaneFingerprint,
  familyManifestFingerprint: profile.familyManifestFingerprint,
  programBriefFingerprint: profile.programBriefFingerprint,
  version: profile.version,
};
assert.deepEqual(parseChannelShowProfile(rekeyed), profile, "object key order must not alter a show profile");

assert.throws(
  () => parseChannelShowProfile({ ...profile, selectedCapabilityKeys: ["source_attributed_data_story", "source_attributed_data_story"] }),
  /sorted and unique|fingerprint/,
  "duplicate selections cannot be hidden in a persisted profile",
);
assert.throws(
  () => parseChannelShowProfile({ ...profile, fingerprint: "0".repeat(64) }),
  /fingerprint/,
  "a forged profile fingerprint must fail closed",
);
assert.throws(
  () => parseChannelShowProfile({
    ...profile,
    selectedCapabilityKeys: ["not-a-capability"],
  }),
  /unknown creative capability|fingerprint/,
  "a persisted profile cannot invent a catalog capability key",
);
assert.throws(
  () => parseChannelShowProfile({
    ...profile,
    creativeCapabilityCatalogFingerprint: "creative-capability-catalog/v0:stale",
  }),
  /stale creative-capability catalog fingerprint/,
  "a retry cannot reuse a show profile against a changed capability catalog",
);
assert.throws(
  () => assertChannelShowProfile({
    profile,
    programBrief: brief,
    capabilitySelections,
    pipeline: design.pipeline.filter((entry) => entry.block !== "visual_inserts"),
  }),
  /requires effective pipeline block visual_inserts|does not match/,
  "selected-capability obligations must survive in the sealed pipeline",
);
assert.throws(
  () => assertChannelShowProfile({
    profile,
    programBrief: brief,
    capabilitySelections: [],
    pipeline: design.pipeline,
  }),
  /does not match/,
  "a retry cannot silently drop an opted-in capability",
);

const alteredPipeline = design.pipeline.map((entry, index) => index === 0
  ? { ...entry, params: { ...entry.params, profileBaselineVariant: "changed" } }
  : entry);
const alteredProfile = createChannelShowProfile({
  programBrief: brief,
  capabilitySelections,
  pipeline: alteredPipeline,
});
assert.notEqual(
  alteredProfile.fingerprint,
  profile.fingerprint,
  "a different baseline pipeline must become a different repeatable channel composition",
);

console.log("channel show profile contract tests passed");
