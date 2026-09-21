import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { composeWithIntro } from "../ffmpeg";

for (const introSec of [0, 3.5, 5]) {
  test(`native loop composition includes the ${introSec}s intro inside its final clock`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "loop-intro-clock-"));
    const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", ...args]);
    try {
      const card = join(directory, "card.mp4"), body = join(directory, "body.mp4");
      const music = join(directory, "source.wav"), output = join(directory, "master.mp4");
      ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=320x176:r=30:d=5", "-an", "-c:v", "libx264", card]);
      ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=320x176:r=30:d=1", "-an", "-c:v", "libx264", body]);
      ffmpeg(["-f", "lavfi", "-i", "sine=frequency=233:sample_rate=48000:duration=7.123", "-ac", "2", "-c:a", "pcm_f32le", music]);
      const finalSec = 12;
      await composeWithIntro({ introCardPath: introSec ? card : undefined, loopBodyPath: body, musicPath: music,
        introSec, bodySec: finalSec - introSec, tailSec: 0, outPath: output,
        audioSampleRateHz: 48000, width: 320, height: 176 });
      const inspection = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { encoding: "utf8" }));
      const video = inspection.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
      const audio = inspection.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
      assert.equal(Number(video.nb_frames), finalSec * 30);
      assert.equal(Number(video.duration), finalSec); assert.equal(Number(audio.duration), finalSec);
      assert.equal(Number(inspection.format.duration), finalSec);
      assert.equal(Number(audio.sample_rate), 48000); assert.equal(audio.channels, 2);
      const samples = execFileSync("ffmpeg", ["-v", "error", "-ss", "10", "-t", "1", "-i", output,
        "-map", "0:a:0", "-ac", "1", "-f", "f32le", "-"], { maxBuffer: 500000 });
      let square = 0;
      for (let i = 0; i < samples.length; i += 4) square += samples.readFloatLE(i) ** 2;
      assert.ok(Math.sqrt(square / (samples.length / 4)) > 0.01, "short natural source must continue audibly through the final body");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
