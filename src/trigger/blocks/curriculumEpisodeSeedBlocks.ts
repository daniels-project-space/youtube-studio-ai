import { assertCurriculumEpisodeSeed } from "@/engine/curriculumEpisodeSeed";
import type { Block } from "@/engine/types";

/**
 * First supervised-children gate. It is deliberately local and reviewer-bound:
 * no model/provider is asked to invent curriculum or a child-facing identity.
 */
const curriculumEpisodeSeed: Block = {
  id: "curriculum_episode_seed",
  consumes: ["curriculumEpisodeSeedInput", "contentLane"],
  produces: ["curriculumEpisodeSeed", "curriculumEpisodeSeedApproval"],
  run: async (ctx) => {
    const admitted = assertCurriculumEpisodeSeed({
      input: ctx.store["curriculumEpisodeSeedInput"],
      contentLane: ctx.store["contentLane"],
    });
    ctx.log(
      `curriculum_episode_seed: one approved objective + ${admitted.seed.vocabularyAndActions.length} vocabulary/action item(s); ` +
        "provider calls: 0; private human child-editor review only",
    );
    return {
      curriculumEpisodeSeed: admitted.seed,
      curriculumEpisodeSeedApproval: admitted.receipt,
    };
  },
};

export const curriculumEpisodeSeedBlocks: Block[] = [curriculumEpisodeSeed];
