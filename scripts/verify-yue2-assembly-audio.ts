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
  "-show_entries", "stream=sample_rate,channels,duration_ts,time_base,duration", "-of", "json", path], { encoding: "utf8", timeout: 30_000 })).streams[0];
const loop = inspect(reference), output = inspect(master);
assert.equal(loop.sample_rate, "48000"); assert.equal(loop.channels, 2);
assert.equal(output.sample_rate, "48000"); assert.equal(output.channels, 2);
assert.equal(loop.time_base, "1/48000");
const loopFrames = Number(loop.duration_ts), duration = Number(output.duration);
assert.ok(Number.isSafeInteger(loopFrames) && loopFrames > 20 * 48000 && Number.isFinite(duration) && duration > 20);
const readWindow = (path: string, sample: number, count = 48000) => execFileSync(ffmpeg, ["-v", "error", "-ss",
  (sample / 48000).toFixed(9), "-i", path, "-t", (count / 48000).toFixed(9), "-map", "0:a:0", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
{ maxBuffer: 2 * 1024 * 1024, timeout: 30_000 });
const referenceFrame = 10 * 48000;
const expected = readWindow(reference, referenceFrame);
assert.equal(expected.length, 48000 * 8);
const lastRepeat = Math.floor(((duration - 20) * 48000 - referenceFrame) / loopFrames);
type WindowKind = "body" | "wrap" | "fade_in" | "fade_out";
const results: { kind: WindowKind; repeat: number; sample: number; seconds: number; correlation: number; rmsRatio: number }[] = [];
function compare(kind: WindowKind, repeat: number, frame: number, expected: Buffer) {
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
  assert.ok(correlation >= 0.98, `${kind}: audio drift/content mismatch at ${frame / 48000}s: ${correlation}`);
  assert.ok(rmsRatio >= 0.95 && rmsRatio <= 1.05, `${kind}: unexpected gain at ${frame / 48000}s: ${rmsRatio}`);
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
// Calculate the envelope independently in sample space, not by applying the
// renderer's FFmpeg filter to the reference (which could repeat its mistake).
const fadeOutSec = Math.min(4, Math.max(1, duration * 0.1));
const fadeOutStart = Math.round(Number((duration - fadeOutSec).toFixed(2)) * 48000);
const fadeOutFrames = Math.round(Number(fadeOutSec.toFixed(2)) * 48000);
for (const [kind, frame] of [["fade_in", 0], ["fade_out", Math.round((duration - 1) * 48000)]] as const) {
  const offset = frame % loopFrames;
  const firstCount = Math.min(48000, loopFrames - offset);
  const samples = Buffer.concat([readWindow(reference, offset, firstCount),
    ...(firstCount < 48000 ? [readWindow(reference, 0, 48000 - firstCount)] : [])]);
  assert.equal(samples.length, 48000 * 8);
  for (let sample = 0; sample < 48000; sample++) {
    const clock = frame + sample;
    const gain = Math.min(1, clock / 96000) * Math.max(0, Math.min(1, (fadeOutStart + fadeOutFrames - clock) / fadeOutFrames));
    for (let channel = 0; channel < 2; channel++) {
      const index = (sample * 2 + channel) * 4;
      samples.writeFloatLE(samples.readFloatLE(index) * gain, index);
    }
  }
  compare(kind, Math.floor(frame / loopFrames), frame, samples);
}
const evidence = { version: "yue2-assembly-audio-alignment/v3", reference, master, durationSec: duration,
  results, scope: "sample-clock alignment, decoded signal and boundary envelopes only; not a perceptual music or seam approval" };
if (evidencePath) writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(evidence));
