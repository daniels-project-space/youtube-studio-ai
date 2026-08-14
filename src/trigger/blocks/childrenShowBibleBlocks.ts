import { assertChildrenShowBible } from "@/engine/childrenShowBible";
import type { Block } from "@/engine/types";

/**
 * Operator-supplied, provider-free children-show admission. It is intentionally
 * standalone: future supervised children render lanes can consume this durable
 * continuity receipt, while the existing family remains private-review-only.
 */
const childrenShowBible: Block = {
  id: "children_show_bible",
  consumes: ["childrenShowBibleInput", "episodeGraph", "lessonContract", "contentLane"],
  produces: ["childrenShowBible", "childrenShowBibleApproval"],
  run: async (ctx) => {
    const admitted = assertChildrenShowBible({
      input: ctx.store["childrenShowBibleInput"],
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
