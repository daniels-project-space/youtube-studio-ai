import {
  assertCasefileEvidenceShotMap,
  type CasefileEvidenceShotMapAdmissionReceipt,
  type CasefileEvidenceShotMap,
} from "./casefileEvidenceShotMap";
import {
  assertCinematicCaseSequence,
  type AdmittedCinematicCaseSequence,
  type CinematicCaseSequenceInput,
} from "./cinematicCaseSequence";
import {
  finalizeCinematicCaseSequenceDraft,
  planCinematicCaseSequenceDraft,
  type CinematicCaseDirection,
  type CinematicCaseSequenceDraft,
} from "./cinematicCaseSequenceDraft";
import { referenceQualityContractFor } from "./creative/referenceQuality";
import {
  createReferenceMechanicsPacket,
  type ReferenceMechanicsPacket,
} from "./referenceMechanicsPacket";
import {
  assertCasefileSourcePacket,
  type CasefileSourceAdmissionReceipt,
  type CasefileSourcePacket,
} from "./sourceFirstAdmission";

/**
 * Durable, no-spend handoff state for one factual cinematic episode.
 *
 * This deliberately does not call a model, create a run, render, or publish.
 * Each transition executes the same source/claim/sequence assertions that the
 * Trigger blocks use, then freezes the admitted output for the next human
 * review. That gives the operator a real two-phase path instead of asking a
 * generic automatic channel run to smuggle mutable Casefile inputs through it.
 */
export const CASEFILE_EPISODE_WORKFLOW_VERSION = "casefile-episode-workflow/v1" as const;

export const CASEFILE_EPISODE_STATUSES = [
  "source_admitted",
  "awaiting_evidence_review",
  "awaiting_cinematic_direction",
  "awaiting_cinematic_review",
  "render_admitted",
] as const;
export type CasefileEpisodeStatus = (typeof CASEFILE_EPISODE_STATUSES)[number];

export type CasefileEpisodeWorkflow = {
  version: typeof CASEFILE_EPISODE_WORKFLOW_VERSION;
  caseId: string;
  status: CasefileEpisodeStatus;
  sourcePacket: CasefileSourcePacket;
  sourceAdmission: CasefileSourceAdmissionReceipt;
  planning?: {
    sceneManifest: unknown;
    shotList: unknown;
  };
  evidenceShotMap?: CasefileEvidenceShotMap;
  evidenceShotMapAdmission?: CasefileEvidenceShotMapAdmissionReceipt;
  /** Optional, immutable mechanics-only craft review attached before the cinematic draft. */
  referenceMechanicsPacket?: ReferenceMechanicsPacket;
  cinematicDirection?: CinematicCaseDirection;
  cinematicDraft?: CinematicCaseSequenceDraft;
  cinematicInput?: CinematicCaseSequenceInput;
  cinematicAdmission?: AdmittedCinematicCaseSequence["receipt"];
};

function requireStatus(
  episode: CasefileEpisodeWorkflow,
  expected: CasefileEpisodeStatus,
  operation: string,
): void {
  if (episode.status !== expected) {
    throw new Error(
      `casefile episode ${operation}: expected ${expected}, received ${episode.status}; ` +
        "create a fresh immutable revision instead of overwriting a reviewed handoff",
    );
  }
}

function requirePlanning(episode: CasefileEpisodeWorkflow): NonNullable<CasefileEpisodeWorkflow["planning"]> {
  if (!episode.planning) {
    throw new Error("casefile episode: locked Scene Manifest and Story Spine ShotPlan are required before evidence review");
  }
  return episode.planning;
}

function requireEvidence(
  episode: CasefileEpisodeWorkflow,
): Pick<CasefileEpisodeWorkflow, "evidenceShotMap" | "evidenceShotMapAdmission"> & {
  evidenceShotMap: CasefileEvidenceShotMap;
  evidenceShotMapAdmission: CasefileEvidenceShotMapAdmissionReceipt;
} {
  if (!episode.evidenceShotMap || !episode.evidenceShotMapAdmission) {
    throw new Error("casefile episode: a current human-reviewed claim-to-shot map is required before cinematic planning");
  }
  return {
    evidenceShotMap: episode.evidenceShotMap,
    evidenceShotMapAdmission: episode.evidenceShotMapAdmission,
  };
}

/** Starts a revision only from an already human-reviewed, rights-bound Case Packet. */
export function admitCasefileEpisodeSource(
  sourcePacket: unknown,
  options: { now?: Date } = {},
): CasefileEpisodeWorkflow {
  const admitted = assertCasefileSourcePacket(sourcePacket, options);
  return {
    version: CASEFILE_EPISODE_WORKFLOW_VERSION,
    caseId: admitted.casePacket.id,
    status: "source_admitted",
    sourcePacket: admitted.packet,
    sourceAdmission: admitted.receipt,
  };
}

/** Freezes the exact scene and shot planning artifacts that the evidence editor reviewed. */
export function attachCasefileEpisodePlanning(args: {
  episode: CasefileEpisodeWorkflow;
  sceneManifest: unknown;
  shotList: unknown;
}): CasefileEpisodeWorkflow {
  requireStatus(args.episode, "source_admitted", "attach planning");
  if (!Array.isArray(args.shotList) || args.shotList.length === 0) {
    throw new Error("casefile episode planning requires a non-empty Story Spine ShotPlan");
  }
  if (!args.sceneManifest || typeof args.sceneManifest !== "object") {
    throw new Error("casefile episode planning requires a locked Scene Manifest");
  }
  return {
    ...args.episode,
    status: "awaiting_evidence_review",
    planning: { sceneManifest: args.sceneManifest, shotList: args.shotList },
  };
}

/** Executes the real claim-to-source-to-scene/shot admission before any cinematic treatment exists. */
export function admitCasefileEpisodeEvidenceMap(args: {
  episode: CasefileEpisodeWorkflow;
  evidenceShotMapInput: unknown;
  now?: Date;
}): CasefileEpisodeWorkflow {
  requireStatus(args.episode, "awaiting_evidence_review", "admit evidence map");
  const planning = requirePlanning(args.episode);
  const admitted = assertCasefileEvidenceShotMap({
    input: args.evidenceShotMapInput,
    sourcePacket: args.episode.sourcePacket,
    sourceAdmission: args.episode.sourceAdmission,
    sceneManifest: planning.sceneManifest,
    shotList: planning.shotList,
  }, { now: args.now });
  if (admitted.map.caseId !== args.episode.caseId) {
    throw new Error("casefile episode evidence map caseId does not match the admitted source packet");
  }
  return {
    ...args.episode,
    status: "awaiting_cinematic_direction",
    evidenceShotMap: admitted.map,
    evidenceShotMapAdmission: admitted.receipt,
  };
}

/**
 * Stores one reviewed, mechanics-only reference packet after the factual plan
 * is frozen. The desk never accepts reference footage, copied media, source
 * metadata, or an automatic comparison: those fields are derived from the
 * static documentary contract inside createReferenceMechanicsPacket.
 */
export function attachCasefileEpisodeReferenceMechanics(args: {
  episode: CasefileEpisodeWorkflow;
  mechanics: unknown;
  review: unknown;
  now?: Date;
}): CasefileEpisodeWorkflow {
  requireStatus(args.episode, "awaiting_cinematic_direction", "attach reference mechanics");
  const planning = requirePlanning(args.episode);
  requireEvidence(args.episode);
  if (args.episode.referenceMechanicsPacket) {
    throw new Error(
      "casefile episode reference mechanics are already frozen; create a fresh immutable revision instead of replacing a reviewed craft packet",
    );
  }
  const referenceMechanicsPacket = createReferenceMechanicsPacket({
    referenceQuality: referenceQualityContractFor("documentary_collage_short"),
    shotList: planning.shotList,
    mechanics: args.mechanics,
    review: args.review,
    now: args.now,
  });
  return { ...args.episode, referenceMechanicsPacket };
}

/** Generates an editor-visible, faceless-mannequin multi-shot draft; it has no render authority. */
export function draftCasefileEpisodeCinematicSequence(args: {
  episode: CasefileEpisodeWorkflow;
  direction: unknown;
  now?: Date;
}): CasefileEpisodeWorkflow {
  requireStatus(args.episode, "awaiting_cinematic_direction", "draft cinematic sequence");
  const planning = requirePlanning(args.episode);
  const evidence = requireEvidence(args.episode);
  const draft = planCinematicCaseSequenceDraft({
    direction: args.direction,
    evidenceShotMap: evidence.evidenceShotMap,
    sceneManifest: planning.sceneManifest,
    shotList: planning.shotList,
    ...(args.episode.referenceMechanicsPacket
      ? { referenceMechanicsPacket: args.episode.referenceMechanicsPacket, now: args.now }
      : {}),
  });
  if (draft.content.caseId !== args.episode.caseId) {
    throw new Error("casefile episode cinematic direction caseId does not match the admitted source packet");
  }
  return {
    ...args.episode,
    status: "awaiting_cinematic_review",
    cinematicDirection: args.direction as CinematicCaseDirection,
    cinematicDraft: draft,
  };
}

/**
 * Final human signature → exact render package. This is the sole transition
 * that can feed `cinematic_case_sequence`; the release remains private review
 * only and a separate explicitly budgeted render action is still required.
 */
export function finalizeCasefileEpisodeCinematicSequence(args: {
  episode: CasefileEpisodeWorkflow;
  editorialReview: unknown;
  now?: Date;
}): CasefileEpisodeWorkflow {
  requireStatus(args.episode, "awaiting_cinematic_review", "finalize cinematic sequence");
  const planning = requirePlanning(args.episode);
  const evidence = requireEvidence(args.episode);
  if (!args.episode.cinematicDraft) {
    throw new Error("casefile episode: cinematic draft is missing");
  }
  const cinematicInput = finalizeCinematicCaseSequenceDraft({
    draft: args.episode.cinematicDraft,
    editorialReview: args.editorialReview,
  });
  const admitted = assertCinematicCaseSequence({
    input: cinematicInput,
    sourceAdmission: args.episode.sourceAdmission,
    evidenceShotMap: evidence.evidenceShotMap,
    evidenceShotMapAdmission: evidence.evidenceShotMapAdmission,
    sceneManifest: planning.sceneManifest,
    shotList: planning.shotList,
    ...(args.episode.referenceMechanicsPacket
      ? {
          referenceMechanicsPacket: args.episode.referenceMechanicsPacket,
          referenceQuality: referenceQualityContractFor("documentary_collage_short"),
        }
      : {}),
  }, { now: args.now });
  return {
    ...args.episode,
    status: "render_admitted",
    cinematicInput,
    cinematicAdmission: admitted.receipt,
  };
}
