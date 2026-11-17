import assert from "node:assert/strict";
import { buildManualPrivateVideoPipeline } from "../manualPrivateVideoPipeline";
const source = [
  { block: "topic_select", params: { targetSeconds: 1800 } },
  { block: "script_gen", params: { maxSeconds: 1800 } },
  { block: "assemble", params: { durationSec: 1800 } },
  { block: "thumbnail_gen" }, { block: "qa_visual" }, { block: "upload_draft" }, { block: "emit_bundle" },
];
const before = JSON.stringify(source);
const result = buildManualPrivateVideoPipeline(source);
assert.equal(JSON.stringify(source), before);
assert.deepEqual(result.slice(0, 3), source.slice(0, 3), "full duration and all creative settings remain unchanged");
assert.deepEqual(result.map(entry => entry.block), ["topic_select", "script_gen", "assemble", "qa_visual"]);
assert.equal(result.at(-1)?.params?.channelInceptionProbeThumbnailMode, "deferred_mvp");
console.log("Manual private video retains requested duration and excludes delivery and thumbnail generation");
