import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Independent read-only oracle: compare decoded AAC windows with the PCM loop
// at the corresponding sample clock, including far into a long assembled file.
const [reference, master, evidencePath] = process.argv.slice(2);
assert.ok(reference && master, "Usage: verify-yue2-assembly-audio.ts LOOP.wav MASTER.mp4 [EVIDENCE.json]");
const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
const ffprobe = process.env.FFPROBE_BIN ?? "ffprobe";
const inspect = (path: string) => JSON.parse(execFileSync(ffprobe, ["-v", "error", "-select_streams", "a:0",
  "-show_entries", "stream=sample_rate,channels,duration_ts,time_base,duration", "-of", "json", path], { encoding: "utf8" })).streams[0];
const loop = inspect(reference), output = inspect(master);
assert.equal(loop.sample_rate, "48000"); assert.equal(loop.channels, 2);
assert.equal(output.sample_rate, "48000"); assert.equal(output.channels, 2);
assert.equal(loop.time_base, "1/48000");
const loopFrames = Number(loop.duration_ts), duration = Number(output.duration);
assert.ok(Number.isSafeInteger(loopFrames) && loopFrames > 20 * 48000 && Number.isFinite(duration) && duration > 20);
const readWindow = (path: string, sample: number, count = 48000) => execFileSync(ffmpeg, ["-v", "error", "-ss",
  (sample / 48000).toFixed(9), "-i", path, "-t", (count / 48000).toFixed(9), "-map", "0:a:0", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
{ maxBuffer: 2 * 1024 * 1024 });
const referenceFrame = 10 * 48000;
const expected = readWindow(reference, referenceFrame);
assert.equal(expected.length, 48000 * 8);
const lastRepeat = Math.floor(((duration - 20) * 48000 - referenceFrame) / loopFrames);
const results: { kind: "body" | "wrap"; repeat: number; sample: number; seconds: number; correlation: number; rmsRatio: number }[] = [];
function compare(kind: "body" | "wrap", repeat: number, frame: number, expected: Buffer) {
  const actual = readWindow(master, frame);
  assert.equal(actual.length, expected.length);
  let xy = 0, xx = 0, yy = 0;
  for (let offset = 0; offset < expected.length; offset += 4) {
    const x = expected.readFloatLE(offset), y = actual.readFloatLE(offset);
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    xy += x * y; xx += x * x; yy += y * y;
  }
  assert.ok(xx > 1e-8 && yy > 1e-8, "silent windows cannot prove alignment");
  const correlation = xy / Math.sqrt(xx * yy), rmsRatio = Math.sqrt(yy / xx);
  assert.ok(correlation >= 0.98, `audio drift/content mismatch at ${frame / 48000}s: ${correlation}`);
  assert.ok(rmsRatio >= 0.95 && rmsRatio <= 1.05, `unexpected gain at ${frame / 48000}s: ${rmsRatio}`);
  results.push({ kind, repeat, sample: frame, seconds: frame / 48000, correlation, rmsRatio });
}
for (const repeat of new Set([0, Math.floor(Math.max(0, lastRepeat) / 2), Math.max(0, lastRepeat)])) {
  compare("body", repeat, referenceFrame + repeat * loopFrames, expected);
}
if (lastRepeat >= 1) {
  const acrossWrap = Buffer.concat([readWindow(reference, loopFrames - 24000, 24000), readWindow(reference, 0, 24000)]);
  assert.equal(acrossWrap.length, 48000 * 8);
  for (const repeat of new Set([Math.max(1, Math.floor(lastRepeat / 2)), lastRepeat])) {
    compare("wrap", repeat, repeat * loopFrames - 24000, acrossWrap);
  }
}
const evidence = { version: "yue2-assembly-audio-alignment/v2", reference, master, durationSec: duration,
  results, scope: "sample-clock alignment and decoded signal only; not a perceptual music or seam approval" };
if (evidencePath) writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(evidence));
