import assert from "node:assert/strict";
import { privateBenchmarkPreflight } from "../privateBenchmarkPreflight";

const pipeline = [
  ...["competitor_research", "topic_select", "critic_spec", "composer_brief", "editor_brief", "dp_brief", "director_brief", "script_gen", "qa_script", "originality_gate", "compliance_check"].map(block => ({ block })),
  { block: "narration_tts", params: { ttsProvider: "fish" } },
  ...["story_spine", "stock_footage", "entity_imagery", "music", "intro_card", "quote_overlays", "timeline_assemble", "length_check", "captions", "metadata", "package_to_opening_plan", "thumbnail_gen"].map(block => ({ block })),
  { block: "qa_visual" }, { block: "upload_draft" }, { block: "emit_bundle" }, { block: "notify" },
];
const before = JSON.stringify(pipeline);
const result = privateBenchmarkPreflight({ pipeline, identity: { voiceId: "legacy" } });
assert.equal(JSON.stringify(pipeline), before, "preflight must not mutate the channel pipeline");
assert.deepEqual(result.removedDeliveryBlocks, ["upload_draft", "emit_bundle", "notify"]);
assert.ok(result.blockers.some(blocker => /Qwen3 narration provider/.test(blocker)));
assert.ok(result.blockers.some(blocker => /sealed, eligible channel route/.test(blocker)));
assert.equal(result.preflightReceiptChecked, false);
assert.equal(result.providerReadinessChecked, false);
const malformed = privateBenchmarkPreflight({ pipeline: [{ block: "upload_draft" }] });
assert.ok(malformed.blockers.length > 0);
console.log("Private benchmark preflight is read-only and reports legacy route and Qwen blockers");
