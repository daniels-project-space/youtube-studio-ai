import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  assertReferenceQualityAttestation,
  assessReferenceQualityAttestation,
  referenceQualityContractFingerprint,
  type ReferenceQualityAttestation,
} from "@/engine/creative/referenceQualityAttestation";
import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import type { ReferenceQualityContract } from "@/engine/creative/types";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const contract = referenceQualityContractFor("illustrated_explainer");

function passingAttestation(input: ReferenceQualityContract = contract): ReferenceQualityAttestation {
  return {
    version: "1.0.0",
    family: input.family,
    contractFingerprint: referenceQualityContractFingerprint(input),
    finalMasterFingerprint: sha256("final-master"),
    reviewFingerprint: sha256("final-review"),
    evidence: input.requirements.flatMap((requirement) => requirement.evidence.map((evidenceId) => ({
      requirementId: requirement.id,
      evidenceId,
      verification: requirement.verification,
      measurementState: "measured" as const,
      verdict: "pass" as const,
      evidenceFingerprint: sha256(`${requirement.id}:${evidenceId}`),
    }))),
  };
}

const accepted = assessReferenceQualityAttestation(contract, passingAttestation());
assert.equal(accepted.accepted, true);
assert.deepEqual(accepted.issues, []);
assert.doesNotThrow(() => assertReferenceQualityAttestation(contract, passingAttestation()));

const cloned = referenceQualityContractFor("illustrated_explainer");
assert.equal(
  referenceQualityContractFingerprint(contract),
  referenceQualityContractFingerprint(cloned),
  "contract fingerprint must be stable across equivalent cloned contracts",
);
cloned.requirements[0]!.standard = "changed standard";
assert.notEqual(
  referenceQualityContractFingerprint(contract),
  referenceQualityContractFingerprint(cloned),
  "contract fingerprint must bind the full contract content",
);

const missing = passingAttestation();
const missingEvidence = missing.evidence[0]!;
missing.evidence = missing.evidence.slice(1);
const missingReport = assessReferenceQualityAttestation(contract, missing);
assert.equal(missingReport.accepted, false);
assert.ok(missingReport.issues.some((item) =>
  item.code === "evidence_missing"
  && item.requirementId === missingEvidence.requirementId
  && item.evidenceId === missingEvidence.evidenceId,
));

const notMeasured = passingAttestation();
notMeasured.evidence = notMeasured.evidence.map((item, index) =>
  index === 0 ? { ...item, measurementState: "not_measured" } : item,
);
assert.ok(assessReferenceQualityAttestation(contract, notMeasured).issues.some((item) => item.code === "evidence_not_measured"));

const failed = passingAttestation();
failed.evidence = failed.evidence.map((item, index) =>
  index === 0 ? { ...item, verdict: "fail" } : item,
);
assert.ok(assessReferenceQualityAttestation(contract, failed).issues.some((item) => item.code === "evidence_failed"));

const wrongMode = passingAttestation();
wrongMode.evidence = wrongMode.evidence.map((item, index) =>
  index === 0
    ? {
      ...item,
      verification: item.verification === "reviewer-confirmed"
        ? "measured-render-evidence"
        : "reviewer-confirmed",
    }
    : item,
);
assert.ok(assessReferenceQualityAttestation(contract, wrongMode).issues.some((item) => item.code === "evidence_verification_mismatch"));

const wrongEvidence = passingAttestation();
wrongEvidence.evidence = wrongEvidence.evidence.map((item, index) =>
  index === 0 ? { ...item, evidenceId: "wrong-evidence" } : item,
);
assert.ok(assessReferenceQualityAttestation(contract, wrongEvidence).issues.some((item) => item.code === "evidence_identifier_mismatch"));

const duplicate = passingAttestation();
duplicate.evidence = [...duplicate.evidence, duplicate.evidence[0]!];
assert.ok(assessReferenceQualityAttestation(contract, duplicate).issues.some((item) => item.code === "evidence_duplicate"));

const fingerprintMismatch = passingAttestation();
fingerprintMismatch.contractFingerprint = sha256("different contract");
assert.ok(assessReferenceQualityAttestation(contract, fingerprintMismatch).issues.some((item) => item.code === "contract_fingerprint_mismatch"));

const malformedOptionalBindings = passingAttestation();
malformedOptionalBindings.finalMasterFingerprint = "not-a-fingerprint";
malformedOptionalBindings.reviewFingerprint = "also-not-a-fingerprint";
malformedOptionalBindings.evidence = malformedOptionalBindings.evidence.map((item, index) =>
  index === 0 ? { ...item, evidenceFingerprint: "not-a-fingerprint" } : item,
);
const malformedReport = assessReferenceQualityAttestation(contract, malformedOptionalBindings);
assert.ok(malformedReport.issues.some((item) => item.code === "final_master_fingerprint_invalid"));
assert.ok(malformedReport.issues.some((item) => item.code === "review_fingerprint_invalid"));
assert.ok(malformedReport.issues.some((item) => item.code === "evidence_fingerprint_invalid"));

const wrongFamily = passingAttestation();
wrongFamily.family = "whiteboard";
assert.ok(assessReferenceQualityAttestation(contract, wrongFamily).issues.some((item) => item.code === "attestation_family_mismatch"));

const incompleteContract: ReferenceQualityContract = {
  ...contract,
  calibration: "partial",
  unresolvedAreas: ["audio"],
};
const incompleteReport = assessReferenceQualityAttestation(incompleteContract, passingAttestation(incompleteContract));
assert.ok(incompleteReport.issues.some((item) => item.code === "contract_not_calibrated"));

assert.throws(
  () => assertReferenceQualityAttestation(contract, notMeasured),
  /evidence_not_measured/,
);

console.log("reference-quality attestation contract passed");
