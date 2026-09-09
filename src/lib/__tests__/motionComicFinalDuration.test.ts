import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lengthCheck } from "@/trigger/blocks/narratedBlocks";
import type { StageContext } from "@/engine/types";
import { loadMotionComicDurationHarness } from "./helpers/motionComicDurationHarness";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "ysa-motion-duration-unit-"));
  const harness = await loadMotionComicDurationHarness();
  try {
    const cast = await harness.run(join(root, "cast"), { finalDuration: 200.551 });
    assert.equal(cast.result.durationMs, 200_551, "real cast returns final master measurement, not its incomplete panel schedule");
    assert.equal(cast.evidence.probes.at(-1), join(root, "cast", "final.mp4"));
    assert.ok(cast.evidence.events.indexOf("normalize") < cast.evidence.events.indexOf("probe:final.mp4"));
    const block = await harness.run(join(root, "block"), { finalDuration: 200.551 }, true);
    assert.equal(block.result.videoDurationSec, 200.551, "real block preserves fractional duration");
    assert.equal(block.result.narrationDurationSec, 11, "independently measured narration still supplies QA's expected duration");
    const video = block.evidence.assets.find(asset => asset.kind === "video")!;
    assert.equal(video.meta?.durationSec, 200.551, "actual recordAsset call receives measured seconds");
    assert.equal(video.r2Key, block.result.videoKey);
    assert.ok(block.evidence.events.indexOf("probe:final.mp4") < block.evidence.events.indexOf("upload:final.mp4"));
    await assert.rejects(() => lengthCheck.run({
      store: { videoDurationSec: block.result.videoDurationSec },
      params: { minSeconds: 190, maxSeconds: 200 }, log: () => {},
    } as unknown as StageContext), /length_check FAILED/, "the actual length gate rejects an oversized measured master even if its old plan fit");
    for (const [name, value] of [["zero", 0], ["negative", -1], ["nan", NaN], ["infinite", Infinity], ["overflow", Number.MAX_VALUE]] as const) {
      await assert.rejects(() => harness.run(join(root, name), { finalDuration: value }), /final master duration/i);
    }
    await assert.rejects(() => harness.run(join(root, "block-invalid"), { finalDuration: 0 }, true), /final master duration/i);
    assert.deepEqual(harness.evidence.uploads, [], "invalid duration cannot reach the real block's upload boundary");
    assert.deepEqual(harness.evidence.assets.filter(asset => ["video", "narration"].includes(asset.kind)), [], "invalid duration cannot record a video or narration asset");
    await assert.rejects(() => harness.run(join(root, "probe-failure"), { probeFailure: new Error("probe process failed") }), /probe process failed/);
    const withoutNormalization = await harness.run(join(root, "normalization-failed"), { normalizeFailure: true, finalDuration: 15.123 });
    assert.equal(withoutNormalization.result.durationMs, 15_123, "existing fail-soft normalization still measures the actual surviving mux");
    console.log("motion comic final duration: 11 real cast/block/length-gate cases passed");
  } finally { harness.dispose(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
