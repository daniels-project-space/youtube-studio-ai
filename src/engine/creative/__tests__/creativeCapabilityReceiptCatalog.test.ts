import assert from "node:assert/strict";

import {
  CREATIVE_CAPABILITY_CATALOG,
  CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
} from "@/engine/creative/creativeCapabilityCatalog";
import {
  CREATIVE_CAPABILITY_RECEIPT_CATALOG,
  CREATIVE_CAPABILITY_RECEIPT_CATALOG_FINGERPRINT,
  assertCreativeCapabilityReceiptSelection,
} from "@/engine/creative/creativeCapabilityReceiptCatalog";

assert.equal(
  CREATIVE_CAPABILITY_RECEIPT_CATALOG_FINGERPRINT,
  CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
  "the Convex-safe receipt spine must pin the rich creator catalog's current fingerprint",
);

const richProjection = CREATIVE_CAPABILITY_CATALOG.map((definition) => {
  const offer = definition.materialize(
    { concept: "Source-attributed data storytelling with animated charts and ranked comparisons" },
    definition.supportedFamilies[0]!,
  );
  return {
    capability: definition.capability,
    supportedFamilies: definition.supportedFamilies,
    selectionMode: definition.selectionMode,
    compositionFragmentVersion: definition.compositionFragmentVersion,
    pipelineObligations: offer.pipelineObligations,
  };
});

const receiptProjection = CREATIVE_CAPABILITY_RECEIPT_CATALOG.map((definition) => ({
  capability: definition.capability,
  supportedFamilies: definition.supportedFamilies,
  selectionMode: definition.selectionMode,
  compositionFragmentVersion:
    "compositionFragmentVersion" in definition ? definition.compositionFragmentVersion : undefined,
  pipelineObligations: definition.pipelineObligations,
}));

assert.deepEqual(
  receiptProjection,
  richProjection,
  "the Convex-safe receipt spine must preserve every catalog key, family, selection mode, fragment version, and pipeline obligation",
);

assert.doesNotThrow(() =>
  assertCreativeCapabilityReceiptSelection({
    capability: "source_attributed_data_story",
    family: "narrated_stock",
    intent: { concept: "Source-attributed data storytelling with animated charts" },
  }),
);
assert.throws(
  () =>
    assertCreativeCapabilityReceiptSelection({
      capability: "source_attributed_data_story",
      family: "narrated_stock",
      intent: { concept: "A generic narrated business channel" },
    }),
  /not eligible for the stated channel concept/,
);
assert.throws(
  () =>
    assertCreativeCapabilityReceiptSelection({
      capability: "casefile_cinematic",
      family: "cinematic",
      intent: { concept: "A source-led case study" },
    }),
  /private review only/,
  "the receipt spine must not turn a supervised catalog offer into an executable selection",
);

console.log("creative capability receipt catalog parity tests passed");
