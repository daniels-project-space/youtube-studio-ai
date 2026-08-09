import assert from "node:assert/strict";
import { registerAllBlocks } from "@/engine/blocks";
import { planChannelPipelineUpgrade } from "@/engine/channelPipelineUpgrade";
import type { PipelineEntry } from "@/engine/types";

registerAllBlocks();

const liveQuietStoic: PipelineEntry[] = [
  "competitor_research", "topic_select", "script_gen", "qa_script", "originality_gate",
  "compliance_check", "narration_tts", "stock_footage", "entity_imagery", "music",
  "intro_card", "quote_overlays", "timeline_assemble", "qa_refine", "length_check",
  "captions", "metadata", "thumbnail_gen", "qa_visual", "upload_draft", "notify", "cleanup",
].map((block) => ({ block }));

const quietPlan = planChannelPipelineUpgrade(liveQuietStoic);
assert.equal(quietPlan.changed, true);
assert.deepEqual(quietPlan.retired, ["qa_refine"]);
assert(!quietPlan.entries.some((entry) => entry.block === "qa_refine"));
assert(
  quietPlan.entries.some((entry) => entry.block === "story_spine"),
  "externally narrated legacy channels receive the current timed story spine",
);
for (const brief of ["director_brief", "dp_brief", "editor_brief", "composer_brief", "critic_spec"]) {
  assert(quietPlan.entries.some((entry) => entry.block === brief), `missing required ${brief}`);
}
assert(
  quietPlan.compilation.modules.every(
    (module) => module.certification !== "legacy" && module.certification !== "revoked",
  ),
);

const liveWhiteboard: PipelineEntry[] = [
  "competitor_research", "topic_select", "director_brief", "editor_brief", "composer_brief",
  "critic_spec", "compliance_check", "music", "whiteboard_scribe", "originality_gate",
  "metadata", "thumbnail_gen", "qa_visual", "upload_draft", "notify", "cleanup",
].map((block) => ({ block }));
const whiteboardPlan = planChannelPipelineUpgrade(liveWhiteboard);
assert(whiteboardPlan.entries.some((entry) => entry.block === "whiteboard_scribe"));
assert(whiteboardPlan.entries.some((entry) => entry.block === "dp_brief"));
for (const unrelated of ["script_gen", "narration_tts", "stock_footage", "timeline_assemble"]) {
  assert(
    !whiteboardPlan.entries.some((entry) => entry.block === unrelated),
    `specialist whiteboard flow must not inherit ${unrelated}`,
  );
}

// A persisted/custom channel may have been authored before evidence-backed
// visual QA existed. The production compiler must add exactly one real release
// gate directly before upload instead of trusting a caller-specific checklist.
const noVisualGate = liveWhiteboard.filter((entry) => entry.block !== "qa_visual");
const noVisualGatePlan = planChannelPipelineUpgrade(noVisualGate);
assert(noVisualGatePlan.inserted.includes("qa_visual"), "legacy upload pipelines must receive qa_visual");
const qaIndex = noVisualGatePlan.entries.findIndex((entry) => entry.block === "qa_visual");
const uploadIndex = noVisualGatePlan.entries.findIndex((entry) => entry.block === "upload_draft");
assert.equal(qaIndex, uploadIndex - 1, "qa_visual must review the final render immediately before upload");
assert.equal(noVisualGatePlan.entries[qaIndex]?.params?.qaProfile, "production");

const draftVisualGate = liveWhiteboard.map((entry) =>
  entry.block === "qa_visual" ? { ...entry, params: { qaProfile: "draft" } } : entry,
);
assert.throws(
  () => planChannelPipelineUpgrade(draftVisualGate),
  /upload_draft cannot use qa_visual qaProfile=draft/,
  "an upload pipeline cannot silently downgrade the mandatory visual gate",
);

const liveLofi: PipelineEntry[] = [
  { block: "competitor_research" },
  { block: "topic_select" },
  { block: "scene_planner", params: { visualStyle: "lofi", clipDurationSec: 5 } },
  { block: "keyframes", params: { aspectRatio: "16:9", visualStyle: "lofi" } },
  { block: "loop_clips", params: { clipDurationSec: 10, visualStyle: "lofi", crossfadeSec: 2.5 } },
  { block: "upscale", params: { targetResolution: "4k", targetFps: 30 } },
  { block: "music", params: { provider: "suno" } },
  { block: "metadata" },
  { block: "intro_card" },
  { block: "assemble", params: { durationSec: 180, deblurIntro: true } },
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft" },
  { block: "notify" },
  { block: "cleanup" },
];
const lofiPlan = planChannelPipelineUpgrade(liveLofi);
assert.deepEqual(lofiPlan.retired, ["intro_card"]);
assert(!lofiPlan.entries.some((entry) => entry.block === "intro_card"));
assert.equal(lofiPlan.compilation.videoRenderBinding.required, true);
assert.equal(lofiPlan.compilation.videoRenderBinding.compliant, true);
assert.deepEqual(
  lofiPlan.compilation.videoRenderBinding.selectedProviderExecutables,
  ["keyframes", "loop_clips"],
);

const secondPass = planChannelPipelineUpgrade(lofiPlan.entries);
assert.equal(secondPass.changed, false, "the persisted upgrade must be idempotent");
assert.deepEqual(secondPass.entries, lofiPlan.entries);

console.log("CHANNEL PIPELINE UPGRADE TESTS PASS");
