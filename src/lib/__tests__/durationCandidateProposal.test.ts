import assert from "node:assert/strict";
import { enforceLengthContract } from "@/engine/designerCore";
import { familyDurationContract } from "@/engine/families";
import { durationCandidateProposal, durationCandidateRouteOwned } from "@/lib/durationCandidateProposal";
import { ROUTE_OWNED_RUNTIME_PARAM_KEYS } from "@/engine/runtimeModuleConfig";
import { channelOverviewEffectivePipeline } from "@/lib/channelOverviewEffectivePipeline";
import type { PipelineEntry } from "@/engine/types";

const blocks = ["topic_select", "director_brief", "dp_brief", "editor_brief", "composer_brief", "critic_spec", "script_gen", "length_check", "assemble", "metadata", "metadata", "loop_clips", "music", "whiteboard_scribe", "lore_short", "motion_comic", "quiz_year", "topic_select", "other"];
assert.deepEqual(durationCandidateRouteOwned, ROUTE_OWNED_RUNTIME_PARAM_KEYS);
const pipeline: PipelineEntry[] = blocks.map((block, index) => ({ block, version: block === "metadata" && index === 9 ? "2.0.0-delivery-aware" : "1", params: { targetSeconds: 30, maxSeconds: 30, minSeconds: 10, durationSec: 60, trackCount: 20, preserve: "x" } }));
for (const family of ["music_loop", "narrated_stock"] as const) {
  const contract = familyDurationContract(family);
  for (let seconds = contract.minimumSeconds; seconds <= contract.maximumSeconds; seconds += contract.stepSeconds * 7) {
    const before = structuredClone(pipeline);
    const proposal = durationCandidateProposal({ family, pipeline }, seconds);
    assert.deepEqual({ pipeline: proposal.pipeline, changed: proposal.changed }, enforceLengthContract(pipeline, seconds, family));
    assert.deepEqual(pipeline, before);
  }
}
assert.throws(() => durationCandidateProposal({ family: "music_loop", pipeline, moduleConfig: { assemble: { durationSec: 7200 } } }, 10800), /overrides/);
assert.throws(() => durationCandidateProposal({ family: "music_loop", pipeline }, 3601), /whole-minute/);
const configured: PipelineEntry[] = [{ block: "assemble", params: { durationSec: 7200 } }, { block: "music", params: { trackCount: 4 } }];
const overrides = { music: { preset: "lofi", prompt: "quiet piano", trackCount: 4 } };
const configuredProposal = durationCandidateProposal({ family: "music_loop", pipeline: configured, moduleConfig: overrides }, 10800);
assert.deepEqual(overrides, { music: { preset: "lofi", prompt: "quiet piano", trackCount: 4 } });
assert.equal(configuredProposal.pipeline[1]?.params?.trackCount, 4);
const effective = channelOverviewEffectivePipeline(configuredProposal.pipeline, overrides);
assert.equal(effective?.[0]?.params?.durationSec, 10800);
assert.equal(effective?.[1]?.params?.trackCount, 4);
assert.equal(effective?.[1]?.params?.prompt, "quiet piano");
const conflicting = { music: { trackCount: 3, prompt: "ambient" } };
const reconciled = durationCandidateProposal({ family: "music_loop", pipeline: configured, moduleConfig: conflicting }, 10800);
assert.equal(reconciled.pipeline[1]?.params?.trackCount, 3);
assert.deepEqual(reconciled.moduleConfig, conflicting);
assert.equal(channelOverviewEffectivePipeline(reconciled.pipeline, reconciled.moduleConfig)?.[1]?.params?.trackCount, 3);
assert.deepEqual(conflicting, { music: { trackCount: 3, prompt: "ambient" } });
const effectiveBaseline = channelOverviewEffectivePipeline(configured, conflicting)!;
assert.deepEqual(channelOverviewEffectivePipeline(reconciled.pipeline, reconciled.moduleConfig), enforceLengthContract([...effectiveBaseline], 10800, "music_loop").pipeline);
const presetReconciled = durationCandidateProposal({ family: "music_loop", pipeline: [{ block: "assemble", params: { durationSec: 7200 } }, { block: "music", params: { trackCount: 2 } }], moduleConfig: { music: { preset: "lofi", prompt: "ambient" } } }, 10800);
assert.equal(presetReconciled.pipeline[1]?.params?.trackCount, 4);
assert.deepEqual(presetReconciled.moduleConfig, { music: { preset: "lofi", prompt: "ambient" } });
assert.throws(() => durationCandidateProposal({ family: "music_loop", pipeline: [...configured, configured[1]!], moduleConfig: overrides }, 10800), /repeated/);
assert.throws(() => durationCandidateProposal({ family: "music_loop", pipeline: configured, moduleConfig: { music: { trackCount: 99 } } }, 10800), /invalid/);
console.log("Duration candidate transformation matches designer across supported family ranges, including repeated blocks");
