import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MiniMaxH3OpeningMotionQaEvidenceSchema } from "@/engine/cinematicClipReview";
import { CinematicClipRejectedError, reviewCinematicClip } from "@/lib/cinematicClipGate";
import {
  assertMiniMaxH3OpeningMotionQa,
  measureMiniMaxH3OpeningMotionQa,
  MINIMAX_H3_IMMEDIATE_MOTION_MAX_FROZEN_HOLD_SEC,
  MiniMaxH3OpeningMotionRejectedError,
} from "@/lib/minimaxH3OpeningMotionQa";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

function render(output: string, args: string[]): void {
  const result = spawnSync(
    FFMPEG,
    ["-hide_banner", "-loglevel", "error", "-y", ...args, output],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  assert.equal(result.status, 0, result.stderr?.slice(-2_000));
}

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "ysa-h3-opening-motion-"));
  try {
    const frozenOpening = join(work, "frozen-opening.mp4");
    const briefFrozenOpening = join(work, "brief-frozen-opening.mp4");
    const continuousMotion = join(work, "continuous-motion.mp4");
    render(frozenOpening, [
      "-f", "lavfi", "-i", "color=c=0x5b2533:s=320x192:r=24:d=2",
      "-f", "lavfi", "-i", "testsrc2=s=320x192:r=24:d=3",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]);
    render(briefFrozenOpening, [
      "-f", "lavfi", "-i", "color=c=0x5b2533:s=320x192:r=24:d=0.5",
      "-f", "lavfi", "-i", "testsrc2=s=320x192:r=24:d=4.5",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]);
    render(continuousMotion, [
      "-f", "lavfi", "-i", "testsrc2=s=320x192:r=24:d=5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]);

    const frozen = measureMiniMaxH3OpeningMotionQa({
      videoPath: frozenOpening,
      durationSec: 5,
      fps: 24,
    });
    assert.equal(frozen.verdict, "fail");
    assert(
      frozen.openingFrozenHoldSec >= 1.8,
      `a known H3-style frozen opening must retain its measured duration (got ${frozen.openingFrozenHoldSec})`,
    );
    assert(frozen.violatingIntervals.some((interval) => interval.startSec < 0.1));
    assert.throws(
      () => MiniMaxH3OpeningMotionQaEvidenceSchema.parse(frozen),
      /Invalid literal value|expected.*pass|Array must contain exactly 0 element/i,
      "a failed H3 opening-motion receipt cannot authorize a cinematic clip",
    );
    assert.throws(
      () => assertMiniMaxH3OpeningMotionQa({
        videoPath: frozenOpening,
        durationSec: 5,
        fps: 24,
        label: "generic H3 fixture",
      }),
      (error: unknown) => error instanceof MiniMaxH3OpeningMotionRejectedError,
      "non-cinematic H3 callers receive a typed, repairable opening-motion rejection",
    );
    await assert.rejects(
      () => reviewCinematicClip({
        scene: {
          id: "cinematic-shot-opening-freeze",
          imagePrompt: "A sealed evidence object in a rain-lit archive room.",
          motionPrompt: "The camera moves immediately toward the evidence object.",
          durationSec: 5,
          expectedCastIds: [],
          forbidAdditionalPeople: true,
        },
        // The deterministic opening gate must reject before it needs the
        // source still, extracted samples, or an external vision provider.
        stillPath: join(work, "unused-source-still.png"),
        clipPath: frozenOpening,
        workDir: work,
      }),
      (error: unknown) =>
        error instanceof CinematicClipRejectedError && /opening froze/.test(error.message),
      "the real H3 cinematic gate must stop a static opening before vision review",
    );

    const briefOpening = measureMiniMaxH3OpeningMotionQa({
      videoPath: briefFrozenOpening,
      durationSec: 5,
      fps: 24,
    });
    assert.equal(briefOpening.verdict, "fail");
    assert.equal(briefOpening.maxOpeningFrozenHoldSec, MINIMAX_H3_IMMEDIATE_MOTION_MAX_FROZEN_HOLD_SEC);
    assert(
      briefOpening.maxFrozenHoldSec <= briefOpening.maxStaticHoldSec + 0.05,
      "the fixture must remain below the ordinary whole-take hold allowance",
    );
    assert(
      briefOpening.openingFrozenHoldSec >= 0.45,
      "the independent immediate-motion rule must catch a half-second H3 opening hold",
    );

    const moving = measureMiniMaxH3OpeningMotionQa({
      videoPath: continuousMotion,
      durationSec: 5,
      fps: 24,
    });
    assert.equal(moving.verdict, "pass");
    assert(
      moving.openingFrozenHoldSec <= MINIMAX_H3_IMMEDIATE_MOTION_MAX_FROZEN_HOLD_SEC,
      "a normal H3 take may retain at most one detector interval at its opening",
    );
    if (moving.verdict !== "pass") throw new Error("moving H3 fixture unexpectedly failed");
    assert.doesNotThrow(() => MiniMaxH3OpeningMotionQaEvidenceSchema.parse(moving));
    console.log("MiniMax H3 opening-motion QA tests passed");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

void main();
