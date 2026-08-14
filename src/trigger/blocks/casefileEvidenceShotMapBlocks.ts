import type { Block } from "@/engine/types";
import { assertCasefileEvidenceShotMap } from "@/engine/casefileEvidenceShotMap";

/**
 * Reviewer-gated documentary visual handoff. This has no provider, planner,
 * renderer, publishing, or channel-family side effect.
 */
const casefileEvidenceShotMap: Block = {
  id: "casefile_evidence_shot_map",
  consumes: [
    "casefileSourcePacket",
    "casefileSourceAdmission",
    "casefileEvidenceShotMapInput",
    "sceneManifest",
    "shotList",
  ],
  produces: ["casefileEvidenceShotMap", "casefileEvidenceShotMapAdmission"],
  run: async (ctx) => {
    const admitted = assertCasefileEvidenceShotMap({
      input: ctx.store["casefileEvidenceShotMapInput"],
      sourcePacket: ctx.store["casefileSourcePacket"],
      sourceAdmission: ctx.store["casefileSourceAdmission"],
      sceneManifest: ctx.store["sceneManifest"],
      shotList: ctx.store["shotList"],
    });
    ctx.log(
      `casefile_evidence_shot_map: ${admitted.receipt.factualClaimCount} factual claim(s) → ` +
        `${admitted.receipt.bindingCount} reviewed scene/shot binding(s); provider calls: 0; private human-review draft only`,
    );
    return {
      casefileEvidenceShotMap: admitted.map,
      casefileEvidenceShotMapAdmission: admitted.receipt,
    };
  },
};

export const casefileEvidenceShotMapBlocks: Block[] = [casefileEvidenceShotMap];
