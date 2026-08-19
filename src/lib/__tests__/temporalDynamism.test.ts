import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { laneQualityPolicy } from "@/engine/contentLane";
import {
  measureTemporalDynamism,
  parseFreezedetectIntervals,
} from "@/lib/temporalDynamism";
import { validateRender } from "@/lib/renderValidate";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

function render(args: string[]): void {
  const result = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  assert.equal(result.status, 0, result.stderr?.slice(-1600));
}

async function main(): Promise<void> {
  assert.equal(laneQualityPolicy("children_learning_supervised").maxStaticHoldSec, 4, "children's learning must require visible programme progression");
  assert.equal(laneQualityPolicy("narrated_documentary").maxStaticHoldSec, 4.5, "narrated factual storytelling must retain the generic continuity bar");
  assert.equal(laneQualityPolicy("ambient_guided").maxStaticHoldSec, null, "ambient visual beds may be intentionally static");
  assert.equal(laneQualityPolicy("music_loop").maxStaticHoldSec, null, "music visual beds may be intentionally static");
  const work = await mkdtemp(join(tmpdir(), "ysa-temporal-dynamism-"));
  try {
    const frozen = join(work, "frozen.mp4");
    const moving = join(work, "moving.mp4");
    const plannedIntro = join(work, "planned-intro.mp4");
    render([
      "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", frozen,
    ]);
    render([
      "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", moving,
    ]);
    render([
      "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=3",
      "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=3",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", plannedIntro,
    ]);

    const frozenEvidence = measureTemporalDynamism({
      videoPath: frozen,
      durationSec: 6,
      maxStaticHoldSec: 1.5,
    });
    assert.equal(frozenEvidence.source, "ffmpeg/freezedetect");
    assert.equal(frozenEvidence.ran, true, "detector must actually execute FFmpeg");
    assert.equal(frozenEvidence.verdict, "fail", "a fully static render must fail a progressive-story lane");
    assert(frozenEvidence.violatingIntervals.some((span) => span.startSec < 0.1 && span.endSec > 5.5), "EOF freezes must retain their full repair interval");

    const renderGate = await validateRender({
      videoPath: frozen,
      durationSec: 6,
      introApplied: true,
      channel: { contentLaneKey: "children_learning_supervised", maxStaticHoldSec: 1.5 },
    });
    assert.equal(renderGate.verdict, "fail", "render validation must turn a temporal violation into a release defect");
    assert(renderGate.defects.some((defect) => /static visual hold.*0\.0–6\.0s/i.test(defect.issue)), "the final QA defect must retain its exact repair interval");

    const movingEvidence = measureTemporalDynamism({
      videoPath: moving,
      durationSec: 6,
      maxStaticHoldSec: 1.5,
    });
    assert.equal(movingEvidence.verdict, "pass", "ordinary moving footage must not trip the frozen-hold gate");
    assert.equal(movingEvidence.violatingIntervals.length, 0);

    const plannedCardEvidence = measureTemporalDynamism({
      videoPath: plannedIntro,
      durationSec: 6,
      maxStaticHoldSec: 1.5,
      excludedWindows: [{ startSec: 0, endSec: 3, reason: "planned intro/title card" }],
    });
    assert.equal(plannedCardEvidence.verdict, "pass", "only the explicit planned title-card interval may be excluded");
    assert.equal(plannedCardEvidence.excludedWindows[0]?.reason, "planned intro/title card");
    assert.equal(plannedCardEvidence.evaluatedIntervals.length, 0, "the receipt must show that no frozen programme interval remains");

    const plannedCardGate = await validateRender({
      videoPath: plannedIntro,
      durationSec: 6,
      introSec: 3,
      introApplied: true,
      channel: { contentLaneKey: "narrated_documentary", maxStaticHoldSec: 1.5 },
    });
    assert.equal(plannedCardGate.verdict, "pass", "the render gate must exclude only an explicitly-applied planned intro card");

    const unavailableGate = await validateRender({
      videoPath: join(work, "missing-master.mp4"),
      durationSec: 6,
      introApplied: true,
      // Explicitly exercise an intentional static lane: temporal evidence is
      // not required there, but the black/dead-air measurement still must not
      // degrade to a release pass when the master cannot be decoded.
      channel: { contentLaneKey: "ambient_guided", maxStaticHoldSec: null },
    });
    assert.equal(unavailableGate.ran, false, "an unavailable deterministic measurement must be recorded as incomplete");
    assert.equal(unavailableGate.verdict, "fail", "an unavailable black/dead-air measurement must fail closed even for a static lane");
    assert(
      unavailableGate.defects.some((defect) => /black\/dead-air evidence unavailable/i.test(defect.issue)),
      "the failure receipt must identify the unavailable black/dead-air measurement",
    );
    assert.equal(
      unavailableGate.temporalDynamism.verdict,
      "not_required",
      "an intentional static lane remains exempt from temporal progression measurement",
    );

    const eofReceipt = parseFreezedetectIntervals("lavfi.freezedetect.freeze_start: 1.5", 6);
    assert.deepEqual(eofReceipt, [{ startSec: 1.5, endSec: 6, durationSec: 4.5 }], "an EOF freeze start must become a repairable terminal interval");
    console.log("temporal dynamism test passed");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
