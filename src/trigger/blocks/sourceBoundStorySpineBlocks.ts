import type { Block } from "@/engine/types";
import { createSourceBoundStorySpineHandoff } from "@/engine/sourceBoundStorySpine";
import { StorySpineSchema } from "@/engine/storySpine";

function storySpineFromStore(store: Readonly<Record<string, unknown>>) {
  return StorySpineSchema.parse({
    version: "1.0.0",
    timedScript: store["timedScript"],
    narrativeBeats: store["narrativeBeats"],
    continuityLedger: store["continuityLedger"],
    shotList: store["shotList"],
    dpVisualSpecs: store["dpVisualSpecs"],
    editorEdl: store["editorEdl"],
    coverage: store["storyCoverage"],
  });
}

/**
 * Provider-free source/evidence → Story Spine boundary. It does not plan a
 * documentary, make a render, or authorize a family; it merely makes a
 * current human-reviewed Casefile map usable by source-led consumers.
 */
const sourceBoundStorySpine: Block = {
  id: "source_bound_story_spine",
  consumes: [
    "casefileSourcePacket",
    "casefileSourceAdmission",
    "casefileEvidenceShotMap",
    "casefileEvidenceShotMapAdmission",
    "timedScript",
    "narrativeBeats",
    "continuityLedger",
    "shotList",
    "dpVisualSpecs",
    "editorEdl",
    "storyCoverage",
  ],
  produces: ["sourceBoundStorySpine"],
  run: async (ctx) => {
    const handoff = createSourceBoundStorySpineHandoff({
      sourcePacket: ctx.store["casefileSourcePacket"],
      sourceAdmission: ctx.store["casefileSourceAdmission"],
      evidenceShotMap: ctx.store["casefileEvidenceShotMap"],
      evidenceShotMapAdmission: ctx.store["casefileEvidenceShotMapAdmission"],
      storySpine: storySpineFromStore(ctx.store),
    });
    ctx.log(
      `source_bound_story_spine: ${handoff.claimBindings.length} reviewed claim binding(s) → ` +
        `${handoff.storySpine.shotList.length} timed source-bound shot(s); provider calls: 0; private human-review only`,
    );
    return { sourceBoundStorySpine: handoff };
  },
};

export const sourceBoundStorySpineBlocks: Block[] = [sourceBoundStorySpine];
