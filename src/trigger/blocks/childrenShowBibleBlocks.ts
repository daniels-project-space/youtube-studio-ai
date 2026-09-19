import { assertChildrenShowBible } from "@/engine/childrenShowBible";
import type { Block } from "@/engine/types";

/**
 * Provider-free, standalone series-identity validator. It accepts an already
 * approved curriculum seed plus a completed generic learning plan and emits a
 * durable continuity receipt. It neither selects a curriculum objective nor
 * invokes a script, renderer, safety gate, or delivery module.
 */
const childrenShowBible: Block = {
  id: "children_show_bible",
  consumes: [
    "childrenShowBibleInput", "curriculumEpisodeSeed", "curriculumEpisodeSeedApproval",
    "episodeGraph", "lessonContract", "contentLane",
  ],
  produces: ["childrenShowBible", "childrenShowBibleApproval"],
  run: async (ctx) => {
    const admitted = assertChildrenShowBible({
      input: ctx.store["childrenShowBibleInput"],
      curriculumEpisodeSeed: ctx.store["curriculumEpisodeSeed"],
      curriculumEpisodeSeedApproval: ctx.store["curriculumEpisodeSeedApproval"],
      episodeGraph: ctx.store["episodeGraph"],
      lessonContract: ctx.store["lessonContract"],
      contentLane: ctx.store["contentLane"],
    });
    ctx.log(
      `children_show_bible: ${admitted.bible.identity.recurringCharacters.length} original recurring character(s) + ` +
        `five-stage participation pattern admitted; provider calls: 0; private human child-editor review only`,
    );
    return {
      childrenShowBible: admitted.bible,
      childrenShowBibleApproval: admitted.receipt,
    };
  },
};

export const childrenShowBibleBlocks: Block[] = [childrenShowBible];
