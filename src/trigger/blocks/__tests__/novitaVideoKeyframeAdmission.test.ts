import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { registerAllBlocks } from "@/engine/blocks";
import { generationProfile } from "@/engine/generationProfiles";
import { getManifest } from "@/engine/registry";
import {
  toNovitaPhaseProfile,
  type NovitaPhaseProfile,
  type NovitaRenderResult,
} from "@/lib/novitaRenderFarm";
import {
  assertAcceptedKeyframeSelection,
  assertNovitaRenderVideoOutputProofs,
} from "@/trigger/blocks/novitaRenderBlocks";

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

const native720VideoProfile: NovitaPhaseProfile = {
  ...toNovitaPhaseProfile(generationProfile("production"), "video"),
  width: 2560,
  height: 1408,
  stageOneWidth: 1280,
  stageOneHeight: 704,
};
const nativeInitialSha256 = "e".repeat(64);
const nativeEndSha256 = "f".repeat(64);
const native720Result: Pick<NovitaRenderResult, "videoOutputProofs" | "nativeInputGeometrySources"> = {
  videoOutputProofs: {
    "shot-a": {
      outputWidth: 2560,
      outputHeight: 1408,
      hasAudio: true,
      stageOneWidth: 1280,
      stageOneHeight: 704,
      spatialUpscaleFactor: 2 as const,
      pipeline: "distilled" as const,
      quantization: "fp8-cast" as const,
      offload: "cpu" as const,
      inputGeometry: {
        initial: { sha256: nativeInitialSha256, width: 1280, height: 704 },
        end: { sha256: nativeEndSha256, width: 1280, height: 704 },
      },
    },
  },
  nativeInputGeometrySources: {
    "shot-a": { initialSha256: nativeInitialSha256, endSha256: nativeEndSha256 },
  },
};
assert.doesNotThrow(
  () => assertNovitaRenderVideoOutputProofs({
    profile: native720VideoProfile,
    shotIds: ["shot-a"],
    result: native720Result,
  }),
  "novita_render_video must retain controller-sealed native input hashes through its final output-proof check",
);
assert.throws(
  () => assertNovitaRenderVideoOutputProofs({
    profile: native720VideoProfile,
    shotIds: ["shot-a"],
    result: { videoOutputProofs: native720Result.videoOutputProofs },
  }),
  /missing sealed input geometry sources/,
  "novita_render_video must fail closed if a native render result loses controller-sealed input bindings",
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
assert(
  "studioLtxCreativeAdapterSelectionsByShot" in (video.optionalConsumes ?? {}),
  "novita_render_video must declare the immutable per-shot Studio adapter map when a serialized route emits one",
);
assert(
  "narrativeShotControl" in (video.optionalConsumes ?? {}),
  "a per-shot Studio adapter map must be cross-checked against the sealed narrative shot-control receipt",
);
const source = readFileSync(new URL("../novitaRenderBlocks.ts", import.meta.url), "utf8");
assert.match(
  source,
  /studioLtxShotAdapterSelectionsFromUnknown\(\s*ctx\.store\["studioLtxCreativeAdapterSelectionsByShot"\]/,
  "the renderer must parse the immutable per-shot adapter map before direct LTX work",
);
assert.match(
  source,
  /creativeAdapterForShot = scopedStudioAdapterByShot[\s\S]*scopedStudioAdapter\?\.selection[\s\S]*creativeAdapter/,
  "the renderer must choose the exact per-shot selection rather than reapplying a character LoRA globally",
);
assert.match(
  source,
  /const renderedAdapterByShot = new Map\([\s\S]*shotsWithStills\.map\(\(shot\) => \[shot\.id, shot\.creativeAdapter\][\s\S]*?creativeAdapter: renderedAdapterByShot\.get\(shot\.id\)/,
  "the durable render manifest must retain the exact adapter used for each initial LTX shot",
);
assert.match(
  source,
  /phase: "video",[\s\S]*?creativeAdapter: item\.creativeAdapter,[\s\S]*?renderVideo\(qualityRecoveryRenderCfg\(ctx, "video", profile, repair\.shot\)\)/,
  "a video QA repair must replay the rejected clip's manifest-bound Studio adapter, not a mutable global parameter",
);

console.log("Novita video keyframe-admission binding tests passed");
