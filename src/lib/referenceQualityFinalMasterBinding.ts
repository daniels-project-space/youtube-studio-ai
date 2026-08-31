import { createHash } from "node:crypto";

import { z } from "zod";

import { referenceQualityContractFingerprint } from "@/engine/creative/referenceQualityAttestation";
import type { ReferenceQualityContract } from "@/engine/creative/types";
import { QualityAxisEvidenceSchema, type QualityAxisEvidence } from "@/engine/qualityEvidence";

import { canonicalJson } from "./canonicalJson";
import {
  assertFinalMasterNarrationSemanticEvidence,
  type FinalMasterNarrationSemanticEvidence,
} from "./narrationTranscriptProof";

/**
 * A release certificate must distinguish a channel's selected reference bar
 * from proof that a master met that bar.  v1 deliberately supports only the
 * former: it seals the exact static contract and explicitly records every
 * required proof as unmeasured.  A future trusted receipt adapter can add an
 * attested version without allowing this foundation to manufacture approval.
 */
export const REFERENCE_QUALITY_FINAL_MASTER_BINDING_VERSION =
  "reference-quality-final-master-binding/v1" as const;
/**
 * A deliberately narrow successor to v1. It does not turn the generic QA
 * report into a reference-quality score: it can attest exactly two narrated
 * audio requirements, and only from final-master-bound receipts.
 */
export const REFERENCE_QUALITY_EVIDENCE_BRIDGE_V2_VERSION =
  "reference-quality-evidence-bridge/v2" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = z.string().regex(SHA256, "expected lowercase SHA-256 fingerprint");
const identifier = z.string().trim().min(1).max(256);
const boundedText = z.string().trim().min(1).max(8_000);
const finite = z.number().finite();

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

const MeasuredNarratedFinalMasterAudioEvidenceSchema = z.object({
  requirementId: identifier,
  evidenceId: identifier,
  /** The allowlist below intentionally permits no other verification mode. */
  verification: z.literal("measured-render-evidence"),
  measurementState: z.literal("measured"),
  verdict: z.literal("pass"),
  proofKind: z.literal("narrated-final-master-audio/v1"),
  narrationSemanticFingerprint: sha256,
  audioAxisFingerprint: sha256,
}).strict();

const ReferenceQualityEvidenceBridgeV2EvidenceSchema = z.discriminatedUnion("measurementState", [
  UnmeasuredReferenceQualityEvidenceSchema,
  MeasuredNarratedFinalMasterAudioEvidenceSchema,
]);

const ReferenceQualityEvidenceBridgeV2FinalMasterSchema = z.object({
  sha256,
  durationSec: finite.positive(),
}).strict();

/**
 * This is a compact projection of the immutable visual-review release receipt.
 * The full receipt remains separately content-addressed in R2; the bridge
 * keeps the exact fields that join it to the frozen contract and final master.
 */
export const ReferenceQualityVisualReleaseWitnessSchema = z.object({
  reviewFingerprint: sha256,
  reviewReceiptVersion: z.string().trim().min(1).max(128),
  reviewReceiptFingerprint: sha256,
  releaseReceiptFingerprint: sha256,
  verdict: z.literal("pass"),
  source: ReferenceQualityEvidenceBridgeV2FinalMasterSchema,
}).strict();

export type ReferenceQualityVisualReleaseWitness = z.infer<
  typeof ReferenceQualityVisualReleaseWitnessSchema
>;

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

/**
 * V2 is not a generic evidence registry. The fixed recipe is intentionally
 * small so a future receipt cannot be treated as equivalent without a new
 * reviewed schema and explicit allowlist entry.
 */
export const ReferenceQualityEvidenceBridgeV2Schema = z.object({
  version: z.literal(REFERENCE_QUALITY_EVIDENCE_BRIDGE_V2_VERSION),
  family: identifier,
  contractFingerprint: sha256,
  contract: ReferenceQualityContractSnapshotSchema,
  finalMaster: ReferenceQualityEvidenceBridgeV2FinalMasterSchema,
  visualRelease: ReferenceQualityVisualReleaseWitnessSchema,
  assessment: z.literal("partially_measured"),
  evidence: z.array(ReferenceQualityEvidenceBridgeV2EvidenceSchema).min(1).max(256),
  bridgeFingerprint: sha256,
}).strict();

/** Parses either historical v1 provenance or the tightly-scoped v2 bridge. */
export const ReferenceQualityFinalMasterBindingAnySchema = z.union([
  ReferenceQualityFinalMasterBindingSchema,
  ReferenceQualityEvidenceBridgeV2Schema,
]);

export type ReferenceQualityFinalMasterBindingV1 = z.infer<
  typeof ReferenceQualityFinalMasterBindingSchema
>;
export type ReferenceQualityEvidenceBridgeV2 = z.infer<
  typeof ReferenceQualityEvidenceBridgeV2Schema
>;
export type ReferenceQualityFinalMasterBinding =
  | ReferenceQualityFinalMasterBindingV1
  | ReferenceQualityEvidenceBridgeV2;

type BindingInput = Omit<ReferenceQualityFinalMasterBindingV1, "bindingFingerprint">;
type EvidenceBridgeV2Input = Omit<ReferenceQualityEvidenceBridgeV2, "bridgeFingerprint">;

function bindingPayload(value: BindingInput): string {
  return canonicalJson(value);
}

export function referenceQualityFinalMasterBindingFingerprint(value: BindingInput): string {
  return createHash("sha256").update(bindingPayload(value)).digest("hex");
}

export function referenceQualityEvidenceBridgeV2Fingerprint(value: EvidenceBridgeV2Input): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Canonical identity of the exact evaluated audio-axis receipt. */
export function referenceQualityAudioAxisFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(QualityAxisEvidenceSchema.parse(value)))
    .digest("hex");
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
  evidence: readonly ReferenceQualityFinalMasterBindingV1["evidence"][number][],
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

/**
 * Exact family/contract pairs that can reuse the narrated final-master recipe.
 * This is deliberately not a generic audio-QA switch: every listed family must
 * require narration in its frozen contract and supply the semantic narration
 * receipt plus a passing scored audio axis for the same master.
 */
const V2_MEASURED_AUDIO_ALLOWLIST = {
  narrated_stock: {
    requirementId: "measured-documentary-narration",
    evidenceId: "audio-intelligibility-or-continuity-evidence",
  },
  shorts: {
    requirementId: "intelligible-short-narration",
    evidenceId: "audio-intelligibility-or-continuity-evidence",
  },
  illustrated_explainer: {
    requirementId: "comprehensible-narration",
    evidenceId: "audio-intelligibility-or-continuity-evidence",
  },
} as const;

type V2MeasuredAudioFamily = keyof typeof V2_MEASURED_AUDIO_ALLOWLIST;

function v2MeasuredAudioAllowance(family: string) {
  return Object.prototype.hasOwnProperty.call(V2_MEASURED_AUDIO_ALLOWLIST, family)
    ? V2_MEASURED_AUDIO_ALLOWLIST[family as V2MeasuredAudioFamily]
    : undefined;
}

/** Whether this frozen family has the one narrow V2 receipt recipe. */
export function isReferenceQualityEvidenceBridgeV2Family(family: string): boolean {
  return v2MeasuredAudioAllowance(family) !== undefined;
}

function assertPassingCanonicalAudioAxis(value: unknown): QualityAxisEvidence {
  const axis = QualityAxisEvidenceSchema.parse(value);
  // A bare boolean pass is not enough for a measured render claim. The V2
  // recipe requires the actual evaluated score and its acceptance threshold.
  if (
    axis.status !== "pass" ||
    axis.score === undefined ||
    axis.minimumScore === undefined ||
    axis.score < axis.minimumScore
  ) {
    throw new Error(
      "reference-quality evidence bridge v2 requires a passing scored audio-axis receipt at or above its threshold",
    );
  }
  return axis;
}

function assertNarrationSemanticMasterBinding(args: {
  evidence: unknown;
  finalMaster: ReferenceQualityEvidenceBridgeV2["finalMaster"];
}): FinalMasterNarrationSemanticEvidence {
  const evidence = assertFinalMasterNarrationSemanticEvidence(args.evidence);
  if (
    evidence.finalMaster.sha256 !== args.finalMaster.sha256 ||
    evidence.finalMaster.durationSec !== args.finalMaster.durationSec
  ) {
    throw new Error(
      "reference-quality evidence bridge v2 narration semantic receipt belongs to a different final master",
    );
  }
  return evidence;
}

function assertV2EvidenceCoverage(args: {
  bridge: ReferenceQualityEvidenceBridgeV2;
  contract: ReferenceQualityContract;
  narrationSemanticFingerprint: string;
  audioAxisFingerprint: string;
}): void {
  const expected = expectedEvidence(args.contract);
  const allowed = v2MeasuredAudioAllowance(args.bridge.family);
  if (!allowed) {
    throw new Error(
      `reference-quality evidence bridge v2 does not permit measured evidence for family ${args.bridge.family}`,
    );
  }
  const allowedKey = evidenceKey(allowed.requirementId, allowed.evidenceId);
  const expectedByKey = new Map(expected.map((item) => [
    evidenceKey(item.requirementId, item.evidenceId),
    item,
  ]));
  const allowedExpected = expectedByKey.get(allowedKey);
  if (!allowedExpected || allowedExpected.verification !== "measured-render-evidence") {
    throw new Error(
      "reference-quality evidence bridge v2 frozen contract is missing its exact allowlisted measured audio pair",
    );
  }
  if (args.bridge.evidence.length !== expected.length) {
    throw new Error("reference-quality evidence bridge v2 does not enumerate every required evidence item");
  }

  const seen = new Set<string>();
  let measuredCount = 0;
  for (const item of args.bridge.evidence) {
    const key = evidenceKey(item.requirementId, item.evidenceId);
    const required = expectedByKey.get(key);
    if (!required) {
      throw new Error(`reference-quality evidence bridge v2 names unexpected evidence ${item.evidenceId}`);
    }
    if (seen.has(key)) {
      throw new Error(`reference-quality evidence bridge v2 repeats evidence ${item.evidenceId}`);
    }
    seen.add(key);
    if (item.verification !== required.verification) {
      throw new Error(`reference-quality evidence bridge v2 changes verification mode for ${item.evidenceId}`);
    }

    if (item.measurementState === "unmeasured") {
      if (key === allowedKey) {
        throw new Error("reference-quality evidence bridge v2 omitted its allowlisted measured audio evidence");
      }
      continue;
    }

    if (key !== allowedKey) {
      throw new Error(`reference-quality evidence bridge v2 measured an unallowlisted evidence pair ${item.evidenceId}`);
    }
    if (
      item.verification !== "measured-render-evidence" ||
      item.verdict !== "pass" ||
      item.proofKind !== "narrated-final-master-audio/v1"
    ) {
      throw new Error("reference-quality evidence bridge v2 measured audio evidence has an unsupported proof recipe");
    }
    if (item.narrationSemanticFingerprint !== args.narrationSemanticFingerprint) {
      throw new Error("reference-quality evidence bridge v2 narration semantic fingerprint does not match its receipt");
    }
    if (item.audioAxisFingerprint !== args.audioAxisFingerprint) {
      throw new Error("reference-quality evidence bridge v2 audio-axis fingerprint does not match its receipt");
    }
    measuredCount += 1;
  }

  if (seen.size !== expectedByKey.size || measuredCount !== 1) {
    throw new Error("reference-quality evidence bridge v2 must contain exactly its one allowlisted measured audio pair");
  }
}

export interface ReferenceQualityEvidenceBridgeV2AssertionContext {
  finalMasterSha256: string;
  finalMasterDurationSec: number;
  visualReviewFingerprint: string;
  visualReviewReceiptVersion: string;
  visualReviewReceiptFingerprint: string;
  visualReviewReleaseReceiptFingerprint: string;
  finalMasterNarration: unknown;
  audioAxis: unknown;
  /** Supplying the durable raw receipt also verifies its master/review projection. */
  visualRelease?: unknown;
}

/**
 * Validates a persisted V2 bridge without any downgrade path. The caller must
 * supply the sibling certificate receipts: an isolated bridge is never proof.
 */
export function assertReferenceQualityEvidenceBridgeV2(args: {
  bridge: unknown;
} & ReferenceQualityEvidenceBridgeV2AssertionContext): ReferenceQualityEvidenceBridgeV2 {
  const bridge = ReferenceQualityEvidenceBridgeV2Schema.parse(args.bridge);
  const { bridgeFingerprint, ...unsigned } = bridge;
  if (bridgeFingerprint !== referenceQualityEvidenceBridgeV2Fingerprint(unsigned)) {
    throw new Error("reference-quality evidence bridge v2 fingerprint does not match its payload");
  }

  const contextMaster = ReferenceQualityEvidenceBridgeV2FinalMasterSchema.parse({
    sha256: args.finalMasterSha256,
    durationSec: args.finalMasterDurationSec,
  });
  if (
    bridge.finalMaster.sha256 !== contextMaster.sha256 ||
    bridge.finalMaster.durationSec !== contextMaster.durationSec
  ) {
    throw new Error("reference-quality evidence bridge v2 belongs to a different final master");
  }
  if (
    bridge.visualRelease.source.sha256 !== bridge.finalMaster.sha256 ||
    bridge.visualRelease.source.durationSec !== bridge.finalMaster.durationSec
  ) {
    throw new Error("reference-quality evidence bridge v2 visual release is not bound to its final master");
  }
  if (
    bridge.visualRelease.reviewFingerprint !== args.visualReviewFingerprint ||
    bridge.visualRelease.reviewReceiptVersion !== args.visualReviewReceiptVersion ||
    bridge.visualRelease.reviewReceiptFingerprint !== args.visualReviewReceiptFingerprint ||
    bridge.visualRelease.releaseReceiptFingerprint !== args.visualReviewReleaseReceiptFingerprint
  ) {
    throw new Error("reference-quality evidence bridge v2 belongs to a different visual-release receipt");
  }
  if (args.visualRelease !== undefined) {
    const durableVisualRelease = ReferenceQualityVisualReleaseWitnessSchema.parse(args.visualRelease);
    if (canonicalJson(durableVisualRelease) !== canonicalJson(bridge.visualRelease)) {
      throw new Error("reference-quality evidence bridge v2 does not match its durable visual-release receipt");
    }
  }

  const contract = canonicalFrozenCalibratedContract(bridge.contract);
  if (bridge.family !== contract.family) {
    throw new Error("reference-quality evidence bridge v2 family does not match its contract snapshot");
  }
  if (bridge.contractFingerprint !== referenceQualityContractFingerprint(contract)) {
    throw new Error("reference-quality evidence bridge v2 contract fingerprint does not match its snapshot");
  }
  if (bridge.assessment !== "partially_measured") {
    throw new Error("reference-quality evidence bridge v2 must remain explicitly partially measured");
  }

  const narration = assertNarrationSemanticMasterBinding({
    evidence: args.finalMasterNarration,
    finalMaster: bridge.finalMaster,
  });
  const audioAxis = assertPassingCanonicalAudioAxis(args.audioAxis);
  assertV2EvidenceCoverage({
    bridge,
    contract,
    narrationSemanticFingerprint: narration.receiptFingerprint,
    audioAxisFingerprint: referenceQualityAudioAxisFingerprint(audioAxis),
  });
  return bridge;
}

/**
 * Creates the only V2 shape that can exist today. It enumerates the frozen
 * contract itself, allowing one exact audio pair to pass and leaving all other
 * source, story, pacing, presentation, and audio pairs honestly unmeasured.
 */
export function createReferenceQualityEvidenceBridgeV2(args: {
  contract: ReferenceQualityContract;
  finalMaster: { sha256: string; durationSec: number };
  visualRelease: unknown;
  finalMasterNarration: unknown;
  audioAxis: unknown;
}): ReferenceQualityEvidenceBridgeV2 {
  const contract = canonicalFrozenCalibratedContract(args.contract);
  const finalMaster = ReferenceQualityEvidenceBridgeV2FinalMasterSchema.parse(args.finalMaster);
  const visualRelease = ReferenceQualityVisualReleaseWitnessSchema.parse(args.visualRelease);
  const allowed = v2MeasuredAudioAllowance(contract.family);
  if (!allowed) {
    throw new Error(
      `reference-quality evidence bridge v2 does not permit measured evidence for family ${contract.family}`,
    );
  }
  const narration = assertNarrationSemanticMasterBinding({
    evidence: args.finalMasterNarration,
    finalMaster,
  });
  const audioAxis = assertPassingCanonicalAudioAxis(args.audioAxis);
  if (
    visualRelease.source.sha256 !== finalMaster.sha256 ||
    visualRelease.source.durationSec !== finalMaster.durationSec
  ) {
    throw new Error("reference-quality evidence bridge v2 visual release belongs to a different final master");
  }
  const expected = expectedEvidence(contract);
  if (!expected.some((item) => (
    item.requirementId === allowed.requirementId &&
    item.evidenceId === allowed.evidenceId &&
    item.verification === "measured-render-evidence"
  ))) {
    throw new Error(
      "reference-quality evidence bridge v2 frozen contract is missing its exact allowlisted measured audio pair",
    );
  }
  const narrationSemanticFingerprint = narration.receiptFingerprint;
  const audioAxisFingerprint = referenceQualityAudioAxisFingerprint(audioAxis);
  const unsigned: EvidenceBridgeV2Input = {
    version: REFERENCE_QUALITY_EVIDENCE_BRIDGE_V2_VERSION,
    family: contract.family,
    contractFingerprint: referenceQualityContractFingerprint(contract),
    contract: ReferenceQualityContractSnapshotSchema.parse(contract),
    finalMaster,
    visualRelease,
    assessment: "partially_measured",
    evidence: expected.map((item) => (
      item.requirementId === allowed.requirementId && item.evidenceId === allowed.evidenceId
        ? {
            requirementId: item.requirementId,
            evidenceId: item.evidenceId,
            verification: "measured-render-evidence" as const,
            measurementState: "measured" as const,
            verdict: "pass" as const,
            proofKind: "narrated-final-master-audio/v1" as const,
            narrationSemanticFingerprint,
            audioAxisFingerprint,
          }
        : {
            ...item,
            measurementState: "unmeasured" as const,
          }
    )),
  };
  const bridge = ReferenceQualityEvidenceBridgeV2Schema.parse({
    ...unsigned,
    bridgeFingerprint: referenceQualityEvidenceBridgeV2Fingerprint(unsigned),
  });
  return assertReferenceQualityEvidenceBridgeV2({
    bridge,
    finalMasterSha256: finalMaster.sha256,
    finalMasterDurationSec: finalMaster.durationSec,
    visualReviewFingerprint: visualRelease.reviewFingerprint,
    visualReviewReceiptVersion: visualRelease.reviewReceiptVersion,
    visualReviewReceiptFingerprint: visualRelease.reviewReceiptFingerprint,
    visualReviewReleaseReceiptFingerprint: visualRelease.releaseReceiptFingerprint,
    finalMasterNarration: narration,
    audioAxis,
    visualRelease,
  });
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
  /** Required when the persisted binding is the explicit V2 bridge. */
  visualReviewReceiptVersion?: string;
  /** Required when the persisted binding is the explicit V2 bridge. */
  finalMasterDurationSec?: number;
  /** Required when the persisted binding is the explicit V2 bridge. */
  visualReviewReleaseReceiptFingerprint?: string;
  /** Required when the persisted binding is the explicit V2 bridge. */
  finalMasterNarration?: unknown;
  /** Required when the persisted binding is the explicit V2 bridge. */
  audioAxis?: unknown;
  /** Optional raw release receipt projection for durable reload cross-validation. */
  visualRelease?: unknown;
}): ReferenceQualityFinalMasterBinding {
  const binding = ReferenceQualityFinalMasterBindingAnySchema.parse(args.binding);
  if (binding.version === REFERENCE_QUALITY_EVIDENCE_BRIDGE_V2_VERSION) {
    if (
      args.finalMasterDurationSec === undefined ||
      args.visualReviewReceiptVersion === undefined ||
      args.visualReviewReleaseReceiptFingerprint === undefined ||
      args.finalMasterNarration === undefined ||
      args.audioAxis === undefined
    ) {
      throw new Error(
        "reference-quality evidence bridge v2 requires final-master, visual-release, narration, and audio-axis sibling receipts",
      );
    }
    return assertReferenceQualityEvidenceBridgeV2({
      bridge: binding,
      finalMasterSha256: args.finalMasterSha256,
      finalMasterDurationSec: args.finalMasterDurationSec,
      visualReviewFingerprint: args.visualReviewFingerprint,
      visualReviewReceiptVersion: args.visualReviewReceiptVersion,
      visualReviewReceiptFingerprint: args.visualReviewReceiptFingerprint,
      visualReviewReleaseReceiptFingerprint: args.visualReviewReleaseReceiptFingerprint,
      finalMasterNarration: args.finalMasterNarration,
      audioAxis: args.audioAxis,
      ...(args.visualRelease === undefined ? {} : { visualRelease: args.visualRelease }),
    });
  }
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
