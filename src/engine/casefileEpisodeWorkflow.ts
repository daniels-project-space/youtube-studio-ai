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
  CinematicCaseDirectionSchema,
  finalizeCinematicCaseSequenceDraft,
  planCinematicCaseSequenceDraft,
  type CinematicCaseDirection,
  type CinematicCaseSequenceDraft,
} from "./cinematicCaseSequenceDraft";
import {
  assertNarrativeEvidenceLedger,
  createNarrativeEvidenceLedger,
  NarrativeEvidenceClaimRelationSchema,
  NarrativeEvidenceClaimSchema,
  NarrativeEvidenceLedgerReviewDraftSchema,
  NarrativeEvidenceSupportSchema,
  type NarrativeEvidenceLedger,
} from "./narrativeEvidenceLedger";
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
import {
  createSourceBoundStorySpineHandoff,
  type SourceBoundStorySpineHandoff,
  validateSourceBoundStorySpineHandoff,
} from "./sourceBoundStorySpine";

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
  /** Optional immutable evidence-to-timed-narration handoff required when the semantic ledger is used. */
  sourceBoundStorySpine?: SourceBoundStorySpineHandoff;
  /** Optional immutable semantic review; it never grants render or publish authority. */
  narrativeEvidenceLedger?: NarrativeEvidenceLedger;
  /** Optional, immutable mechanics-only craft review attached before the cinematic draft. */
  referenceMechanicsPacket?: ReferenceMechanicsPacket;
  cinematicDirection?: CinematicCaseDirection;
  cinematicDraft?: CinematicCaseSequenceDraft;
  cinematicInput?: CinematicCaseSequenceInput;
  cinematicAdmission?: AdmittedCinematicCaseSequence["receipt"];
};

const CasefileNarrativeEvidenceClaimInputSchema = NarrativeEvidenceClaimSchema
  .extend({
    // The desk derives the only legal rail id from the admitted source packet.
    // Editors may name the exact source/claim support, never an arbitrary rail.
    supports: z.array(NarrativeEvidenceSupportSchema.omit({ railId: true })).min(1).max(24),
  })
  .strict();

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

function assertCasefileNarrativeEvidenceLedgerAttachment(args: {
  episode: CasefileEpisodeWorkflow;
  ledger: unknown;
  now?: Date;
}): NarrativeEvidenceLedger {
  const ledger = assertNarrativeEvidenceLedger(args.ledger, args.now?.getTime());
  if (ledger.subject !== args.episode.sourcePacket.casePacket.title) {
    throw new Error("casefile narrative evidence ledger subject does not match the admitted Casefile source packet");
  }
  const casefileRails = ledger.evidenceRails.filter((rail) => rail.kind === "casefile_source_packet");
  if (casefileRails.length !== 1) {
    throw new Error("casefile narrative evidence ledger requires exactly one current Casefile source-packet rail");
  }
  if (ledger.evidenceRails.length !== casefileRails.length) {
    throw new Error("casefile narrative evidence ledger desk accepts only the current Casefile source-packet rail");
  }
  const rail = casefileRails[0]!;
  if (rail.packetFingerprint !== args.episode.sourceAdmission.sourcePacketFingerprint) {
    throw new Error("casefile narrative evidence ledger does not match the current admitted source packet");
  }
  const knownSourceIds = new Set(args.episode.sourcePacket.sourceUsage.map((entry) => entry.sourceId));
  const knownClaimIds = new Set(args.episode.sourcePacket.claimPrimarySources.map((entry) => entry.claimId));
  if (rail.sourceIds.some((id) => !knownSourceIds.has(id)) || rail.upstreamClaimIds.some((id) => !knownClaimIds.has(id))) {
    throw new Error("casefile narrative evidence ledger contains a source or claim outside the current admitted source packet");
  }
  const evidence = requireEvidence(args.episode);
  const sourceBoundStorySpine = args.episode.sourceBoundStorySpine
    ? validateSourceBoundStorySpineHandoff(args.episode.sourceBoundStorySpine)
    : undefined;
  if (
    !sourceBoundStorySpine
    || sourceBoundStorySpine.caseId !== args.episode.caseId
    || sourceBoundStorySpine.sourcePacketFingerprint !== args.episode.sourceAdmission.sourcePacketFingerprint
    || sourceBoundStorySpine.evidenceShotMapFingerprint !== evidence.evidenceShotMap.contentFingerprint
    || sourceBoundStorySpine.storySpineShotPlanFingerprint !== evidence.evidenceShotMap.shotPlanFingerprint
  ) {
    throw new Error("casefile narrative evidence ledger requires the exact current source-bound Story Spine and evidence map");
  }
  for (const claim of ledger.claims) {
    const supports = claim.supports.filter((support) => support.railId === rail.id);
    if (!supports.length) {
      throw new Error(`casefile narrative evidence ledger claim ${claim.id} has no current Casefile source support`);
    }
    for (const support of supports) {
      if (
        support.sourceIds.some((id) => !rail.sourceIds.includes(id))
        || support.upstreamClaimIds.some((id) => !rail.upstreamClaimIds.includes(id))
      ) {
        throw new Error(`casefile narrative evidence ledger claim ${claim.id} exceeds the admitted Casefile rail`);
      }
      for (const upstreamClaimId of support.upstreamClaimIds) {
        const mapClaim = evidence.evidenceShotMap.claimMappings.find((mapping) => mapping.claimId === upstreamClaimId);
        const mapHasSources = mapClaim?.bindings.some((binding) =>
          support.sourceIds.every((sourceId) => binding.sourceIds.includes(sourceId)),
        ) ?? false;
        const handoffHasSources = sourceBoundStorySpine.claimBindings.some((binding) =>
          binding.claimId === upstreamClaimId && support.sourceIds.every((sourceId) => binding.sourceIds.includes(sourceId)),
        );
        if (!mapHasSources || !handoffHasSources) {
          throw new Error(
            `casefile narrative evidence ledger claim ${claim.id} cannot be traced to the exact frozen Story Spine and evidence-map source support`,
          );
        }
      }
    }
  }
  return ledger;
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

/**
 * Freezes the full timed Story Spine only when every narration shot retains
 * the current reviewed Casefile claim/source binding. It is optional unless
 * the editor chooses the stricter Narrative Evidence Ledger path.
 */
export function attachCasefileEpisodeSourceBoundStorySpine(args: {
  episode: CasefileEpisodeWorkflow;
  storySpine: unknown;
  now?: Date;
}): CasefileEpisodeWorkflow {
  requireStatus(args.episode, "awaiting_cinematic_direction", "attach source-bound Story Spine");
  const evidence = requireEvidence(args.episode);
  if (args.episode.sourceBoundStorySpine) {
    throw new Error(
      "casefile episode source-bound Story Spine is already frozen; create a fresh immutable revision instead of replacing reviewed narration coverage",
    );
  }
  const sourceBoundStorySpine = createSourceBoundStorySpineHandoff({
    sourcePacket: args.episode.sourcePacket,
    sourceAdmission: args.episode.sourceAdmission,
    evidenceShotMap: evidence.evidenceShotMap,
    evidenceShotMapAdmission: evidence.evidenceShotMapAdmission,
    storySpine: args.storySpine,
    now: args.now,
  });
  if (sourceBoundStorySpine.caseId !== args.episode.caseId) {
    throw new Error("casefile source-bound Story Spine caseId does not match the admitted source packet");
  }
  return { ...args.episode, sourceBoundStorySpine };
}

/**
 * Stores a reviewed narrative-evidence ledger after its exact source-bound
 * narration exists. The operator cannot add a second upstream rail, a foreign
 * source, or a foreign claim through this desk; final cinematic admission
 * performs the stricter per-beat/visual-treatment proof again.
 */
export function attachCasefileEpisodeNarrativeEvidenceLedger(args: {
  episode: CasefileEpisodeWorkflow;
  claims: unknown;
  relations?: unknown;
  review: unknown;
  now?: Date;
}): CasefileEpisodeWorkflow {
  requireStatus(args.episode, "awaiting_cinematic_direction", "attach narrative evidence ledger");
  requireEvidence(args.episode);
  if (!args.episode.sourceBoundStorySpine) {
    throw new Error(
      "casefile narrative evidence ledger requires a frozen source-bound Story Spine before it can be attached",
    );
  }
  if (args.episode.narrativeEvidenceLedger) {
    throw new Error(
      "casefile narrative evidence ledger is already frozen; create a fresh immutable revision instead of replacing reviewed semantic evidence",
    );
  }
  const claims = z.array(CasefileNarrativeEvidenceClaimInputSchema).min(1).max(192).parse(args.claims);
  const relations = args.relations === undefined
    ? []
    : z.array(NarrativeEvidenceClaimRelationSchema).max(384).parse(args.relations);
  const review = NarrativeEvidenceLedgerReviewDraftSchema.parse(args.review);
  const railId = `casefile-source:${args.episode.caseId}`;
  const narrativeEvidenceLedger = assertCasefileNarrativeEvidenceLedgerAttachment({
    episode: args.episode,
    ledger: createNarrativeEvidenceLedger({
      subject: args.episode.sourcePacket.casePacket.title,
      evidenceRails: [{
        id: railId,
        kind: "casefile_source_packet",
        packetFingerprint: args.episode.sourceAdmission.sourcePacketFingerprint,
        sourceIds: args.episode.sourcePacket.sourceUsage.map((entry) => entry.sourceId),
        upstreamClaimIds: args.episode.sourcePacket.claimPrimarySources.map((entry) => entry.claimId),
      }],
      claims: claims.map((claim) => ({
        ...claim,
        supports: claim.supports.map((support) => ({ ...support, railId })),
      })),
      relations,
      editorialReview: review,
      now: args.now?.getTime(),
    }),
    now: args.now,
  });
  return { ...args.episode, narrativeEvidenceLedger };
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
  const submittedDirection = CinematicCaseDirectionSchema.parse(args.direction);
  if (
    submittedDirection.narrativeEvidenceLedgerFingerprint
    && submittedDirection.narrativeEvidenceLedgerFingerprint !== args.episode.narrativeEvidenceLedger?.contentFingerprint
  ) {
    throw new Error("casefile cinematic direction names a Narrative Evidence Ledger that is not frozen on this episode revision");
  }
  if (args.episode.narrativeEvidenceLedger && !args.episode.sourceBoundStorySpine) {
    throw new Error("casefile narrative evidence ledger requires its frozen source-bound Story Spine before cinematic drafting");
  }
  const direction: CinematicCaseDirection = args.episode.narrativeEvidenceLedger
    ? { ...submittedDirection, narrativeEvidenceLedgerFingerprint: args.episode.narrativeEvidenceLedger.contentFingerprint }
    : submittedDirection;
  const draft = planCinematicCaseSequenceDraft({
    direction,
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
    cinematicDirection: direction,
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
    ...(args.episode.narrativeEvidenceLedger
      ? {
          sourcePacket: args.episode.sourcePacket,
          narrativeEvidenceLedger: args.episode.narrativeEvidenceLedger,
          sourceBoundStorySpine: args.episode.sourceBoundStorySpine,
        }
      : {}),
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
import { z } from "zod";
