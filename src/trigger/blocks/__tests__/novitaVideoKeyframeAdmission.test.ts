import assert from "node:assert/strict";

import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { assertAcceptedKeyframeSelection } from "@/trigger/blocks/novitaRenderBlocks";

const generation = {
  contractVersion: "1.0.0" as const,
  profileId: "production" as const,
  model: "Lightricks/LTX-2.5",
  revision: "ce298b6b078f52562e928b55a62d6f34cbe58c2b",
  checkpoint: "ltx-2.5-distilled-fp8.safetensors",
  precision: "bf16" as const,
  width: 1280,
  height: 704,
  steps: 8,
  allowFallback: false as const,
};

const selected = {
  version: "1.0.0" as const,
  generation,
  items: [
    {
      shotId: "shot-a",
      stillKey: "runs/test/still-a.png",
      candidateIndex: 1,
      score: 0.91,
      semanticAlignment: 0.93,
      continuity: 0.9,
      artifactFree: 0.92,
      notes: ["Accepted mannequin wardrobe and evidence composition."],
    },
    {
      shotId: "shot-b",
      stillKey: "runs/test/still-b.png",
      candidateIndex: 0,
      score: 0.9,
      semanticAlignment: 0.91,
      continuity: 0.9,
      artifactFree: 0.9,
      notes: ["Accepted causal reveal frame."],
    },
  ],
};

const qaReport = {
  version: "1.0.0" as const,
  required: true as const,
  graderRan: true as const,
  passed: true as const,
  shotCount: 2,
  candidateCount: 3,
  selected: [
    { shotId: "shot-a", candidateIndex: 1, score: 0.91, threshold: 0.86 },
    { shotId: "shot-b", candidateIndex: 0, score: 0.9, threshold: 0.86 },
  ],
};

assert.doesNotThrow(() =>
  assertAcceptedKeyframeSelection({
    shotIds: ["shot-a", "shot-b"],
    selected,
    assetQaReport: qaReport,
  }),
);

assert.throws(
  () =>
    assertAcceptedKeyframeSelection({
      shotIds: ["shot-a", "shot-b"],
      selected,
      assetQaReport: {
        ...qaReport,
        selected: [{ ...qaReport.selected[0], candidateIndex: 0 }, qaReport.selected[1]],
      },
    }),
  /keyframe QA selection mismatch for shot-a/,
  "a selected still from a different candidate cannot authorize LTX",
);

assert.throws(
  () =>
    assertAcceptedKeyframeSelection({
      shotIds: ["shot-a", "shot-b"],
      selected,
      assetQaReport: {
        ...qaReport,
        selected: [{ ...qaReport.selected[0], threshold: 0.95 }, qaReport.selected[1]],
      },
    }),
  /does not meet its accepted QA threshold/,
  "a report that claims pass below its own threshold cannot authorize LTX",
);

registerAllBlocks();
const video = getManifest("novita_render_video");
assert(video, "novita_render_video must be registered");
assert(
  "assetQaReport" in video.consumes,
  "novita_render_video must hard-consume the accepted keyframe QA receipt before it can create an LTX worker",
);
assert(
  !("assetQaReport" in (video.optionalConsumes ?? {})),
  "the accepted keyframe QA receipt must never become optional",
);

console.log("Novita video keyframe-admission binding tests passed");
