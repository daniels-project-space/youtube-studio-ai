import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { assertAcceptedKeyframeSelection } from "@/trigger/blocks/novitaRenderBlocks";

const generation = {
  contractVersion: "1.0.0" as const,
  profileId: "production" as const,
  model: "Tongyi-MAI/Z-Image-Turbo",
  revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
  checkpoint: "Z-Image-Turbo",
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
  "a selected still from a different candidate cannot authorize H3",
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
  "a report that claims pass below its own threshold cannot authorize H3",
);

registerAllBlocks();
const video = getManifest("novita_render_video");
assert(video, "novita_render_video must be registered");
assert(
  "assetQaReport" in video.consumes,
  "novita_render_video must hard-consume the accepted keyframe QA receipt before it can create an H3 worker",
);
assert(
  !("assetQaReport" in (video.optionalConsumes ?? {})),
  "the accepted keyframe QA receipt must never become optional",
);
const source = readFileSync(new URL("../novitaRenderBlocks.ts", import.meta.url), "utf8");
const videoStart = source.indexOf("export const novitaRenderVideo");
const videoEnd = source.indexOf("export const qaShots");
assert(videoStart >= 0 && videoEnd > videoStart, "standard video route boundaries must remain discoverable");
const videoSource = source.slice(videoStart, videoEnd);
assert.match(
  videoSource,
  /minimaxH3Readiness\("novita"\)[\s\S]*assertMiniMaxH3R2ModelManifest\(\)/,
  "the standard renderer must prove the admitted Novita H3 runtime and immutable R2 model pack before spend",
);
assert.match(
  videoSource,
  /renderStandardH3Take\(\{[\s\S]*firstFrameKey: selectedStill\.stillKey[\s\S]*maxCostUsd: h3TakeBudget/,
  "every H3 take must be bound to the accepted still and a bounded per-take budget",
);
assert.match(
  videoSource,
  /generation: \{[\s\S]*h3ShotGenerationIdentity\(profile\)[\s\S]*renderedDurationSec/,
  "the durable render manifest must retain H3 identity and observed native source duration",
);
assert.doesNotMatch(
  videoSource,
  /renderVideo\(|LtxCreativeAdapter|studioLtx/i,
  "the active standard video route must not dispatch or claim an LTX adapter",
);

console.log("Novita H3 video keyframe-admission binding tests passed");
