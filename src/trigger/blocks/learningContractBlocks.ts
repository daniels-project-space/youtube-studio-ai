import type { Block } from "@/engine/types";
import { buildLearningContract } from "@/engine/learningContract";

/**
 * Provider-free bridge from an approved Episode Graph to a reusable learning
 * handoff. It locks what a later language, STEM, or children renderer must
 * teach without pretending to replace subject-matter or child-safety review.
 */
const learningContract: Block = {
  id: "learning_contract",
  consumes: ["episodeGraph", "contentLane"],
  produces: ["lessonContract"],
  run: async (ctx) => {
    const contract = buildLearningContract(ctx.store["episodeGraph"], ctx.store["contentLane"]);
    ctx.log(
      `learning_contract: ${contract.demonstrationBeatIds.length} learning beats locked ` +
      `for ${contract.audience} (${contract.level}; provider calls: 0)`,
    );
    return { lessonContract: contract };
  },
};

export const learningContractBlocks: Block[] = [learningContract];
