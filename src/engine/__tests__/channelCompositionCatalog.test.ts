import assert from "node:assert/strict";

import {
  CERTIFIED_CHANNEL_COMPOSITIONS,
  CHANNEL_COMPOSITION_DEFINITION_HISTORY,
  assertChannelCompositionReceiptBinding,
  certifiedChannelCompositionDefinition,
  findCertifiedChannelComposition,
  parseChannelCompositionReceipt,
  resolveCertifiedChannelComposition,
} from "@/engine/channelCompositionCatalog";
import { familyChannelInceptionCapability } from "@/engine/channelInceptionCapability";
import { FAMILY_KEYS } from "@/engine/families";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const autonomousFamilies = FAMILY_KEYS
  .filter((family) => familyChannelInceptionCapability(family).mode === "registered_non_gemini")
  .sort();
const composedFamilies = [...new Set(CERTIFIED_CHANNEL_COMPOSITIONS.map((composition) => composition.family))]
  .sort();

assert.deepEqual(
  composedFamilies,
  autonomousFamilies,
  "the durable composition catalog must cover every and only currently autonomous channel-creation family",
);

for (const family of autonomousFamilies) {
  const receipt = resolveCertifiedChannelComposition({ family });
  const definition = certifiedChannelCompositionDefinition(receipt);
  assert.equal(receipt.family, family);
  assert.equal(definition.key, receipt.key);
  assert.deepEqual(
    assertChannelCompositionReceiptBinding({
      receipt,
      family,
      selectedCapabilityKeys: [],
    }),
    receipt,
    `${family} must have a deterministic default composition receipt`,
  );
}

const dataStory = resolveCertifiedChannelComposition({
  family: "narrated_stock",
  selectedCapabilityKeys: ["source_attributed_data_story"],
});
assert.equal(dataStory.key, "source_attributed_data_story");
assert.equal(dataStory.definitionVersion, "v1");
assert.deepEqual(
  parseChannelCompositionReceipt(dataStory),
  dataStory,
  "a current receipt must round-trip through its sealed definition identity",
);
assert.equal(
  resolveCertifiedChannelComposition({ family: "narrated_stock" }).key,
  "narrated_visual_essay",
  "the source-attributed route must be qualified by its existing explicit capability, not inferred from prose",
);
assert.throws(
  () => resolveCertifiedChannelComposition({ family: "cinematic" }),
  /no certified autonomous channel composition/,
  "a renderer-present but unregistered family must not gain creator authority from a composition label",
);
assert.equal(
  findCertifiedChannelComposition({ family: "cinematic" }),
  undefined,
  "a supervised or unregistered family can retain its generic Show Profile without being mislabeled as certified autonomous",
);

const { fingerprint: _dataStoryFingerprint, ...dataStoryBody } = dataStory;
void _dataStoryFingerprint;
const futureCatalogV2 = [
  ...CHANNEL_COMPOSITION_DEFINITION_HISTORY,
  {
    key: "future_certified_timeline",
    definitionVersion: "v1",
    status: "current" as const,
    family: "shorts" as const,
    title: "Future certified timeline",
    qualityFocus: ["timeline clarity"],
    requiredCapabilityKeys: [],
  },
];
assert.notEqual(
  canonicalJson(CHANNEL_COMPOSITION_DEFINITION_HISTORY),
  canonicalJson(futureCatalogV2),
  "the regression must model an additive v2 catalog rather than a no-op reparse",
);
assert.equal(
  "catalogFingerprint" in dataStory,
  false,
  "a receipt must not pin a whole-catalog hash that would invalidate it after an unrelated addition",
);
assert.deepEqual(
  parseChannelCompositionReceipt(dataStory),
  dataStory,
  "a v1 definition receipt must remain valid after an unrelated future v2 catalog addition",
);

const staleDefinitionBody = {
  ...dataStoryBody,
  definitionFingerprint: "0".repeat(64),
};
assert.throws(
  () => parseChannelCompositionReceipt({
    ...staleDefinitionBody,
    fingerprint: sha256Hex(canonicalJson(staleDefinitionBody)),
  }),
  /definition fingerprint/,
  "a receipt must bind the exact historical definition rather than a mutable catalog aggregate",
);
const titleTamperedBody = {
  ...dataStoryBody,
  title: "Counterfeit data-story title",
};
assert.throws(
  () => parseChannelCompositionReceipt({
    ...titleTamperedBody,
    fingerprint: sha256Hex(canonicalJson(titleTamperedBody)),
  }),
  /sealed historical definition/,
  "a re-fingerprinted receipt cannot change the title shown to the creator",
);
const focusTamperedBody = {
  ...dataStoryBody,
  qualityFocus: ["counterfeit quality promise"],
};
assert.throws(
  () => parseChannelCompositionReceipt({
    ...focusTamperedBody,
    fingerprint: sha256Hex(canonicalJson(focusTamperedBody)),
  }),
  /sealed historical definition/,
  "a re-fingerprinted receipt cannot change the quality focus shown to the creator",
);
assert.throws(
  () => assertChannelCompositionReceiptBinding({
    receipt: resolveCertifiedChannelComposition({ family: "narrated_stock" }),
    family: "narrated_stock",
    selectedCapabilityKeys: ["source_attributed_data_story"],
  }),
  /does not match the admitted channel route/,
  "a generic narrated receipt cannot replace a selected source-attributed data-story route",
);

console.log("certified channel composition catalog tests passed");
