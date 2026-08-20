import type { Block } from "@/engine/types";
import { getCutSheet, getStructure, getVisualBrief } from "@/engine/creative/brief";
import { planStorySpine } from "@/engine/storySpine";
import { assertEditorialEvidencePacketNarrationAlignment } from "@/engine/editorialEvidenceNarration";
import { resolveContentLane } from "@/engine/contentLane";
import { assertCurriculumEpisodeSeedForStoryInput } from "@/engine/curriculumEpisodeSeed";
import { buildEpisodeSpec } from "@/engine/qualityEvidence";
import { measureHookWindow } from "@/lib/hookcraft";

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
    const lane = resolveContentLane({
      stored: ctx.store["contentLane"],
      pipeline: [],
    });
    if (lane.key === "children_learning_supervised") {
      assertCurriculumEpisodeSeedForStoryInput({
        curriculumEpisodeSeed: ctx.store["curriculumEpisodeSeed"],
        curriculumEpisodeSeedApproval: ctx.store["curriculumEpisodeSeedApproval"],
        contentLane: lane,
        topic: ctx.store["topic"],
      });
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
    if (ctx.store["editorialEvidencePacket"] !== undefined) {
      const editorialNarrationBinding = assertEditorialEvidencePacketNarrationAlignment({
        editorialEvidencePacket: ctx.store["editorialEvidencePacket"],
        storySpine: spine,
      });
      ctx.log(
        `story_spine: editorial narration binding passed for ${editorialNarrationBinding.claimBindings.length} reviewed claims`,
      );
    }
    // MEASURED HOOK GATE (src/lib/hookcraft.ts measureHookWindow) — additive
    // to hook_craft's word-estimate lintHook, which runs on the written hook
    // text long before any shot is timed. This instead reads the REAL
    // t0/t1 shot boundaries this block just produced and requires at least
    // one meaningful shot transition inside the first ~10s of audio
    // timeline, per measureHookWindow's own doc comment ("Run this AFTER
    // Story Spine planning ... as a guard-stage check"). Same hard-gate
    // convention as this block's own sentenceTimings check above and the
    // sibling guard-stage blocks (qa_script/originality_gate/
    // compliance_check): a confirmed failure throws and halts the pipeline
    // rather than shipping a video that holds on one static shot too long.
    const hookGate = measureHookWindow(spine.shotList);
    if (!hookGate.pass) {
      throw new Error(`story_spine: measured hook gate failed — ${hookGate.issues.join(" | ")}`);
    }
    ctx.log(
      `story_spine: measured hook gate passed (first real transition @ ${hookGate.firstTransitionSec}s, ` +
        `window ${hookGate.windowSec}s)`,
    );
    // Touch the Editor artifact as an explicit dependency and record its exact
    // versioned handoff even though the deterministic EDL owns hard timing.
    const cutSheet = getCutSheet(ctx.store);
    const editorEdl = {
      ...spine.editorEdl,
      editorBrief: cutSheet ?? null,
    };
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
