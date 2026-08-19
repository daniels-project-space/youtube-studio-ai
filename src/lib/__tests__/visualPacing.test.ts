import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { laneQualityPolicy } from "@/engine/contentLane";
import { validateRender } from "@/lib/renderValidate";
import {
  measureVisualPacing,
  parseSceneChangeTimestamps,
} from "@/lib/visualPacing";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

function render(args: string[]): void {
  const result = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  assert.equal(result.status, 0, result.stderr?.slice(-1600));
}

async function main(): Promise<void> {
  const shortPolicy = laneQualityPolicy("short_form").visualPacing;
  assert.equal(shortPolicy.mode, "scene_rhythm", "Shorts need a measurable pace signal");
  assert(shortPolicy.maxMarkerHoldSec !== null && shortPolicy.maxMarkerHoldSec <= 6, "Shorts must not silently inherit slow long-form cadence");
  for (const lane of ["children_learning_supervised", "narrated_documentary", "cinematic_ai"] as const) {
    assert.equal(
      laneQualityPolicy(lane).visualPacing.mode,
      "calibrated_review",
      `${lane} must route sparse hard-cut markers to review because continuous evolution can be intentional`,
    );
  }
  for (const lane of ["ambient_guided", "music_loop"] as const) {
    const policy = laneQualityPolicy(lane).visualPacing;
    assert.equal(policy.mode, "exempt", `${lane} is an intentionally slow/static visual product`);
    assert.equal(policy.maxMarkerHoldSec, null, `${lane} must not make a meaningless scene-cadence claim`);
  }

  const work = await mkdtemp(join(tmpdir(), "ysa-visual-pacing-"));
  try {
    const cutRhythm = join(work, "cut-rhythm.mp4");
    const staticMaster = join(work, "static-master.mp4");
    render([
      "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=2",
      "-f", "lavfi", "-i", "color=c=white:s=320x180:r=24:d=2",
      "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=2",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", cutRhythm,
    ]);
    render([
      "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=14",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", staticMaster,
    ]);

    const markerReceipt = measureVisualPacing({
      videoPath: cutRhythm,
      durationSec: 6,
      policy: shortPolicy,
    });
    assert.equal(markerReceipt.source, "ffmpeg/select-scene");
    assert.equal(markerReceipt.ran, true, "receipt must come from a completed FFmpeg decode");
    assert.equal(markerReceipt.usable, true);
    assert.equal(markerReceipt.verdict, "pass", "two-second hard-cut rhythm should meet the Short policy");
    assert.equal(markerReceipt.signal, "scene_rhythm_observed");
    assert.equal(markerReceipt.meetsPolicy, true);
    assert(markerReceipt.changeCount >= 2, "the receipt must retain the actual scene-change count");
    assert(markerReceipt.changeTimestampsSec.some((timeSec) => timeSec > 1.7 && timeSec < 2.3));
    assert(markerReceipt.changeTimestampsSec.some((timeSec) => timeSec > 3.7 && timeSec < 4.3));
    assert.equal(markerReceipt.rawHoldIntervals.length, 3, "marker boundaries must become explicit rhythm intervals");
    assert(markerReceipt.maxHoldSec <= 2.3, "maximum hold must be based on actual selected timestamps");
    assert(markerReceipt.medianHoldSec > 1.7 && markerReceipt.medianHoldSec < 2.3, "median hold must be a real aggregate, not a cut-count proxy");

    const renderGate = await validateRender({
      videoPath: cutRhythm,
      durationSec: 6,
      introApplied: true,
      channel: {
        contentLaneKey: "short_form",
        // The synthetic source intentionally uses two-second colour cards;
        // lift only the freeze fixture threshold so this test isolates pacing.
        maxStaticHoldSec: 3,
        visualPacingPolicy: shortPolicy,
      },
    });
    assert.equal(renderGate.verdict, "pass", "pacing receipt must be attached to the real final-master validation path");
    assert.equal(renderGate.visualPacing.verdict, "pass");
    assert.equal(renderGate.visualPacing.changeCount, markerReceipt.changeCount);

    const sparseReceipt = measureVisualPacing({
      videoPath: staticMaster,
      durationSec: 14,
      policy: laneQualityPolicy("cinematic_ai").visualPacing,
    });
    assert.equal(sparseReceipt.verdict, "needs_human", "sparse markers must not be misreported as a universal quality failure");
    assert.equal(sparseReceipt.signal, "pacing_calibration_needed");
    assert.equal(sparseReceipt.meetsPolicy, false);
    assert.match(sparseReceipt.detail ?? "", /continuous visual evolution may be valid/i);

    const sparseRenderGate = await validateRender({
      videoPath: staticMaster,
      durationSec: 14,
      introApplied: true,
      channel: {
        contentLaneKey: "cinematic_ai",
        // Isolate the pacing semantic: temporal freeze detection is a separate
        // hard integrity gate, while this signal asks the visual reviewer.
        maxStaticHoldSec: null,
        visualPacingPolicy: laneQualityPolicy("cinematic_ai").visualPacing,
      },
    });
    assert.equal(sparseRenderGate.verdict, "pass", "a sparse cut receipt alone must not become a false deterministic render failure");
    assert.equal(sparseRenderGate.visualPacing.verdict, "needs_human");

    const exemptReceipt = measureVisualPacing({
      videoPath: staticMaster,
      durationSec: 14,
      policy: laneQualityPolicy("music_loop").visualPacing,
    });
    assert.equal(exemptReceipt.verdict, "not_required", "music-loop visual beds are explicitly exempt rather than silently skipped");
    assert.equal(exemptReceipt.usable, true, "an explicit exemption is a usable policy receipt");
    assert.equal(exemptReceipt.signal, "pacing_exempt_static_visual_bed");

    const unavailableReceipt = measureVisualPacing({
      videoPath: join(work, "missing-master.mp4"),
      durationSec: 14,
      policy: shortPolicy,
    });
    assert.equal(unavailableReceipt.verdict, "unavailable", "a required FFmpeg pacing receipt must fail closed when the master cannot decode");
    assert.equal(unavailableReceipt.usable, false);
    assert.equal(unavailableReceipt.signal, "pacing_measurement_unavailable");

    assert.deepEqual(
      parseSceneChangeTimestamps("[Parsed_showinfo] n: 0 pts:2000000 pts_time:2\n[Parsed_showinfo] n: 1 pts:4000000 pts_time:4", 6),
      [2, 4],
      "showinfo timestamps must remain independently parseable for receipt/audit tests",
    );
    console.log("visual pacing test passed");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
