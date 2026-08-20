import { createHash } from "node:crypto";

import type {
  ReferenceQualityContract,
  ReferenceQualityVerification,
} from "./types";

/**
 * A portable, provider-free receipt that proves a particular reference-quality
 * contract was assessed. It intentionally records proof of our own standards;
 * it never represents a comparison with a reference creator or their work.
 */
export const REFERENCE_QUALITY_ATTESTATION_VERSION = "1.0.0" as const;

export type ReferenceQualityEvidenceMeasurementState = "measured" | "not_measured";
export type ReferenceQualityEvidenceVerdict = "pass" | "fail";

/** One exact proof obligation from one contract requirement. */
export interface ReferenceQualityEvidenceAttestation {
  requirementId: string;
  evidenceId: string;
  /** Must exactly match the referenced requirement's honest verification mode. */
  verification: ReferenceQualityVerification;
  /** `measured` means the declared review/trace/render check was actually recorded. */
  measurementState: ReferenceQualityEvidenceMeasurementState;
  verdict: ReferenceQualityEvidenceVerdict;
  /** SHA-256 of the immutable review, source-trace, or render-evidence receipt. */
  evidenceFingerprint: string;
}

/**
 * Family- and contract-bound quality receipt. Final-master and review bindings
 * are intentionally optional so the same contract can attest pre-render work;
 * when supplied, both must be immutable SHA-256 fingerprints.
 */
export interface ReferenceQualityAttestation {
  version: typeof REFERENCE_QUALITY_ATTESTATION_VERSION;
  family: ReferenceQualityContract["family"];
  contractFingerprint: string;
  finalMasterFingerprint?: string;
  reviewFingerprint?: string;
  evidence: readonly ReferenceQualityEvidenceAttestation[];
}

export type ReferenceQualityAttestationIssueCode =
  | "attestation_shape_invalid"
  | "attestation_version_invalid"
  | "attestation_family_mismatch"
  | "contract_not_calibrated"
  | "contract_fingerprint_mismatch"
  | "final_master_fingerprint_invalid"
  | "review_fingerprint_invalid"
  | "evidence_shape_invalid"
  | "evidence_requirement_unknown"
  | "evidence_identifier_mismatch"
  | "evidence_verification_mismatch"
  | "evidence_fingerprint_invalid"
  | "evidence_duplicate"
  | "evidence_missing"
  | "evidence_not_measured"
  | "evidence_failed";

export interface ReferenceQualityAttestationIssue {
  code: ReferenceQualityAttestationIssueCode;
  message: string;
  requirementId?: string;
  evidenceId?: string;
}

export interface ReferenceQualityAttestationReport {
  accepted: boolean;
  /** Recomputed from the supplied contract; callers must never trust the payload value alone. */
  expectedContractFingerprint: string;
  issues: ReferenceQualityAttestationIssue[];
}

const SHA256_FINGERPRINT = /^[a-f0-9]{64}$/;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "undefined" : serialized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSha256Fingerprint(value: unknown): value is string {
  return typeof value === "string" && SHA256_FINGERPRINT.test(value);
}

function issue(
  code: ReferenceQualityAttestationIssueCode,
  message: string,
  requirementId?: string,
  evidenceId?: string,
): ReferenceQualityAttestationIssue {
  return { code, message, ...(requirementId ? { requirementId } : {}), ...(evidenceId ? { evidenceId } : {}) };
}

function evidencePairKey(requirementId: string, evidenceId: string): string {
  return `${requirementId}\u0000${evidenceId}`;
}

/**
 * Stable content fingerprint for a static reference-quality contract. This is
 * an integrity binding, not an approval signature or authorization mechanism.
 */
export function referenceQualityContractFingerprint(contract: ReferenceQualityContract): string {
  return createHash("sha256").update(canonicalJson(contract)).digest("hex");
}

/**
 * Validates a quality receipt against the exact family contract without
 * contacting a provider, loading media, or inventing an automatic comparison.
 */
export function assessReferenceQualityAttestation(
  contract: ReferenceQualityContract,
  candidate: unknown,
): ReferenceQualityAttestationReport {
  const expectedContractFingerprint = referenceQualityContractFingerprint(contract);
  const issues: ReferenceQualityAttestationIssue[] = [];

  if (contract.calibration !== "calibrated" || contract.unresolvedAreas.length > 0) {
    issues.push(issue(
      "contract_not_calibrated",
      "A complete reference-quality attestation requires a calibrated contract with no unresolved areas.",
    ));
  }

  if (!isRecord(candidate)) {
    issues.push(issue(
      "attestation_shape_invalid",
      "Reference-quality attestation must be an object.",
    ));
    return { accepted: false, expectedContractFingerprint, issues };
  }

  if (candidate.version !== REFERENCE_QUALITY_ATTESTATION_VERSION) {
    issues.push(issue(
      "attestation_version_invalid",
      `Reference-quality attestation version must be ${REFERENCE_QUALITY_ATTESTATION_VERSION}.`,
    ));
  }
  if (candidate.family !== contract.family) {
    issues.push(issue(
      "attestation_family_mismatch",
      `Reference-quality attestation family must equal ${contract.family}.`,
    ));
  }
  if (candidate.contractFingerprint !== expectedContractFingerprint) {
    issues.push(issue(
      "contract_fingerprint_mismatch",
      "Reference-quality attestation was not issued for this exact contract fingerprint.",
    ));
  }
  if (candidate.finalMasterFingerprint !== undefined && !isSha256Fingerprint(candidate.finalMasterFingerprint)) {
    issues.push(issue(
      "final_master_fingerprint_invalid",
      "finalMasterFingerprint must be an optional lowercase SHA-256 fingerprint.",
    ));
  }
  if (candidate.reviewFingerprint !== undefined && !isSha256Fingerprint(candidate.reviewFingerprint)) {
    issues.push(issue(
      "review_fingerprint_invalid",
      "reviewFingerprint must be an optional lowercase SHA-256 fingerprint.",
    ));
  }

  const requirementsById = new Map(contract.requirements.map((requirement) => [requirement.id, requirement]));
  const expectedEvidence = new Map<string, ReferenceQualityVerification>();
  for (const requirement of contract.requirements) {
    for (const evidenceId of requirement.evidence) {
      expectedEvidence.set(evidencePairKey(requirement.id, evidenceId), requirement.verification);
    }
  }

  if (!Array.isArray(candidate.evidence)) {
    issues.push(issue(
      "evidence_shape_invalid",
      "Reference-quality attestation evidence must be an array.",
    ));
  }

  const providedEvidence = new Set<string>();
  const seenEvidence = new Set<string>();
  for (const rawEvidence of Array.isArray(candidate.evidence) ? candidate.evidence : []) {
    if (!isRecord(rawEvidence)) {
      issues.push(issue(
        "evidence_shape_invalid",
        "Each reference-quality evidence entry must be an object.",
      ));
      continue;
    }
    const requirementId = rawEvidence.requirementId;
    const evidenceId = rawEvidence.evidenceId;
    if (typeof requirementId !== "string" || typeof evidenceId !== "string") {
      issues.push(issue(
        "evidence_shape_invalid",
        "Each reference-quality evidence entry needs requirementId and evidenceId.",
      ));
      continue;
    }
    const requirement = requirementsById.get(requirementId);
    if (!requirement) {
      issues.push(issue(
        "evidence_requirement_unknown",
        `Evidence names an unknown contract requirement: ${requirementId}.`,
        requirementId,
        evidenceId,
      ));
      continue;
    }
    const key = evidencePairKey(requirementId, evidenceId);
    if (!expectedEvidence.has(key)) {
      issues.push(issue(
        "evidence_identifier_mismatch",
        `Evidence ${evidenceId} is not required by ${requirementId}.`,
        requirementId,
        evidenceId,
      ));
      continue;
    }
    providedEvidence.add(key);
    if (seenEvidence.has(key)) {
      issues.push(issue(
        "evidence_duplicate",
        `Evidence ${evidenceId} was supplied more than once for ${requirementId}.`,
        requirementId,
        evidenceId,
      ));
      continue;
    }
    seenEvidence.add(key);

    if (rawEvidence.verification !== requirement.verification) {
      issues.push(issue(
        "evidence_verification_mismatch",
        `Evidence ${evidenceId} for ${requirementId} must use ${requirement.verification}.`,
        requirementId,
        evidenceId,
      ));
    }
    if (rawEvidence.measurementState !== "measured") {
      issues.push(issue(
        "evidence_not_measured",
        `Evidence ${evidenceId} for ${requirementId} was not measured or reviewed.`,
        requirementId,
        evidenceId,
      ));
    }
    if (rawEvidence.verdict !== "pass") {
      issues.push(issue(
        "evidence_failed",
        `Evidence ${evidenceId} for ${requirementId} did not pass.`,
        requirementId,
        evidenceId,
      ));
    }
    if (!isSha256Fingerprint(rawEvidence.evidenceFingerprint)) {
      issues.push(issue(
        "evidence_fingerprint_invalid",
        `Evidence ${evidenceId} for ${requirementId} needs a lowercase SHA-256 receipt fingerprint.`,
        requirementId,
        evidenceId,
      ));
    }
  }

  for (const [key] of expectedEvidence) {
    if (providedEvidence.has(key)) continue;
    const [requirementId, evidenceId] = key.split("\u0000");
    issues.push(issue(
      "evidence_missing",
      `Missing required evidence ${evidenceId} for ${requirementId}.`,
      requirementId,
      evidenceId,
    ));
  }

  return {
    accepted: issues.length === 0,
    expectedContractFingerprint,
    issues,
  };
}

/** Throws a concise admission error when any immutable quality proof is absent or invalid. */
export function assertReferenceQualityAttestation(
  contract: ReferenceQualityContract,
  candidate: unknown,
): void {
  const report = assessReferenceQualityAttestation(contract, candidate);
  if (report.accepted) return;
  throw new Error(`Reference-quality attestation rejected: ${report.issues.map((item) => item.code).join(", ")}`);
}
