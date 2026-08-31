/**
 * Route-aware reference-quality evidence adapter.
 *
 * This registry deliberately turns only existing, typed receipts into a
 * measured pass. It never asks a provider to compare us with a reference
 * channel, and it does not participate in release authorization. Unsupported
 * mechanics remain explicit `unmeasured` entries in the durable certificate.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import {
  referenceQualityContractFor,
} from "@/engine/creative/referenceQuality";
import {
  channelProgramRouteRunSeedFingerprint,
  ChannelProgramRouteRunSeedSchema,
  parseChannelProgramRouteRunSeed,
  type ChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertDataStorySourceLedger,
  dataStorySourceLedgerFingerprint,
} from "@/engine/dataStorySourceLedger";
import { referenceQualityContractFingerprint } from "@/engine/creative/referenceQualityAttestation";
import type {
  ReferenceQualityContract,
  ReferenceQualityRequirement,
  ReferenceQualityVerification,
} from "@/engine/creative/types";
import {
  assertSyntheticScenarioContract,
} from "@/engine/syntheticScenario";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  REFERENCE_QUALITY_EVIDENCE_BRIDGE_V2_VERSION,
  ReferenceQualityFinalMasterBindingAnySchema,
} from "@/lib/referenceQualityFinalMasterBinding";
import { assertFinalMasterQualityEvidenceBinding } from "@/lib/finalMasterQualityEvidenceBinding";

export const ROUTE_REFERENCE_QUALITY_MECHANICS_LEDGER_VERSION =
  "route-reference-quality-mechanics-ledger/v1" as const;

const SOURCE_ATTRIBUTED_DATA_STORY_CAPABILITY = "source_attributed_data_story" as const;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected lowercase SHA-256 fingerprint");
const identifier = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/);
const boundedText = z.string().trim().min(1).max(8_000);
const finite = z.number().finite();
const verification = z.enum([
  "reviewer-confirmed",
  "source-trace-plus-review",
  "measured-render-evidence",
  "route-contract",
  "source-data-receipt",
]);

type RouteMechanicsVerification = z.infer<typeof verification>;

// The public schema bounds every nested field at certificate ingress. Its
// runtime output is intentionally the readonly run-seed contract used by the
// runner, rather than the mutable Zod inference type.
const sealedRouteSeedSchema = ChannelProgramRouteRunSeedSchema.transform(
  (value) => value as ChannelProgramRouteRunSeed,
);

const finalMasterSchema = z.object({
  sha256,
  durationSec: finite.positive(),
}).strict();

const visualReleaseSchema = z.object({
  reviewFingerprint: sha256,
  reviewReceiptVersion: z.string().trim().min(1).max(128),
  reviewReceiptFingerprint: sha256,
  releaseReceiptFingerprint: sha256,
  verdict: z.literal("pass"),
  referenceCriteriaComplete: z.literal(true),
  evidence: z.object({
    source: finalMasterSchema,
  }).passthrough(),
  referenceCriteria: z.array(z.object({
    id: identifier,
    scope: z.enum(["frame", "global"]),
    verdict: z.enum(["pass", "fail", "not_observable"]),
    evidenceFrameIds: z.array(identifier).min(1).max(20_000),
  }).strict()).max(256),
}).passthrough();

const requirementSchema = z.object({
  id: identifier,
  area: z.enum(["story", "pacing", "presentation", "audio", "route_contract"]),
  standard: boundedText,
  verification,
  /** Source/route provenance must never be mistaken for final-master evidence. */
  proofScope: z.enum(["final_master", "source_asset", "route_contract"]),
  evidenceIds: z.array(identifier).min(1).max(32),
}).strict();

const unmeasuredEvidenceSchema = z.object({
  requirementId: identifier,
  evidenceId: identifier,
  verification,
  measurementState: z.literal("unmeasured"),
  proofScope: z.enum(["final_master", "source_asset", "route_contract"]),
  /** A reason is required so absence cannot be mistaken for a failed measurement. */
  reason: boundedText,
}).strict();

const measuredEvidenceSchema = z.object({
  requirementId: identifier,
  evidenceId: identifier,
  verification,
  measurementState: z.literal("measured"),
  verdict: z.literal("pass"),
  proofScope: z.enum(["final_master", "source_asset", "route_contract"]),
  proofKind: z.enum([
    "visual-review-reference-criterion/v1",
    "reference-quality-audio-bridge/v2",
    "final-master-music-audio-quality/v1",
    "final-master-ambient-audio-quality/v1",
    "data-story-source-ledger/v1",
    "synthetic-scenario-contract/v1",
  ]),
  proofFingerprint: sha256,
}).strict();

const evidenceSchema = z.discriminatedUnion("measurementState", [
  unmeasuredEvidenceSchema,
  measuredEvidenceSchema,
]);

export const ReferenceQualityMechanicsLedgerSchema = z.object({
  version: z.literal(ROUTE_REFERENCE_QUALITY_MECHANICS_LEDGER_VERSION),
  /** Bounded at certificate ingress before any canonical fingerprinting. */
  route: sealedRouteSeedSchema,
  /** Immutable full-seed sibling join; never re-resolves the current catalog. */
  routeSeedFingerprint: sha256,
  claimMode: z.enum([
    "editorial_lane_policy",
    "certified_quiz_facts",
    "fictional_scenario_no_external_claims",
  ]),
  mechanicsKind: z.enum(["reference-quality-contract", "fictional-scenario-contract"]),
  /** Only capabilities that actually alter this adapter's requirements. */
  applicableCapabilityKeys: z.array(identifier).max(16),
  /** Present for factual routes; fictional routes intentionally do not cite a reference contract. */
  referenceContractFingerprint: sha256.optional(),
  requirements: z.array(requirementSchema).min(1).max(128),
  definitionFingerprint: sha256,
  finalMaster: finalMasterSchema,
  visualRelease: z.object({
    reviewFingerprint: sha256,
    reviewReceiptVersion: z.string().trim().min(1).max(128),
    reviewReceiptFingerprint: sha256,
    releaseReceiptFingerprint: sha256,
  }).strict(),
  assessment: z.enum(["unmeasured", "partially_measured", "fully_measured"]),
  evidence: z.array(evidenceSchema).min(1).max(256),
  ledgerFingerprint: sha256,
}).strict();

export type ReferenceQualityMechanicsLedger = z.infer<typeof ReferenceQualityMechanicsLedgerSchema>;

export interface CreateReferenceQualityMechanicsLedgerInput {
  route: unknown;
  /** Optional for legacy route snapshots. Fresh route-bearing runs freeze this from ShowProfile. */
  selectedCapabilityKeys?: unknown;
  finalMaster: { sha256: string; durationSec: number };
  /** The already-created, durable visual-review release receipt. */
  visualRelease: unknown;
  /** Existing V1/V2 binding. V2 is the only generic audio adapter. */
  referenceQualityBinding?: unknown;
  /**
   * Optional final-master quality binding. It can prove only the music-loop
   * audio-continuity pair when its sealed route, master, review, and passing
   * scored audio axis all agree. It never acts as a generic audio adapter.
   */
  finalMasterQualityEvidenceBinding?: unknown;
  narrationText?: unknown;
  dataStorySourceLedger?: unknown;
  syntheticScenario?: unknown;
}

interface RouteMechanicsRequirement {
  id: string;
  area: z.infer<typeof requirementSchema>["area"];
  standard: string;
  verification: RouteMechanicsVerification;
  proofScope: z.infer<typeof requirementSchema>["proofScope"];
  evidenceIds: readonly string[];
}

interface RouteMechanicsDefinition {
  mechanicsKind: ReferenceQualityMechanicsLedger["mechanicsKind"];
  applicableCapabilityKeys: string[];
  referenceContractFingerprint?: string;
  requirements: RouteMechanicsRequirement[];
}

interface FrozenReferenceContract {
  contract: ReferenceQualityContract;
  fingerprint: string;
  binding?: z.infer<typeof ReferenceQualityFinalMasterBindingAnySchema>;
}

function sha256Of(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function assertCanonicalCapabilityKeys(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const keys = z.array(identifier).max(64).parse(value);
  if (new Set(keys).size !== keys.length) {
    throw new Error("reference-quality mechanics capability seed repeats a key");
  }
  if (keys.some((key, index) => index > 0 && keys[index - 1]!.localeCompare(key) >= 0)) {
    throw new Error("reference-quality mechanics capability seed is not canonical sorted order");
  }
  return keys;
}

function asRouteVerification(value: ReferenceQualityVerification): RouteMechanicsVerification {
  return value;
}

function requirementFromReferenceContract(
  requirement: ReferenceQualityRequirement,
): RouteMechanicsRequirement {
  return {
    id: requirement.id,
    area: requirement.area,
    standard: requirement.standard,
    verification: asRouteVerification(requirement.verification),
    proofScope: "final_master",
    evidenceIds: [...requirement.evidence],
  };
}

function matchingFrozenReferenceContract(args: {
  route: ChannelProgramRouteRunSeed;
  binding: unknown;
}): FrozenReferenceContract {
  const parsed = ReferenceQualityFinalMasterBindingAnySchema.safeParse(args.binding);
  if (!parsed.success) {
    throw new Error("reference-quality mechanics requires the existing frozen reference-quality binding");
  }
  if (parsed.data.family !== args.route.family) {
    throw new Error("reference-quality mechanics binding family does not match the sealed channel route");
  }
  const contract = parsed.data.contract as ReferenceQualityContract;
  const fingerprint = referenceQualityContractFingerprint(contract);
  if (parsed.data.contractFingerprint !== fingerprint) {
    throw new Error("reference-quality mechanics binding contract fingerprint is invalid");
  }
  return { contract, fingerprint, binding: parsed.data };
}

/**
 * Final QA has two deliberate phases. Before reviewing the final master, the
 * only available reference input is the frozen channel QualityBar contract;
 * after review, the stronger final-master binding is required. Do not make the
 * pre-review path fabricate a final-master binding merely to reuse the later
 * parser. Instead accept only the canonical contract for this exact family.
 */
function matchingPreReviewReferenceContract(args: {
  route: ChannelProgramRouteRunSeed;
  contract: unknown;
}): FrozenReferenceContract {
  if (!args.contract || typeof args.contract !== "object" || Array.isArray(args.contract)) {
    throw new Error("reference-quality visual review requires a frozen channel reference-quality contract");
  }
  const candidate = args.contract as ReferenceQualityContract;
  const expected = referenceQualityContractFor(args.route.family);
  const expectedFingerprint = referenceQualityContractFingerprint(expected);
  if (candidate.family !== args.route.family) {
    throw new Error("reference-quality visual review contract family does not match the sealed channel route");
  }
  if (referenceQualityContractFingerprint(candidate) !== expectedFingerprint) {
    throw new Error("reference-quality visual review contract is not the canonical frozen contract for the sealed channel route");
  }
  return { contract: expected, fingerprint: expectedFingerprint };
}

function sourceDataCapabilityApplies(args: {
  route: ChannelProgramRouteRunSeed;
  selectedCapabilityKeys: readonly string[] | undefined;
}): boolean {
  const selected = args.selectedCapabilityKeys?.includes(SOURCE_ATTRIBUTED_DATA_STORY_CAPABILITY) ?? false;
  if (!selected) return false;
  if (args.route.family !== "narrated_stock" || args.route.directives.claimMode !== "editorial_lane_policy") {
    throw new Error(
      "source_attributed_data_story capability is incompatible with the sealed channel route",
    );
  }
  return true;
}

function mechanicsDefinitionForRoute(args: {
  route: ChannelProgramRouteRunSeed;
  selectedCapabilityKeys: readonly string[] | undefined;
  referenceQualityBinding?: unknown;
}): RouteMechanicsDefinition {
  if (args.route.directives.claimMode === "fictional_scenario_no_external_claims") {
    if (!args.route.syntheticScenarioProfile) {
      throw new Error("fictional channel route lacks its sealed synthetic scenario profile");
    }
    return {
      mechanicsKind: "fictional-scenario-contract",
      applicableCapabilityKeys: [],
      requirements: [
        {
          id: "fictional-scenario-contract",
          area: "route_contract",
          standard:
            "The released episode is bound to the route's sealed fictional scenario profile; this confirms declared assumptions, not a real-world simulation or factual claim.",
          verification: "route-contract",
          proofScope: "route_contract",
          evidenceIds: ["sealed-synthetic-scenario-contract"],
        },
        {
          id: "fictional-scenario-opening-disclosure",
          area: "route_contract",
          standard:
            "The route's visible fictional-scenario disclosure must be proven in the released opening by a final-master-bound receipt; the script gate alone is not enough.",
          verification: "route-contract",
          proofScope: "final_master",
          evidenceIds: ["opening-synthetic-scenario-disclosure"],
        },
      ],
    };
  }

  const frozen = matchingFrozenReferenceContract({
    route: args.route,
    binding: args.referenceQualityBinding,
  });
  const capabilityApplies = sourceDataCapabilityApplies({
    route: args.route,
    selectedCapabilityKeys: args.selectedCapabilityKeys,
  });
  const requirements = frozen.contract.requirements.map(requirementFromReferenceContract);
  if (capabilityApplies) {
    requirements.push({
      id: "source-attributed-data-story-admission",
      area: "story",
      standard:
        "The sealed source-data capability requires a current approved source ledger bound to the narrated numeric claims. This is source-asset provenance only and does not claim final-master shot coverage.",
      verification: "source-data-receipt",
      proofScope: "source_asset",
      evidenceIds: ["approved-data-story-source-ledger"],
    });
  }
  return {
    mechanicsKind: "reference-quality-contract",
    applicableCapabilityKeys: capabilityApplies ? [SOURCE_ATTRIBUTED_DATA_STORY_CAPABILITY] : [],
    referenceContractFingerprint: frozen.fingerprint,
    requirements,
  };
}

function definitionFingerprint(args: {
  route: ChannelProgramRouteRunSeed;
  definition: RouteMechanicsDefinition;
}): string {
  return sha256Of({
    version: ROUTE_REFERENCE_QUALITY_MECHANICS_LEDGER_VERSION,
    route: {
      routeKey: args.route.routeKey,
      routeFingerprint: args.route.routeFingerprint,
      family: args.route.family,
      contentLaneKey: args.route.contentLaneKey,
      programBriefFingerprint: args.route.programBriefFingerprint,
      claimMode: args.route.directives.claimMode,
      syntheticScenarioProfile: args.route.syntheticScenarioProfile,
    },
    definition: {
      mechanicsKind: args.definition.mechanicsKind,
      applicableCapabilityKeys: args.definition.applicableCapabilityKeys,
      referenceContractFingerprint: args.definition.referenceContractFingerprint,
      requirements: args.definition.requirements,
    },
  });
}

function evidenceKey(requirementId: string, evidenceId: string): string {
  return `${requirementId}\u0000${evidenceId}`;
}

function expectedEvidence(definition: RouteMechanicsDefinition): Array<{
  requirementId: string;
  evidenceId: string;
  verification: RouteMechanicsVerification;
  proofScope: z.infer<typeof requirementSchema>["proofScope"];
}> {
  const expected: Array<{
    requirementId: string;
    evidenceId: string;
    verification: RouteMechanicsVerification;
    proofScope: z.infer<typeof requirementSchema>["proofScope"];
  }> = [];
  const seen = new Set<string>();
  for (const requirement of definition.requirements) {
    for (const evidenceId of requirement.evidenceIds) {
      const key = evidenceKey(requirement.id, evidenceId);
      if (seen.has(key)) {
        throw new Error(`reference-quality mechanics definition repeats evidence ${evidenceId}`);
      }
      seen.add(key);
      expected.push({
        requirementId: requirement.id,
        evidenceId,
        verification: requirement.verification,
        proofScope: requirement.proofScope,
      });
    }
  }
  return expected;
}

function visualCriterionPass(args: {
  visualRelease: z.infer<typeof visualReleaseSchema>;
  requirementId: string;
  evidenceId: string;
  verification: RouteMechanicsVerification;
}): string | undefined {
  // Only explicitly typed, frame-observable mechanics may become final-master
  // evidence. Broad QA text or referenceCriteriaComplete alone are
  // intentionally never treated as proof.
  if (
    args.verification !== "reviewer-confirmed" ||
    ![
      "reviewer-confirmed-purposeful-change-map",
      "reviewer-confirmed-legible-visual-model",
      "reviewer-confirmed-stable-visual-language",
    ].includes(args.evidenceId)
  ) return undefined;
  const criterion = args.visualRelease.referenceCriteria.find((candidate) =>
    candidate.id === args.requirementId &&
    candidate.verdict === "pass" &&
    candidate.evidenceFrameIds.length > 0,
  );
  return criterion ? args.visualRelease.releaseReceiptFingerprint : undefined;
}

function v2AudioPass(args: {
  route: ChannelProgramRouteRunSeed;
  frozen: FrozenReferenceContract | undefined;
  finalMaster: z.infer<typeof finalMasterSchema>;
  visualRelease: z.infer<typeof visualReleaseSchema>;
  requirementId: string;
  evidenceId: string;
}): string | undefined {
  const binding = args.frozen?.binding;
  if (!binding || binding.version !== REFERENCE_QUALITY_EVIDENCE_BRIDGE_V2_VERSION) return undefined;
  if (
    binding.family !== args.route.family ||
    binding.contractFingerprint !== args.frozen?.fingerprint ||
    binding.finalMaster.sha256 !== args.finalMaster.sha256 ||
    binding.finalMaster.durationSec !== args.finalMaster.durationSec ||
    binding.visualRelease.reviewFingerprint !== args.visualRelease.reviewFingerprint ||
    binding.visualRelease.reviewReceiptFingerprint !== args.visualRelease.reviewReceiptFingerprint ||
    binding.visualRelease.releaseReceiptFingerprint !== args.visualRelease.releaseReceiptFingerprint
  ) {
    return undefined;
  }
  const item = binding.evidence.find((candidate) =>
    candidate.requirementId === args.requirementId &&
    candidate.evidenceId === args.evidenceId &&
    candidate.measurementState === "measured" &&
    candidate.verdict === "pass",
  );
  return item ? binding.bridgeFingerprint : undefined;
}

const AMBIENT_FINAL_MASTER_AUDIO_PROOF_KIND = "final-master-ambient-audio-quality/v1" as const;
const LEGACY_MUSIC_FINAL_MASTER_AUDIO_PROOF_KIND = "final-master-music-audio-quality/v1" as const;

function ambientAudioPass(args: {
  route: ChannelProgramRouteRunSeed;
  finalMaster: z.infer<typeof finalMasterSchema>;
  visualRelease: z.infer<typeof visualReleaseSchema>;
  requirementId: string;
  evidenceId: string;
  finalMasterQualityEvidenceBinding: unknown;
  /** Retained only so existing release certificates remain verifiable. */
  proofKind?: typeof AMBIENT_FINAL_MASTER_AUDIO_PROOF_KIND | typeof LEGACY_MUSIC_FINAL_MASTER_AUDIO_PROOF_KIND;
}): string | undefined {
  const expectedLane = args.route.family === "music_loop"
    ? { key: "music_loop", renderer: "loop_clips" }
    : args.route.family === "sleep"
      ? { key: "ambient_guided", renderer: "stock_footage" }
      : undefined;
  if (
    !expectedLane ||
    args.route.contentLaneKey !== expectedLane.key ||
    args.requirementId !== "audio-continuity" ||
    args.evidenceId !== "audio-intelligibility-or-continuity-evidence"
  ) return undefined;
  try {
    const binding = assertFinalMasterQualityEvidenceBinding({
      binding: args.finalMasterQualityEvidenceBinding,
      finalMasterSha256: args.finalMaster.sha256,
      finalMasterDurationSec: args.finalMaster.durationSec,
      visualReviewFingerprint: args.visualRelease.reviewFingerprint,
      visualReviewReceiptVersion: args.visualRelease.reviewReceiptVersion,
      visualReviewReceiptFingerprint: args.visualRelease.reviewReceiptFingerprint,
      visualReviewReleaseReceiptFingerprint: args.visualRelease.releaseReceiptFingerprint,
    });
    const programRoute = binding.programRoute;
    const routeSeedFingerprint = channelProgramRouteRunSeedFingerprint(args.route);
    if (
      binding.contentLane.key !== expectedLane.key ||
      binding.contentLane.renderer !== expectedLane.renderer ||
      !programRoute ||
      programRoute.routeFingerprint !== args.route.routeFingerprint ||
      programRoute.family !== args.route.family ||
      programRoute.contentLaneKey !== args.route.contentLaneKey ||
      programRoute.programBriefFingerprint !== args.route.programBriefFingerprint ||
      programRoute.routeSeedFingerprint !== routeSeedFingerprint
    ) return undefined;
    const audio = binding.qualityEvidence.axes.audio;
    if (
      audio.status !== "pass" ||
      audio.score === undefined ||
      audio.minimumScore === undefined ||
      audio.score < audio.minimumScore
    ) return undefined;
    return sha256Of({
      version: args.proofKind ?? AMBIENT_FINAL_MASTER_AUDIO_PROOF_KIND,
      requirementId: args.requirementId,
      evidenceId: args.evidenceId,
      routeSeedFingerprint,
      finalMasterQualityEvidenceBindingFingerprint: binding.bindingFingerprint,
      qualityEvidenceFingerprint: binding.qualityEvidenceFingerprint,
      audioAxis: audio,
    });
  } catch {
    return undefined;
  }
}

function fictionalScenarioPass(args: {
  route: ChannelProgramRouteRunSeed;
  requirementId: string;
  evidenceId: string;
  syntheticScenario: unknown;
}): { proofKind: z.infer<typeof measuredEvidenceSchema>["proofKind"]; proofFingerprint: string } | undefined {
  const profile = args.route.syntheticScenarioProfile;
  if (!profile) return undefined;
  if (
    args.requirementId === "fictional-scenario-contract" &&
    args.evidenceId === "sealed-synthetic-scenario-contract"
  ) {
    try {
      const contract = assertSyntheticScenarioContract(args.syntheticScenario);
      if (contract.profile !== profile) return undefined;
      return {
        proofKind: "synthetic-scenario-contract/v1",
        proofFingerprint: sha256Of(contract),
      };
    } catch {
      return undefined;
    }
  }
  // The existing disclosure gate checks authored narration, not the released
  // master. Keep this final-output requirement unmeasured until an exact
  // final-master transcript or OCR proof can bind the phrase and timing.
  return undefined;
}

function sourceDataLedgerPass(args: {
  requirementId: string;
  evidenceId: string;
  narrationText: unknown;
  ledger: unknown;
}): string | undefined {
  if (
    args.requirementId !== "source-attributed-data-story-admission" ||
    args.evidenceId !== "approved-data-story-source-ledger" ||
    typeof args.narrationText !== "string" ||
    !args.narrationText.trim()
  ) {
    return undefined;
  }
  try {
    const ledger = assertDataStorySourceLedger(args.ledger, args.narrationText);
    return dataStorySourceLedgerFingerprint(ledger);
  } catch {
    return undefined;
  }
}

function assessmentFor(evidence: readonly ReferenceQualityMechanicsLedger["evidence"][number][]) {
  const measured = evidence.filter((item) => item.measurementState === "measured").length;
  if (measured === 0) return "unmeasured" as const;
  return measured === evidence.length ? "fully_measured" as const : "partially_measured" as const;
}

function ledgerPayload(value: Omit<ReferenceQualityMechanicsLedger, "ledgerFingerprint">): string {
  return canonicalJson(value);
}

export function referenceQualityMechanicsLedgerFingerprint(
  value: Omit<ReferenceQualityMechanicsLedger, "ledgerFingerprint">,
): string {
  return createHash("sha256")
    .update(`${ROUTE_REFERENCE_QUALITY_MECHANICS_LEDGER_VERSION}\n${ledgerPayload(value)}`)
    .digest("hex");
}

/**
 * Creates an attestation-style ledger. A missing/unsupported receipt is never
 * guessed from prose or a generic QA score: it remains explicitly unmeasured.
 */
export function createReferenceQualityMechanicsLedger(
  input: CreateReferenceQualityMechanicsLedgerInput,
): ReferenceQualityMechanicsLedger {
  const route = parseChannelProgramRouteRunSeed(input.route);
  const selectedCapabilityKeys = assertCanonicalCapabilityKeys(input.selectedCapabilityKeys);
  const finalMaster = finalMasterSchema.parse(input.finalMaster);
  const visualRelease = visualReleaseSchema.parse(input.visualRelease);
  if (
    visualRelease.evidence.source.sha256 !== finalMaster.sha256 ||
    visualRelease.evidence.source.durationSec !== finalMaster.durationSec
  ) {
    throw new Error("reference-quality mechanics visual receipt belongs to a different final master");
  }
  const definition = mechanicsDefinitionForRoute({
    route,
    selectedCapabilityKeys,
    referenceQualityBinding: input.referenceQualityBinding,
  });
  const frozen = definition.mechanicsKind === "reference-quality-contract"
    ? matchingFrozenReferenceContract({ route, binding: input.referenceQualityBinding })
    : undefined;
  const evidence = expectedEvidence(definition).map((expected) => {
    if (definition.mechanicsKind === "fictional-scenario-contract") {
      const scenario = fictionalScenarioPass({
        route,
        requirementId: expected.requirementId,
        evidenceId: expected.evidenceId,
        syntheticScenario: input.syntheticScenario,
      });
      if (scenario) {
        return {
          ...expected,
          measurementState: "measured" as const,
          verdict: "pass" as const,
          proofScope: "route_contract" as const,
          ...scenario,
        };
      }
    } else {
      const visualProof = visualCriterionPass({
        visualRelease,
        requirementId: expected.requirementId,
        evidenceId: expected.evidenceId,
        verification: expected.verification,
      });
      if (visualProof) {
        return {
          ...expected,
          measurementState: "measured" as const,
          verdict: "pass" as const,
          proofScope: "final_master" as const,
          proofKind: "visual-review-reference-criterion/v1" as const,
          proofFingerprint: visualProof,
        };
      }
      const audioProof = v2AudioPass({
        route,
        frozen,
        finalMaster,
        visualRelease,
        requirementId: expected.requirementId,
        evidenceId: expected.evidenceId,
      });
      if (audioProof) {
        return {
          ...expected,
          measurementState: "measured" as const,
          verdict: "pass" as const,
          proofScope: "final_master" as const,
          proofKind: "reference-quality-audio-bridge/v2" as const,
          proofFingerprint: audioProof,
        };
      }
      const ambientAudioProof = ambientAudioPass({
        route,
        finalMaster,
        visualRelease,
        requirementId: expected.requirementId,
        evidenceId: expected.evidenceId,
        finalMasterQualityEvidenceBinding: input.finalMasterQualityEvidenceBinding,
      });
      if (ambientAudioProof) {
        return {
          ...expected,
          measurementState: "measured" as const,
          verdict: "pass" as const,
          proofScope: "final_master" as const,
          proofKind: AMBIENT_FINAL_MASTER_AUDIO_PROOF_KIND,
          proofFingerprint: ambientAudioProof,
        };
      }
      const sourceLedgerProof = sourceDataLedgerPass({
        requirementId: expected.requirementId,
        evidenceId: expected.evidenceId,
        narrationText: input.narrationText,
        ledger: input.dataStorySourceLedger,
      });
      if (sourceLedgerProof) {
        return {
          ...expected,
          measurementState: "measured" as const,
          verdict: "pass" as const,
          proofScope: "source_asset" as const,
          proofKind: "data-story-source-ledger/v1" as const,
          proofFingerprint: sourceLedgerProof,
        };
      }
    }
    return {
      ...expected,
      measurementState: "unmeasured" as const,
      reason: "No matching certificate-bound typed receipt is available for this requirement.",
    };
  });
  const unsigned = {
    version: ROUTE_REFERENCE_QUALITY_MECHANICS_LEDGER_VERSION,
    route,
    routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(route),
    claimMode: route.directives.claimMode,
    mechanicsKind: definition.mechanicsKind,
    applicableCapabilityKeys: definition.applicableCapabilityKeys,
    ...(definition.referenceContractFingerprint
      ? { referenceContractFingerprint: definition.referenceContractFingerprint }
      : {}),
    requirements: definition.requirements.map((requirement) => ({
      ...requirement,
      evidenceIds: [...requirement.evidenceIds],
    })),
    definitionFingerprint: definitionFingerprint({ route, definition }),
    finalMaster,
    visualRelease: {
      reviewFingerprint: visualRelease.reviewFingerprint,
      reviewReceiptVersion: visualRelease.reviewReceiptVersion,
      reviewReceiptFingerprint: visualRelease.reviewReceiptFingerprint,
      releaseReceiptFingerprint: visualRelease.releaseReceiptFingerprint,
    },
    assessment: assessmentFor(evidence),
    evidence,
  } satisfies Omit<ReferenceQualityMechanicsLedger, "ledgerFingerprint">;
  return assertReferenceQualityMechanicsLedger({
    ledger: {
      ...unsigned,
      ledgerFingerprint: referenceQualityMechanicsLedgerFingerprint(unsigned),
    },
    referenceQualityBinding: input.referenceQualityBinding,
    finalMasterQualityEvidenceBinding: input.finalMasterQualityEvidenceBinding,
  });
}

function assertExpectedEvidenceCoverage(args: {
  definition: RouteMechanicsDefinition;
  evidence: readonly ReferenceQualityMechanicsLedger["evidence"][number][];
}): void {
  const expected = expectedEvidence(args.definition);
  if (args.evidence.length !== expected.length) {
    throw new Error("reference-quality mechanics ledger does not enumerate every required evidence pair");
  }
  const expectedByKey = new Map(expected.map((item) => [
    evidenceKey(item.requirementId, item.evidenceId),
    item,
  ]));
  const seen = new Set<string>();
  for (const item of args.evidence) {
    const key = evidenceKey(item.requirementId, item.evidenceId);
    const expectedItem = expectedByKey.get(key);
    if (!expectedItem || seen.has(key)) {
      throw new Error("reference-quality mechanics ledger names duplicate or unexpected evidence");
    }
    seen.add(key);
    if (item.verification !== expectedItem.verification) {
      throw new Error("reference-quality mechanics ledger changes a requirement verification mode");
    }
    if (item.proofScope !== expectedItem.proofScope) {
      throw new Error("reference-quality mechanics ledger changes an evidence proof scope");
    }
    if (item.measurementState === "unmeasured") continue;
    if (
      item.proofKind === "visual-review-reference-criterion/v1" &&
      item.evidenceId !== "reviewer-confirmed-purposeful-change-map"
    ) {
      throw new Error("reference-quality mechanics visual proof is attached to an unsupported evidence pair");
    }
    if (
      item.proofKind === "reference-quality-audio-bridge/v2" &&
      item.evidenceId !== "audio-intelligibility-or-continuity-evidence"
    ) {
      throw new Error("reference-quality mechanics audio proof is attached to an unsupported evidence pair");
    }
    if (
      (item.proofKind === LEGACY_MUSIC_FINAL_MASTER_AUDIO_PROOF_KIND ||
        item.proofKind === AMBIENT_FINAL_MASTER_AUDIO_PROOF_KIND) &&
      (item.requirementId !== "audio-continuity" ||
        item.evidenceId !== "audio-intelligibility-or-continuity-evidence")
    ) {
      throw new Error("reference-quality mechanics ambient audio proof is attached to an unsupported evidence pair");
    }
    if (
      item.proofKind === "data-story-source-ledger/v1" &&
      (item.requirementId !== "source-attributed-data-story-admission" ||
        item.evidenceId !== "approved-data-story-source-ledger")
    ) {
      throw new Error("reference-quality mechanics source ledger proof is attached to an unsupported evidence pair");
    }
    if (
      item.proofKind === "synthetic-scenario-contract/v1" &&
      (item.requirementId !== "fictional-scenario-contract" ||
        item.evidenceId !== "sealed-synthetic-scenario-contract")
    ) {
      throw new Error("reference-quality mechanics scenario contract proof is attached to an unsupported evidence pair");
    }
  }
}

/**
 * Structural certificate assertion. It validates the ledger's frozen route,
 * exact static definition, expected pair coverage, and master/review lineage;
 * it never upgrades an unmeasured entry into a pass.
 */
export function assertReferenceQualityMechanicsLedger(args: {
  ledger: unknown;
  referenceQualityBinding?: unknown;
  finalMasterQualityEvidenceBinding?: unknown;
  finalMaster?: { sha256: string; durationSec: number };
  visualReview?: {
    reviewFingerprint: string;
    reviewReceiptVersion: string;
    reviewReceiptFingerprint: string;
    releaseReceiptFingerprint: string;
  };
}): ReferenceQualityMechanicsLedger {
  const ledger = ReferenceQualityMechanicsLedgerSchema.parse(args.ledger);
  const route = parseChannelProgramRouteRunSeed(ledger.route);
  const definition = mechanicsDefinitionForRoute({
    route,
    selectedCapabilityKeys: ledger.applicableCapabilityKeys,
    referenceQualityBinding: args.referenceQualityBinding,
  });
  if (ledger.claimMode !== route.directives.claimMode || ledger.mechanicsKind !== definition.mechanicsKind) {
    throw new Error("reference-quality mechanics ledger does not match its sealed channel route");
  }
  if (ledger.routeSeedFingerprint !== channelProgramRouteRunSeedFingerprint(route)) {
    throw new Error("reference-quality mechanics ledger route seed fingerprint does not match its payload");
  }
  if (canonicalJson(ledger.applicableCapabilityKeys) !== canonicalJson(definition.applicableCapabilityKeys)) {
    throw new Error("reference-quality mechanics ledger capability selection does not match its sealed route");
  }
  if (ledger.referenceContractFingerprint !== definition.referenceContractFingerprint) {
    throw new Error("reference-quality mechanics ledger contract fingerprint does not match its frozen binding");
  }
  const normalizedRequirements = definition.requirements.map((requirement) => ({
    ...requirement,
    evidenceIds: [...requirement.evidenceIds],
  }));
  if (canonicalJson(ledger.requirements) !== canonicalJson(normalizedRequirements)) {
    throw new Error("reference-quality mechanics ledger requirements do not match its sealed definition");
  }
  if (ledger.definitionFingerprint !== definitionFingerprint({ route, definition })) {
    throw new Error("reference-quality mechanics ledger definition fingerprint does not match its payload");
  }
  assertExpectedEvidenceCoverage({ definition, evidence: ledger.evidence });
  for (const item of ledger.evidence) {
    if (
      item.requirementId !== "audio-continuity" ||
      item.evidenceId !== "audio-intelligibility-or-continuity-evidence" ||
      item.measurementState !== "measured" ||
      (route.family !== "music_loop" && route.family !== "sleep")
    ) continue;
    if (
      item.proofKind !== AMBIENT_FINAL_MASTER_AUDIO_PROOF_KIND &&
      !(route.family === "music_loop" && item.proofKind === LEGACY_MUSIC_FINAL_MASTER_AUDIO_PROOF_KIND)
    ) {
      throw new Error("ambient audio continuity must use its exact final-master quality proof");
    }
    const expectedProof = ambientAudioPass({
      route,
      finalMaster: ledger.finalMaster,
      visualRelease: {
        ...ledger.visualRelease,
        verdict: "pass",
        referenceCriteriaComplete: true,
        evidence: { source: ledger.finalMaster },
        referenceCriteria: [],
      },
      requirementId: item.requirementId,
      evidenceId: item.evidenceId,
      finalMasterQualityEvidenceBinding: args.finalMasterQualityEvidenceBinding,
      proofKind: item.proofKind,
    });
    if (!expectedProof || item.proofFingerprint !== expectedProof) {
      throw new Error("ambient audio continuity proof does not match the final-master quality evidence");
    }
  }
  if (ledger.assessment !== assessmentFor(ledger.evidence)) {
    throw new Error("reference-quality mechanics ledger assessment does not match its evidence coverage");
  }
  if (
    args.finalMaster &&
    (ledger.finalMaster.sha256 !== args.finalMaster.sha256 ||
      ledger.finalMaster.durationSec !== args.finalMaster.durationSec)
  ) {
    throw new Error("reference-quality mechanics ledger belongs to a different final master");
  }
  if (
    args.visualReview &&
    (ledger.visualRelease.reviewFingerprint !== args.visualReview.reviewFingerprint ||
      ledger.visualRelease.reviewReceiptVersion !== args.visualReview.reviewReceiptVersion ||
      ledger.visualRelease.reviewReceiptFingerprint !== args.visualReview.reviewReceiptFingerprint ||
      ledger.visualRelease.releaseReceiptFingerprint !== args.visualReview.releaseReceiptFingerprint)
  ) {
    throw new Error("reference-quality mechanics ledger belongs to a different visual-review receipt");
  }
  const { ledgerFingerprint, ...unsigned } = ledger;
  if (ledgerFingerprint !== referenceQualityMechanicsLedgerFingerprint(unsigned)) {
    throw new Error("reference-quality mechanics ledger fingerprint does not match its payload");
  }
  return ledger;
}

/**
 * Re-validates any visual measured entry against the retained release receipt.
 * This is called only during durable certificate reload/verification.
 */
export function assertReferenceQualityMechanicsVisualReceiptBinding(args: {
  ledger: unknown;
  visualRelease: unknown;
}): void {
  const ledger = ReferenceQualityMechanicsLedgerSchema.parse(args.ledger);
  const visualRelease = visualReleaseSchema.parse(args.visualRelease);
  if (
    visualRelease.reviewFingerprint !== ledger.visualRelease.reviewFingerprint ||
    visualRelease.reviewReceiptVersion !== ledger.visualRelease.reviewReceiptVersion ||
    visualRelease.reviewReceiptFingerprint !== ledger.visualRelease.reviewReceiptFingerprint ||
    visualRelease.releaseReceiptFingerprint !== ledger.visualRelease.releaseReceiptFingerprint ||
    visualRelease.evidence.source.sha256 !== ledger.finalMaster.sha256 ||
    visualRelease.evidence.source.durationSec !== ledger.finalMaster.durationSec
  ) {
    throw new Error("reference-quality mechanics ledger does not match its visual-release receipt");
  }
  for (const item of ledger.evidence) {
    if (item.measurementState !== "measured" || item.proofKind !== "visual-review-reference-criterion/v1") {
      continue;
    }
    const proof = visualCriterionPass({
      visualRelease,
      requirementId: item.requirementId,
      evidenceId: item.evidenceId,
      verification: item.verification,
    });
    if (!proof || proof !== item.proofFingerprint) {
      throw new Error("reference-quality mechanics visual criterion proof does not match its retained receipt");
    }
  }
}

/**
 * A route-aware ledger is meaningful only beside the same sealed route in the
 * shared final-QA binding. This prevents a fictional or factual ledger from
 * being replayed onto a master reviewed for a different route.
 */
export function assertReferenceQualityMechanicsProgramRouteBinding(args: {
  ledger: unknown;
  programRoute: unknown;
}): void {
  const ledger = ReferenceQualityMechanicsLedgerSchema.parse(args.ledger);
  const route = parseChannelProgramRouteRunSeed(ledger.route);
  const programRoute = z.object({
    routeFingerprint: sha256,
    family: identifier,
    contentLaneKey: identifier,
    programBriefFingerprint: sha256,
    routeSeedFingerprint: sha256,
  }).strict().parse(args.programRoute);
  if (
    programRoute.routeFingerprint !== route.routeFingerprint ||
    programRoute.family !== route.family ||
    programRoute.contentLaneKey !== route.contentLaneKey ||
    programRoute.programBriefFingerprint !== route.programBriefFingerprint ||
    programRoute.routeSeedFingerprint !== ledger.routeSeedFingerprint
  ) {
    throw new Error("reference-quality mechanics ledger route does not match the final-QA route binding");
  }
}

/** A pure route profile helper for tests and static diagnostics; it does not inspect live channel state. */
export function referenceQualityMechanicsRequirementsForRoute(args: {
  route: unknown;
  selectedCapabilityKeys?: unknown;
  referenceQualityBinding?: unknown;
}): ReadonlyArray<z.infer<typeof requirementSchema>> {
  const route = parseChannelProgramRouteRunSeed(args.route);
  const selectedCapabilityKeys = assertCanonicalCapabilityKeys(args.selectedCapabilityKeys);
  const definition = mechanicsDefinitionForRoute({
    route,
    selectedCapabilityKeys,
    referenceQualityBinding: args.referenceQualityBinding,
  });
  return definition.requirements.map((requirement) => ({
    ...requirement,
    evidenceIds: [...requirement.evidenceIds],
  }));
}

/**
 * The final-master reviewer may judge only the continuously visible pacing
 * mechanic. Source traceability, originality, thumbnail packaging, rights,
 * and audio remain bound to their dedicated receipts; collapsing those into a
 * frame-only verdict would overclaim what the reviewer can see.
 */
export function referenceQualityVisualReviewCriteriaForRoute(args: {
  route: unknown;
  selectedCapabilityKeys?: unknown;
  /** Sealed channel QualityBar contract available before final-master review. */
  referenceQualityContract?: unknown;
  /** Final-master binding used only for post-review or historical derivation. */
  referenceQualityBinding?: unknown;
}): ReadonlyArray<{ id: string; criterion: string; scope: "global" }> {
  const route = parseChannelProgramRouteRunSeed(args.route);
  const selectedCapabilityKeys = assertCanonicalCapabilityKeys(args.selectedCapabilityKeys);
  const definition = args.referenceQualityContract === undefined
    ? mechanicsDefinitionForRoute({
        route,
        selectedCapabilityKeys,
        referenceQualityBinding: args.referenceQualityBinding,
      })
    : (() => {
        if (route.directives.claimMode === "fictional_scenario_no_external_claims") {
          return mechanicsDefinitionForRoute({
            route,
            selectedCapabilityKeys,
            referenceQualityBinding: args.referenceQualityBinding,
          });
        }
        const frozen = matchingPreReviewReferenceContract({
          route,
          contract: args.referenceQualityContract,
        });
        const capabilityApplies = sourceDataCapabilityApplies({ route, selectedCapabilityKeys });
        const requirements = frozen.contract.requirements.map(requirementFromReferenceContract);
        if (capabilityApplies) {
          requirements.push({
            id: "source-attributed-data-story-admission",
            area: "story",
            standard:
              "The sealed source-data capability requires a current approved source ledger bound to the narrated numeric claims. This is source-asset provenance only and does not claim final-master shot coverage.",
            verification: "source-data-receipt",
            proofScope: "source_asset",
            evidenceIds: ["approved-data-story-source-ledger"],
          });
        }
        return {
          mechanicsKind: "reference-quality-contract" as const,
          applicableCapabilityKeys: capabilityApplies ? [SOURCE_ATTRIBUTED_DATA_STORY_CAPABILITY] : [],
          referenceContractFingerprint: frozen.fingerprint,
          requirements,
        };
      })();
  return definition.requirements
    .filter((requirement) =>
      requirement.verification === "reviewer-confirmed" &&
      requirement.evidenceIds.some((evidenceId) =>
        [
          "reviewer-confirmed-purposeful-change-map",
          "reviewer-confirmed-legible-visual-model",
          "reviewer-confirmed-stable-visual-language",
        ].includes(evidenceId),
      ),
    )
    .map((requirement) => ({
      id: requirement.id,
      criterion: requirement.standard,
      scope: "global" as const,
    }));
}
