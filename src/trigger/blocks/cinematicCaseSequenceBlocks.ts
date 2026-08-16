import type { Block } from "@/engine/types";
import {
  CinematicCaseSequenceInputSchema,
  assertCinematicCaseSequence,
} from "@/engine/cinematicCaseSequence";
import { admitCinematicFinalMasterQa } from "@/engine/cinematicFinalMasterQaAdmission";
import {
  CinematicCaseDirectionSchema,
  finalizeCinematicCaseSequenceDraft,
  planCinematicCaseSequenceDraft,
} from "@/engine/cinematicCaseSequenceDraft";
import {
  CasefileEvidenceShotMapSchema,
  casefileShotPlanFingerprint,
} from "@/engine/casefileEvidenceShotMap";
import { validateSourceBoundStorySpineHandoff } from "@/engine/sourceBoundStorySpine";
import { ShotPlanSchema } from "@/engine/storySpine";
import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";

/**
 * The source-bound Story Spine is a private proof artifact, but merely
 * registering it is not sufficient: the cinematic route must prove that the
 * exact direction/input still refers to the same reviewed Casefile map and
 * timed ShotPlan before it can create a sequence or a render handoff.
 */
function assertCurrentSourceBoundStorySpine(args: {
  sourceBoundStorySpine: unknown;
  caseId: string;
  sourcePacketFingerprint: string;
  evidenceShotMapFingerprint: string;
  shotPlanFingerprint: string;
  evidenceShotMap: unknown;
  shotList: unknown;
  stage: "draft" | "sequence";
}): void {
  let handoff: ReturnType<typeof validateSourceBoundStorySpineHandoff>;
  try {
    handoff = validateSourceBoundStorySpineHandoff(args.sourceBoundStorySpine);
  } catch (error) {
    throw new Error(
      `cinematic ${args.stage}: source-bound Story Spine handoff is missing or invalid; ` +
        "run source_bound_story_spine from the current reviewed Casefile artifacts before cinematic planning",
      { cause: error },
    );
  }

  const evidenceShotMap = CasefileEvidenceShotMapSchema.parse(args.evidenceShotMap);
  const shotList = ShotPlanSchema.array().min(1).max(2_000).parse(args.shotList);
  const currentShotPlanFingerprint = casefileShotPlanFingerprint(shotList);
  const sourceFieldsMatch =
    handoff.caseId === args.caseId &&
    handoff.sourcePacketFingerprint === args.sourcePacketFingerprint &&
    handoff.evidenceShotMapFingerprint === args.evidenceShotMapFingerprint &&
    handoff.storySpineShotPlanFingerprint === args.shotPlanFingerprint;
  const currentArtifactsMatch =
    evidenceShotMap.caseId === args.caseId &&
    evidenceShotMap.sourcePacketFingerprint === args.sourcePacketFingerprint &&
    evidenceShotMap.contentFingerprint === args.evidenceShotMapFingerprint &&
    evidenceShotMap.shotPlanFingerprint === args.shotPlanFingerprint &&
    currentShotPlanFingerprint === args.shotPlanFingerprint;

  if (!sourceFieldsMatch || !currentArtifactsMatch) {
    throw new Error(
      `cinematic ${args.stage}: source-bound Story Spine handoff is stale or mismatched for the current ` +
        "Casefile direction/evidence/ShotPlan; regenerate it and obtain a fresh private editorial review",
    );
  }
}

/**
 * Produces the editor-ready creative draft from verified facts. It contains no
 * invented editorial approval and never calls a model or renderer.
 */
const cinematicCaseSequenceDraft: Block = {
  id: "cinematic_case_sequence_draft",
  consumes: ["cinematicCaseDirection", "casefileEvidenceShotMap", "sourceBoundStorySpine", "sceneManifest", "shotList"],
  produces: ["cinematicCaseSequenceDraft"],
  run: async (ctx) => {
    const direction = CinematicCaseDirectionSchema.parse(ctx.store["cinematicCaseDirection"]);
    const evidenceShotMap = CasefileEvidenceShotMapSchema.parse(ctx.store["casefileEvidenceShotMap"]);
    const shotPlanFingerprint = casefileShotPlanFingerprint(
      ShotPlanSchema.array().min(1).max(2_000).parse(ctx.store["shotList"]),
    );
    assertCurrentSourceBoundStorySpine({
      sourceBoundStorySpine: ctx.store["sourceBoundStorySpine"],
      caseId: direction.caseId,
      sourcePacketFingerprint: evidenceShotMap.sourcePacketFingerprint,
      evidenceShotMapFingerprint: evidenceShotMap.contentFingerprint,
      shotPlanFingerprint,
      evidenceShotMap,
      shotList: ctx.store["shotList"],
      stage: "draft",
    });
    const draft = planCinematicCaseSequenceDraft({
      direction,
      evidenceShotMap,
      sceneManifest: ctx.store["sceneManifest"],
      shotList: ctx.store["shotList"],
    });
    ctx.log(
      `cinematic_case_sequence_draft: ${draft.content.beats.length} causal beats / ` +
        `${draft.content.beats.flatMap((beat) => beat.shots).length} source-bound coverage shots; provider calls: 0; awaiting human editorial signature`,
    );
    return { cinematicCaseSequenceDraft: draft };
  },
};

/** A human editorial signature can finalize an unchanged deterministic draft. */
const cinematicCaseSequenceFinalize: Block = {
  id: "cinematic_case_sequence_finalize",
  consumes: ["cinematicCaseSequenceDraft", "cinematicSequenceEditorialReview"],
  produces: ["cinematicCaseSequenceInput"],
  run: async (ctx) => {
    const input = finalizeCinematicCaseSequenceDraft({
      draft: ctx.store["cinematicCaseSequenceDraft"],
      editorialReview: ctx.store["cinematicSequenceEditorialReview"],
    });
    ctx.log("cinematic_case_sequence_finalize: reviewer signature bound to exact draft; provider calls: 0");
    return { cinematicCaseSequenceInput: input };
  },
};

/**
 * Evidence-led cinematic coverage handoff. It runs only after Casefile source
 * and claim-to-shot admission, then gives the generated-footage renderer an
 * exact multi-shot plan rather than permission to improvise a crime scene.
 */
const cinematicCaseSequence: Block = {
  id: "cinematic_case_sequence",
  consumes: [
    "casefileSourceAdmission",
    "casefileEvidenceShotMap",
    "casefileEvidenceShotMapAdmission",
    "sourceBoundStorySpine",
    "cinematicCaseSequenceInput",
    "sceneManifest",
    "shotList",
  ],
  produces: [
    "cinematicSequencePlan",
    "cinematicGeneratedScenePlan",
    "cinematicCreativeLocks",
    "cinematicEditDecisionList",
    "cinematicCaseSequenceAdmission",
    "cinematicFinalMasterQaAdmission",
  ],
  run: async (ctx) => {
    const input = CinematicCaseSequenceInputSchema.parse(ctx.store["cinematicCaseSequenceInput"]);
    // A mechanics packet is optional so normal Casefile review work remains
    // runnable. Once a human attaches one to the signed sequence, however,
    // this live LTX path resolves the fixed Casefile quality contract and
    // carries it through prompt construction and final-master QA.
    const referenceMechanicsPacket = input.referenceMechanicsPacket;
    const referenceQuality = referenceMechanicsPacket
      ? referenceQualityContractFor("documentary_collage_short")
      : undefined;
    assertCurrentSourceBoundStorySpine({
      sourceBoundStorySpine: ctx.store["sourceBoundStorySpine"],
      caseId: input.caseId,
      sourcePacketFingerprint: input.sourcePacketFingerprint,
      evidenceShotMapFingerprint: input.evidenceShotMapFingerprint,
      shotPlanFingerprint: input.shotPlanFingerprint,
      evidenceShotMap: ctx.store["casefileEvidenceShotMap"],
      shotList: ctx.store["shotList"],
      stage: "sequence",
    });
    const admitted = assertCinematicCaseSequence({
      input,
      sourceAdmission: ctx.store["casefileSourceAdmission"],
      evidenceShotMap: ctx.store["casefileEvidenceShotMap"],
      evidenceShotMapAdmission: ctx.store["casefileEvidenceShotMapAdmission"],
      sceneManifest: ctx.store["sceneManifest"],
      shotList: ctx.store["shotList"],
      ...(referenceMechanicsPacket && referenceQuality
        ? { referenceMechanicsPacket, referenceQuality }
        : {}),
    });
    const cinematicFinalMasterQaAdmission = admitCinematicFinalMasterQa({
      creativeLocks: admitted.creativeLocks,
      editDecisionList: admitted.editDecisionList,
    });
    ctx.log(
      `cinematic_case_sequence: ${admitted.generatedScenePlan.scenes.length} source-bound coverage shots; ` +
        `provider calls: 0; ${cinematicFinalMasterQaAdmission.reviewCallCount} final-master non-Google review call(s) ` +
        `reserved at $${cinematicFinalMasterQaAdmission.reviewCostUsd.toFixed(2)} before Novita; ` +
        "faceless-cast/cut/continuity locks → private human-review only",
    );
    return {
      cinematicSequencePlan: admitted.plan,
      cinematicGeneratedScenePlan: admitted.generatedScenePlan,
      cinematicCreativeLocks: admitted.creativeLocks,
      cinematicEditDecisionList: admitted.editDecisionList,
      cinematicCaseSequenceAdmission: admitted.receipt,
      cinematicFinalMasterQaAdmission,
    };
  },
};

export const cinematicCaseSequenceBlocks: Block[] = [
  cinematicCaseSequenceDraft,
  cinematicCaseSequenceFinalize,
  cinematicCaseSequence,
];
