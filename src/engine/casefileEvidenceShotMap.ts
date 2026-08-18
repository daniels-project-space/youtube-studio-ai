import { sha256Hex } from "@/lib/sha256";

import { z } from "zod";

import { RECONSTRUCTION_DISCLOSURE } from "./casefile";
import { SceneManifestSchema, type SceneManifest } from "./episodeGraph";
import {
  CASEFILE_EDITORIAL_REVIEW_MAX_AGE_DAYS,
  CasefileSourceAdmissionReceiptSchema,
  assertCasefileSourcePacket,
  type AdmittedCasefileSourcePacket,
  type CasefileSourceAdmissionReceipt,
} from "./sourceFirstAdmission";
import { ShotPlanSchema, type ShotPlan } from "./storySpine";

/**
 * Provider-free, reviewer-gated visual binding for factual documentary work.
 *
 * This deliberately does not invent a scene, write a script, render footage,
 * or open any channel family. It verifies that an already admitted source
 * packet is mapped to the real scene/shot plan an editor reviewed, using only
 * safe visual treatments and a fresh, fingerprint-bound approval.
 */
export const CASEFILE_EVIDENCE_SHOT_MAP_VERSION = "casefile-evidence-shot-map/v1" as const;
export const CASEFILE_EVIDENCE_SHOT_MAP_ADMISSION_VERSION =
  "casefile-evidence-shot-map-admission/v1" as const;
export const CASEFILE_EVIDENCE_SHOT_MAP_REVIEW_MAX_AGE_DAYS = CASEFILE_EDITORIAL_REVIEW_MAX_AGE_DAYS;

const CASEFILE_EVIDENCE_SHOT_MAP_REVIEW_MAX_AGE_MS =
  CASEFILE_EVIDENCE_SHOT_MAP_REVIEW_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000;
const FUTURE_REVIEW_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const identifier = (prefix: string) =>
  z.string().regex(
    new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]{1,119}$`),
    `expected ${prefix}- prefixed identifier`,
  );
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

/** Closed vocabulary: no gore or free-form recreation prompt can enter here. */
export const CasefileEvidenceShotMapTreatmentSchema = z.enum([
  "map",
  "timeline",
  "document_abstraction",
  "neutral_reenactment",
]);
export type CasefileEvidenceShotMapTreatment = z.infer<typeof CasefileEvidenceShotMapTreatmentSchema>;

/** Both protections are explicit and must remain true for admission. */
export const CasefileEvidenceShotMapVisualSafetyPolicySchema = z
  .object({
    noGore: z.boolean(),
    noUnsupportedRecreation: z.boolean(),
  })
  .strict();
export type CasefileEvidenceShotMapVisualSafetyPolicy = z.infer<
  typeof CasefileEvidenceShotMapVisualSafetyPolicySchema
>;

const CasefileEvidenceShotBindingSchema = z
  .object({
    /** One binding may cover several planned scenes/shots using the same safe treatment. */
    sceneIds: z.array(identifier("scene")).max(80),
    shotIds: z.array(identifier("shot")).max(80),
    treatment: CasefileEvidenceShotMapTreatmentSchema,
    /** Sources that support this visualisation; at least one must be primary evidence. */
    sourceIds: z.array(identifier("source")).min(1).max(24),
    /** Citations remain visible even for abstract maps, timelines, and reconstructions. */
    onScreenCitation: z.literal(true),
    /** Required only for the narrowly allowed, declared neutral reenactment path. */
    reconstructionDisclosure: text(180).optional(),
  })
  .strict()
  .refine(
    (binding) => binding.sceneIds.length + binding.shotIds.length > 0,
    "each factual binding must target one or more planned scene or shot ids",
  );

const CasefileEvidenceShotMapClaimSchema = z
  .object({
    claimId: identifier("claim"),
    bindings: z.array(CasefileEvidenceShotBindingSchema).min(1).max(40),
  })
  .strict();

/** A distinct evidence-visual review, rather than reusing source-admission approval. */
export const CasefileEvidenceShotMapEditorialReviewSchema = z
  .object({
    id: identifier("evidence-shot-review"),
    decision: z.literal("approved"),
    reviewerId: identifier("reviewer"),
    reviewedAt: z.string().datetime({ offset: true }),
    /** The reviewed source packet's content fingerprint. */
    reviewedSourcePacketFingerprint: sha256,
    /** Canonical fingerprint of the exact scene/shot-map content below. */
    reviewedShotMapFingerprint: sha256,
  })
  .strict();

export const CasefileEvidenceShotMapInputSchema = z
  .object({
    version: z.literal(CASEFILE_EVIDENCE_SHOT_MAP_VERSION),
    caseId: identifier("case"),
    /** Must equal the prior casefile_source_packet receipt fingerprint. */
    sourcePacketFingerprint: sha256,
    /** The locked Scene Manifest's Episode Graph fingerprint. */
    sceneManifestFingerprint: sha256,
    /** Canonical, order-insensitive fingerprint of the active ShotPlan list. */
    shotPlanFingerprint: sha256,
    visualSafetyPolicy: CasefileEvidenceShotMapVisualSafetyPolicySchema,
    /** Every established factual Case Packet claim must appear exactly once. */
    claimMappings: z.array(CasefileEvidenceShotMapClaimSchema).min(1).max(500),
    editorialReview: CasefileEvidenceShotMapEditorialReviewSchema,
  })
  .strict();

/** The editorial review is excluded from the content it signs. */
export const CasefileEvidenceShotMapContentSchema = CasefileEvidenceShotMapInputSchema
  .omit({ editorialReview: true })
  .strict();

export const CasefileEvidenceShotMapSchema = CasefileEvidenceShotMapInputSchema
  .extend({
    contentFingerprint: sha256,
    release: z.literal("private_human_editorial_review_only"),
  })
  .strict();

export const CasefileEvidenceShotMapAdmissionReceiptSchema = z
  .object({
    version: z.literal(CASEFILE_EVIDENCE_SHOT_MAP_ADMISSION_VERSION),
    caseId: identifier("case"),
    sourcePacketFingerprint: sha256,
    sceneManifestFingerprint: sha256,
    shotPlanFingerprint: sha256,
    evidenceShotMapFingerprint: sha256,
    factualClaimCount: z.number().int().positive(),
    bindingCount: z.number().int().positive(),
    visualSafetyPolicy: z
      .object({
        noGore: z.literal(true),
        noUnsupportedRecreation: z.literal(true),
      })
      .strict(),
    editorialReview: CasefileEvidenceShotMapEditorialReviewSchema,
    /** The module can prepare a review candidate only; publication stays gated elsewhere. */
    release: z.literal("private_human_editorial_review_only"),
    requiresHumanEditorialReview: z.literal(true),
  })
  .strict();

export type CasefileEvidenceShotMapInput = z.infer<typeof CasefileEvidenceShotMapInputSchema>;
export type CasefileEvidenceShotMap = z.infer<typeof CasefileEvidenceShotMapSchema>;
export type CasefileEvidenceShotMapAdmissionReceipt = z.infer<
  typeof CasefileEvidenceShotMapAdmissionReceiptSchema
>;

export const CasefileEvidenceShotMapIssueCodeSchema = z.enum([
  "evidence_shot_map_invalid",
  "source_packet_invalid",
  "source_admission_invalid",
  "source_admission_mismatch",
  "case_identifier_mismatch",
  "scene_manifest_invalid",
  "shot_plan_invalid",
  "plan_fingerprint_mismatch",
  "visual_policy_invalid",
  "claim_mapping_missing",
  "claim_mapping_invalid",
  "planned_target_unknown",
  "primary_source_binding_missing",
  "neutral_reenactment_blocked",
  "editorial_review_source_packet_mismatch",
  "editorial_review_shot_map_mismatch",
  "editorial_review_stale",
]);
export type CasefileEvidenceShotMapIssueCode = z.infer<typeof CasefileEvidenceShotMapIssueCodeSchema>;

export interface CasefileEvidenceShotMapIssue {
  code: CasefileEvidenceShotMapIssueCode;
  message: string;
  remediation: string;
}

export interface CasefileEvidenceShotMapAdmissionReport {
  safe: boolean;
  issues: CasefileEvidenceShotMapIssue[];
}

export interface AdmittedCasefileEvidenceShotMap {
  sourcePacket: AdmittedCasefileSourcePacket;
  sourceAdmission: CasefileSourceAdmissionReceipt;
  map: CasefileEvidenceShotMap;
  receipt: CasefileEvidenceShotMapAdmissionReceipt;
}

function issue(
  code: CasefileEvidenceShotMapIssueCode,
  message: string,
  remediation: string,
): CasefileEvidenceShotMapIssue {
  return { code, message, remediation };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function parseReviewedAt(value: string): Date | undefined {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function uniqueIssues(issues: CasefileEvidenceShotMapIssue[]): CasefileEvidenceShotMapIssue[] {
  return issues.filter(
    (candidate, index) =>
      index === issues.findIndex((entry) =>
        entry.code === candidate.code && entry.message === candidate.message,
      ),
  );
}

function invalidInputIssue(): CasefileEvidenceShotMapIssue {
  return issue(
    "evidence_shot_map_invalid",
    "The evidence shot map does not satisfy the closed, reviewable schema.",
    "Supply the exact case/source/plan fingerprints, one or more planned targets per factual binding, and a reviewer approval record.",
  );
}

/**
 * Stable plan binding. Shot order is deliberately not semantic: an editor can
 * reorder a list without invalidating an otherwise unchanged reviewed map.
 */
export function casefileShotPlanFingerprint(value: unknown): string {
  const shots = z.array(ShotPlanSchema).min(1).max(500).parse(value);
  return fingerprint([...shots].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))));
}

/**
 * Stable target for a reviewer signature. It includes the source and plan
 * fingerprints plus every claim-to-target/evidence/treatment declaration, but
 * excludes the approval itself to avoid a self-referential hash.
 */
export function casefileEvidenceShotMapContentFingerprint(
  value: Pick<
    CasefileEvidenceShotMapInput,
    | "version"
    | "caseId"
    | "sourcePacketFingerprint"
    | "sceneManifestFingerprint"
    | "shotPlanFingerprint"
    | "visualSafetyPolicy"
    | "claimMappings"
  >,
): string {
  const map = CasefileEvidenceShotMapContentSchema.parse({
    version: value.version,
    caseId: value.caseId,
    sourcePacketFingerprint: value.sourcePacketFingerprint,
    sceneManifestFingerprint: value.sceneManifestFingerprint,
    shotPlanFingerprint: value.shotPlanFingerprint,
    visualSafetyPolicy: value.visualSafetyPolicy,
    claimMappings: value.claimMappings,
  });
  return fingerprint({
    version: map.version,
    caseId: map.caseId,
    sourcePacketFingerprint: map.sourcePacketFingerprint,
    sceneManifestFingerprint: map.sceneManifestFingerprint,
    shotPlanFingerprint: map.shotPlanFingerprint,
    visualSafetyPolicy: map.visualSafetyPolicy,
    claimMappings: [...map.claimMappings]
      .map((mapping) => ({
        claimId: mapping.claimId,
        bindings: [...mapping.bindings].sort((left, right) =>
          canonicalJson(left).localeCompare(canonicalJson(right)),
        ),
      }))
      .sort((left, right) => left.claimId.localeCompare(right.claimId)),
  });
}

export function evaluateCasefileEvidenceShotMap(
  args: {
    input: unknown;
    sourcePacket: unknown;
    sourceAdmission: unknown;
    sceneManifest: unknown;
    shotList: unknown;
  },
  options: { now?: Date } = {},
): CasefileEvidenceShotMapAdmissionReport {
  const parsedInput = CasefileEvidenceShotMapInputSchema.safeParse(args.input);
  if (!parsedInput.success) return { safe: false, issues: [invalidInputIssue()] };
  const input = parsedInput.data;
  const issues: CasefileEvidenceShotMapIssue[] = [];

  let sourcePacket: AdmittedCasefileSourcePacket | undefined;
  try {
    sourcePacket = assertCasefileSourcePacket(args.sourcePacket, options);
  } catch (error) {
    issues.push(issue(
      "source_packet_invalid",
      error instanceof Error ? error.message : "The upstream Casefile source packet is not admitted.",
      "Run casefile_source_packet with the current source ledger, primary-source links, rights declarations, and human editorial approval first.",
    ));
  }

  const parsedAdmission = CasefileSourceAdmissionReceiptSchema.safeParse(args.sourceAdmission);
  if (!parsedAdmission.success) {
    issues.push(issue(
      "source_admission_invalid",
      "The upstream Casefile source-admission receipt is missing or invalid.",
      "Provide the receipt emitted by casefile_source_packet; do not manually construct a documentary admission.",
    ));
  }

  const parsedSceneManifest = SceneManifestSchema.safeParse(args.sceneManifest);
  if (!parsedSceneManifest.success) {
    issues.push(issue(
      "scene_manifest_invalid",
      "The evidence shot map needs a validated Scene Manifest with stable scene ids.",
      "Compile and validate the active Episode Graph Scene Manifest before mapping claims.",
    ));
  }

  const parsedShotList = z.array(ShotPlanSchema).min(1).max(500).safeParse(args.shotList);
  if (!parsedShotList.success) {
    issues.push(issue(
      "shot_plan_invalid",
      "The evidence shot map needs a validated non-empty ShotPlan list with stable shot ids.",
      "Run the Story Spine planner and pass its current shotList before mapping claims.",
    ));
  }

  if (!sourcePacket || !parsedAdmission.success || !parsedSceneManifest.success || !parsedShotList.success) {
    return { safe: false, issues: uniqueIssues(issues) };
  }

  const sourceAdmission = parsedAdmission.data;
  const sceneManifest = parsedSceneManifest.data;
  const shotList = parsedShotList.data;
  const currentShotPlanFingerprint = casefileShotPlanFingerprint(shotList);

  if (input.caseId !== sourcePacket.casePacket.id) {
    issues.push(issue(
      "case_identifier_mismatch",
      `Evidence shot map caseId ${input.caseId} does not match admitted Case Packet ${sourcePacket.casePacket.id}.`,
      "Use the exact Case Packet id so factual claims cannot be mapped across cases.",
    ));
  }
  if (input.sourcePacketFingerprint !== sourcePacket.receipt.sourcePacketFingerprint) {
    issues.push(issue(
      "source_admission_mismatch",
      "The evidence shot map is not bound to the current admitted source-packet fingerprint.",
      "Regenerate the map from the current casefile_source_packet output and obtain a new visual-editor approval.",
    ));
  }
  if (
    sourceAdmission.caseId !== sourcePacket.receipt.caseId ||
    sourceAdmission.casePacketFingerprint !== sourcePacket.receipt.casePacketFingerprint ||
    sourceAdmission.sourcePacketFingerprint !== sourcePacket.receipt.sourcePacketFingerprint ||
    sourceAdmission.evidenceGrammarFingerprint !== sourcePacket.receipt.evidenceGrammarFingerprint ||
    sourceAdmission.release !== "private_human_editorial_review_only" ||
    sourceAdmission.requiresHumanEditorialReview !== true
  ) {
    issues.push(issue(
      "source_admission_mismatch",
      "The supplied source-admission receipt does not match the currently admitted Case Packet and source packet.",
      "Use the unmodified receipt emitted alongside this exact casefileSourcePacket output.",
    ));
  }
  if (input.sceneManifestFingerprint !== sceneManifest.fingerprint) {
    issues.push(issue(
      "plan_fingerprint_mismatch",
      "The evidence shot map was not reviewed against this exact Scene Manifest fingerprint.",
      "Rebind every claim to the current Scene Manifest and obtain a new evidence-visual review.",
    ));
  }
  if (input.shotPlanFingerprint !== currentShotPlanFingerprint) {
    issues.push(issue(
      "plan_fingerprint_mismatch",
      "The evidence shot map was not reviewed against this exact ShotPlan list.",
      "Rebind every claim to the current ShotPlan list and obtain a new evidence-visual review.",
    ));
  }
  if (!input.visualSafetyPolicy.noGore || !input.visualSafetyPolicy.noUnsupportedRecreation) {
    issues.push(issue(
      "visual_policy_invalid",
      "The evidence shot map must explicitly prohibit both gore and unsupported recreations.",
      "Set noGore and noUnsupportedRecreation to true; only the closed safe treatment vocabulary may be used.",
    ));
  }

  const claimsById = new Map(sourcePacket.casePacket.claims.map((claim) => [claim.id, claim]));
  const primarySourceIdsByClaim = new Map<string, Set<string>>();
  for (const primary of sourcePacket.packet.claimPrimarySources) {
    const ids = primarySourceIdsByClaim.get(primary.claimId) ?? new Set<string>();
    ids.add(primary.sourceId);
    primarySourceIdsByClaim.set(primary.claimId, ids);
  }
  const sceneIds = new Set(sceneManifest.scenes.map((scene) => scene.id));
  const shotIds = new Set(shotList.map((shot) => shot.id));
  const mappingsByClaim = new Map<string, CasefileEvidenceShotMapInput["claimMappings"][number]>();

  for (const mapping of input.claimMappings) {
    if (mappingsByClaim.has(mapping.claimId)) {
      issues.push(issue(
        "claim_mapping_invalid",
        `Claim ${mapping.claimId} is mapped more than once.`,
        "Keep one claim mapping entry per Case Packet claim; place multiple visual bindings inside that entry.",
      ));
      continue;
    }
    mappingsByClaim.set(mapping.claimId, mapping);
    const claim = claimsById.get(mapping.claimId);
    if (!claim) {
      issues.push(issue(
        "claim_mapping_invalid",
        `Evidence shot map references unknown Case Packet claim ${mapping.claimId}.`,
        "Map only established claim ids present in the admitted Case Packet.",
      ));
      continue;
    }
    const primarySourceIds = primarySourceIdsByClaim.get(claim.id) ?? new Set<string>();
    const usedTargets = new Set<string>();
    for (const binding of mapping.bindings) {
      const targetKey = `${[...binding.sceneIds].sort().join(",")}|${[...binding.shotIds].sort().join(",")}|${binding.treatment}`;
      if (usedTargets.has(targetKey)) {
        issues.push(issue(
          "claim_mapping_invalid",
          `Claim ${claim.id} repeats the same scene/shot/treatment binding.`,
          "Remove duplicate bindings; each planned target should have one auditable visual treatment per claim.",
        ));
      }
      usedTargets.add(targetKey);
      for (const sceneId of binding.sceneIds) {
        if (!sceneIds.has(sceneId)) {
          issues.push(issue(
            "planned_target_unknown",
            `Claim ${claim.id} references Scene Manifest id ${sceneId}, which is not in the active plan.`,
            "Use only scene ids emitted by the current Scene Manifest.",
          ));
        }
      }
      for (const shotId of binding.shotIds) {
        if (!shotIds.has(shotId)) {
          issues.push(issue(
            "planned_target_unknown",
            `Claim ${claim.id} references ShotPlan id ${shotId}, which is not in the active plan.`,
            "Use only shot ids emitted by the current Story Spine ShotPlan list.",
          ));
        }
      }
      const supportedSources = binding.sourceIds.every((sourceId) => claim.sourceIds.includes(sourceId));
      const hasPrimaryEvidence = binding.sourceIds.some((sourceId) => primarySourceIds.has(sourceId));
      if (!supportedSources || !hasPrimaryEvidence) {
        issues.push(issue(
          "primary_source_binding_missing",
          `Claim ${claim.id}'s ${binding.treatment} binding is not anchored to its Case Packet evidence and at least one declared primary source.`,
          "List only source ids attached to this claim and include at least one primary-source id admitted for it.",
        ));
      }
      if (binding.treatment === "neutral_reenactment") {
        if (
          sourcePacket.casePacket.reconstruction.mode !== "illustrated_reconstruction" ||
          binding.reconstructionDisclosure !== RECONSTRUCTION_DISCLOSURE
        ) {
          issues.push(issue(
            "neutral_reenactment_blocked",
            `Claim ${claim.id} may use neutral reenactment only under the declared illustrated-reconstruction path with the exact visible disclosure.`,
            "Use map, timeline, or document_abstraction instead, or declare illustrated_reconstruction with the required disclosure and obtain fresh review.",
          ));
        }
      } else if (binding.reconstructionDisclosure) {
        issues.push(issue(
          "neutral_reenactment_blocked",
          `Claim ${claim.id}'s ${binding.treatment} binding declares reconstruction disclosure without the narrow neutral-reenactment treatment.`,
          "Remove the disclosure or use neutral_reenactment only when the Case Packet declares illustrated reconstruction.",
        ));
      }
    }
  }
  for (const claim of sourcePacket.casePacket.claims) {
    if (!mappingsByClaim.has(claim.id)) {
      issues.push(issue(
        "claim_mapping_missing",
        `Factual Case Packet claim ${claim.id} has no scene/shot evidence map.`,
        "Map every factual claim to one or more current Scene Manifest or ShotPlan ids before review.",
      ));
    }
  }

  const mapFingerprint = casefileEvidenceShotMapContentFingerprint(input);
  if (input.editorialReview.reviewedSourcePacketFingerprint !== sourcePacket.receipt.sourcePacketFingerprint) {
    issues.push(issue(
      "editorial_review_source_packet_mismatch",
      "The visual-editor approval was not issued for this exact admitted source packet.",
      "Have the reviewer approve the current source packet again after any claim, primary-source, rights, or source-use change.",
    ));
  }
  if (input.editorialReview.reviewedShotMapFingerprint !== mapFingerprint) {
    issues.push(issue(
      "editorial_review_shot_map_mismatch",
      "The visual-editor approval was not issued for this exact claim-to-scene/shot evidence map.",
      "Have the reviewer approve the current map again after any visual target, treatment, plan, or policy change.",
    ));
  }
  const now = options.now ?? new Date();
  const reviewedAt = parseReviewedAt(input.editorialReview.reviewedAt);
  if (
    !reviewedAt ||
    reviewedAt.getTime() > now.getTime() + FUTURE_REVIEW_CLOCK_SKEW_MS ||
    now.getTime() - reviewedAt.getTime() > CASEFILE_EVIDENCE_SHOT_MAP_REVIEW_MAX_AGE_MS
  ) {
    issues.push(issue(
      "editorial_review_stale",
      `Evidence-visual approval must be valid, non-future, and no older than ${CASEFILE_EVIDENCE_SHOT_MAP_REVIEW_MAX_AGE_DAYS} days.`,
      "Obtain a fresh human evidence-visual review bound to the unchanged source packet and shot map.",
    ));
  }

  return { safe: issues.length === 0, issues: uniqueIssues(issues) };
}

export function assertCasefileEvidenceShotMap(
  args: {
    input: unknown;
    sourcePacket: unknown;
    sourceAdmission: unknown;
    sceneManifest: unknown;
    shotList: unknown;
  },
  options: { now?: Date } = {},
): AdmittedCasefileEvidenceShotMap {
  const report = evaluateCasefileEvidenceShotMap(args, options);
  if (!report.safe) {
    throw new Error(
      `casefile evidence shot map admission blocked: ${report.issues
        .map((entry) => `${entry.code}: ${entry.message} Remediation: ${entry.remediation}`)
        .join(" | ")}`,
    );
  }
  const input = CasefileEvidenceShotMapInputSchema.parse(args.input);
  const sourcePacket = assertCasefileSourcePacket(args.sourcePacket, options);
  const sourceAdmission = CasefileSourceAdmissionReceiptSchema.parse(args.sourceAdmission);
  const sceneManifest: SceneManifest = SceneManifestSchema.parse(args.sceneManifest);
  const shotList: ShotPlan[] = z.array(ShotPlanSchema).min(1).max(500).parse(args.shotList);
  const contentFingerprint = casefileEvidenceShotMapContentFingerprint(input);
  const map = CasefileEvidenceShotMapSchema.parse({
    ...input,
    contentFingerprint,
    release: "private_human_editorial_review_only",
  });
  const receipt = CasefileEvidenceShotMapAdmissionReceiptSchema.parse({
    version: CASEFILE_EVIDENCE_SHOT_MAP_ADMISSION_VERSION,
    caseId: input.caseId,
    sourcePacketFingerprint: sourcePacket.receipt.sourcePacketFingerprint,
    sceneManifestFingerprint: sceneManifest.fingerprint,
    shotPlanFingerprint: casefileShotPlanFingerprint(shotList),
    evidenceShotMapFingerprint: contentFingerprint,
    factualClaimCount: sourcePacket.casePacket.claims.length,
    bindingCount: input.claimMappings.reduce((total, mapping) => total + mapping.bindings.length, 0),
    visualSafetyPolicy: {
      noGore: true,
      noUnsupportedRecreation: true,
    },
    editorialReview: input.editorialReview,
    release: "private_human_editorial_review_only",
    requiresHumanEditorialReview: true,
  });
  return { sourcePacket, sourceAdmission, map, receipt };
}
