import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_OPENING_HIGH_BAND_DROP_DB,
  measureNativeMusicQuality,
} from "@/lib/nativeMusicQuality";

function render(path: string, args: readonly string[]): void {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args, "-c:a", "pcm_s16le", path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`FFmpeg fixture failed: ${result.stderr}`);
}

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "native-music-quality-test-"));
  try {
    const stable = join(work, "stable.wav");
    const collapsed = join(work, "collapsed.wav");
    const delayedCollapsed = join(work, "delayed-collapsed.wav");
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

    const [stableAnalysis, collapsedAnalysis, delayedCollapsedAnalysis] = await Promise.all([
      measureNativeMusicQuality({ audio: await readFile(stable), durationSec: 8 }),
      measureNativeMusicQuality({ audio: await readFile(collapsed), durationSec: 8 }),
      measureNativeMusicQuality({ audio: await readFile(delayedCollapsed), durationSec: 12 }),
    ]);
    assert(stableAnalysis.measurements.openingHighBandDropDb < 2, "stable high-band material must not resemble the Music3 degradation");
    assert.equal(stableAnalysis.measurements.mechanicalArtifactScore, 0);
    assert(
      collapsedAnalysis.measurements.openingHighBandDropDb > MAX_OPENING_HIGH_BAND_DROP_DB,
      "a post-opening high-band collapse must be caught from the native WAV",
    );
    assert(
      collapsedAnalysis.measurements.mechanicalArtifactScore > 0.15,
      "the measured collapse must independently fail the artifact threshold",
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
