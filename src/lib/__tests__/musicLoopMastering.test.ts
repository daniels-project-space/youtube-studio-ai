import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { composeMusicLoopDeblur, normalizeMusicLoopSource } from "../ffmpeg";

const ffmpeg = (args: string[]) => execFileSync("ffmpeg", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
const inspect = (path: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { encoding: "utf8" }));
const pcm = (path: string) => execFileSync("ffmpeg", ["-v", "error", "-i", path, "-map", "0:a:0", "-f", "f32le", "-"], { maxBuffer: 8_000_000 });

for (const target of [-14, -20, -23]) test(`primary loop delivers ${target} LUFS without altering native timing or musical dynamics`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "loop-master-"));
  try {
    const source = join(dir, "source.wav"), master = join(dir, "master.wav");
    const picture = join(dir, "picture.mp4"), delivery = join(dir, "final.mp4");
    ffmpeg(["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.04*sin(2*PI*233*t)*(0.7+0.3*cos(2*PI*t)):s=48000:d=10",
      "-ac", "2", "-c:a", "pcm_f32le", source]);
    const original = await readFile(source);
    await normalizeMusicLoopSource(source, master, target, 480000);
    assert.deepEqual(await readFile(source), original, "approved bytes must remain unchanged");
    const audio = inspect(master).streams[0];
    assert.equal(audio.codec_name, "pcm_f32le"); assert.equal(audio.sample_rate, "48000");
    assert.equal(audio.channels, 2); assert.equal(audio.duration_ts, 480000);
    const before = pcm(source), after = pcm(master);
    assert.equal(after.length, before.length);
    let gain: number | undefined;
    for (let i = 0; i < before.length; i += 4) {
      const a = before.readFloatLE(i), b = after.readFloatLE(i);
      if (Math.abs(a) < 0.0001) continue;
      gain ??= b / a;
      assert.ok(Math.abs(b - a * gain) < 1e-6, "fixed gain must preserve every sample, including the seam");
    }
    ffmpeg(["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x96:r=30:d=1", "-an", "-c:v", "libx264", picture]);
    await composeMusicLoopDeblur({ loopUnitPath: picture, musicPath: master, outPath: delivery,
      durationSec: 60, width: 160, height: 96, preset: "ultrafast" });
    const delivered = inspect(delivery);
    assert.equal(Number(delivered.format.duration), 60);
    assert.equal(delivered.streams[0].nb_frames, "1800");
    assert.equal(delivered.streams[1].sample_rate, "48000");
    assert.equal(Number(delivered.streams[1].duration), 60);
    const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", delivery, "-map", "0:a:0",
      "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const lufs = Number([...result.stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)].at(-1)?.[1]);
    const peak = Number([...result.stderr.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)].at(-1)?.[1]);
    assert.ok(Math.abs(lufs - target) <= 0.5, `decoded delivery ${lufs} LUFS misses ${target}`);
    assert.ok(peak <= -1, `decoded delivery peak ${peak} exceeds headroom`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("unsafe targets, source clocks, silence and insufficient headroom fail before assembly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loop-master-refusal-"));
  try {
    const source = join(dir, "source.wav"), output = join(dir, "master.wav");
    ffmpeg(["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.001*sin(2*PI*233*t)+if(eq(n\\,240000)\\,0.9\\,0):s=48000:d=10",
      "-ac", "2", "-c:a", "pcm_f32le", source]);
    await assert.rejects(normalizeMusicLoopSource(source, output, -14, 480000), /headroom/);
    await assert.rejects(normalizeMusicLoopSource(source, output, NaN, 480000), /target/);
    await assert.rejects(normalizeMusicLoopSource(source, output, -11, 480000), /target/);
    await assert.rejects(normalizeMusicLoopSource(source, source, -20, 480000), /separate/);
    await assert.rejects(normalizeMusicLoopSource(source, output, -20, 479999), /frame count/);
    ffmpeg(["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "10", "-c:a", "pcm_f32le", source]);
    await assert.rejects(normalizeMusicLoopSource(source, output, -20, 480000), /measure/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
