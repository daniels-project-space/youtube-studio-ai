import assert from "node:assert/strict";
import test from "node:test";
import {
  LTX25_720P_NATIVE_X2_SMOKE,
  assertLtx25Native720X2SmokeJob,
  assertLtx25Native720X2SmokeProof,
  ltx25Native720X2SmokeImageProfile,
  ltx25Native720X2SmokeProfile,
} from "../lib/ltx25BenchmarkSmokeProfile.mjs";

test("720p-native x2 smoke contract remains benchmark-only and exact", () => {
  const profile = ltx25Native720X2SmokeProfile({
    model: "Lightricks/LTX-2.5",
    revision: "a".repeat(40),
    infrastructure: { provider: "novita" },
  });
  assert.equal(profile.id, "ltx25-720p-native-x2-smoke");
  assert.equal(profile.benchmarkOnly, true);
  assert.deepEqual([profile.stageOneWidth, profile.stageOneHeight, profile.width, profile.height], [1280, 704, 2560, 1408]);
  assert.equal(profile.maxFrames, 17);
  assert.equal(profile.maxSampledPeakVramMib, 22_000);

  const imageProfile = ltx25Native720X2SmokeImageProfile({
    model: "Tongyi-MAI/Z-Image-Turbo",
    revision: "b".repeat(40),
    infrastructure: { provider: "novita" },
  });
  assert.equal(imageProfile.benchmarkOnly, true);
  assert.deepEqual([imageProfile.width, imageProfile.height], [1280, 704]);
});

test("720p-native x2 smoke rejects non-exact jobs and output evidence", () => {
  const job = { width: 2560, height: 1408, steps: 8, frames: 17, fps: 25 };
  assert.doesNotThrow(() => assertLtx25Native720X2SmokeJob(job));
  assert.throws(() => assertLtx25Native720X2SmokeJob({ ...job, frames: 9 }), /17 frames/);

  const proof = {
    outputWidth: 2560, outputHeight: 1408, stageOneWidth: 1280, stageOneHeight: 704,
    spatialUpscaleFactor: 2, frameCount: 17, frameRate: 25, hasAudio: true, sampledPeakVramMib: 21_999,
    inputGeometry: { initial: { sha256: "a".repeat(64), width: 1280, height: 704 } },
  };
  assert.doesNotThrow(() => assertLtx25Native720X2SmokeProof(proof, { initialSha256: "a".repeat(64) }));
  assert.throws(() => assertLtx25Native720X2SmokeProof(proof), /input geometry/);
  assert.throws(() => assertLtx25Native720X2SmokeProof({ ...proof, sampledPeakVramMib: LTX25_720P_NATIVE_X2_SMOKE.maxSampledPeakVramMib + 1 }), /22 GiB/);
  assert.throws(() => assertLtx25Native720X2SmokeProof({ ...proof, inputGeometry: { initial: { ...proof.inputGeometry.initial, height: 736 } } }), /input geometry/);
  assert.throws(() => assertLtx25Native720X2SmokeProof(proof, { initialSha256: "b".repeat(64) }), /input geometry/);
});
