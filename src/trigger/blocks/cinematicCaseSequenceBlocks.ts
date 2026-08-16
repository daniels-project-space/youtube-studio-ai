import type { Block } from "@/engine/types";
import { assertCinematicCaseSequence } from "@/engine/cinematicCaseSequence";
import { admitCinematicFinalMasterQa } from "@/engine/cinematicFinalMasterQaAdmission";
import {
  finalizeCinematicCaseSequenceDraft,
  planCinematicCaseSequenceDraft,
} from "@/engine/cinematicCaseSequenceDraft";

/**
 * Produces the editor-ready creative draft from verified facts. It contains no
 * invented editorial approval and never calls a model or renderer.
 */
const cinematicCaseSequenceDraft: Block = {
  id: "cinematic_case_sequence_draft",
  consumes: ["cinematicCaseDirection", "casefileEvidenceShotMap", "sceneManifest", "shotList"],
  produces: ["cinematicCaseSequenceDraft"],
  run: async (ctx) => {
    const draft = planCinematicCaseSequenceDraft({
      direction: ctx.store["cinematicCaseDirection"],
      evidenceShotMap: ctx.store["casefileEvidenceShotMap"],
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
    const admitted = assertCinematicCaseSequence({
      input: ctx.store["cinematicCaseSequenceInput"],
      sourceAdmission: ctx.store["casefileSourceAdmission"],
      evidenceShotMap: ctx.store["casefileEvidenceShotMap"],
      evidenceShotMapAdmission: ctx.store["casefileEvidenceShotMapAdmission"],
      sceneManifest: ctx.store["sceneManifest"],
      shotList: ctx.store["shotList"],
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
