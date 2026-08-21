import { createHash } from "node:crypto";

import { z } from "zod";

import { referenceQualityContractFingerprint } from "@/engine/creative/referenceQualityAttestation";
import type { ReferenceQualityContract } from "@/engine/creative/types";

import { canonicalJson } from "./canonicalJson";

/**
 * A release certificate must distinguish a channel's selected reference bar
 * from proof that a master met that bar.  v1 deliberately supports only the
 * former: it seals the exact static contract and explicitly records every
 * required proof as unmeasured.  A future trusted receipt adapter can add an
 * attested version without allowing this foundation to manufacture approval.
 */
export const REFERENCE_QUALITY_FINAL_MASTER_BINDING_VERSION =
  "reference-quality-final-master-binding/v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = z.string().regex(SHA256, "expected lowercase SHA-256 fingerprint");
const identifier = z.string().trim().min(1).max(256);
const boundedText = z.string().trim().min(1).max(8_000);

const ReferenceQualitySourceSnapshotSchema = z.object({
  id: identifier,
  label: boundedText,
  url: z.string().url().max(2_000),
  transferableMechanic: boundedText,
  prohibitedImitation: boundedText,
}).strict();

const ReferenceQualityRequirementSnapshotSchema = z.object({
  id: identifier,
  area: z.enum(["story", "pacing", "presentation", "audio"]),
  dimensionIds: z.array(identifier).min(1).max(32),
  standard: boundedText,
  verification: z.enum([
    "reviewer-confirmed",
    "source-trace-plus-review",
    "measured-render-evidence",
  ]),
  evidence: z.array(identifier).min(1).max(32),
  sourceIds: z.array(identifier).min(1).max(32),
}).strict();

/** A full historical copy means a later calibration change cannot rewrite old evidence. */
export const ReferenceQualityContractSnapshotSchema = z.object({
  version: z.literal("1.0.0"),
  family: identifier,
  calibration: z.enum(["calibrated", "partial", "unconfigured"]),
  comparisonPolicy: z.literal("mechanics-only-no-automatic-comparison"),
  sourceDocument: boundedText,
  sources: z.array(ReferenceQualitySourceSnapshotSchema).min(1).max(64),
  requirements: z.array(ReferenceQualityRequirementSnapshotSchema).min(1).max(64),
  unresolvedAreas: z.array(z.enum(["story", "pacing", "presentation", "audio"])).max(4),
}).strict();

const UnmeasuredReferenceQualityEvidenceSchema = z.object({
  requirementId: identifier,
  evidenceId: identifier,
  verification: z.enum([
    "reviewer-confirmed",
    "source-trace-plus-review",
    "measured-render-evidence",
  ]),
  /** No renderer or generic visual review may silently upgrade this state. */
  measurementState: z.literal("unmeasured"),
}).strict();

export const ReferenceQualityFinalMasterBindingSchema = z.object({
  version: z.literal(REFERENCE_QUALITY_FINAL_MASTER_BINDING_VERSION),
  family: identifier,
  contractFingerprint: sha256,
  contract: ReferenceQualityContractSnapshotSchema,
  finalMasterSha256: sha256,
  visualReviewFingerprint: sha256,
  visualReviewReceiptFingerprint: sha256,
  /** v1 is an honest declaration, not a reference-quality approval. */
  assessment: z.literal("unmeasured"),
  evidence: z.array(UnmeasuredReferenceQualityEvidenceSchema).min(1).max(256),
  bindingFingerprint: sha256,
}).strict();

export type ReferenceQualityFinalMasterBinding = z.infer<
  typeof ReferenceQualityFinalMasterBindingSchema
>;

type BindingInput = Omit<ReferenceQualityFinalMasterBinding, "bindingFingerprint">;

function bindingPayload(value: BindingInput): string {
  return canonicalJson(value);
}

export function referenceQualityFinalMasterBindingFingerprint(value: BindingInput): string {
  return createHash("sha256").update(bindingPayload(value)).digest("hex");
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`reference-quality final-master binding repeats ${label}`);
  }
}

/**
 * Validates the complete contract frozen into the run's persisted QualityBar.
 * It intentionally does not compare against today's source catalog: changing
 * a calibration after a run starts must not make that already-reviewed run
 * unresumable. Canonical JSON and the sealed snapshot fingerprint provide the
 * identity; the QualityBar cast itself never grants authority.
 */
function canonicalFrozenCalibratedContract(value: unknown): ReferenceQualityContract {
  const snapshot = ReferenceQualityContractSnapshotSchema.parse(value);
  if (snapshot.calibration !== "calibrated" || snapshot.unresolvedAreas.length > 0) {
    throw new Error(
      "reference-quality final-master binding requires a calibrated contract with no unresolved areas",
    );
  }
  assertUnique(snapshot.sources.map((source) => source.id), "source ids");
  assertUnique(snapshot.requirements.map((requirement) => requirement.id), "requirement ids");
  const knownSourceIds = new Set(snapshot.sources.map((source) => source.id));
  for (const requirement of snapshot.requirements) {
    assertUnique(requirement.dimensionIds, `dimension ids for ${requirement.id}`);
    assertUnique(requirement.evidence, `evidence ids for ${requirement.id}`);
    assertUnique(requirement.sourceIds, `source ids for ${requirement.id}`);
    for (const sourceId of requirement.sourceIds) {
      if (!knownSourceIds.has(sourceId)) {
        throw new Error(
          `reference-quality final-master binding requirement ${requirement.id} references an undeclared source ${sourceId}`,
        );
      }
    }
  }
  return snapshot as ReferenceQualityContract;
}

/**
 * Extracts the frozen channel QualityBar contract before costly production QA.
 * Legacy certificates remain readable, and a resumable run may use the exact
 * calibrated snapshot it was created with. A newly issued certificate still
 * refuses an absent or internally incomplete contract.
 */
export function requireFrozenReferenceQualityContract(
  qualityBar: unknown,
): ReferenceQualityContract {
  const parsed = z.object({ referenceQuality: z.unknown() }).passthrough().safeParse(qualityBar);
  if (!parsed.success || parsed.data.referenceQuality === undefined) {
    throw new Error(
      "production QA requires a stored reference-quality contract; re-run channel calibration before creating a new release certificate",
    );
  }
  return canonicalFrozenCalibratedContract(parsed.data.referenceQuality);
}

function expectedEvidence(contract: ReferenceQualityContract): Array<{
  requirementId: string;
  evidenceId: string;
  verification: "reviewer-confirmed" | "source-trace-plus-review" | "measured-render-evidence";
}> {
  const pairs: Array<{
    requirementId: string;
    evidenceId: string;
    verification: "reviewer-confirmed" | "source-trace-plus-review" | "measured-render-evidence";
  }> = [];
  const seen = new Set<string>();
  for (const requirement of contract.requirements) {
    for (const evidenceId of requirement.evidence) {
      const key = `${requirement.id}\u0000${evidenceId}`;
      if (seen.has(key)) {
        throw new Error(`reference-quality contract repeats required evidence ${evidenceId} for ${requirement.id}`);
      }
      seen.add(key);
      pairs.push({
        requirementId: requirement.id,
        evidenceId,
        verification: requirement.verification,
      });
    }
  }
  return pairs;
}

function evidenceKey(requirementId: string, evidenceId: string): string {
  return `${requirementId}\u0000${evidenceId}`;
}

function assertExpectedEvidence(
  contract: ReferenceQualityContract,
  evidence: readonly ReferenceQualityFinalMasterBinding["evidence"][number][],
): void {
  const expected = expectedEvidence(contract);
  if (evidence.length !== expected.length) {
    throw new Error("reference-quality final-master binding does not enumerate every required evidence item");
  }
  const expectedByKey = new Map(expected.map((item) => [evidenceKey(item.requirementId, item.evidenceId), item]));
  const seen = new Set<string>();
  for (const item of evidence) {
    const key = evidenceKey(item.requirementId, item.evidenceId);
    const requirement = expectedByKey.get(key);
    if (!requirement) {
      throw new Error(`reference-quality final-master binding names unexpected evidence ${item.evidenceId}`);
    }
    if (seen.has(key)) {
      throw new Error(`reference-quality final-master binding repeats evidence ${item.evidenceId}`);
    }
    seen.add(key);
    if (item.verification !== requirement.verification) {
      throw new Error(`reference-quality final-master binding changes verification mode for ${item.evidenceId}`);
    }
    if (item.measurementState !== "unmeasured") {
      throw new Error("reference-quality final-master binding v1 cannot claim measured evidence");
    }
  }
}

export function createUnmeasuredReferenceQualityFinalMasterBinding(args: {
  contract: ReferenceQualityContract;
  finalMasterSha256: string;
  visualReviewFingerprint: string;
  visualReviewReceiptFingerprint: string;
}): ReferenceQualityFinalMasterBinding {
  const contract = canonicalFrozenCalibratedContract(args.contract);
  const unsigned: BindingInput = {
    version: REFERENCE_QUALITY_FINAL_MASTER_BINDING_VERSION,
    family: contract.family,
    contractFingerprint: referenceQualityContractFingerprint(contract),
    contract: ReferenceQualityContractSnapshotSchema.parse(contract),
    finalMasterSha256: args.finalMasterSha256,
    visualReviewFingerprint: args.visualReviewFingerprint,
    visualReviewReceiptFingerprint: args.visualReviewReceiptFingerprint,
    assessment: "unmeasured",
    evidence: expectedEvidence(contract).map((item) => ({
      ...item,
      measurementState: "unmeasured" as const,
    })),
  };
  const binding = ReferenceQualityFinalMasterBindingSchema.parse({
    ...unsigned,
    bindingFingerprint: referenceQualityFinalMasterBindingFingerprint(unsigned),
  });
  return assertReferenceQualityFinalMasterBinding({
    binding,
    finalMasterSha256: args.finalMasterSha256,
    visualReviewFingerprint: args.visualReviewFingerprint,
    visualReviewReceiptFingerprint: args.visualReviewReceiptFingerprint,
  });
}

/** Validates a historical binding against the immutable certificate it accompanies. */
export function assertReferenceQualityFinalMasterBinding(args: {
  binding: unknown;
  finalMasterSha256: string;
  visualReviewFingerprint: string;
  visualReviewReceiptFingerprint: string;
}): ReferenceQualityFinalMasterBinding {
  const binding = ReferenceQualityFinalMasterBindingSchema.parse(args.binding);
  const { bindingFingerprint, ...unsigned } = binding;
  const expectedBindingFingerprint = referenceQualityFinalMasterBindingFingerprint(unsigned);
  if (bindingFingerprint !== expectedBindingFingerprint) {
    throw new Error("reference-quality final-master binding fingerprint does not match its payload");
  }
  if (binding.finalMasterSha256 !== args.finalMasterSha256) {
    throw new Error("reference-quality final-master binding belongs to a different final master");
  }
  if (binding.visualReviewFingerprint !== args.visualReviewFingerprint) {
    throw new Error("reference-quality final-master binding belongs to a different visual review");
  }
  if (binding.visualReviewReceiptFingerprint !== args.visualReviewReceiptFingerprint) {
    throw new Error("reference-quality final-master binding belongs to a different visual-review receipt");
  }
  const contract = ReferenceQualityContractSnapshotSchema.parse(binding.contract) as ReferenceQualityContract;
  if (contract.calibration !== "calibrated" || contract.unresolvedAreas.length > 0) {
    throw new Error("reference-quality final-master binding contains an incomplete calibration");
  }
  if (binding.family !== contract.family) {
    throw new Error("reference-quality final-master binding family does not match its contract snapshot");
  }
  if (binding.contractFingerprint !== referenceQualityContractFingerprint(contract)) {
    throw new Error("reference-quality final-master binding contract fingerprint does not match its snapshot");
  }
  if (binding.assessment !== "unmeasured") {
    throw new Error("reference-quality final-master binding v1 cannot claim an attested assessment");
  }
  assertExpectedEvidence(contract, binding.evidence);
  return binding;
}
