import { buildChildrenVideoTreatment } from "@/engine/childrenVideoTreatment";
import type { Block } from "@/engine/types";

/**
 * Child-video creative direction only. It writes a typed handoff for visual,
 * motion, and thumbnail modules; it does not call Ernie/H3, assess safety, or
 * package/publish a video.
 */
const childrenVideoTreatment: Block = {
  id: "children_video_treatment",
  consumes: ["episodeGraph", "lessonContract", "childrenShowBible", "contentLane"],
  produces: ["childrenVideoTreatment"],
  run: async (ctx) => {
    const treatment = buildChildrenVideoTreatment({
      episodeGraph: ctx.store["episodeGraph"],
      lessonContract: ctx.store["lessonContract"],
      childrenShowBible: ctx.store["childrenShowBible"],
      contentLane: ctx.store["contentLane"],
    });
    ctx.log(
      `children_video_treatment: ${treatment.format.primarySurface} handoff sealed for Ernie, H3, and thumbnail consumers; provider calls: 0`,
    );
    return { childrenVideoTreatment: treatment };
  },
};

export const childrenVideoTreatmentBlocks: Block[] = [childrenVideoTreatment];
