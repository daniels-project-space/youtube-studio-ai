import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { composeMusicLoopDeblur, probe } from "@/lib/ffmpeg";

const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";

async function main(): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), "lofi-packet-assembly-test-"));
  try {
    const video = join(workDir, "source.mp4");
    const audio = join(workDir, "music.m4a");
    const output = join(workDir, "master.mp4");
    execFileSync(ffmpeg, [
      "-y", "-f", "lavfi", "-i", "testsrc2=s=320x176:r=5:d=1",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
    ], { stdio: "ignore" });
    execFileSync(ffmpeg, [
      "-y", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=1",
      "-c:a", "aac", audio,
    ], { stdio: "ignore" });

    await composeMusicLoopDeblur({
      loopUnitPath: video,
      musicPath: audio,
      outPath: output,
      durationSec: 60,
      title: "Night Study",
      channel: "Signal Room",
      width: 320,
      height: 176,
      fps: 5,
      preset: "ultrafast",
      timeoutMs: 120_000,
    });

    const media = await probe(output);
    assert.equal(media.hasVideo, true);
    assert.equal(media.hasAudio, true);
    assert.equal(media.videoCodec, "h264", "the repeated visual packets must remain YouTube-compatible H.264");
    assert.equal(media.audioCodec, "aac", "the looped mastered bed must be muxed as AAC");
    assert.equal(media.width, 320);
    assert.equal(media.height, 176);
    assert.ok(Math.abs(media.durationSec - 60) <= 0.08, `packet-loop master must be exactly 60s, got ${media.durationSec}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().then(
  () => console.log("music-loop packet assembly ffmpeg tests passed"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
