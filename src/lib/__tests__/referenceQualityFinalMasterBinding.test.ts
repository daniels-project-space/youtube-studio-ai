import assert from "node:assert/strict";

import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import { referenceQualityContractFingerprint } from "@/engine/creative/referenceQualityAttestation";
import {
  assertReferenceQualityFinalMasterBinding,
  createUnmeasuredReferenceQualityFinalMasterBinding,
  referenceQualityFinalMasterBindingFingerprint,
  requireFrozenReferenceQualityContract,
} from "@/lib/referenceQualityFinalMasterBinding";

const contract = referenceQualityContractFor("illustrated_explainer");
const masterSha256 = "a".repeat(64);
const reviewFingerprint = "b".repeat(64);
const reviewReceiptFingerprint = "c".repeat(64);

const binding = createUnmeasuredReferenceQualityFinalMasterBinding({
  contract,
  finalMasterSha256: masterSha256,
  visualReviewFingerprint: reviewFingerprint,
  visualReviewReceiptFingerprint: reviewReceiptFingerprint,
});

assert.equal(binding.family, "illustrated_explainer");
assert.equal(binding.assessment, "unmeasured");
assert.equal(
  binding.evidence.length,
  contract.requirements.reduce((count, requirement) => count + requirement.evidence.length, 0),
  "the sealed binding must retain every static evidence requirement, not just visible review criteria",
);
assert.ok(
  binding.evidence.every((item) => item.measurementState === "unmeasured"),
  "v1 must preserve the absence of a source-specific measurement rather than manufacture a pass",
);
assert.deepEqual(
  assertReferenceQualityFinalMasterBinding({
    binding,
    finalMasterSha256: masterSha256,
    visualReviewFingerprint: reviewFingerprint,
    visualReviewReceiptFingerprint: reviewReceiptFingerprint,
  }),
  binding,
);

assert.doesNotThrow(
  () => requireFrozenReferenceQualityContract({ referenceQuality: contract }),
  "a calibrated frozen channel QualityBar contract should be admissible before production QA",
);
assert.throws(
  () => requireFrozenReferenceQualityContract({}),
  /requires a stored reference-quality contract/,
  "new production certificates must fail closed when a legacy channel lacks a calibrated contract",
);
const frozenPreCatalogRevision = {
  ...contract,
  requirements: [
    { ...contract.requirements[0]!, standard: "Frozen prior calibration wording that remains internally complete." },
    ...contract.requirements.slice(1),
  ],
};
const resumedFrozenContract = requireFrozenReferenceQualityContract({
  referenceQuality: frozenPreCatalogRevision,
});
assert.equal(
  resumedFrozenContract.requirements[0]?.standard,
  "Frozen prior calibration wording that remains internally complete.",
  "a valid frozen calibration must remain resumable even after today's source catalog changes",
);
const resumedFrozenBinding = createUnmeasuredReferenceQualityFinalMasterBinding({
  contract: resumedFrozenContract,
  finalMasterSha256: masterSha256,
  visualReviewFingerprint: reviewFingerprint,
  visualReviewReceiptFingerprint: reviewReceiptFingerprint,
});
assert.equal(
  resumedFrozenBinding.contractFingerprint,
  referenceQualityContractFingerprint(resumedFrozenContract),
  "a resumed run must seal the canonical fingerprint of its own frozen calibrated snapshot",
);
assert.doesNotThrow(
  () => assertReferenceQualityFinalMasterBinding({
    binding: resumedFrozenBinding,
    finalMasterSha256: masterSha256,
    visualReviewFingerprint: reviewFingerprint,
    visualReviewReceiptFingerprint: reviewReceiptFingerprint,
  }),
  "a resumed frozen run should seal its own canonical snapshot rather than requiring today's catalog fingerprint",
);
assert.throws(
  () => requireFrozenReferenceQualityContract({
    referenceQuality: {
      ...contract,
      requirements: [{ ...contract.requirements[0]!, sourceIds: ["not-a-declared-source"] }, ...contract.requirements.slice(1)],
    },
  }),
  /references an undeclared source/,
  "the QualityBar cast is not authority: malformed frozen source provenance must still fail closed",
);
assert.throws(
  () => requireFrozenReferenceQualityContract({
    referenceQuality: {
      ...contract,
      calibration: "partial",
      unresolvedAreas: ["audio"],
    },
  }),
  /requires a calibrated contract/,
  "a partial reference rubric cannot be sealed as a production release baseline",
);
assert.throws(
  () => assertReferenceQualityFinalMasterBinding({
    binding,
    finalMasterSha256: "d".repeat(64),
    visualReviewFingerprint: reviewFingerprint,
    visualReviewReceiptFingerprint: reviewReceiptFingerprint,
  }),
  /different final master/,
  "the reference contract must be bound to exact final-master bytes",
);

const { bindingFingerprint: _fingerprint, ...unsigned } = binding;
void _fingerprint;
const incompleteUnsigned = {
  ...unsigned,
  evidence: unsigned.evidence.slice(1),
};
const incomplete = {
  ...incompleteUnsigned,
  bindingFingerprint: referenceQualityFinalMasterBindingFingerprint(incompleteUnsigned),
};
assert.throws(
  () => assertReferenceQualityFinalMasterBinding({
    binding: incomplete,
    finalMasterSha256: masterSha256,
    visualReviewFingerprint: reviewFingerprint,
    visualReviewReceiptFingerprint: reviewReceiptFingerprint,
  }),
  /does not enumerate every required evidence item/,
  "a certificate cannot quietly omit requirements that the static contract selected",
);

console.log("reference-quality final-master binding tests passed");
