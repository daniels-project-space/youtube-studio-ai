import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hasKnownMiniMaxMusic3OpeningDegradation,
  MAX_OPENING_HIGH_BAND_DROP_DB,
  measureNativeMusicQuality,
} from "@/lib/nativeMusicQuality";

function render(path: string, args: readonly string[], codec = "pcm_s16le"): void {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args, "-c:a", codec, path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`FFmpeg fixture failed: ${result.stderr}`);
}

function separatePassMeasurements(path: string, durationSec: number) {
  const outputs = ["ebur128=peak=true", "astats=metadata=0:reset=0", "silencedetect=noise=-50dB:d=0.05"].map(filter => {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-i", path, "-map", "a:0", "-af", filter, "-f", "null", "-"],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 1_048_576 });
    assert.equal(result.status, 0, result.stderr);
    return result.stderr;
  });
  const last = (output: string, expression: RegExp) => {
    const value = Number([...output.matchAll(expression)].at(-1)?.[1]);
    assert.ok(Number.isFinite(value));
    return value;
  };
  const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
  const peak = last(outputs[0]!, /^\s*Peak:\s*(-?[0-9.]+)\s+dBFS/mgu);
  const rms = last(outputs[1]!, /RMS level dB:\s*(-?[0-9.]+)/gu);
  const peaks = Math.max(0, Math.round(last(outputs[1]!, /Peak count:\s*([0-9.]+)/gu)));
  const starts = [...outputs[2]!.matchAll(/silence_start:\s*([0-9.]+)/gu)].map(match => Number(match[1]));
  const ends = [...outputs[2]!.matchAll(/silence_end:\s*([0-9.]+)/gu)].map(match => Number(match[1]));
  const silence = starts.reduce((total, start, index) => total + Math.max(0, (ends[index] ?? durationSec) - start), 0);
  return {
    integratedLufs: round(last(outputs[0]!, /^\s*I:\s*(-?[0-9.]+)\s+LUFS/mgu)),
    truePeakDbtp: round(peak), lraLu: round(last(outputs[0]!, /^\s*LRA:\s*(-?[0-9.]+)\s+LU/mgu)),
    crestDb: round(Math.max(0, peak - rms)), clippedSamples: peak >= -0.1 ? peaks : 0,
    maximumConsecutiveCeilingSamples: peak >= -0.1 ? peaks : 0,
    dcOffsetAbsolute: round(Math.abs(last(outputs[1]!, /DC offset:\s*(-?[0-9.]+)/gu)), 6),
    silenceFraction: round(Math.max(0, Math.min(durationSec, silence)) / durationSec, 6),
  };
}

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "native-music-quality-test-"));
  try {
    const stable = join(work, "stable.wav");
    const collapsed = join(work, "collapsed.wav");
    const delayedCollapsed = join(work, "delayed-collapsed.wav");
    const dynamicFloat = join(work, "dynamic-float.wav");
    // Both windows contain the same low- and high-band content.
    render(stable, [
      "-f", "lavfi", "-i", "aevalsrc=0.22*sin(2*PI*440*t)+0.13*sin(2*PI*8000*t):s=32000:d=8",
      "-ac", "2",
    ]);
    // This reproduces the reported failure signature: a healthy opening that
    // suddenly loses high-frequency bandwidth after the opening seconds.
    render(collapsed, [
      "-f", "lavfi", "-i", "aevalsrc=0.22*sin(2*PI*440*t)+0.13*sin(2*PI*8000*t):s=32000:d=3",
      "-f", "lavfi", "-i", "aevalsrc=0.22*sin(2*PI*440*t):s=32000:d=5",
      "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
      "-ac", "2",
    ]);
    // A take may remain healthy at the old single 3.75s probe, then lose its
    // bandwidth later in the first musical phrase. The bounded early-interior
    // sweep must select that weaker window instead of certifying the take.
    render(delayedCollapsed, [
      "-f", "lavfi", "-i", "aevalsrc=0.22*sin(2*PI*440*t)+0.13*sin(2*PI*8000*t):s=32000:d=5.5",
      "-f", "lavfi", "-i", "aevalsrc=0.22*sin(2*PI*440*t):s=32000:d=6.5",
      "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
      "-ac", "2",
    ]);
    render(dynamicFloat, ["-f", "lavfi", "-i",
      "aevalsrc=between(t\\,1\\,7)*(0.1+1.1*sin(2*PI*440*t))|between(t\\,1\\,7)*0.2*sin(2*PI*8000*t):s=48000:d=8"], "pcm_f32le");

    const [stableAnalysis, collapsedAnalysis, delayedCollapsedAnalysis] = await Promise.all([
      measureNativeMusicQuality({ audio: await readFile(stable), durationSec: 8 }),
      measureNativeMusicQuality({ audio: await readFile(collapsed), durationSec: 8 }),
      measureNativeMusicQuality({ audio: await readFile(delayedCollapsed), durationSec: 12 }),
    ]);
    const floatAnalysis = await measureNativeMusicQuality({ audio: await readFile(dynamicFloat), durationSec: 8 });
    for (const [path, duration, analysis] of [[stable, 8, stableAnalysis], [collapsed, 8, collapsedAnalysis],
      [delayedCollapsed, 12, delayedCollapsedAnalysis], [dynamicFloat, 8, floatAnalysis]] as const) {
      const expected = separatePassMeasurements(path, duration);
      const measured = Object.fromEntries(Object.keys(expected).map(key =>
        [key, analysis.measurements[key as keyof typeof analysis.measurements]]));
      assert.deepEqual(measured, expected, `${path}: combined decoding must preserve every full-file measurement`);
    }
    assert(stableAnalysis.measurements.openingHighBandDropDb < 2, "stable high-band material must not resemble the Music3 degradation");
    assert.equal(stableAnalysis.measurements.mechanicalArtifactScore, 0);
    assert.equal(hasKnownMiniMaxMusic3OpeningDegradation(stableAnalysis), false);
    assert(
      collapsedAnalysis.measurements.openingHighBandDropDb > MAX_OPENING_HIGH_BAND_DROP_DB,
      "a post-opening high-band collapse must be caught from the native WAV",
    );
    assert(
      collapsedAnalysis.measurements.mechanicalArtifactScore > 0.15,
      "the measured collapse must independently fail the artifact threshold",
    );
    assert.equal(
      hasKnownMiniMaxMusic3OpeningDegradation(collapsedAnalysis),
      true,
      "the known defect classifier must admit an automatic bounded retry before human audition",
    );
    assert(collapsedAnalysis.postOpeningHighBand.startSec >= 3.75, "the defect probe must inspect after the known opening window");
    assert(
      delayedCollapsedAnalysis.measurements.openingHighBandDropDb > MAX_OPENING_HIGH_BAND_DROP_DB,
      "a later first-phrase high-band collapse must not evade the old single-window probe",
    );
    assert(
      delayedCollapsedAnalysis.postOpeningHighBand.startSec > 5,
      "the analysis must retain the weakest early-interior window as review evidence",
    );

    console.log("NATIVE MUSIC QUALITY PASS — stable take accepted, immediate and delayed post-opening spectral collapse rejected");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

void main();
