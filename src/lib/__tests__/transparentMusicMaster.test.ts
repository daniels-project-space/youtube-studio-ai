import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { masterAudioTransparentGain, measureAudio } from "@/lib/ffmpeg";

const execFileP = promisify(execFile);

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "transparent-music-master-"));
  try {
    const source = join(directory, "source.wav");
    const mastered = join(directory, "mastered.mp3");
    await execFileP(process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "sine=frequency=220:sample_rate=48000:duration=4",
      "-af", "volume=0.25",
      "-c:a", "pcm_s16le",
      source,
    ]);
    await masterAudioTransparentGain(source, mastered, { lufs: -18, truePeakMaxDbtp: -1 });
    const measurement = await measureAudio(mastered);
    assert.notEqual(measurement.integratedLufs, null);
    assert.ok(Math.abs((measurement.integratedLufs ?? 0) - -18) <= 0.65);
    const { stderr } = await execFileP(process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-nostats", "-i", mastered, "-map", "a:0", "-filter:a", "ebur128=peak=true", "-f", "null", "-",
    ]);
    const peak = Number([...stderr.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/gu)].at(-1)?.[1]);
    assert.ok(Number.isFinite(peak) && peak <= -1 + 0.05, `encoded true peak must pass, measured ${peak}`);
    console.log("TRANSPARENT MUSIC MASTER PASS: measured fixed gain without compressor/limiter normalization");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void main();
