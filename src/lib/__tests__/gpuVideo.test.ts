/**
 * gpuVideo module test (tsx). Pure logic only — provider selection, LTX duration
 * snapping, fal-LTX body (native audio), and the salad-ltx "not deployed" guard.
 * No live API calls (that's the smoke script).
 */
import assert from "node:assert/strict";
import {
  selectProvider, ltxDuration, buildFalLtxBody, renderGpuVideo, GpuVideoError,
} from "../gpuVideo";

function providerSelection(): void {
  const prev = process.env.GPU_VIDEO_PROVIDER;
  delete process.env.GPU_VIDEO_PROVIDER;
  assert.equal(selectProvider({ prompt: "x" }), "salad-ltx", "default = salad-ltx");
  assert.equal(selectProvider({ prompt: "x", provider: "fal-ltx" }), "fal-ltx", "explicit wins");
  process.env.GPU_VIDEO_PROVIDER = "fal-ltx";
  assert.equal(selectProvider({ prompt: "x" }), "fal-ltx", "env selects");
  assert.throws(() => selectProvider({ prompt: "x", provider: "bogus" as never }), /unknown/, "bad provider throws");
  if (prev === undefined) delete process.env.GPU_VIDEO_PROVIDER; else process.env.GPU_VIDEO_PROVIDER = prev;
  console.log("PROVIDER PASS: default=salad / explicit / env / illegal");
}

function durationGrid(): void {
  assert.equal(ltxDuration(5), 6, "5 → 6 (floor of grid)");
  assert.equal(ltxDuration(6), 6);
  assert.equal(ltxDuration(7), 6, "7 → 6 (nearest)");
  assert.equal(ltxDuration(9), 8, "9 → 8 (nearest)");
  assert.equal(ltxDuration(10), 10);
  assert.equal(ltxDuration(100), 20, "clamps to max grid 20");
  assert.equal(ltxDuration(undefined), 6, "undefined → 6");
  console.log("DURATION PASS: snaps to LTX grid");
}

function falBody(): void {
  const b = buildFalLtxBody({ prompt: "victor turns to camera", imageUrl: "https://x/still.png", durationSec: 6 });
  assert.equal(b.generate_audio, true, "native audio ON by default");
  assert.equal(b.resolution, "1080p", "default 1080p");
  assert.equal(b.duration, 6, "duration snapped");
  assert.equal(b.image_url, "https://x/still.png");
  const noAudio = buildFalLtxBody({ prompt: "x", imageUrl: "https://x/y.png", audio: false });
  assert.equal(noAudio.generate_audio, false, "audio:false disables");
  assert.throws(() => buildFalLtxBody({ prompt: "x" }), /imageUrl required/, "i2v needs a still");
  console.log("FAL-BODY PASS: native audio + resolution + i2v guard");
}

async function saladNotDeployed(): Promise<void> {
  const prevGw = process.env.SALAD_LTX_GATEWAY;
  delete process.env.SALAD_LTX_GATEWAY;
  await assert.rejects(
    () => renderGpuVideo({ prompt: "x", imageUrl: "https://x/y.png", provider: "salad-ltx" }),
    (e: unknown) => e instanceof GpuVideoError && /SALAD_LTX_GATEWAY/.test((e as Error).message),
    "salad-ltx without a gateway throws a clear, actionable error",
  );
  if (prevGw !== undefined) process.env.SALAD_LTX_GATEWAY = prevGw;
  console.log("SALAD-GUARD PASS: clear error until container deployed");
}

async function main(): Promise<void> {
  providerSelection();
  durationGrid();
  falBody();
  await saladNotDeployed();
  console.log("\nALL GPUVIDEO TESTS PASSED");
}

main().catch((e) => { console.error(e); process.exit(1); });
