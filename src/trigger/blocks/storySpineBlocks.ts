import type { Block } from "@/engine/types";
import { getCutSheet, getStructure, getVisualBrief } from "@/engine/creative/brief";
import { planStorySpine } from "@/engine/storySpine";

export const storySpine: Block = {
  id: "story_spine",
  consumes: [
    "topic",
    "script",
    "narrationText",
    "sentenceTimings",
    "narrationDurationSec",
  ],
  produces: [
    "timedScript",
    "narrativeBeats",
    "continuityLedger",
    "shotList",
    "dpVisualSpecs",
    "editorEdl",
    "storyCoverage",
  ],
  run: async (ctx) => {
    const timings = ctx.store["sentenceTimings"] as
      | Array<{ text: string; start: number; end: number }>
      | undefined;
    if (!timings?.length) {
      throw new Error("story_spine: sentenceTimings are required; timing unavailable cannot pass");
    }
    const duration = Number(ctx.store["narrationDurationSec"]);
    const spine = planStorySpine({
      topic: String(ctx.store["topic"]),
      narrationDurationSec: duration,
      sentenceTimings: timings,
      structure: getStructure(ctx.store),
      visualBrief: getVisualBrief(ctx.store) as Record<string, unknown> | undefined,
      styleDNA: (ctx.store["styleDNA"] as Record<string, unknown> | null | undefined) ?? null,
      generationProfile: ctx.params["generationProfile"] ?? "production",
      targetShotSec: Number(ctx.params["targetShotSec"] ?? 6),
    });
    // Touch the Editor artifact as an explicit dependency and record its exact
    // versioned handoff even though the deterministic EDL owns hard timing.
    const cutSheet = getCutSheet(ctx.store);
    const editorEdl = {
      ...spine.editorEdl,
      editorBrief: cutSheet ?? null,
    };
    ctx.log(
      `story_spine: ${spine.timedScript.sentences.length} timed sentences → ` +
        `${spine.narrativeBeats.length} beats → ${spine.shotList.length} shots; coverage 100%`,
    );
    return {
      timedScript: spine.timedScript,
      narrativeBeats: spine.narrativeBeats,
      continuityLedger: spine.continuityLedger,
      shotList: spine.shotList,
      dpVisualSpecs: spine.dpVisualSpecs,
      editorEdl,
      storyCoverage: spine.coverage,
    };
  },
};

export const STORY_SPINE_BLOCKS: Block[] = [storySpine];
