import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { normalizeAudioOnly } from "../ffmpeg";

const inspect = (path: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { encoding: "utf8" }));
const videoHash = (path: string) => execFileSync("ffmpeg", ["-v", "error", "-i", path, "-map", "0:v:0", "-c:v", "copy", "-f", "hash", "-"], { encoding: "utf8" });
for (const rate of [44100, 48000]) for (const duration of [3.5, 10]) {
  test(`normalization preserves ${rate} Hz audio and the exact ${duration}s video clock`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "normalize-timeline-"));
    try {
      const input = join(dir, "before.mp4"), output = join(dir, "after.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `testsrc2=s=160x96:r=30:d=${duration}`,
        "-f", "lavfi", "-i", `sine=frequency=233:sample_rate=${rate}:duration=${duration}`,
        "-c:v", "libx264", "-c:a", "aac", "-t", String(duration), input]);
      const before = inspect(input);
      await normalizeAudioOnly(input, output, -16);
      const after = inspect(output);
      assert.equal(videoHash(output), videoHash(input), "no video re-encode or packet loss");
      const sound = after.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
      assert.equal(Number(sound.sample_rate), rate);
      assert.equal(Number(sound.duration), duration, "AAC padded decode must not extend the master");
      assert.equal(Number(after.format.duration), duration);
      assert.equal(after.streams[0].duration_ts, before.streams[0].duration_ts);
      assert.equal(Number(after.streams[0].nb_frames), duration * 30);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
