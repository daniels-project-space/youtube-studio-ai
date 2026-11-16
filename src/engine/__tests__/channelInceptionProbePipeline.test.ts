import assert from "node:assert/strict";

import type { PipelineEntry } from "../types";
import { buildChannelInceptionProbePipeline } from "../channelInceptionProbePipeline";

const source = [
  "topic_select",
  "script_gen",
  "narration_tts",
  "stock_footage",
  "thumbnail_gen",
  "assemble",
  "captions",
  "metadata",
  "qa_visual",
  "upload_draft",
  "emit_bundle",
].map((block) => ({ block, params: {} })) as PipelineEntry[];

const probe = buildChannelInceptionProbePipeline(source, { thumbnailMode: "deferred_mvp" });
const blocks = probe.map((entry) => entry.block);

assert.ok(blocks.includes("narration_tts"), "the private proof must exercise Qwen narration");
assert.ok(blocks.includes("assemble"), "the private proof must assemble a real output");
assert.ok(blocks.includes("captions"), "the private proof must exercise captions");
assert.ok(blocks.includes("metadata"), "the private proof must exercise metadata");
assert.ok(blocks.includes("qa_visual"), "the private proof must retain output QA");
assert.ok(!blocks.includes("thumbnail_gen"), "thumbnail work is deferred for the personal MVP");
assert.ok(!blocks.includes("upload_draft"), "the private proof must not publish or upload");
assert.ok(!blocks.includes("emit_bundle"), "the private proof must not emit a publishing bundle");

const script = probe.find((entry) => entry.block === "script_gen");
const assembly = probe.find((entry) => entry.block === "assemble");
assert.equal(script?.params?.["maxSeconds"], 60);
assert.equal(assembly?.params?.["durationSec"], 60);
assert.equal(
  probe.find((entry) => entry.block === "qa_visual")?.params?.[
    "channelInceptionProbeThumbnailMode"
  ],
  "deferred_mvp",
  "thumbnail deferral is explicit in the signed QA pipeline",
);
const normalProbe = buildChannelInceptionProbePipeline(source);
assert.ok(
  normalProbe.some((entry) => entry.block === "thumbnail_gen"),
  "ordinary private probes retain the production thumbnail module",
);
assert.equal(
  normalProbe.find((entry) => entry.block === "qa_visual")?.params?.[
    "channelInceptionProbeThumbnailMode"
  ],
  undefined,
  "ordinary private probes cannot opt out of thumbnail QA",
);

console.log("channel inception private probe pipeline contract passed");
