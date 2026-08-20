import { sha256Hex } from "@/lib/sha256";

import { z } from "zod";

import {
  CasefileEvidenceShotMapAdmissionReceiptSchema,
  CasefileEvidenceShotMapSchema,
  type CasefileEvidenceShotMap,
} from "./casefileEvidenceShotMap";
import type { ReferenceQualityContract } from "./creative/types";
import { assertEditorialEvidencePacket } from "./editorialEvidencePacket";
import { SceneManifestSchema } from "./episodeGraph";
import { evaluateNarrativeEvidenceLedger } from "./narrativeEvidenceLedger";
import {
  assertCurrentReferenceMechanicsPacket,
  referenceMechanicsPromptGuidance,
  ReferenceMechanicsPacketSchema,
  type ReferenceMechanicsPacket,
} from "./referenceMechanicsPacket";
import {
  casefileSourcePacketContentFingerprint,
  CasefileSourceAdmissionReceiptSchema,
  CasefileSourcePacketSchema,
} from "./sourceFirstAdmission";
import {
  SourceProofMediaObligationSchema,
  type SourceProofMediaObligation,
} from "./sourceProofMedia";
import { validateSourceBoundStorySpineHandoff } from "./sourceBoundStorySpine";
import { BeatMoodSchema, ShotPlanSchema, type ShotPlan } from "./storySpine";

/**
 * A source-bound cinematic handoff for investigations, disasters, fraud, and
 * historical cases. It deliberately plans edited coverage rather than asking
 * one video-generation prompt to invent story, blocking, continuity, and
 * camera work at once.
 *
 * It is not a channel family and cannot authorize publication. A human editor
 * supplies and signs this treatment after the Casefile source/shot-map gates.
 */
export const CINEMATIC_CASE_SEQUENCE_VERSION = "cinematic-case-sequence/v1" as const;
export const CINEMATIC_CASE_SEQUENCE_ADMISSION_VERSION =
  "cinematic-case-sequence-admission/v1" as const;
export const CINEMATIC_CASE_SEQUENCE_REVIEW_MAX_AGE_DAYS = 30;

const REVIEW_MAX_AGE_MS = CINEMATIC_CASE_SEQUENCE_REVIEW_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const identifier = (prefix: string) =>
  z.string().regex(
    new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]{1,119}$`),
    `expected ${prefix}- prefixed identifier`,
  );
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const CameraMoveSchema = z.enum([
  "static", "dolly_push", "dolly_pull", "crane_up", "crane_down",
  "orbit_left", "orbit_right", "truck_left", "truck_right", "handheld_drift",
]);
const ShotScaleSchema = z.enum(["wide", "medium", "close", "extreme_close", "establishing"]);

export const CinematicVisualModeSchema = z.enum([
  "source_proof",
  "spatial_reconstruction",
  "abstract_reenactment",
  "atmosphere",
]);
export type CinematicVisualMode = z.infer<typeof CinematicVisualModeSchema>;

export const CinematicCoveragePurposeSchema = z.enum([
  "spatial_anchor",
  "mannequin_action",
  "relationship",
  "evidence_insert",
  "contradiction",
  "consequence",
  "reaction",
  "aftermath",
]);
export type CinematicCoveragePurpose = z.infer<typeof CinematicCoveragePurposeSchema>;

export const CinematicCutReasonSchema = z.enum([
  "new_fact",
  "new_location",
  "new_relationship",
  "physical_action",
  "contradiction",
  "reveal",
  "breath",
]);
export type CinematicCutReason = z.infer<typeof CinematicCutReasonSchema>;

export const CinematicTensionStateSchema = z.enum([
  "question",
  "orientation",
  "pressure",
  "uncertainty",
  "reversal",
  "release",
  "residue",
]);
export type CinematicTensionState = z.infer<typeof CinematicTensionStateSchema>;

export const CinematicNarrativeRoleSchema = z.enum([
  "cold_open",
  "orientation",
  "investigation",
  "contradiction",
  "reveal",
  "aftermath",
  "closing_residue",
  /**
   * A distinct character name-reveal beat: typography identifying a cast
   * member appears before that mannequin is shown in action (see the
   * `nameCardText` field on `CinematicCoverageShotSchema` below and its
   * narrow on-screen-text exception in the `narrativeLock` prompt builder
   * inside `assertCinematicCaseSequence`). Source of truth for
   * `narrativeRole` lives only here — Story Spine (`./storySpine`) has no
   * equivalent enum; its beats/shots carry free-text `purpose`/
   * `coveragePurpose` instead, so there is nothing to duplicate there.
   */
  "introduction",
]);
export type CinematicNarrativeRole = z.infer<typeof CinematicNarrativeRoleSchema>;

/** An original role token, never a likeness of a victim, suspect, or witness. */
export const CinematicMannequinSchema = z
  .object({
    id: identifier("mannequin"),
    role: z.enum(["subject", "investigator", "witness", "unknown"]),
    silhouette: text(180),
    wardrobeSignature: text(320),
    palette: z.array(text(80)).min(1).max(5),
    keyProp: text(160),
    movementProfile: text(180),
    faceless: z.literal(true),
    noLikeness: z.literal(true),
  })
  .strict();
export type CinematicMannequin = z.infer<typeof CinematicMannequinSchema>;

const CinematicCoverageShotSchema = z
  .object({
    id: identifier("cinematic-shot"),
    t0: z.number().finite().nonnegative(),
    t1: z.number().finite().positive(),
    coveragePurpose: CinematicCoveragePurposeSchema,
    visualMode: CinematicVisualModeSchema,
    castIds: z.array(identifier("mannequin")).max(4),
    cameraMove: CameraMoveSchema,
    shotScale: ShotScaleSchema,
    lens: text(120),
    cutReason: CinematicCutReasonSchema,
    tensionState: CinematicTensionStateSchema,
    cameraRationale: text(360),
    narrationPurpose: text(360),
    still: text(1_800),
    motion: text(1_200),
    negative: text(700),
    firstFrameConstraint: text(700),
    lastFrameConstraint: text(700),
    onScreenCitation: z.literal(true),
    reconstructionDisclosure: text(220).optional(),
    /**
     * NARROW on-screen-typography exception. Every other narrative role is
     * still governed by the "never render this as on-screen text" prompt
     * discipline (see `narrativeLock` in `assertCinematicCaseSequence`
     * below) — this field exists only so a character's introduction can
     * carry a reviewed name-card string, and `evaluateCinematicCaseSequence`
     * rejects it (`name_card_invalid`) on any shot whose parent beat is not
     * `narrativeRole: "introduction"`. Optional so every sequence input
     * authored before this field existed keeps validating unchanged.
     */
    nameCardText: text(120).optional(),
    /** Retired migration field; a free-text search cannot authorize evidence. */
    realImageInsertQuery: text(200).optional(),
    /** Exact approved source asset used instead of LTX for this evidence insert. */
    sourceProofMedia: SourceProofMediaObligationSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.t1 - value.t0 >= 3,
    "cinematic coverage shot must be at least 3 seconds for the locked LTX render profile",
  );
export type CinematicCoverageShot = z.infer<typeof CinematicCoverageShotSchema>;

/**
 * The source-bound answer or reframe that earns the cold open.  It is kept on
 * the later reveal rather than inferred from prompt prose so the story turn
 * survives planning, human review, rendering, and final-master QA.
 */
export const CinematicStoryPayoffSchema = z
  .object({
    coldOpenBeatId: identifier("cinematic-beat"),
    answerOrReframe: text(400),
    citedClaimIds: z.array(identifier("claim")).min(1).max(24),
    citedSourceIds: z.array(identifier("source")).min(1).max(24),
  })
  .strict();
export type CinematicStoryPayoff = z.infer<typeof CinematicStoryPayoffSchema>;

const CinematicSequenceBeatSchema = z
  .object({
    id: identifier("cinematic-beat"),
    narrativeRole: CinematicNarrativeRoleSchema,
    t0: z.number().finite().nonnegative(),
    t1: z.number().finite().positive(),
    parentShotIds: z.array(identifier("shot")).min(1).max(24),
    claimIds: z.array(identifier("claim")).min(1).max(24),
    sourceIds: z.array(identifier("source")).min(1).max(24),
    causalQuestion: text(400),
    /**
     * Optional bounded per-beat mood tag (same enum as Story Spine's beat/
     * shot mood — see `BeatMoodSchema` in `./storySpine`, the single source
     * of truth for this value set). DATA ONLY: no mood-to-music-section
     * selection logic consumes it yet; that is future work. Optional so
     * every existing sequence input that predates this field keeps
     * validating unchanged.
     */
    mood: BeatMoodSchema.optional(),
    /** Present only when this reveal explicitly pays off the opening question. */
    storyPayoff: CinematicStoryPayoffSchema.optional(),
    shots: z.array(CinematicCoverageShotSchema).min(2).max(4),
  })
  .strict()
  .refine((value) => value.t1 > value.t0, "cinematic beat must have positive duration");
export type CinematicSequenceBeat = z.infer<typeof CinematicSequenceBeatSchema>;

export const CinematicSequenceEditorialReviewSchema = z
  .object({
    id: identifier("cinematic-sequence-review"),
    decision: z.literal("approved"),
    reviewerId: identifier("reviewer"),
    reviewedAt: z.string().datetime({ offset: true }),
    reviewedSourcePacketFingerprint: fingerprint,
    reviewedEvidenceShotMapFingerprint: fingerprint,
    reviewedSequenceFingerprint: fingerprint,
  })
  .strict();

export const CinematicCaseSequenceInputSchema = z
  .object({
    version: z.literal(CINEMATIC_CASE_SEQUENCE_VERSION),
    sequenceId: identifier("cinematic-sequence"),
    caseId: identifier("case"),
    sourcePacketFingerprint: fingerprint,
    evidenceShotMapFingerprint: fingerprint,
    sceneManifestFingerprint: fingerprint,
    shotPlanFingerprint: fingerprint,
    cast: z.array(CinematicMannequinSchema).min(1).max(8),
    beats: z.array(CinematicSequenceBeatSchema).min(1).max(500),
    /**
     * Optional human-reviewed craft mechanics. When present, it is part of
     * the signed sequence content and is propagated into the actual LTX
     * still/motion prompts and final-master QA provenance.
     */
    referenceMechanicsPacket: ReferenceMechanicsPacketSchema.optional(),
    /** Optional reviewed factual-semantics rail; its full packet is revalidated at admission. */
    narrativeEvidenceLedgerFingerprint: fingerprint.optional(),
    editorialReview: CinematicSequenceEditorialReviewSchema,
  })
  .strict();
export type CinematicCaseSequenceInput = z.infer<typeof CinematicCaseSequenceInputSchema>;
export type CinematicCaseSequenceContent = Omit<CinematicCaseSequenceInput, "editorialReview">;

/** Review itself is excluded from the content it signs. */
export const CinematicCaseSequenceContentSchema = CinematicCaseSequenceInputSchema
  .omit({ editorialReview: true })
  .strict();

export const CinematicGeneratedSceneSchema = z
  .object({
    id: identifier("cinematic-shot"),
    sequenceBeatId: identifier("cinematic-beat"),
    parentShotIds: z.array(identifier("shot")).min(1),
    claimIds: z.array(identifier("claim")).min(1),
    sourceIds: z.array(identifier("source")).min(1),
    t0: z.number().finite().nonnegative(),
    t1: z.number().finite().positive(),
    still: text(1_800),
    /** A separately generated target for LTX's final conditioned frame. */
    terminalStill: text(1_800).optional(),
    /** Retired; generated scenes must not carry a free-text image search. */
    realImageInsertQuery: text(200).optional(),
    /** Exact source/right/asset obligation for a non-LTX evidence insert. */
    sourceProofMedia: SourceProofMediaObligationSchema.optional(),
    motion: text(1_200),
    /** Shot-specific physical sound direction; final narration is mixed separately. */
    diegeticSoundscape: text(900),
    durationSec: z.number().finite().min(3).max(10),
    cameraMove: CameraMoveSchema,
    shotScale: ShotScaleSchema,
    lens: text(120),
    negative: text(700),
    visualMode: CinematicVisualModeSchema,
    coveragePurpose: CinematicCoveragePurposeSchema,
    cutReason: CinematicCutReasonSchema,
    tensionState: CinematicTensionStateSchema,
    castIds: z.array(identifier("mannequin")).max(4),
    /** Stable image-generation prior shared by the same reviewed mannequin cast. */
    continuitySeed: z.number().int().min(1).max(2_147_483_647),
  })
  .strict()
  .refine(
    (value) => value.t1 - value.t0 >= 3,
    "generated cinematic scene must be at least 3 seconds for the locked LTX render profile",
  );
export type CinematicGeneratedScene = z.infer<typeof CinematicGeneratedSceneSchema>;

export const CinematicGeneratedScenePlanSchema = z
  .object({
    version: z.literal(CINEMATIC_CASE_SEQUENCE_VERSION),
    sequenceFingerprint: fingerprint,
    sourcePacketFingerprint: fingerprint,
    evidenceShotMapFingerprint: fingerprint,
    /** Optional review-only craft packet; it never authorizes a render by itself. */
    referenceMechanicsPacketFingerprint: fingerprint.optional(),
    narrativeEvidenceLedgerFingerprint: fingerprint.optional(),
    durationSec: z.number().finite().positive(),
    scenes: z.array(CinematicGeneratedSceneSchema).min(2).max(2_000),
    release: z.literal("private_human_editorial_review_only"),
  })
  .strict();
export type CinematicGeneratedScenePlan = z.infer<typeof CinematicGeneratedScenePlanSchema>;

export const CinematicCreativeLocksSchema = z
  .object({
    version: z.literal(CINEMATIC_CASE_SEQUENCE_VERSION),
    sequenceFingerprint: fingerprint,
    /** Preserves mechanics provenance into final-master QA without any source comparison. */
    referenceMechanicsPacketFingerprint: fingerprint.optional(),
    narrativeEvidenceLedgerFingerprint: fingerprint.optional(),
    locks: z.array(z.object({
      id: identifier("cinematic-shot"),
      startSec: z.number().finite().nonnegative(),
      endSec: z.number().finite().positive(),
      expected: text(1_400),
      acceptanceCriteria: z.array(text(360)).min(4).max(10),
    }).strict()).min(2).max(2_000),
  })
  .strict();
export type CinematicCreativeLocks = z.infer<typeof CinematicCreativeLocksSchema>;

export const CinematicEditDecisionListSchema = z
  .object({
    version: z.literal(CINEMATIC_CASE_SEQUENCE_VERSION),
    sequenceFingerprint: fingerprint,
    referenceMechanicsPacketFingerprint: fingerprint.optional(),
    narrativeEvidenceLedgerFingerprint: fingerprint.optional(),
    durationSec: z.number().finite().positive(),
    edits: z.array(z.object({
      shotId: identifier("cinematic-shot"),
      t0: z.number().finite().nonnegative(),
      t1: z.number().finite().positive(),
      cutReason: CinematicCutReasonSchema,
      tensionState: CinematicTensionStateSchema,
      narrationPurpose: text(360),
    }).strict()).min(2).max(2_000),
  })
  .strict();
export type CinematicEditDecisionList = z.infer<typeof CinematicEditDecisionListSchema>;

export const CinematicCaseSequencePlanSchema = CinematicCaseSequenceInputSchema
  .extend({
    contentFingerprint: fingerprint,
    release: z.literal("private_human_editorial_review_only"),
    requiresHumanEditorialReview: z.literal(true),
  })
  .strict();
export type CinematicCaseSequencePlan = z.infer<typeof CinematicCaseSequencePlanSchema>;

export const CinematicCaseSequenceAdmissionReceiptSchema = z
  .object({
    version: z.literal(CINEMATIC_CASE_SEQUENCE_ADMISSION_VERSION),
    sequenceId: identifier("cinematic-sequence"),
    caseId: identifier("case"),
    sourcePacketFingerprint: fingerprint,
    evidenceShotMapFingerprint: fingerprint,
    narrativeEvidenceLedgerFingerprint: fingerprint.optional(),
    sequenceFingerprint: fingerprint,
    generatedSceneCount: z.number().int().min(2),
    release: z.literal("private_human_editorial_review_only"),
    requiresHumanEditorialReview: z.literal(true),
  })
  .strict();
export type CinematicCaseSequenceAdmissionReceipt = z.infer<typeof CinematicCaseSequenceAdmissionReceiptSchema>;

export const CinematicCaseSequenceIssueCodeSchema = z.enum([
  "sequence_input_invalid",
  "source_admission_invalid",
  "evidence_shot_map_invalid",
  "scene_manifest_invalid",
  "shot_plan_invalid",
  "upstream_fingerprint_mismatch",
  "cast_invalid",
  "beat_coverage_invalid",
  "claim_binding_invalid",
  "visual_mode_invalid",
  "coverage_grammar_invalid",
  "tension_grammar_invalid",
  "story_payoff_invalid",
  "camera_repetition_invalid",
  "reference_mechanics_invalid",
  "editorial_review_mismatch",
  "editorial_review_stale",
  "name_card_invalid",
  "real_image_insert_invalid",
  "source_proof_media_invalid",
  "narrative_evidence_ledger_invalid",
]);
export type CinematicCaseSequenceIssueCode = z.infer<typeof CinematicCaseSequenceIssueCodeSchema>;

export interface CinematicCaseSequenceIssue {
  code: CinematicCaseSequenceIssueCode;
  message: string;
  remediation: string;
}

export interface CinematicCaseSequenceAdmissionReport {
  safe: boolean;
  issues: CinematicCaseSequenceIssue[];
}

export interface AdmittedCinematicCaseSequence {
  plan: CinematicCaseSequencePlan;
  generatedScenePlan: CinematicGeneratedScenePlan;
  creativeLocks: CinematicCreativeLocks;
  editDecisionList: CinematicEditDecisionList;
  receipt: CinematicCaseSequenceAdmissionReceipt;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function cinematicCaseSequenceContentFingerprint(
  input: CinematicCaseSequenceContent | CinematicCaseSequenceInput,
): string {
  const content = "editorialReview" in input
    ? (({ editorialReview: _editorialReview, ...withoutReview }) => {
        void _editorialReview;
        return withoutReview;
      })(input)
    : input;
  return hash(CinematicCaseSequenceContentSchema.parse(content));
}

/**
 * Preserve the same deterministic image prior whenever an approved mannequin
 * cast recurs, while letting non-cast evidence/atmosphere shots compose
 * independently. Prompts still carry every per-shot camera/action lock; the
 * seed is an additional continuity control, never a substitute for review.
 */
export function cinematicContinuitySeed(
  sequenceFingerprint: string,
  castIds: readonly string[],
  sceneId: string,
): number {
  const subject = castIds.length
    ? `cast:${[...castIds].sort().join("|")}`
    : `scene:${sceneId}`;
  const hex = sha256Hex(`cinematic-continuity-seed/v1\n${sequenceFingerprint}\n${subject}`)
    .slice(0, 8);
  return Math.max(1, parseInt(hex, 16) & 0x7fff_ffff);
}

function issue(
  code: CinematicCaseSequenceIssueCode,
  message: string,
  remediation: string,
): CinematicCaseSequenceIssue {
  return { code, message, remediation };
}

function uniqueIssues(issues: readonly CinematicCaseSequenceIssue[]): CinematicCaseSequenceIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.code}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ledgerTreatmentsForVisualMode(mode: CinematicVisualMode): Set<string> {
  switch (mode) {
    case "source_proof":
      return new Set(["source_proof", "data_diagram", "map_timeline", "document_abstraction"]);
    case "abstract_reenactment":
      return new Set(["neutral_reenactment"]);
    case "spatial_reconstruction":
    case "atmosphere":
      return new Set(["ambient_context"]);
  }
}

/**
 * Optional factual-semantics bridge.  It is deliberately evaluated only when
 * a sequence carries the ledger fingerprint: legacy Casefile review packets
 * remain valid, while a ledger-bearing sequence cannot silently drop its
 * reviewed claim/source/treatment limits before a renderer is admitted.
 */
function validateNarrativeEvidenceLedgerBinding(args: {
  input: CinematicCaseSequenceInput;
  ledger: unknown;
  sourcePacket: unknown;
  evidenceShotMap: CasefileEvidenceShotMap;
  sourceBoundStorySpine: unknown;
  editorialEvidencePacket?: unknown;
  now: number;
}): string[] {
  const report = evaluateNarrativeEvidenceLedger(args.ledger, args.now);
  if (!report.safe || !report.ledger) {
    return [`Narrative Evidence Ledger is invalid: ${report.issues.map((entry) => entry.message).join("; ")}`];
  }
  const ledger = report.ledger;
  const issues: string[] = [];
  if (args.input.narrativeEvidenceLedgerFingerprint !== ledger.contentFingerprint) {
    issues.push("the signed cinematic sequence does not carry this exact Narrative Evidence Ledger fingerprint");
  }
  const sourcePacket = CasefileSourcePacketSchema.safeParse(args.sourcePacket);
  if (!sourcePacket.success) {
    issues.push("the Narrative Evidence Ledger requires the exact current Casefile source packet");
    return issues;
  }
  if (casefileSourcePacketContentFingerprint(sourcePacket.data) !== args.input.sourcePacketFingerprint) {
    issues.push("the supplied Casefile source packet no longer matches the source-packet fingerprint signed by this cinematic sequence");
  }
  let handoff: ReturnType<typeof validateSourceBoundStorySpineHandoff>;
  try {
    handoff = validateSourceBoundStorySpineHandoff(args.sourceBoundStorySpine);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "source-bound Story Spine handoff is invalid");
    return issues;
  }
  if (
    handoff.caseId !== args.input.caseId ||
    handoff.sourcePacketFingerprint !== args.input.sourcePacketFingerprint ||
    handoff.evidenceShotMapFingerprint !== args.input.evidenceShotMapFingerprint ||
    handoff.storySpineShotPlanFingerprint !== args.input.shotPlanFingerprint
  ) {
    issues.push("the source-bound Story Spine does not match the Casefile/source/map/ShotPlan signed by this cinematic sequence");
  }

  const knownCasefileSources = new Set(sourcePacket.data.sourceUsage.map((entry) => entry.sourceId));
  const knownCasefileClaims = new Set(sourcePacket.data.claimPrimarySources.map((entry) => entry.claimId));
  const casefileRails = ledger.evidenceRails.filter((rail) => rail.kind === "casefile_source_packet");
  if (casefileRails.length !== 1) {
    issues.push("a Casefile cinematic ledger requires exactly one casefile_source_packet rail");
  }
  for (const rail of casefileRails) {
    if (rail.packetFingerprint !== args.input.sourcePacketFingerprint) {
      issues.push(`Casefile rail ${rail.id} does not match the signed Casefile source packet`);
    }
    if (rail.sourceIds.some((id) => !knownCasefileSources.has(id)) || rail.upstreamClaimIds.some((id) => !knownCasefileClaims.has(id))) {
      issues.push(`Casefile rail ${rail.id} contains a source or claim outside the current reviewed source packet`);
    }
  }

  const editorialRails = ledger.evidenceRails.filter((rail) => rail.kind === "editorial_evidence_packet");
  if (editorialRails.length) {
    if (args.editorialEvidencePacket === undefined) {
      issues.push("an editorial_evidence_packet rail requires the exact reviewed Editorial Evidence Packet at cinematic admission");
    } else {
      try {
        const packet = assertEditorialEvidencePacket(args.editorialEvidencePacket, args.now);
        const sourceIds = new Set(packet.sources.map((source) => source.id));
        const claimIds = new Set(packet.claims.map((claim) => claim.id));
        for (const rail of editorialRails) {
          if (rail.packetFingerprint !== packet.contentFingerprint || rail.sourceIds.some((id) => !sourceIds.has(id)) || rail.upstreamClaimIds.some((id) => !claimIds.has(id))) {
            issues.push(`editorial rail ${rail.id} does not match the supplied reviewed Editorial Evidence Packet`);
          }
        }
      } catch (error) {
        issues.push(error instanceof Error ? error.message : "Editorial Evidence Packet is invalid");
      }
    }
  }

  const bindingsByClaim = new Map(handoff.claimBindings.map((binding) => [binding.claimId, binding]));
  const casefileRailIds = new Set(casefileRails.map((rail) => rail.id));
  for (const ledgerClaim of ledger.claims) {
    const supports = ledgerClaim.supports.filter((support) => casefileRailIds.has(support.railId));
    if (!supports.length) {
      issues.push(`ledger claim ${ledgerClaim.id} has no Casefile source support`);
      continue;
    }
    for (const support of supports) {
      for (const upstreamClaimId of support.upstreamClaimIds) {
        const binding = bindingsByClaim.get(upstreamClaimId);
        const mapClaim = args.evidenceShotMap.claimMappings.find((mapping) => mapping.claimId === upstreamClaimId);
        const mapHasExactSources = mapClaim?.bindings.some((binding) =>
          support.sourceIds.every((sourceId) => binding.sourceIds.includes(sourceId)),
        ) ?? false;
        if (!binding || !mapHasExactSources || support.sourceIds.some((sourceId) => !binding.sourceIds.includes(sourceId))) {
          issues.push(`ledger claim ${ledgerClaim.id} cannot be traced to an exact reviewed source-bound Story Spine claim/shot`);
        }
      }
    }
  }
  for (const beat of args.input.beats) {
    for (const casefileClaimId of beat.claimIds) {
      const supportingLedgerClaims = ledger.claims.filter((ledgerClaim) =>
        ledgerClaim.supports.some((support) =>
          casefileRailIds.has(support.railId) &&
          support.upstreamClaimIds.includes(casefileClaimId) &&
          beat.sourceIds.every((sourceId) => support.sourceIds.includes(sourceId)),
        ),
      );
      if (!supportingLedgerClaims.length) {
        issues.push(`cinematic beat ${beat.id} claim ${casefileClaimId} is not covered by an exact reviewed Narrative Evidence Ledger support`);
        continue;
      }
      for (const shot of beat.shots) {
        const allowed = ledgerTreatmentsForVisualMode(shot.visualMode);
        if (!supportingLedgerClaims.some((claim) => claim.allowedVisualTreatments.some((treatment) => allowed.has(treatment.kind)))) {
          issues.push(`cinematic shot ${shot.id} uses ${shot.visualMode} beyond the Narrative Evidence Ledger's allowed visual treatments`);
        }
      }
    }
  }
  return [...new Set(issues)];
}

function parseReviewedAt(value: string): Date | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

function compatibleMapBindingsFor(
  map: CasefileEvidenceShotMap,
  claimId: string,
  parentShotIds: readonly string[],
  sourceIds: readonly string[],
) {
  const mapping = map.claimMappings.find((entry) => entry.claimId === claimId);
  return (mapping?.bindings ?? []).filter((binding) =>
    binding.onScreenCitation &&
    binding.shotIds.some((id) => parentShotIds.includes(id)) &&
    binding.sourceIds.some((id) => sourceIds.includes(id)),
  );
}

function modeAllowedByBinding(
  mode: CinematicVisualMode,
  binding: ReturnType<typeof compatibleMapBindingsFor>[number],
  disclosure?: string,
): boolean {
  if (mode === "source_proof") {
    return binding.treatment === "map" || binding.treatment === "timeline" || binding.treatment === "document_abstraction";
  }
  if (mode === "spatial_reconstruction") {
    return binding.treatment === "map" || binding.treatment === "timeline" || binding.treatment === "neutral_reenactment";
  }
  if (mode === "abstract_reenactment") {
    return binding.treatment === "neutral_reenactment" && Boolean(disclosure) && disclosure === binding.reconstructionDisclosure;
  }
  // Atmospheric plates can support a beat only when the sourced citation stays
  // on-screen; they are never evidence by themselves.
  return binding.onScreenCitation;
}

function parentWindow(parentShots: readonly ShotPlan[], ids: readonly string[]): { t0: number; t1: number } | undefined {
  const matches = parentShots.filter((shot) => ids.includes(shot.id));
  if (matches.length !== ids.length) return undefined;
  return { t0: Math.min(...matches.map((shot) => shot.t0)), t1: Math.max(...matches.map((shot) => shot.t1)) };
}

function strictCoverage(
  shots: readonly CinematicCoverageShot[],
  t0: number,
  t1: number,
): boolean {
  const ordered = [...shots].sort((left, right) => left.t0 - right.t0 || left.id.localeCompare(right.id));
  let cursor = t0;
  for (const shot of ordered) {
    if (Math.abs(shot.t0 - cursor) > 0.03) return false;
    cursor = shot.t1;
  }
  return Math.abs(cursor - t1) <= 0.03;
}

function isSubset(values: readonly string[], allowed: readonly string[]): boolean {
  const allowedIds = new Set(allowed);
  return values.every((value) => allowedIds.has(value));
}

function normalizedStoryText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function requiredScales(role: CinematicNarrativeRole): number {
  return role === "cold_open" || role === "investigation" || role === "contradiction" || role === "reveal" ? 3 : 2;
}

export function evaluateCinematicCaseSequence(
  args: {
    input: unknown;
    /** Required only when a signed source-proof media obligation is present. */
    sourcePacket?: unknown;
    sourceAdmission: unknown;
    evidenceShotMap: unknown;
    evidenceShotMapAdmission: unknown;
    sceneManifest: unknown;
    shotList: unknown;
    /** Optional; a supplied packet must bind the current contract and ShotPlan. */
    referenceMechanicsPacket?: unknown;
    referenceQuality?: ReferenceQualityContract;
    /** Optional only with a matching signed sequence fingerprint; never a renderer authority. */
    narrativeEvidenceLedger?: unknown;
    editorialEvidencePacket?: unknown;
    sourceBoundStorySpine?: unknown;
  },
  options: { now?: Date } = {},
): CinematicCaseSequenceAdmissionReport {
  const parsedInput = CinematicCaseSequenceInputSchema.safeParse(args.input);
  if (!parsedInput.success) {
    return { safe: false, issues: [issue("sequence_input_invalid", "The cinematic sequence input is invalid.", "Provide a complete, reviewer-ready sequence input with cast, causal beats, and coverage shots.")] };
  }
  const input = parsedInput.data;
  const issues: CinematicCaseSequenceIssue[] = [];
  const inputReferenceMechanicsPacket = input.referenceMechanicsPacket;
  const suppliedReferenceMechanicsPacket = inputReferenceMechanicsPacket ?? args.referenceMechanicsPacket;
  if (
    inputReferenceMechanicsPacket !== undefined &&
    args.referenceMechanicsPacket !== undefined
  ) {
    const externalPacket = ReferenceMechanicsPacketSchema.safeParse(args.referenceMechanicsPacket);
    if (
      !externalPacket.success ||
      externalPacket.data.contentFingerprint !== inputReferenceMechanicsPacket.contentFingerprint
    ) {
      issues.push(issue(
        "reference_mechanics_invalid",
        "The input-bound Reference Mechanics packet conflicts with the separately supplied packet.",
        "Keep one reviewed mechanics packet on the signed cinematic sequence, or supply the exact same packet through both compatibility paths.",
      ));
    }
  }
  if (suppliedReferenceMechanicsPacket !== undefined || args.referenceQuality !== undefined) {
    if (suppliedReferenceMechanicsPacket === undefined || !args.referenceQuality) {
      issues.push(issue(
        "reference_mechanics_invalid",
        "Reference mechanics require both the reviewed packet and its current attributed ReferenceQuality contract.",
        "Supply both artifacts together, or omit both; this optional review aid must never silently fall back to an unbound style prompt.",
      ));
    } else {
      try {
        assertCurrentReferenceMechanicsPacket({
          packet: suppliedReferenceMechanicsPacket,
          referenceQuality: args.referenceQuality,
          shotList: args.shotList,
          now: options.now,
        });
      } catch (error) {
        issues.push(issue(
          "reference_mechanics_invalid",
          error instanceof Error ? error.message : "The reference mechanics packet is invalid.",
          "Refresh the human-reviewed, source-attributed mechanics packet from the current ReferenceQuality contract and timed Story Spine ShotPlan.",
        ));
      }
    }
  }
  const sourceAdmission = CasefileSourceAdmissionReceiptSchema.safeParse(args.sourceAdmission);
  const evidenceMap = CasefileEvidenceShotMapSchema.safeParse(args.evidenceShotMap);
  const evidenceAdmission = CasefileEvidenceShotMapAdmissionReceiptSchema.safeParse(args.evidenceShotMapAdmission);
  const sceneManifest = SceneManifestSchema.safeParse(args.sceneManifest);
  const shots = z.array(ShotPlanSchema).min(1).max(2_000).safeParse(args.shotList);
  // `source_proof` is a factual evidence treatment, not an LTX prompt style.
  // Every such shot must eventually resolve to exact approved source bytes,
  // so parse the full source packet whenever a sequence claims source proof—
  // not only when an optional receipt happened to be supplied already.
  const requiresSourceProofMedia = input.beats.some((beat) =>
    beat.shots.some((shot) => shot.visualMode === "source_proof"),
  );
  const sourcePacket = requiresSourceProofMedia
    ? CasefileSourcePacketSchema.safeParse(args.sourcePacket)
    : undefined;
  if (!sourceAdmission.success) issues.push(issue("source_admission_invalid", "A valid source-first Casefile admission receipt is required.", "Run casefile_source_packet and supply its unmodified private-review receipt."));
  if (requiresSourceProofMedia && !sourcePacket?.success) {
    issues.push(issue(
      "source_proof_media_invalid",
      "A signed source-proof image requires the current Casefile source packet, not only its summary admission receipt.",
      "Carry casefileSourcePacket through the cinematic handoff so the exact source usage, asset id, and rights locator can be rechecked before rendering.",
    ));
  }
  if (!evidenceMap.success || !evidenceAdmission.success) issues.push(issue("evidence_shot_map_invalid", "A valid admitted Casefile evidence shot map and receipt are required.", "Run casefile_evidence_shot_map against the current source packet and planning artifacts."));
  if (!sceneManifest.success) issues.push(issue("scene_manifest_invalid", "A validated Scene Manifest is required.", "Compile the active Episode Graph before sequence planning."));
  if (!shots.success) issues.push(issue("shot_plan_invalid", "A validated Story Spine ShotPlan list is required.", "Run story_spine and pass its complete current shot list."));
  if (
    !sourceAdmission.success ||
    !evidenceMap.success ||
    !evidenceAdmission.success ||
    !sceneManifest.success ||
    !shots.success ||
    (requiresSourceProofMedia && !sourcePacket?.success)
  ) {
    return { safe: false, issues: uniqueIssues(issues) };
  }

  const map = evidenceMap.data;
  const admission = evidenceAdmission.data;
  const source = sourceAdmission.data;
  const usesNarrativeEvidenceLedger =
    input.narrativeEvidenceLedgerFingerprint !== undefined || args.narrativeEvidenceLedger !== undefined;
  if (usesNarrativeEvidenceLedger) {
    if (input.narrativeEvidenceLedgerFingerprint === undefined || args.narrativeEvidenceLedger === undefined || args.sourceBoundStorySpine === undefined) {
      issues.push(issue(
        "narrative_evidence_ledger_invalid",
        "Narrative Evidence Ledger use requires a signed ledger fingerprint, the exact ledger, and the current source-bound Story Spine handoff.",
        "Keep the reviewed ledger fingerprint in the signed sequence and carry the exact ledger plus current source-bound Story Spine through cinematic admission.",
      ));
    } else {
      for (const message of validateNarrativeEvidenceLedgerBinding({
        input,
        ledger: args.narrativeEvidenceLedger,
        sourcePacket: args.sourcePacket,
        evidenceShotMap: map,
        sourceBoundStorySpine: args.sourceBoundStorySpine,
        editorialEvidencePacket: args.editorialEvidencePacket,
        now: (options.now ?? new Date()).getTime(),
      })) {
        issues.push(issue(
          "narrative_evidence_ledger_invalid",
          message,
          "Repair the reviewed ledger's source/claim/Story Spine bindings or visual-treatment allowance, then obtain a fresh cinematic editorial signature.",
        ));
      }
    }
  }
  if (
    input.caseId !== source.caseId ||
    input.caseId !== map.caseId ||
    input.sourcePacketFingerprint !== source.sourcePacketFingerprint ||
    input.sourcePacketFingerprint !== map.sourcePacketFingerprint ||
    input.evidenceShotMapFingerprint !== map.contentFingerprint ||
    input.evidenceShotMapFingerprint !== admission.evidenceShotMapFingerprint ||
    input.sceneManifestFingerprint !== sceneManifest.data.fingerprint ||
    input.sceneManifestFingerprint !== map.sceneManifestFingerprint ||
    input.shotPlanFingerprint !== map.shotPlanFingerprint ||
    input.shotPlanFingerprint !== admission.shotPlanFingerprint
  ) {
    issues.push(issue("upstream_fingerprint_mismatch", "The cinematic sequence does not bind the exact admitted source/map/scene/shot planning artifacts.", "Regenerate the sequence from the current Casefile source packet, evidence map, Scene Manifest, and Story Spine; then obtain fresh review."));
  }
  if (
    sourcePacket?.success &&
    casefileSourcePacketContentFingerprint(sourcePacket.data) !== source.sourcePacketFingerprint
  ) {
    issues.push(issue(
      "upstream_fingerprint_mismatch",
      "The supplied Casefile source packet does not match the admission receipt bound to this cinematic sequence.",
      "Use the unmodified current casefileSourcePacket output and obtain a fresh source-proof-media approval after any packet change.",
    ));
  }
  if (!admission.visualSafetyPolicy.noGore || !admission.visualSafetyPolicy.noUnsupportedRecreation) {
    issues.push(issue("upstream_fingerprint_mismatch", "The upstream Casefile visual-safety policy is not intact.", "Do not sequence a case until the admitted evidence map explicitly requires no gore and no unsupported recreation."));
  }

  const castById = new Map<string, CinematicMannequin>();
  const wardrobeTokens = new Set<string>();
  for (const mannequin of input.cast) {
    if (castById.has(mannequin.id)) {
      issues.push(issue("cast_invalid", `Mannequin ${mannequin.id} is declared more than once.`, "Give each anonymous role one stable cast token."));
    }
    castById.set(mannequin.id, mannequin);
    const wardrobe = mannequin.wardrobeSignature.toLowerCase().replace(/\s+/g, " ");
    if (wardrobeTokens.has(wardrobe)) {
      issues.push(issue("cast_invalid", "Two mannequin roles share an identical wardrobe signature.", "Give every recurring role a distinct wardrobe/silhouette cue so the audience can follow the causal scene without faces."));
    }
    wardrobeTokens.add(wardrobe);
  }

  const shotById = new Map(shots.data.map((shot) => [shot.id, shot]));
  const seenParentShots = new Set<string>();
  const seenClaims = new Set<string>();
  const allCinematicShots: CinematicCoverageShot[] = [];
  const orderedBeats = [...input.beats].sort((left, right) => left.t0 - right.t0 || left.id.localeCompare(right.id));
  // A source-bound shot map proves what may be shown; it does not by itself
  // prove that the episode opens with a question and earns a payoff. Enforce a
  // small, reusable story curve before grading individual shots.
  if (orderedBeats[0]?.narrativeRole !== "cold_open") {
    issues.push(issue("tension_grammar_invalid", "The cinematic sequence does not start with a cold-open causal question.", "Begin with one concrete unresolved fact, threat, or contradiction before orientation or explanation."));
  }
  const coldOpen = orderedBeats[0];
  if (coldOpen?.narrativeRole === "cold_open") {
    // The Casefile reference standard is an evidence-led hook, not an
    // unsupported drama montage. Every coverage shot already carries a
    // citation; require a real source-object insert early enough for that
    // citation to earn the opening question before reconstruction takes over.
    const sourceObjectDeadlineSec = Math.min(coldOpen.t1, coldOpen.t0 + 8);
    const hasEarlySourceObject = coldOpen.shots.some((shot) =>
      shot.t0 < sourceObjectDeadlineSec &&
      shot.coveragePurpose === "evidence_insert" &&
      shot.visualMode === "source_proof" &&
      shot.sourceProofMedia !== undefined,
    );
    if (!hasEarlySourceObject) {
      issues.push(issue(
        "coverage_grammar_invalid",
        "The cold open lacks an exact approved source-proof evidence insert in its first eight seconds.",
        "Use an approved source document, object, map, or timeline asset that establishes the opening question before relying on reconstruction or atmosphere.",
      ));
    }
  }
  for (const beat of orderedBeats.slice(1)) {
    if (beat.narrativeRole === "cold_open") {
      issues.push(issue("tension_grammar_invalid", `Cinematic beat ${beat.id} restarts the cold open after the story has begun.`, "Keep a single opening question; use investigation, contradiction, reveal, aftermath, or closing residue for later turns."));
    }
  }
  const revealBeats = orderedBeats.filter((beat) => beat.narrativeRole === "reveal");
  for (const beat of orderedBeats) {
    if (beat.narrativeRole !== "reveal" && beat.storyPayoff) {
      issues.push(issue("story_payoff_invalid", `Cinematic beat ${beat.id} declares a storyPayoff without being a reveal.`, "Keep storyPayoff only on the later reveal that visibly answers or reframes the cold-open question."));
    }
  }
  if (!revealBeats.length) {
    issues.push(issue("story_payoff_invalid", "The cinematic sequence has no later cited reveal that can answer or reframe its cold-open question.", "Add a later reveal beat with a source-proof evidence insert and an explicit storyPayoff bound to the cold open."));
  }
  if (coldOpen?.narrativeRole === "cold_open") {
    const payoffs = revealBeats
      .filter((beat) => Boolean(beat.storyPayoff))
      .map((beat) => ({ beat, payoff: beat.storyPayoff! }));
    if (!payoffs.length) {
      issues.push(issue("story_payoff_invalid", "No later reveal explicitly answers or reframes the cold-open causal question.", "Declare storyPayoff on a later reveal with the cold-open beat id, a concrete answer/reframe, and its admitted claim/source ids."));
    }
    for (const { beat, payoff } of payoffs) {
      if (payoff.coldOpenBeatId !== coldOpen.id) {
        issues.push(issue("story_payoff_invalid", `Reveal ${beat.id} pays off ${payoff.coldOpenBeatId}, not the opening beat ${coldOpen.id}.`, "Bind every declared storyPayoff to the sequence's first cold-open beat."));
      }
      if (beat.t0 < coldOpen.t1 - 0.03) {
        issues.push(issue("story_payoff_invalid", `Reveal ${beat.id} attempts to pay off the cold open before that opening beat has completed.`, "Place the cited reveal after the cold-open narration window rather than overlapping the question."));
      }
      if (normalizedStoryText(payoff.answerOrReframe) === normalizedStoryText(coldOpen.causalQuestion)) {
        issues.push(issue("story_payoff_invalid", `Reveal ${beat.id} repeats the cold-open question instead of answering or reframing it.`, "Write a concrete source-bound answer or reframe; do not restate the opening question."));
      }
      if (!isSubset(payoff.citedClaimIds, beat.claimIds) || !isSubset(payoff.citedSourceIds, beat.sourceIds)) {
        issues.push(issue("story_payoff_invalid", `Reveal ${beat.id}'s storyPayoff cites claim/source ids outside its admitted beat binding.`, "Use only claim and source ids already bound to that reveal beat by the Casefile evidence map."));
      }
      for (const claimId of payoff.citedClaimIds) {
        if (!compatibleMapBindingsFor(map, claimId, beat.parentShotIds, payoff.citedSourceIds).length) {
          issues.push(issue("story_payoff_invalid", `Reveal ${beat.id}'s payoff claim ${claimId} is not source-bound to its declared payoff sources.`, "Bind the payoff claim to the exact cited source ids through casefile_evidence_shot_map before review."));
        }
      }
      if (!beat.shots.some((shot) =>
        shot.coveragePurpose === "evidence_insert" &&
        shot.visualMode === "source_proof" &&
        shot.sourceProofMedia !== undefined &&
        payoff.citedSourceIds.includes(shot.sourceProofMedia.sourceId),
      )) {
        issues.push(issue(
          "story_payoff_invalid",
          `Reveal ${beat.id}'s storyPayoff has no exact approved source-proof asset bound to one of its cited sources.`,
          "Attach an approved sourceProofMedia asset for a cited payoff source; final-master QA must see the real evidence rather than an LTX-generated document approximation.",
        ));
      }
    }
  }
  const finalPlannedShot = orderedBeats.at(-1)?.shots.at(-1);
  if (finalPlannedShot && !["release", "residue"].includes(finalPlannedShot.tensionState)) {
    issues.push(issue("tension_grammar_invalid", "The cinematic sequence ends without a release or residue beat.", "End on a deliberate consequence, unresolved residue, or controlled release rather than carrying raw pressure past the final narration."));
  }
  let beatCursor = 0;
  for (const beat of orderedBeats) {
    if (Math.abs(beat.t0 - beatCursor) > 0.03) {
      issues.push(issue("beat_coverage_invalid", `Cinematic beat ${beat.id} does not begin at the preceding planned boundary.`, "Keep cinematic beats contiguous with the source Story Spine; do not create un-narrated gaps or overlap."));
    }
    beatCursor = beat.t1;
    const parent = parentWindow(shots.data, beat.parentShotIds);
    if (!parent || Math.abs(parent.t0 - beat.t0) > 0.03 || Math.abs(parent.t1 - beat.t1) > 0.03) {
      issues.push(issue("beat_coverage_invalid", `Cinematic beat ${beat.id} does not exactly cover its declared parent Story Spine shot window.`, "Use the exact parent shot ids and timings; split only inside that existing narration window."));
    }
    for (const parentId of beat.parentShotIds) {
      if (seenParentShots.has(parentId)) issues.push(issue("beat_coverage_invalid", `Parent Story Spine shot ${parentId} is sequenced more than once.`, "Assign each source shot to one cinematic sequence beat so edit coverage remains auditable."));
      seenParentShots.add(parentId);
      if (!shotById.has(parentId)) issues.push(issue("beat_coverage_invalid", `Cinematic beat ${beat.id} references missing Story Spine shot ${parentId}.`, "Use only ids from the current Story Spine shot list."));
    }
    if (!strictCoverage(beat.shots, beat.t0, beat.t1)) {
      issues.push(issue("beat_coverage_invalid", `Cinematic beat ${beat.id}'s coverage shots do not continuously fill its narrated time window.`, "Make the ordered 2–4 coverage shots contiguous from beat t0 through t1."));
    }
    const distinctScales = new Set(beat.shots.map((shot) => shot.shotScale));
    if (distinctScales.size < requiredScales(beat.narrativeRole)) {
      issues.push(issue("coverage_grammar_invalid", `Cinematic beat ${beat.id} lacks the required geography/person/evidence scale variation for ${beat.narrativeRole}.`, "Use at least three distinct scales for cold opens, investigations, contradictions, and reveals; use at least two for orientation/aftermath."));
    }
    const purposeSet = new Set(beat.shots.map((shot) => shot.coveragePurpose));
    if ((beat.narrativeRole === "investigation" || beat.narrativeRole === "reveal") && !purposeSet.has("evidence_insert")) {
      issues.push(issue("coverage_grammar_invalid", `Cinematic ${beat.narrativeRole} beat ${beat.id} has no evidence insert.`, "Include a cited document/object/map/timeline visual so the turn is proven rather than merely dramatized."));
    }
    // The introduction role exists solely to carry the name-card exception;
    // an introduction beat that declares no on-screen text has no reason to
    // use this role instead of an ordinary orientation/investigation beat.
    if (beat.narrativeRole === "introduction" && !beat.shots.some((shot) => Boolean(shot.nameCardText))) {
      issues.push(issue(
        "name_card_invalid",
        `Introduction beat ${beat.id} declares no on-screen name-card text.`,
        "Give at least one shot in the introduction beat a nameCardText value, or use a non-introduction narrative role when no name reveal is needed.",
      ));
    }
    const tensionStates = new Set(beat.shots.map((shot) => shot.tensionState));
    const cutReasons = new Set(beat.shots.map((shot) => shot.cutReason));
    if (
      beat.narrativeRole === "cold_open" &&
      !["question", "pressure"].includes(beat.shots[0]!.tensionState)
    ) {
      issues.push(issue("tension_grammar_invalid", `Cold open ${beat.id} does not begin on a question or pressure state.`, "Open on a concrete unresolved fact, threat, or contradiction before explanatory coverage."));
    }
    if (beat.narrativeRole === "contradiction" && !cutReasons.has("contradiction")) {
      issues.push(issue("tension_grammar_invalid", `Contradiction beat ${beat.id} has no contradiction-motivated cut.`, "Make the conflicting fact, constraint, or account drive at least one cut."));
    }
    if (
      beat.narrativeRole === "reveal" &&
      (!cutReasons.has("reveal") || ![...tensionStates].some((state) => state === "reversal" || state === "release"))
    ) {
      issues.push(issue("tension_grammar_invalid", `Reveal beat ${beat.id} lacks a reveal cut or reversal/release state.`, "Make the evidence turn visibly and rhythmically reframe the audience's question."));
    }
    if (
      (beat.narrativeRole === "aftermath" || beat.narrativeRole === "closing_residue") &&
      ![...tensionStates].some((state) => state === "release" || state === "residue")
    ) {
      issues.push(issue("tension_grammar_invalid", `Aftermath beat ${beat.id} never resolves into release or residue.`, "Use a deliberate consequence or closing hold; do not end on the same undifferentiated pressure state."));
    }
    for (const claimId of beat.claimIds) {
      seenClaims.add(claimId);
      if (!compatibleMapBindingsFor(map, claimId, beat.parentShotIds, beat.sourceIds).length) {
        issues.push(issue("claim_binding_invalid", `Cinematic beat ${beat.id} cannot trace claim ${claimId} to a compatible admitted source/shot binding.`, "Use a claim, source, and parent shot combination already admitted by casefile_evidence_shot_map."));
      }
    }
    for (const shot of beat.shots) {
      allCinematicShots.push(shot);
      const proofMedia: SourceProofMediaObligation | undefined = shot.sourceProofMedia;
      if (shot.visualMode === "source_proof" && shot.coveragePurpose !== "evidence_insert") {
        issues.push(issue(
          "source_proof_media_invalid",
          `Cinematic shot ${shot.id} uses source_proof outside an evidence_insert coverage purpose.`,
          "Reserve source_proof for a cited evidence_insert; establishers, relationships, and atmosphere must not present generated visuals as factual source media.",
        ));
      }
      if (shot.visualMode === "source_proof" && !proofMedia) {
        issues.push(issue(
          "source_proof_media_invalid",
          `Cinematic shot ${shot.id} declares source_proof without an exact approved source asset receipt.`,
          "Attach sourceProofMedia with the admitted source id, asset id, rights locator, immutable asset SHA-256, and human approval receipt; never render a factual source proof through LTX.",
        ));
      }
      const binding = beat.claimIds
        .flatMap((claimId) => compatibleMapBindingsFor(map, claimId, beat.parentShotIds, beat.sourceIds))
        .find((candidate) => modeAllowedByBinding(shot.visualMode, candidate, shot.reconstructionDisclosure));
      if (!binding || !modeAllowedByBinding(shot.visualMode, binding, shot.reconstructionDisclosure)) {
        issues.push(issue("visual_mode_invalid", `Cinematic shot ${shot.id}'s ${shot.visualMode} mode is not justified by the admitted Casefile treatment.`, "Use source proof for document/map/timeline evidence; use abstract reenactment only on the declared neutral-reenactment path with the exact disclosure."));
      }
      for (const castId of shot.castIds) {
        if (!castById.has(castId)) issues.push(issue("cast_invalid", `Cinematic shot ${shot.id} references unknown mannequin ${castId}.`, "Use only a declared faceless non-likeness cast token."));
      }
      // A mannequin action is a narrow neutral-reenactment treatment. Without
      // this pairing, a planner can label a generic document/map atmosphere
      // shot as `mannequin_action`, satisfy mechanical scale/camera variety,
      // and still send repetitive non-action coverage to LTX.
      const isMannequinAction = shot.coveragePurpose === "mannequin_action";
      const isNeutralMannequinReenactment =
        shot.visualMode === "abstract_reenactment" && shot.castIds.length > 0;
      if (isMannequinAction !== isNeutralMannequinReenactment) {
        issues.push(issue(
          "coverage_grammar_invalid",
          `Cinematic shot ${shot.id} must use mannequin_action exactly for a cast-bound neutral abstract reenactment.`,
          "Use mannequin_action only with abstract_reenactment and a locked faceless mannequin cast; use relationship for documentary, map, timeline, or atmosphere coverage.",
        ));
      }
      if (shot.visualMode === "abstract_reenactment" && shot.castIds.length === 0) {
        issues.push(issue("cast_invalid", `Abstract reenactment shot ${shot.id} has no locked anonymous mannequin cast.`, "Bind abstract reenactment to a declared faceless mannequin token with wardrobe/silhouette/prop/movement locks."));
      }
      // The on-screen-text prohibition is content-safety/citation-integrity
      // policy, not a per-role convenience: nameCardText is the ONE narrow,
      // explicit carve-out (a reviewed character name, nothing else) and it
      // is only legal inside an introduction beat, on a shot that actually
      // introduces a locked mannequin cast member.
      if (shot.nameCardText) {
        if (beat.narrativeRole !== "introduction") {
          issues.push(issue(
            "name_card_invalid",
            `Cinematic shot ${shot.id} carries on-screen name-card text outside an introduction beat.`,
            "Reserve on-screen typography for the narrow character-introduction exception; every other narrative role must stay free of on-screen prose.",
          ));
        }
        if (shot.castIds.length === 0) {
          issues.push(issue(
            "name_card_invalid",
            `Cinematic shot ${shot.id}'s name card has no locked mannequin cast to introduce.`,
            "Bind the introduction name card to the exact faceless mannequin token whose name is being revealed.",
          ));
        }
      }
      // A free-text image search can never prove a factual Casefile claim.
      // Keep the legacy field parseable solely so it has a clear, fail-closed
      // remediation instead of silently reaching an old renderer path.
      if (shot.realImageInsertQuery) {
        issues.push(issue(
          "real_image_insert_invalid",
          `Cinematic shot ${shot.id} uses retired realImageInsertQuery text without an approved source-proof media receipt.`,
          "Replace the query with sourceProofMedia containing the exact admitted source id, asset id, rights locator, immutable asset SHA-256, approval receipt, and provenance fingerprint.",
        ));
      }
      if (proofMedia) {
        if (shot.coveragePurpose !== "evidence_insert") {
          issues.push(issue(
            "source_proof_media_invalid",
            `Cinematic shot ${shot.id}'s approved source media is not an evidence_insert shot.`,
            "Use source-proof media only for a cited evidence_insert; ordinary coverage remains governed by its LTX scene contract.",
          ));
        }
        if (shot.visualMode !== "source_proof") {
          issues.push(issue(
            "source_proof_media_invalid",
            `Cinematic shot ${shot.id}'s approved source media does not use source_proof visual mode.`,
            "An exact external asset may only be rendered on a cited source_proof evidence insert.",
          ));
        }
        if (shot.shotScale !== "extreme_close") {
          issues.push(issue(
            "source_proof_media_invalid",
            `Cinematic shot ${shot.id}'s approved source media is not framed extreme_close.`,
            "Use the source asset as an extreme-close evidence insert, not as generic establishing coverage.",
          ));
        }
        if (shot.castIds.length > 0) {
          issues.push(issue(
            "source_proof_media_invalid",
            `Cinematic shot ${shot.id}'s approved source media carries a mannequin cast.`,
            "A source proof insert is never blended with mannequin-generated coverage; split the shots at the editorial cut.",
          ));
        }
        if (!beat.sourceIds.includes(proofMedia.sourceId)) {
          issues.push(issue(
            "source_proof_media_invalid",
            `Cinematic shot ${shot.id}'s source-proof asset references ${proofMedia.sourceId}, outside its approved beat source binding.`,
            "Use only a source already attached to this beat's admitted Casefile claim binding.",
          ));
        }
        if (proofMedia.sourcePacketFingerprint !== input.sourcePacketFingerprint) {
          issues.push(issue(
            "source_proof_media_invalid",
            `Cinematic shot ${shot.id}'s source-proof asset belongs to a different source packet.`,
            "Re-approve the exact asset after any Casefile source packet change; source media cannot be replayed across packets.",
          ));
        }
        if (sourcePacket?.success) {
          const sourceRecord = sourcePacket.data.casePacket.sourceLedger.find((entry) => entry.id === proofMedia.sourceId);
          const usage = sourcePacket.data.sourceUsage.find((entry) =>
            entry.sourceId === proofMedia.sourceId &&
            entry.usage === "visual_media" &&
            entry.assetId === proofMedia.assetId,
          );
          if (!sourceRecord || !usage) {
            issues.push(issue(
              "source_proof_media_invalid",
              `Cinematic shot ${shot.id}'s source-proof asset is not an exact visual-media entry in the admitted Casefile source ledger.`,
              "Add the asset id to the source packet's explicit visual_media usage ledger and obtain fresh source/editorial approval.",
            ));
          } else if (
            usage.rightsEvidenceLocator !== proofMedia.rightsEvidenceLocator ||
            sourceRecord.rights.evidenceLocator !== proofMedia.rightsEvidenceLocator
          ) {
            issues.push(issue(
              "source_proof_media_invalid",
              `Cinematic shot ${shot.id}'s source-proof asset rights locator does not match the admitted source ledger.`,
              "Use the exact rights evidence locator from the approved visual-media source usage; do not attach a substitute license URL.",
            ));
          }
        }
      }
    }
  }
  if (Math.abs(beatCursor - sceneManifest.data.durationSec) > 0.03) {
    issues.push(issue("beat_coverage_invalid", "Cinematic beat coverage does not span the current Scene Manifest duration.", "Cover the full narrated episode in chronological sequence; do not leave an unplanned tail."));
  }
  for (const sourceShot of shots.data) {
    if (!seenParentShots.has(sourceShot.id)) issues.push(issue("beat_coverage_invalid", `Story Spine shot ${sourceShot.id} has no cinematic sequence beat.`, "Map every story shot into the cinematic sequence before rendering."));
  }
  for (const mapping of map.claimMappings) {
    if (!seenClaims.has(mapping.claimId)) issues.push(issue("claim_binding_invalid", `Admitted factual claim ${mapping.claimId} has no cinematic coverage beat.`, "Create a source-bound sequence beat for every factual claim before review."));
  }
  const orderedCinematicShots = [...allCinematicShots].sort((left, right) => left.t0 - right.t0 || left.id.localeCompare(right.id));
  if (orderedCinematicShots.length >= 6 && new Set(orderedCinematicShots.map((shot) => shot.tensionState)).size < 3) {
    issues.push(issue("tension_grammar_invalid", "The cinematic sequence has too little tension-state progression for its multi-shot length.", "Use an intentional question → pressure/uncertainty → reversal/release/residue curve instead of holding one emotional temperature throughout."));
  }
  for (let index = 2; index < orderedCinematicShots.length; index++) {
    const [first, second, third] = orderedCinematicShots.slice(index - 2, index + 1);
    if (first.shotScale === second.shotScale && second.shotScale === third.shotScale) {
      issues.push(issue("camera_repetition_invalid", `Three consecutive cinematic shots repeat the ${third.shotScale} scale.`, "Change coverage scale so the cut communicates new geography, person, or evidence information."));
    }
    if (first.cameraMove === second.cameraMove && second.cameraMove === third.cameraMove) {
      issues.push(issue("camera_repetition_invalid", `Three consecutive cinematic shots repeat ${third.cameraMove}.`, "Use motivated camera variation; do not use a modulo camera carousel as editing."));
    }
  }
  const sequenceFingerprint = cinematicCaseSequenceContentFingerprint(input);
  const review = input.editorialReview;
  if (
    review.reviewedSourcePacketFingerprint !== source.sourcePacketFingerprint ||
    review.reviewedEvidenceShotMapFingerprint !== map.contentFingerprint ||
    review.reviewedSequenceFingerprint !== sequenceFingerprint
  ) {
    issues.push(issue("editorial_review_mismatch", "The cinematic-editor approval does not bind this exact source packet, evidence map, and sequence content.", "Obtain a fresh review after any source, claim, coverage, mannequin, camera, prompt, or timing change."));
  }
  const now = options.now ?? new Date();
  const reviewedAt = parseReviewedAt(review.reviewedAt);
  if (!reviewedAt || reviewedAt.getTime() > now.getTime() + FUTURE_CLOCK_SKEW_MS || now.getTime() - reviewedAt.getTime() > REVIEW_MAX_AGE_MS) {
    issues.push(issue("editorial_review_stale", `Cinematic sequence review must be valid, non-future, and no older than ${CINEMATIC_CASE_SEQUENCE_REVIEW_MAX_AGE_DAYS} days.`, "Obtain a fresh cinematic-editor review bound to the unchanged sequence."));
  }
  return { safe: issues.length === 0, issues: uniqueIssues(issues) };
}

export function assertCinematicCaseSequence(
  args: {
    input: unknown;
    sourcePacket?: unknown;
    sourceAdmission: unknown;
    evidenceShotMap: unknown;
    evidenceShotMapAdmission: unknown;
    sceneManifest: unknown;
    shotList: unknown;
    referenceMechanicsPacket?: unknown;
    referenceQuality?: ReferenceQualityContract;
    narrativeEvidenceLedger?: unknown;
    editorialEvidencePacket?: unknown;
    sourceBoundStorySpine?: unknown;
  },
  options: { now?: Date } = {},
): AdmittedCinematicCaseSequence {
  const report = evaluateCinematicCaseSequence(args, options);
  if (!report.safe) {
    throw new Error(`cinematic case sequence admission blocked: ${report.issues.map((entry) => `${entry.code}: ${entry.message} Remediation: ${entry.remediation}`).join(" | ")}`);
  }
  const input = CinematicCaseSequenceInputSchema.parse(args.input);
  const referenceMechanics: ReferenceMechanicsPacket | undefined =
    (input.referenceMechanicsPacket ?? args.referenceMechanicsPacket) !== undefined && args.referenceQuality
      ? assertCurrentReferenceMechanicsPacket({
          packet: input.referenceMechanicsPacket ?? args.referenceMechanicsPacket,
          referenceQuality: args.referenceQuality,
          shotList: args.shotList,
          now: options.now,
        })
      : undefined;
  const mechanicsGuidance = referenceMechanics
    ? referenceMechanicsPromptGuidance(referenceMechanics, { now: options.now })
    : undefined;
  const sequenceFingerprint = cinematicCaseSequenceContentFingerprint(input);
  const castById = new Map(input.cast.map((mannequin) => [mannequin.id, mannequin]));
  const parentShotById = new Map(
    z.array(ShotPlanSchema).min(1).max(2_000).parse(args.shotList).map((shot) => [shot.id, shot]),
  );
  const scenes = input.beats.flatMap((beat) => beat.shots.map((shot) => {
    const castLock = shot.castIds
      .map((castId) => castById.get(castId))
      .filter((mannequin): mannequin is CinematicMannequin => Boolean(mannequin))
      .map((mannequin) =>
        `Faceless anonymous ${mannequin.role} mannequin: ${mannequin.silhouette}; ` +
        `wardrobe ${mannequin.wardrobeSignature}; palette ${mannequin.palette.join(", ")}; ` +
        `key prop ${mannequin.keyProp}; movement ${mannequin.movementProfile}; ` +
        "never show an identifiable face or real-person likeness.",
      )
      .join(" ")
      // A shot may reference several roles, but no cast detail should be able
      // to crowd the causal story instruction or the actual visual prompt out
      // of LTX's useful context window.
      .slice(0, 650);
    const parentLock = beat.parentShotIds
      .map((parentId) => parentShotById.get(parentId))
      .filter((parent): parent is ShotPlan => Boolean(parent))
      .map((parent) =>
        `Source continuity: ${parent.continuityState}; ${parent.era}; ` +
        `${parent.locationId ? `location ${parent.locationId}; ` : ""}` +
        `props ${parent.props.join(", ") || "none"}; wardrobe ${parent.wardrobe.join(", ") || "none"}; ` +
        `lighting ${parent.lighting}; ${parent.lens} ${parent.shotScale} ${parent.cameraMove}.`,
      )
      .join(" ")
      .slice(0, 650);
    // Fern-like shots are not merely attractive coverage: every camera choice
    // must make the current question or turn legible. These instructions must
    // reach the still/I2V prompts themselves, not live only in a reviewer
    // receipt after the expensive render has already happened.
    // Content-safety/citation-integrity default: never render the causal
    // question (or any other narrative prose) as on-screen text. The ONE
    // narrow, explicit exception is a reviewed introduction-beat name card —
    // `evaluateCinematicCaseSequence`'s `name_card_invalid` checks above
    // already guarantee nameCardText can only reach this point on an
    // introduction-role shot, so this directive does not itself need to
    // re-derive that gate; it only decides which prompt clause to emit.
    const onScreenTextDirective = shot.nameCardText
      ? `On-screen typography permitted for this shot ONLY, as the narrow character-introduction exception: render exactly this name-card text and nothing else — no causal question, no other prose: "${shot.nameCardText}"`
      : `Narrative role ${beat.narrativeRole}; story driver (never render this as on-screen text): ${beat.causalQuestion}`;
    const narrativeLock = [
      onScreenTextDirective,
      `This shot must make the narration purpose visually clear: ${shot.narrationPurpose}`,
      ...(mechanicsGuidance ? [`Approved editorial mechanics: ${mechanicsGuidance}`] : []),
    ].join(" ").slice(0, 620);
    const still = [
      `Primary visual: ${shot.still}`,
      narrativeLock,
      castLock,
      parentLock,
      `Approved framing: ${shot.shotScale} at ${shot.lens}.`,
      `Coverage ${shot.coveragePurpose}; visual mode ${shot.visualMode}.`,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1_800)
      .trim();
    const motion = [
      `Motivated motion: ${shot.motion}`,
      // The structured camera field is the reviewed source of truth. Put it
      // directly in the I2V instruction so a vague or conflicting free-text
      // motion description cannot silently turn a planned dolly/orbit/crane
      // into a generic static take before final-master QA sees it.
      `Approved camera treatment: ${shot.cameraMove}; execute only this motivated movement: ${shot.cameraRationale}`,
      narrativeLock,
      castLock,
      parentLock,
      `First frame: ${shot.firstFrameConstraint}`,
      `Last frame: ${shot.lastFrameConstraint}`,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1_200)
      .trim();
    // LTX supports a second, exact image conditioning input at the final
    // frame. Unlike the motion prompt, this target gives a reviewed cinematic
    // sequence a physical endpoint for a reveal or consequence beat.
    const terminalStill = [
      `Terminal visual: ${shot.lastFrameConstraint}`,
      `Primary scene: ${shot.still}`,
      narrativeLock,
      castLock,
      parentLock,
      `Coverage ${shot.coveragePurpose}; visual mode ${shot.visualMode}; ${shot.cameraMove} ${shot.shotScale} ${shot.lens}.`,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1_800)
      .trim();
    const soundRole = {
      spatial_anchor: "the location tone and only environmental movement visible in the frame",
      mannequin_action: "footsteps, fabric movement, and contact with only the visible key prop",
      relationship: "the shared location tone and only physical interaction between the visible figures",
      evidence_insert: "paper, film, map, or archival-object movement only when that evidence is visible",
      contradiction: "restrained location tone and the exact physical moment that makes the contradiction legible",
      consequence: "the visible physical consequence and the surrounding location tone",
      reaction: "held location tone, subtle clothing movement, and any visible object settling",
      aftermath: "residual location tone and the physical aftermath visible in the frame",
    } as const;
    const diegeticSoundscape = [
      `Diegetic only: ${soundRole[shot.coveragePurpose]}.`,
      `Motivate sound solely from this visible action: ${shot.motion}`,
      ...(referenceMechanics
        ? [`Apply only this original audio relationship: ${referenceMechanics.audioRelationship.guidance}`]
        : []),
      "No dialogue, narration, score, lyrics, or invented off-screen event.",
    ].join(" ").slice(0, 900).trim();
    return CinematicGeneratedSceneSchema.parse({
    id: shot.id,
    sequenceBeatId: beat.id,
    parentShotIds: beat.parentShotIds,
    claimIds: beat.claimIds,
    sourceIds: beat.sourceIds,
    t0: shot.t0,
    t1: shot.t1,
    still,
    terminalStill,
    ...(shot.sourceProofMedia ? { sourceProofMedia: shot.sourceProofMedia } : {}),
    motion,
    diegeticSoundscape,
    durationSec: shot.t1 - shot.t0,
    cameraMove: shot.cameraMove,
    shotScale: shot.shotScale,
    lens: shot.lens,
    negative: shot.negative,
    visualMode: shot.visualMode,
    coveragePurpose: shot.coveragePurpose,
    cutReason: shot.cutReason,
    tensionState: shot.tensionState,
    castIds: shot.castIds,
    continuitySeed: cinematicContinuitySeed(sequenceFingerprint, shot.castIds, shot.id),
  });
  })).sort((left, right) => left.t0 - right.t0 || left.id.localeCompare(right.id));
  const durationSec = scenes.at(-1)?.t1;
  if (!durationSec) throw new Error("cinematic case sequence emitted no scenes");
  const plan = CinematicCaseSequencePlanSchema.parse({
    ...input,
    contentFingerprint: sequenceFingerprint,
    release: "private_human_editorial_review_only",
    requiresHumanEditorialReview: true,
  });
  const generatedScenePlan = CinematicGeneratedScenePlanSchema.parse({
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceFingerprint,
    sourcePacketFingerprint: input.sourcePacketFingerprint,
    evidenceShotMapFingerprint: input.evidenceShotMapFingerprint,
    ...(referenceMechanics ? { referenceMechanicsPacketFingerprint: referenceMechanics.contentFingerprint } : {}),
    ...(input.narrativeEvidenceLedgerFingerprint ? { narrativeEvidenceLedgerFingerprint: input.narrativeEvidenceLedgerFingerprint } : {}),
    durationSec,
    scenes,
    release: "private_human_editorial_review_only",
  });
  const creativeLocks = CinematicCreativeLocksSchema.parse({
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceFingerprint,
    ...(referenceMechanics ? { referenceMechanicsPacketFingerprint: referenceMechanics.contentFingerprint } : {}),
    ...(input.narrativeEvidenceLedgerFingerprint ? { narrativeEvidenceLedgerFingerprint: input.narrativeEvidenceLedgerFingerprint } : {}),
    locks: input.beats.flatMap((beat) => beat.shots.map((shot) => ({
      id: shot.id,
      startSec: shot.t0,
      endSec: shot.t1,
      expected: `${shot.visualMode}; ${shot.coveragePurpose}; ${shot.cameraRationale}. ${shot.firstFrameConstraint} ${shot.lastFrameConstraint}`,
      acceptanceCriteria: [
        // Each reviewer-facing criterion is signed under a 360-character
        // contract. Rich source windows can be longer, so cap the rendered
        // instruction here rather than rejecting a valid multi-shot plan at
        // final admission after the editor has reviewed it.
        `The frame fulfills the narrated purpose: ${shot.narrationPurpose}`.slice(0, 360),
        // Camera direction is not decorative metadata. The final-master
        // reviewer sees the lock's start/middle/end evidence frames, so make
        // the approved framing and motivated movement an exact criterion it
        // must attest rather than leaving cameraMove only in the generation
        // prompt and editor-facing `expected` summary.
        `The planned ${shot.shotScale} framing and ${shot.cameraMove} camera treatment are visibly motivated: ${shot.cameraRationale}`.slice(0, 360),
        `The viewer can understand the beat's causal question without on-screen prose: ${beat.causalQuestion}`.slice(0, 360),
        `The cut communicates ${shot.cutReason}; tension state is ${shot.tensionState}`,
        ...(mechanicsGuidance
          ? [
              "The frame preserves the approved original editorial mechanics without imitating a named reference: " +
                mechanicsGuidance.slice(0, 220),
            ]
          : []),
        "Faceless mannequin identity, wardrobe silhouette, palette, key prop, and movement profile remain locked across the scene",
        "No real-person likeness, gore, unsupported act depiction, accidental text, logo, watermark, broken anatomy, or geometry",
        "The visible citation and evidence treatment match the approved factual claim",
      ],
    }))),
  });
  const editDecisionList = CinematicEditDecisionListSchema.parse({
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceFingerprint,
    ...(referenceMechanics ? { referenceMechanicsPacketFingerprint: referenceMechanics.contentFingerprint } : {}),
    ...(input.narrativeEvidenceLedgerFingerprint ? { narrativeEvidenceLedgerFingerprint: input.narrativeEvidenceLedgerFingerprint } : {}),
    durationSec,
    edits: input.beats.flatMap((beat) => beat.shots.map((shot) => ({
      shotId: shot.id,
      t0: shot.t0,
      t1: shot.t1,
      cutReason: shot.cutReason,
      tensionState: shot.tensionState,
      narrationPurpose: shot.narrationPurpose,
    }))).sort((left, right) => left.t0 - right.t0 || left.shotId.localeCompare(right.shotId)),
  });
  const receipt = CinematicCaseSequenceAdmissionReceiptSchema.parse({
    version: CINEMATIC_CASE_SEQUENCE_ADMISSION_VERSION,
    sequenceId: input.sequenceId,
    caseId: input.caseId,
    sourcePacketFingerprint: input.sourcePacketFingerprint,
    evidenceShotMapFingerprint: input.evidenceShotMapFingerprint,
    ...(input.narrativeEvidenceLedgerFingerprint ? { narrativeEvidenceLedgerFingerprint: input.narrativeEvidenceLedgerFingerprint } : {}),
    sequenceFingerprint,
    generatedSceneCount: scenes.length,
    release: "private_human_editorial_review_only",
    requiresHumanEditorialReview: true,
  });
  return { plan, generatedScenePlan, creativeLocks, editDecisionList, receipt };
}
