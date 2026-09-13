import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generationProfile } from "@/engine/generationProfiles";
import { LtxShotTemporalQaEvidenceSchema } from "@/engine/renderArtifacts";
import {
  toNovitaPhaseProfile,
  validate as validateNovitaRender,
  type NovitaRenderCfg,
} from "@/lib/novitaRenderFarm";
import { measureLtxShotTemporalQa } from "@/lib/ltxShotTemporalQa";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

function render(output: string, args: string[]): void {
  const result = spawnSync(
    FFMPEG,
    ["-hide_banner", "-loglevel", "error", "-y", ...args, output],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  assert.equal(result.status, 0, result.stderr?.slice(-2_000));
}

function videoConfig(): NovitaRenderCfg {
  return {
    prefix: "tests/ltx-temporal-qa",
    profile: toNovitaPhaseProfile(generationProfile("production"), "video"),
    shots: [{
      id: "shot-01",
      prompt: "A courier crosses a rain-lit station concourse",
      cameraMove: "dolly_push",
      shotScale: "wide",
      lens: "35mm",
      seconds: 6,
      motion: "The courier walks from frame left while the camera moves immediately.",
      stillKey: "tests/ltx-temporal-qa/shot-01.png",
    }],
  };
}

async function main(): Promise<void> {
  const valid = videoConfig();
  assert.doesNotThrow(() => validateNovitaRender(valid, "video"));

  const invalid720 = videoConfig();
  invalid720.profile = {
    ...invalid720.profile,
    width: 720,
    height: 1280,
    stageOneWidth: 360,
    stageOneHeight: 640,
  };
  assert.throws(
    () => validateNovitaRender(invalid720, "video"),
    /dimensions 720x1280 must be divisible by 32|dimensions 720x1280 must be divisible by 64|exact LTX-2\.5 distilled/i,
    "the upstream-reported 720x1280 geometry must fail before a paid worker launch",
  );

  const work = await mkdtemp(join(tmpdir(), "ysa-ltx-shot-temporal-qa-"));
  try {
    const frozenOpening = join(work, "frozen-opening.mp4");
    const briefFrozenOpening = join(work, "brief-frozen-opening.mp4");
    const continuousMotion = join(work, "continuous-motion.mp4");
    render(frozenOpening, [
      "-f", "lavfi", "-i", "color=c=0x5b2533:s=320x192:r=25:d=2",
      "-f", "lavfi", "-i", "testsrc2=s=320x192:r=25:d=4",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]);
    render(continuousMotion, [
      "-f", "lavfi", "-i", "testsrc2=s=320x192:r=25:d=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]);
    render(briefFrozenOpening, [
      "-f", "lavfi", "-i", "color=c=0x5b2533:s=320x192:r=25:d=0.5",
      "-f", "lavfi", "-i", "testsrc2=s=320x192:r=25:d=5.5",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]);

    const profile = generationProfile("production");
    const frozenEvidence = measureLtxShotTemporalQa({
      videoPath: frozenOpening,
      durationSec: 6,
      fps: profile.video.fps,
      maxFreezeFraction: profile.qa.maxFreezeFraction,
    });
    assert.equal(frozenEvidence.verdict, "fail");
    assert(
      frozenEvidence.openingFrozenHoldSec >= 1.8,
      `known LTX frozen opening must retain its measured duration (got ${frozenEvidence.openingFrozenHoldSec})`,
    );
    assert(frozenEvidence.violatingIntervals.some((interval) => interval.startSec < 0.1));
    assert.throws(
      () => LtxShotTemporalQaEvidenceSchema.parse(frozenEvidence),
      /Invalid literal value|expected.*pass|Array must contain exactly 0 element/i,
      "a failed temporal receipt cannot be serialized as accepted shot QA",
    );

    const briefOpeningEvidence = measureLtxShotTemporalQa({
      videoPath: briefFrozenOpening,
      durationSec: 6,
      fps: profile.video.fps,
      // The general 0.6s budget would allow this half-second hold. The LTX
      // opening rule must still reject it because the authored action has not
      // begun at the first visible beat.
      maxFreezeFraction: 0.1,
    });
    assert(
      Math.abs(briefOpeningEvidence.maxStaticHoldSec - 0.6) < 0.000_001,
      "the fixture must retain its intentionally permissive whole-shot budget",
    );
    assert.equal(briefOpeningEvidence.maxOpeningFrozenHoldSec, 0.25);
    assert(
      briefOpeningEvidence.maxFrozenHoldSec <= briefOpeningEvidence.maxStaticHoldSec + 0.05,
      "the fixture must be under the ordinary whole-shot freeze allowance",
    );
    assert.equal(briefOpeningEvidence.verdict, "fail", "a brief LTX frozen opening must fail the independent immediate-motion gate");
    assert(briefOpeningEvidence.openingFrozenHoldSec >= 0.45);
    assert(briefOpeningEvidence.violatingIntervals.some((interval) => interval.startSec < 0.1));

    const movingEvidence = measureLtxShotTemporalQa({
      videoPath: continuousMotion,
      durationSec: 6,
      fps: profile.video.fps,
      maxFreezeFraction: profile.qa.maxFreezeFraction,
    });
    assert.equal(movingEvidence.verdict, "pass");
    assert(
      movingEvidence.openingFrozenHoldSec <= 0.25,
      "ordinary motion may retain at most one 4fps detector interval at the opening",
    );
    assert.doesNotThrow(() => LtxShotTemporalQaEvidenceSchema.parse(movingEvidence));
    console.log("LTX shot geometry and temporal QA tests passed");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

void main();
