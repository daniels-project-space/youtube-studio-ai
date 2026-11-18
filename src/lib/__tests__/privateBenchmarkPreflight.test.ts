import assert from "node:assert/strict";
import { privateBenchmarkPreflight, privatePipelineConfigurationPreflight } from "../privateBenchmarkPreflight";

const pipeline = [
  ...["competitor_research", "topic_select", "critic_spec", "composer_brief", "editor_brief", "dp_brief", "director_brief", "script_gen", "qa_script", "originality_gate", "compliance_check"].map(block => ({ block })),
  { block: "narration_tts", params: { ttsProvider: "fish" } },
  ...["story_spine", "stock_footage", "entity_imagery", "music", "intro_card", "quote_overlays", "timeline_assemble", "length_check", "captions", "metadata", "package_to_opening_plan", "thumbnail_gen"].map(block => ({ block })),
  { block: "qa_visual" }, { block: "upload_draft" }, { block: "emit_bundle" }, { block: "notify" },
];
const before = JSON.stringify(pipeline);
const result = privateBenchmarkPreflight({ pipeline, identity: { voiceId: "legacy" } });
const manualResult = privatePipelineConfigurationPreflight({ pipeline, identity: { voiceId: "legacy" } });
assert.equal(JSON.stringify(pipeline), before, "preflight must not mutate the channel pipeline");
assert.deepEqual(result.removedDeliveryBlocks, ["upload_draft", "emit_bundle", "notify"]);
assert.deepEqual(manualResult.removedDeliveryBlocks, ["upload_draft", "emit_bundle", "notify"], "a deferred thumbnail is not a delivery block");
assert.ok(manualResult.blockers.some(blocker => /Qwen3 narration provider/.test(blocker)), "manual preflight retains the narration safety policy");
assert.ok(result.blockers.some(blocker => /Qwen3 narration provider/.test(blocker)));
assert.ok(result.blockers.some(blocker => /sealed, eligible channel route/.test(blocker)));
assert.equal(result.preflightReceiptChecked, false);
assert.equal(result.providerReadinessChecked, false);
const malformed = privateBenchmarkPreflight({ pipeline: [{ block: "upload_draft" }] });
assert.ok(malformed.blockers.length > 0);
const longPipeline = pipeline.map(entry => entry.block === "script_gen" ? { ...entry, params: { maxSeconds: 1800 } } : entry);
const long = privateBenchmarkPreflight({ pipeline: longPipeline, budget: 5, moduleConfig: { narration_tts: { ttsProvider: "qwen3", qwenSpeaker: "Ryan" } } });
assert.ok(long.blockers.some(blocker => /conservative narration reservation.*above.*narration limit/.test(blocker)), "long narration must expose the actual module reservation before a run is created");
const shortPipeline = pipeline.map(entry => entry.block === "script_gen" ? { ...entry, params: { maxSeconds: 180 } } : entry);
const lowBudget = privateBenchmarkPreflight({ pipeline: shortPipeline, budget: 1, moduleConfig: { narration_tts: { ttsProvider: "qwen3", qwenSpeaker: "Ryan" } } });
assert.ok(lowBudget.blockers.some(blocker => /conservative narration reservation.*above.*channel budget/.test(blocker)), "channel spending caps must remain effective");
const lowRequest = privatePipelineConfigurationPreflight({ pipeline: shortPipeline, budget: 10, moduleConfig: { narration_tts: { ttsProvider: "qwen3", qwenSpeaker: "Ryan" } } }, 1);
assert.ok(lowRequest.blockers.some(blocker => /above this request.s.*ceiling/.test(blocker)), "the owner's one-off spending ceiling must remain effective");
console.log("Private benchmark preflight is read-only and reports legacy route and Qwen blockers");
