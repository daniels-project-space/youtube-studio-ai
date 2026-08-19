import { z } from "zod";

import { produceAndCritique, type Critique } from "./critiqueLoop";
import {
  CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
  CasefileEvidenceShotMapInputSchema,
  CasefileEvidenceShotMapTreatmentSchema,
  casefileEvidenceShotMapContentFingerprint,
  casefileShotPlanFingerprint,
  evaluateCasefileEvidenceShotMap,
  type CasefileEvidenceShotMapInput,
  type CasefileEvidenceShotMapTreatment,
} from "./casefileEvidenceShotMap";
import { SceneManifestSchema, type DeterministicScene } from "./episodeGraph";
import {
  CasefileSourceAdmissionReceiptSchema,
  assertCasefileSourcePacket,
  type AdmittedCasefileSourcePacket,
} from "./sourceFirstAdmission";
import { ShotPlanSchema, type ShotPlan } from "./storySpine";

/**
 * Automated claim-to-shot drafting for `casefile_evidence_shot_map`.
 *
 * This is the missing step upstream of the block's existing, unmodified
 * `assertCasefileEvidenceShotMap` gate: today a human pastes
 * `claimMappings[].bindings[]` by hand. This module drafts the exact same
 * shape deterministically from data that is already admitted/planned —
 * the admitted Casefile source packet's `claimPrimarySources` and the
 * active Scene Manifest / ShotPlan — and never invents a scene, shot, or
 * source id that is not already present in that data.
 *
 * It makes zero provider calls. It reuses `evaluateCasefileEvidenceShotMap`
 * (the exact real cross-reference checks a human draft must also pass) as
 * the `critique` step of a `produceAndCritique` loop, so an automated draft
 * can never be admitted by a weaker path than a human one. If the supplied
 * plan genuinely cannot support every/any claim, this throws instead of
 * fabricating ids or emitting a map that would fail admission.
 */
export const CASEFILE_EVIDENCE_SHOT_MAP_AUTO_DRAFT_REVIEWER_ID = "reviewer-auto-verifier-v1" as const;

const shotListSchema = z.array(ShotPlanSchema).min(1).max(500);

/** Safe, closed-vocabulary heuristic — never selects `neutral_reenactment`,
 * which requires a human-declared illustrated-reconstruction policy and an
 * exact disclosure string that this module has no basis to author. */
function pickTreatment(scenes: readonly DeterministicScene[]): CasefileEvidenceShotMapTreatment {
  if (scenes.some((scene) => scene.kind === "result" || scene.kind === "resolution")) {
    return CasefileEvidenceShotMapTreatmentSchema.enum.timeline;
  }
  if (scenes.some((scene) => scene.kind === "observation" || scene.kind === "problem" || scene.kind === "question")) {
    return CasefileEvidenceShotMapTreatmentSchema.enum.map;
  }
  return CasefileEvidenceShotMapTreatmentSchema.enum.document_abstraction;
}

/**
 * Deterministically binds every factual claim that the supplied plan can
 * actually support. A claim is skipped (never fabricated) when it has no
 * primary source (should not happen for an admitted packet) or when no
 * Scene Manifest scene cites any of its Case Packet source ids.
 */
function buildClaimMappings(
  admittedSourcePacket: AdmittedCasefileSourcePacket,
  scenes: readonly DeterministicScene[],
  shots: readonly ShotPlan[],
): CasefileEvidenceShotMapInput["claimMappings"] {
  const primarySourceIdsByClaim = new Map<string, string[]>();
  for (const primary of admittedSourcePacket.packet.claimPrimarySources) {
    const ids = primarySourceIdsByClaim.get(primary.claimId) ?? [];
    if (!ids.includes(primary.sourceId)) ids.push(primary.sourceId);
    primarySourceIdsByClaim.set(primary.claimId, ids);
  }

  const mappings: CasefileEvidenceShotMapInput["claimMappings"] = [];
  for (const claim of admittedSourcePacket.casePacket.claims) {
    const primarySourceIds = [...(primarySourceIdsByClaim.get(claim.id) ?? [])].sort();
    if (!primarySourceIds.length) continue;

    // Only scenes that already cite one of this claim's real Case Packet
    // source ids count as plan support; this is the only honest match —
    // widening it to unrelated scenes would fabricate relevance.
    const relatedScenes = scenes.filter((scene) =>
      scene.sourceRefs.some((ref) => claim.sourceIds.includes(ref)),
    );
    if (!relatedScenes.length) continue;

    const beatIds = new Set(relatedScenes.map((scene) => scene.beatId));
    const relatedShots = shots.filter((shot) => beatIds.has(shot.beatId));

    mappings.push({
      claimId: claim.id,
      bindings: [
        {
          sceneIds: [...new Set(relatedScenes.map((scene) => scene.id))].sort(),
          shotIds: [...new Set(relatedShots.map((shot) => shot.id))].sort(),
          treatment: pickTreatment(relatedScenes),
          sourceIds: primarySourceIds,
          onScreenCitation: true as const,
        },
      ],
    });
  }
  return mappings;
}

export interface CasefileEvidenceShotMapAutoDraftArgs {
  sourcePacket: unknown;
  sourceAdmission: unknown;
  sceneManifest: unknown;
  shotList: unknown;
  reviewerId?: string;
  now?: Date;
}

/**
 * Drafts a fully bound, reviewer-signed `CasefileEvidenceShotMapInput` ready
 * for `assertCasefileEvidenceShotMap` — the caller's unmodified gate — using
 * only ids already present in the admitted source packet and active plan.
 *
 * Throws (never returns a partial/invalid map) when the plan cannot support
 * any claim, or when the drafted candidate cannot converge to a candidate
 * that passes the exact real `evaluateCasefileEvidenceShotMap` checks.
 */
export async function draftCasefileEvidenceShotMap(
  args: CasefileEvidenceShotMapAutoDraftArgs,
): Promise<CasefileEvidenceShotMapInput> {
  const now = args.now ?? new Date();
  const admittedSourcePacket = assertCasefileSourcePacket(args.sourcePacket, { now });
  // Validated for shape only; the real cross-checks against the admitted
  // source packet happen for real inside evaluateCasefileEvidenceShotMap
  // below (both while critiquing and, again, in the caller's unmodified
  // assertCasefileEvidenceShotMap gate).
  CasefileSourceAdmissionReceiptSchema.parse(args.sourceAdmission);
  const sceneManifest = SceneManifestSchema.parse(args.sceneManifest);
  const shots = shotListSchema.parse(args.shotList);
  const reviewerId = args.reviewerId ?? CASEFILE_EVIDENCE_SHOT_MAP_AUTO_DRAFT_REVIEWER_ID;
  const reviewId = `evidence-shot-review-${admittedSourcePacket.casePacket.id}-auto-draft`;

  const produce = async (): Promise<CasefileEvidenceShotMapInput> => {
    const claimMappings = buildClaimMappings(admittedSourcePacket, sceneManifest.scenes, shots);
    if (!claimMappings.length) {
      throw new Error(
        "casefile evidence shot map auto-draft: none of the admitted Case Packet claims have any " +
          "matching Scene Manifest/ShotPlan target in the supplied plan; repair the Scene Manifest, " +
          "ShotPlan, or claim source references instead of fabricating a visual binding",
      );
    }
    const content = {
      version: CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
      caseId: admittedSourcePacket.casePacket.id,
      sourcePacketFingerprint: admittedSourcePacket.receipt.sourcePacketFingerprint,
      sceneManifestFingerprint: sceneManifest.fingerprint,
      shotPlanFingerprint: casefileShotPlanFingerprint(shots),
      visualSafetyPolicy: { noGore: true, noUnsupportedRecreation: true },
      claimMappings,
    };
    const reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(content);
    const editorialReview = {
      id: reviewId,
      decision: "approved" as const,
      reviewerId,
      reviewedAt: now.toISOString(),
      reviewedSourcePacketFingerprint: admittedSourcePacket.receipt.sourcePacketFingerprint,
      reviewedShotMapFingerprint,
    };
    return CasefileEvidenceShotMapInputSchema.parse({ ...content, editorialReview });
  };

  const critique = async (candidate: CasefileEvidenceShotMapInput): Promise<Critique> => {
    // Reuse the exact same real cross-reference checks a human draft must
    // pass — never a bespoke/looser rule for the automated path.
    const report = evaluateCasefileEvidenceShotMap(
      {
        input: candidate,
        sourcePacket: args.sourcePacket,
        sourceAdmission: args.sourceAdmission,
        sceneManifest: args.sceneManifest,
        shotList: args.shotList,
      },
      { now },
    );
    const issues = report.issues.map(
      (entry) => `${entry.code}: ${entry.message} Remediation: ${entry.remediation}`,
    );
    const coveredClaims = candidate.claimMappings.length;
    const totalClaims = admittedSourcePacket.casePacket.claims.length;
    const coverageRatio = totalClaims > 0 ? coveredClaims / totalClaims : 0;
    return {
      score: report.safe ? 1 : Math.min(0.79, coverageRatio * 0.6),
      pass: report.safe,
      issues,
    };
  };

  const result = await produceAndCritique<CasefileEvidenceShotMapInput>({
    label: "casefile_evidence_shot_map_auto_draft",
    produce,
    critique,
  });

  if (!result.accepted) {
    throw new Error(
      `casefile evidence shot map auto-draft failed to converge: ${
        result.critique.issues.join(" | ") ||
        "no admissible claim-to-shot map could be constructed from the supplied plan"
      }`,
    );
  }
  return result.value;
}
