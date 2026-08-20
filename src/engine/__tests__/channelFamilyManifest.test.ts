import assert from "node:assert/strict";
import {
  assertChannelFamilyManifestIntegrity,
  CHANNEL_FAMILY_MANIFEST_VERSION,
  resolveChannelFamilyManifest,
} from "@/engine/channelFamilyManifest";
import { ARCHETYPES } from "@/engine/archetypes";
import {
  CONTENT_LANE_BY_FAMILY,
  CONTENT_LANE_POLICIES,
  type ContentLaneKey,
} from "@/engine/contentLane";
import {
  FAMILIES,
  FAMILY_DURATION_CONTRACTS,
  FAMILY_KEYS,
  type FamilyKey,
} from "@/engine/families";
import { NICHES } from "@/lib/nicheCatalog";

assert.doesNotThrow(
  () => assertChannelFamilyManifestIntegrity(),
  "the independent family catalogs must describe one internally-consistent product model",
);

const manifests = FAMILY_KEYS.map((family) => resolveChannelFamilyManifest(family));
assert.equal(manifests.length, FAMILY_KEYS.length, "every supported family must resolve exactly once");
assert.equal(
  new Set(manifests.map((manifest) => manifest.contentLane.key)).size,
  FAMILY_KEYS.length,
  "no two families may silently claim the same visual lane",
);

for (const manifest of manifests) {
  const key = manifest.family.key;
  assert.equal(manifest.version, CHANNEL_FAMILY_MANIFEST_VERSION);
  assert.equal(manifest.family, FAMILIES[key], `${key} must retain its canonical family identity`);
  assert.equal(manifest.duration, FAMILY_DURATION_CONTRACTS[key], `${key} must retain its canonical cadence`);
  assert.equal(
    manifest.archetype,
    ARCHETYPES[manifest.family.archetypeKey],
    `${key} must resolve the exact authored archetype rather than a fallback`,
  );
  assert.equal(manifest.contentLane.key, CONTENT_LANE_BY_FAMILY[key], `${key} must resolve its assigned lane`);
  assert.equal(manifest.contentLane.family, key, `${key} lane provenance must be explicit`);
  assert.equal(
    manifest.contentLanePolicy,
    CONTENT_LANE_POLICIES[manifest.contentLane.key],
    `${key} must resolve the policy behind its lane`,
  );
  assert.equal(manifest.contentLanePolicy.family, key, `${key} lane policy must map back to the same family`);
  assert.equal(
    manifest.contentLane.primaryRenderer,
    manifest.contentLanePolicy.primaryRenderer,
    `${key} lane identity and renderer policy must agree`,
  );
}

const ownedLaneKeys = Object.entries(CONTENT_LANE_POLICIES)
  .filter(([, policy]) => policy.family)
  .map(([key]) => key)
  .sort();
assert.deepEqual(
  manifests.map((manifest) => manifest.contentLane.key).sort(),
  ownedLaneKeys,
  "every non-legacy lane must be represented by exactly one canonical family manifest",
);

for (const niche of NICHES) {
  const manifest = resolveChannelFamilyManifest(niche.defaultFamily);
  assert.equal(
    manifest.family.key,
    niche.defaultFamily,
    `creator niche ${niche.key} must default to a real, manifest-backed family`,
  );
}

// Records are mutable at runtime even when their TypeScript type is exhaustive.
// Exercise a representative cross-catalog mismatch to prove catalog tooling
// fails closed before a wrong visual language can reach a pipeline.
const originalLoreLane = CONTENT_LANE_BY_FAMILY.loreshort;
try {
  (CONTENT_LANE_BY_FAMILY as Record<FamilyKey, ContentLaneKey>).loreshort = "quiz_year";
  assert.throws(
    () => assertChannelFamilyManifestIntegrity(),
    /content lane quiz_year is owned by quizyear, not loreshort/,
    "a family-to-lane drift must not be hidden by a compatible-looking lane",
  );
} finally {
  (CONTENT_LANE_BY_FAMILY as Record<FamilyKey, ContentLaneKey>).loreshort = originalLoreLane;
}

assert.doesNotThrow(
  () => assertChannelFamilyManifestIntegrity(),
  "the exhaustive test must restore its temporary catalog mutation",
);

console.log("channel family manifest test passed");
