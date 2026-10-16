import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { composeMusicLoopDeblur, probe } from "@/lib/ffmpeg";

const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
const ffprobe = process.env.FFPROBE_BIN ?? "ffprobe";

function streamDurations(path: string): Record<string, number> {
  const stdout = execFileSync(ffprobe, [
    "-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", path,
  ], { encoding: "utf8" });
  const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; duration?: string }> };
  return Object.fromEntries((parsed.streams ?? []).map((stream) => [stream.codec_type ?? "unknown", Number(stream.duration)]));
}

async function main(): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), "lofi-packet-assembly-test-"));
  try {
    const video = join(workDir, "source.mp4");
    const audio = join(workDir, "music.m4a");
    const output = join(workDir, "master.mp4");
    const naturalAudio = join(workDir, "natural-music.m4a");
    const naturalOutput = join(workDir, "natural-master.mp4");
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
    const loopStreams = streamDurations(output);
    assert.ok(Math.abs(loopStreams.video! - 60) <= 0.08, `video stream must be exactly 60s, got ${loopStreams.video}`);
    assert.ok(Math.abs(loopStreams.audio! - 60) <= 0.08, `audio stream must be exactly 60s, got ${loopStreams.audio}`);

    execFileSync(ffmpeg, [
      "-y", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=36.439",
      "-c:a", "aac", naturalAudio,
    ], { stdio: "ignore" });
    const source = await probe(naturalAudio);
    assert.ok(Math.abs(source.durationSec - 36.439) <= 0.08,
      `fixture must retain its natural measured duration, got ${source.durationSec}`);

    await composeMusicLoopDeblur({
      loopUnitPath: video,
      musicPath: naturalAudio,
      outPath: naturalOutput,
      durationSec: 30,
      width: 320,
      height: 176,
      fps: 5,
      preset: "ultrafast",
      timeoutMs: 120_000,
    });
    const naturalMaster = await probe(naturalOutput);
    assert.equal(naturalMaster.hasVideo, true);
    assert.equal(naturalMaster.hasAudio, true);
    assert.ok(Math.abs(naturalMaster.durationSec - 30) <= 0.08,
      `final video duration must stay 30s despite the 36.439s natural music source, got ${naturalMaster.durationSec}`);
    const naturalStreams = streamDurations(naturalOutput);
    assert.ok(Math.abs(naturalStreams.video! - 30) <= 0.08,
      `video stream must be exactly 30s, got ${naturalStreams.video}`);
    assert.ok(Math.abs(naturalStreams.audio! - 30) <= 0.08,
      `audio stream must be exactly 30s, got ${naturalStreams.audio}`);
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
