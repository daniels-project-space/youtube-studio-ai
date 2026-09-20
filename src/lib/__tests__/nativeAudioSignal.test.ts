import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureNativeAudioSignal } from "@/lib/nativeAudioSignal";

const sampleRateHz = 48000, channels = 2, frames = 48000;
function wav(sample: (frame: number, channel: number) => number) {
  const bytes = Buffer.alloc(44 + frames * channels * 4);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRateHz, 24); bytes.writeUInt32LE(sampleRateHz * channels * 4, 28);
  bytes.writeUInt16LE(channels * 4, 32); bytes.writeUInt16LE(32, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(frames * channels * 4, 40);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    bytes.writeFloatLE(sample(frame, channel), 44 + (frame * channels + channel) * 4);
  }
  return bytes;
}
const tone = (frame: number) => 0.2 * Math.sin(2 * Math.PI * 1000 * frame / sampleRateHz);

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "native-signal-test-"));
  const path = join(directory, "native.wav");
  const input = { path, sampleRateHz, channels, expectedFrames: frames };
  try {
    const analyze = async (sample: (frame: number, channel: number) => number) => {
      await writeFile(path, wav(sample));
      return measureNativeAudioSignal(input);
    };
    let result = await analyze(tone);
    assert.deepEqual(result.reviewReasons, []);
    assert.equal(result.nonFiniteSamples, 0);
    assert.equal(result.quietWindowFraction, 0);
    assert.equal(result.frames, frames);
    assert.ok(Math.abs(result.channelMeasurements[0].rmsAmplitude! - 0.2 / Math.sqrt(2)) < 1e-7);
    assert.ok(Math.abs(result.channelMeasurements[0].dcOffset!) < 1e-7);
    assert.equal(result.channelMeasurements[0].finiteSamples, frames);
    result = await analyze(() => 0);
    assert.deepEqual(result.reviewReasons, ["digital_silence"]);
    assert.equal(result.longestQuietWindowRunSec, 1);
    assert.equal(result.quietWindowFraction, 1);
    result = await analyze(() => 0.2);
    assert.deepEqual(result.reviewReasons, ["constant_signal"]);
    result = await analyze((frame, channel) => channel ? 0 : tone(frame));
    assert.deepEqual(result.reviewReasons, ["silent_channel_requires_review"]);
    result = await analyze((frame, channel) => frame >= 100 && frame < 110 && !channel ? 1.1 : tone(frame));
    assert.deepEqual(result.reviewReasons, ["full_scale_samples_require_review"]);
    assert.equal(result.samplesAtOrAboveFullScale, 10);
    assert.equal(result.maximumConsecutiveFullScaleSamples, 10);
    result = await analyze((frame, channel) => frame === 10 && channel === 0 ? NaN : frame === 20 && channel === 1 ? Infinity : tone(frame));
    assert.deepEqual(result.reviewReasons, ["non_finite_samples"]);
    assert.equal(result.nonFiniteSamples, 2);
    assert.equal(result.channelMeasurements[0].finiteSamples, frames - 1);
    result = await analyze(() => NaN);
    assert.deepEqual(result.reviewReasons, ["non_finite_samples"]);
    assert.equal(result.channelMeasurements[0].rmsAmplitude, null, "unmeasurable is not zero");
    result = await analyze((frame) => frame < 24000 ? 0 : tone(frame));
    assert.equal(result.quietWindowFraction, 0.5);
    assert.equal(result.longestQuietWindowRunSec, 0.5);
    result = await analyze((frame) => tone(frame) / 10000);
    assert.deepEqual(result.reviewReasons, [], "very quiet music is not automatically bad for every channel role");
    assert.equal(result.quietWindowFraction, 1);
    await assert.rejects(measureNativeAudioSignal({ ...input, expectedFrames: frames - 1 }), /frame bound/);
    await assert.rejects(measureNativeAudioSignal({ ...input, expectedFrames: frames + 1 }), /frame count/);
    await assert.rejects(measureNativeAudioSignal({ ...input, expectedFrames: Number.MAX_SAFE_INTEGER }), /bounded/);
    await writeFile(path, "not audio");
    await assert.rejects(measureNativeAudioSignal(input), /frame count/);
    await decoderFailureBoundaries(directory);
    console.log("NATIVE SIGNAL PASS: real FFmpeg decode, clean/silent/DC/dead-channel/full-scale/nonfinite/quiet fixtures, bounded frame counts");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function decoderFailureBoundaries(directory: string) {
  const binary = join(directory, "fixture-decoder");
  const pidPath = join(directory, "decoder.pid");
  await writeFile(binary, `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.NATIVE_SIGNAL_FIXTURE_PID, String(process.pid));
const mode = process.env.NATIVE_SIGNAL_FIXTURE_MODE;
const audio = Buffer.alloc(64);
for (let i = 0; i < 16; i++) audio.writeFloatLE(Math.sin(i) / 4, i * 4);
if (mode === "diagnostics") { process.stderr.write(Buffer.alloc(65537)); setInterval(() => {}, 1000); }
else if (mode === "stall") { setInterval(() => {}, 1000); }
else if (mode === "partial") process.stdout.write(audio.subarray(0, 63));
else if (mode === "overflow") { process.stdout.write(Buffer.alloc(65)); setInterval(() => {}, 1000); }
else {
  let index = 0;
  const send = () => { if (index < audio.length) { process.stdout.write(audio.subarray(index, ++index)); setImmediate(send); } };
  send();
}
`, { mode: 0o700 });
  const saved = { binary: process.env.FFMPEG_BIN, mode: process.env.NATIVE_SIGNAL_FIXTURE_MODE, pid: process.env.NATIVE_SIGNAL_FIXTURE_PID };
  const originalTimeout = globalThis.setTimeout;
  try {
    process.env.FFMPEG_BIN = binary;
    process.env.NATIVE_SIGNAL_FIXTURE_PID = pidPath;
    const input = { path: "ignored-by-explicit-test-decoder", sampleRateHz: 48000, channels: 2, expectedFrames: 8 };
    process.env.NATIVE_SIGNAL_FIXTURE_MODE = "bytes";
    const measured = await measureNativeAudioSignal(input);
    assert.equal(measured.channelMeasurements[0].finiteSamples, 8);
    assert.deepEqual(measured.reviewReasons, []);
    for (const [mode, message] of [["partial", /frame count/], ["overflow", /frame bound/], ["diagnostics", /diagnostic bound/], ["stall", /timed out/]] as const) {
      process.env.NATIVE_SIGNAL_FIXTURE_MODE = mode;
      if (mode === "stall") {
        globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
          originalTimeout(callback, ms === 30000 ? 1000 : ms, ...args)) as typeof setTimeout;
      }
      await assert.rejects(measureNativeAudioSignal(input), message);
      const pid = Number(await readFile(pidPath, "utf8"));
      assert.throws(() => process.kill(pid, 0), /ESRCH/, "rejection waits for decoder termination");
    }
    process.env.FFMPEG_BIN = join(directory, "missing-decoder");
    await assert.rejects(measureNativeAudioSignal(input), /unavailable/);
  } finally {
    globalThis.setTimeout = originalTimeout;
    for (const [key, value] of [["FFMPEG_BIN", saved.binary], ["NATIVE_SIGNAL_FIXTURE_MODE", saved.mode], ["NATIVE_SIGNAL_FIXTURE_PID", saved.pid]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
