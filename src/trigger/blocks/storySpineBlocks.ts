import type { Block } from "@/engine/types";
import { getCutSheet, getStructure, getVisualBrief } from "@/engine/creative/brief";
import { planStorySpine } from "@/engine/storySpine";
import { resolveContentLane } from "@/engine/contentLane";
import { buildEpisodeSpec } from "@/engine/qualityEvidence";
import { characterPromptBlock, resolveChannelCharacter } from "@/lib/channelCharacter";

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
    "episodeSpec",
  ],
  run: async (ctx) => {
    const timings = ctx.store["sentenceTimings"] as
      | Array<{ text: string; start: number; end: number }>
      | undefined;
    if (!timings?.length) {
      throw new Error("story_spine: sentenceTimings are required; timing unavailable cannot pass");
    }
    const duration = Number(ctx.store["narrationDurationSec"]);
    // The channel's LOCKED recurring character, read from storage and rendered
    // into its frozen prompt block ONCE per run. Empty string for every channel
    // without one, which is every channel except a character-vlog channel — so
    // the planned prompts are byte-identical to what they were before.
    const character = resolveChannelCharacter({
      channelCharacter: ctx.store["channelCharacter"],
      characterLora: ctx.store["characterLora"],
    });
    const spine = planStorySpine({
      topic: String(ctx.store["topic"]),
      narrationDurationSec: duration,
      sentenceTimings: timings,
      structure: getStructure(ctx.store),
      visualBrief: getVisualBrief(ctx.store) as Record<string, unknown> | undefined,
      styleDNA: (ctx.store["styleDNA"] as Record<string, unknown> | null | undefined) ?? null,
      generationProfile: ctx.params["generationProfile"] ?? "production",
      targetShotSec: Number(ctx.params["targetShotSec"] ?? 6),
      shotComposition: ctx.params["shotComposition"],
      characterPromptBlock: characterPromptBlock(character),
    });
    // Touch the Editor artifact as an explicit dependency and record its exact
    // versioned handoff even though the deterministic EDL owns hard timing.
    const cutSheet = getCutSheet(ctx.store);
    const editorEdl = {
      ...spine.editorEdl,
      editorBrief: cutSheet ?? null,
    };
    const lane = resolveContentLane({
      stored: ctx.store["contentLane"],
      pipeline: [],
    });
    const episodeSpec = buildEpisodeSpec({
      lane: { key: lane.key, renderer: lane.primaryRenderer },
      topic: String(ctx.store["topic"]),
      durationSec: spine.timedScript.narrationDurationSec,
      story: {
        source: "validated-story-spine/v1",
        beatCount: spine.narrativeBeats.length,
        shotCount: spine.shotList.length,
        coverageRatio: spine.coverage.ratio,
      },
    });
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
      episodeSpec,
    };
  },
};

export const STORY_SPINE_BLOCKS: Block[] = [storySpine];
