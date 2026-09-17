import assert from "node:assert/strict";

import { validateQualifiedShotRender } from "@/engine/renderArtifacts";
import {
  MINIMAX_H3_MANIFEST_SHA256,
  MINIMAX_H3_MODEL,
  MINIMAX_H3_MODEL_REVISION,
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
} from "@/lib/minimaxH3";

const nativeDurationSec = MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps;

const generation = {
  contractVersion: "1.0.0" as const,
  profileId: "production" as const,
  model: MINIMAX_H3_MODEL,
  revision: MINIMAX_H3_MODEL_REVISION,
  checkpoint: MINIMAX_H3_RUNTIME_ID,
  precision: "bf16" as const,
  width: MINIMAX_H3_PROFILE.width,
  height: MINIMAX_H3_PROFILE.height,
  steps: MINIMAX_H3_PROFILE.steps,
  allowFallback: false as const,
  renderer: "minimax-h3" as const,
  provider: "novita" as const,
  execution: "on-demand" as const,
  runtimeId: MINIMAX_H3_RUNTIME_ID,
  modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
  fps: MINIMAX_H3_PROFILE.fps,
  frames: MINIMAX_H3_PROFILE.frames,
  nativeDurationSec,
};

const manifest = {
  version: "1.0.0" as const,
  generation,
  durationSec: 5,
  items: [{
    shotId: "shot-h3-proof",
    clipKey: "owner/test/runs/h3/clip-0001.mp4",
    t0: 0,
    t1: 5,
    sourceSentenceIds: ["sentence-1"],
    continuityState: "same approved world",
    renderedDurationSec: nativeDurationSec,
  }],
};

const openingMotion = {
  contract: "minimax-h3-opening-motion-qa/v1" as const,
  source: "ffmpeg/freezedetect" as const,
  verdict: "pass" as const,
  durationSec: nativeDurationSec,
  maxFreezeFraction: 0.1,
  maxStaticHoldSec: nativeDurationSec * 0.1,
  maxOpeningFrozenHoldSec: 0.25,
  maxFrozenHoldSec: 0,
  openingFrozenHoldSec: 0,
  frozenIntervals: [],
  violatingIntervals: [],
};

const qaReport = {
  version: "1.1.0" as const,
  required: true as const,
  graderRan: true as const,
  passed: true as const,
  shots: [{
    shotId: "shot-h3-proof",
    score: 0.93,
    threshold: 0.9,
    semanticAlignment: 0.94,
    continuity: 0.93,
    motionIntegrity: 0.92,
    artifactFree: 0.95,
    notes: ["Actual H3 bytes passed the independent opening-motion check."],
    temporalDynamism: openingMotion,
  }],
};

const coverage = {
  version: "1.0.0" as const,
  mappedSec: 5,
  totalSec: 5,
  ratio: 1 as const,
  missingShotIds: [],
  duplicateShotIds: [],
};

assert.doesNotThrow(
  () => validateQualifiedShotRender({ manifest, qaReport, coverage }),
  "a native H3 source take may be trimmed to its authored edit interval only with H3-specific motion evidence",
);

const tooLong = structuredClone(manifest);
tooLong.durationSec = nativeDurationSec + 0.1;
tooLong.items[0]!.t1 = nativeDurationSec + 0.1;
assert.throws(
  () => validateQualifiedShotRender({
    manifest: tooLong,
    qaReport: { ...qaReport, shots: [{ ...qaReport.shots[0]!, temporalDynamism: openingMotion }] },
    coverage: { ...coverage, mappedSec: tooLong.durationSec, totalSec: tooLong.durationSec },
  }),
  /authored H3 interval exceeds its native source take/,
  "the edit must not stretch an H3 clip past observed native duration",
);

const falseAdapterClaim = structuredClone(manifest) as unknown as {
  items: Array<Record<string, unknown>>;
};
falseAdapterClaim.items[0]!.creativeAdapter = { id: "ltx-creative-legacy", strength: 0.4 };
assert.throws(
  () => validateQualifiedShotRender({ manifest: falseAdapterClaim, qaReport, coverage }),
  /fresh H3 takes cannot claim a retired LTX adapter/,
  "H3 evidence must not falsely attribute its pixels to a retired LTX LoRA",
);

console.log("MiniMax H3 standard shot-render manifest tests passed");
