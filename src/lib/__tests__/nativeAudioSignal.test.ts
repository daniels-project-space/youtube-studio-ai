import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureNativeAudioSignal } from "@/lib/nativeAudioSignal";

const sampleRateHz = 48000, channels = 2, frames = 48000;
function wav(sample: (frame: number, channel: number) => number, frameCount = frames) {
  const bytes = Buffer.alloc(44 + frameCount * channels * 4);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRateHz, 24); bytes.writeUInt32LE(sampleRateHz * channels * 4, 28);
  bytes.writeUInt16LE(channels * 4, 32); bytes.writeUInt16LE(32, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(frameCount * channels * 4, 40);
  for (let frame = 0; frame < frameCount; frame++) for (let channel = 0; channel < channels; channel++) {
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
    assert.equal(result.monoFoldDown.finiteFrames, frames);
    assert.equal(result.monoFoldDown.rmsAmplitude, result.channelMeasurements[0].rmsAmplitude);
    result = await analyze((frame, channel) => channel ? -tone(frame) : tone(frame));
    assert.deepEqual(result.reviewReasons, ["mono_cancellation_requires_review"]);
    assert.equal(result.monoFoldDown.rmsAmplitude, 0);
    assert.equal(result.monoFoldDown.nonZeroFrames, 0);
    assert.ok(result.channelMeasurements.every((channel) => channel.rmsAmplitude! > 0.1));
    result = await analyze((frame, channel) => channel ? tone(frame + 12) : tone(frame));
    assert.deepEqual(result.reviewReasons, [], "wide stereo is not itself a defect");
    assert.ok(Math.abs(result.monoFoldDown.rmsAmplitude! - 0.1) < 1e-7);
    result = await analyze((frame, channel) => channel ? -0.5 * tone(frame) : tone(frame));
    assert.deepEqual(result.reviewReasons, [], "partial cancellation is measured, not automatically rejected");
    assert.ok(Math.abs(result.monoFoldDown.rmsAmplitude! - 0.05 / Math.sqrt(2)) < 1e-7);
    result = await analyze(() => 0);
    assert.deepEqual(result.reviewReasons, ["digital_silence"]);
    assert.equal(result.longestQuietWindowRunSec, 1);
    assert.equal(result.quietWindowFraction, 1);
    result = await analyze(() => 0.2);
    assert.deepEqual(result.reviewReasons, ["constant_signal"]);
    result = await analyze((frame, channel) => channel ? 0 : tone(frame));
    assert.deepEqual(result.reviewReasons, ["silent_channel_requires_review"]);
    for (const stuckChannel of [0, 1]) {
      for (const dc of [-0.2, 0.2]) {
        result = await analyze((frame, channel) => channel === stuckChannel ? dc : tone(frame));
        assert.deepEqual(result.reviewReasons, ["constant_channel_requires_review"]);
        assert.equal(result.channelMeasurements[stuckChannel].finiteSamples, frames);
        assert.equal(result.channelMeasurements[stuckChannel].dcOffset, Math.fround(dc));
        assert.equal(result.nonFiniteSamples, 0);
        assert.equal(result.samplesAtOrAboveFullScale, 0);
      }
    }
    result = await analyze((frame, channel) => tone(frame) + (channel ? 0.01 : 0));
    assert.deepEqual(result.reviewReasons, [], "a DC offset in a varying channel is not the same as a completely stuck channel");
    result = await analyze((frame, channel) => channel ? tone(frame) : tone(frame) / 10000);
    assert.deepEqual(result.reviewReasons, [], "a quiet but varying channel is not a stuck channel");
    result = await analyze((frame, channel) => frame >= 100 && frame < 110 && !channel ? 1.1 : tone(frame));
    assert.deepEqual(result.reviewReasons, ["full_scale_samples_require_review"]);
    assert.equal(result.samplesAtOrAboveFullScale, 10);
    assert.equal(result.maximumConsecutiveFullScaleSamples, 10);
    result = await analyze((frame, channel) => frame === 10 && channel === 0 ? NaN : frame === 20 && channel === 1 ? Infinity : tone(frame));
    assert.deepEqual(result.reviewReasons, ["non_finite_samples"]);
    assert.equal(result.nonFiniteSamples, 2);
    assert.equal(result.monoFoldDown.finiteFrames, frames - 2);
    assert.equal(result.channelMeasurements[0].finiteSamples, frames - 1);
    result = await analyze(() => NaN);
    assert.deepEqual(result.reviewReasons, ["non_finite_samples"]);
    assert.equal(result.channelMeasurements[0].rmsAmplitude, null, "unmeasurable is not zero");
    assert.equal(result.monoFoldDown.rmsAmplitude, null);
    assert.equal(result.monoFoldDown.peakAmplitude, null);
    result = await analyze((frame) => frame < 24000 ? 0 : tone(frame));
    assert.equal(result.quietWindowFraction, 0.5);
    assert.equal(result.longestQuietWindowRunSec, 0.5);
    result = await analyze((frame) => tone(frame) / 10000);
    assert.deepEqual(result.reviewReasons, [], "very quiet music is not automatically bad for every channel role");
    assert.equal(result.quietWindowFraction, 1);
    const measuredTone = await analyze(tone);
    const peakTone = await measureNativeAudioSignal({ ...input, measureTruePeak: true });
    assert.equal(peakTone.truePeak?.status, "measured");
    assert.ok(peakTone.truePeak!.dbtp! < -13 && peakTone.truePeak!.dbtp! > -15);
    const { truePeak: _peak, ...rawTone } = peakTone;
    void _peak;
    assert.deepEqual(rawTone, measuredTone, "parallel metering must not change any native sample measurement");
    const intersampleBytes = wav(frame => 1.2 * Math.sin(2 * Math.PI * 12000 * frame / sampleRateHz + Math.PI / 4));
    await writeFile(path, intersampleBytes);
    const sampleOnly = await measureNativeAudioSignal(input);
    assert.equal(sampleOnly.samplesAtOrAboveFullScale, 0);
    assert.deepEqual(sampleOnly.reviewReasons, [], "counterexample passes the previous sample-only gate");
    const intersample = await measureNativeAudioSignal({ ...input, measureTruePeak: true });
    assert.equal(intersample.truePeak?.status, "measured");
    assert.ok(intersample.truePeak!.dbtp! > 0, "oversampled meter must catch a peak hidden between stored samples");
    assert.deepEqual(intersample.reviewReasons, ["true_peak_at_or_near_full_scale_requires_review"]);
    assert.deepEqual(await readFile(path), intersampleBytes, "meter never normalizes or rewrites the source");
    await writeFile(path, wav(frame => frame === 4800 ? 0.8 : tone(frame), 4801));
    const tailPeak = await measureNativeAudioSignal({ ...input, expectedFrames: 4801, measureTruePeak: true });
    assert.ok(tailPeak.truePeak?.status === "unavailable" || tailPeak.truePeak!.dbtp! + 0.051 >= 20 * Math.log10(0.8),
      "a peak in a partial final meter window cannot be certified below the independently measured native peak");
    await analyze(() => 0);
    const silentPeak = await measureNativeAudioSignal({ ...input, measureTruePeak: true });
    assert.equal(silentPeak.truePeak?.status, "digital_silence");
    assert.equal(silentPeak.truePeak?.dbtp, null, "JSON must not coerce negative infinity into a misleading numeric zero");
    assert.deepEqual(silentPeak.reviewReasons, ["digital_silence"]);
    await analyze(() => NaN);
    const invalidPeak = await measureNativeAudioSignal({ ...input, measureTruePeak: true });
    assert.equal(invalidPeak.truePeak?.status, "unavailable");
    assert.ok(invalidPeak.reviewReasons.includes("true_peak_measurement_unavailable"));
    await analyze(tone);
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
if (mode.startsWith("meter-")) {
  const value = mode === "meter-silent" ? "-inf" : mode === "meter-low" ? "-40.0" : mode === "meter-ceiling" ? "0.0" : "-6.0";
  const summary = "True peak:\\n    Peak: " + value + " dBFS\\n";
  process.stderr.write(mode === "meter-duplicate" ? summary + summary : summary);
}
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
    const missingMeter = await measureNativeAudioSignal({ ...input, measureTruePeak: true });
    assert.equal(missingMeter.truePeak?.status, "unavailable");
    assert.deepEqual(missingMeter.reviewReasons, ["true_peak_measurement_unavailable"], "successful PCM decode alone cannot prove true peak");
    for (const mode of ["meter-valid", "meter-ceiling", "meter-duplicate", "meter-silent", "meter-low"]) {
      process.env.NATIVE_SIGNAL_FIXTURE_MODE = mode;
      const result = await measureNativeAudioSignal({ ...input, measureTruePeak: true });
      if (mode === "meter-valid") {
        assert.equal(result.truePeak?.dbtp, -6); assert.deepEqual(result.reviewReasons, []);
      } else if (mode === "meter-ceiling") {
        assert.equal(result.truePeak?.dbtp, 0);
        assert.deepEqual(result.reviewReasons, ["true_peak_at_or_near_full_scale_requires_review"]);
      } else {
        assert.equal(result.truePeak?.status, "unavailable"); assert.equal(result.truePeak?.dbtp, null);
        assert.deepEqual(result.reviewReasons, ["true_peak_measurement_unavailable"]);
      }
    }
    process.env.NATIVE_SIGNAL_FIXTURE_MODE = "bytes";
    const expectedMono = Array.from({ length: 8 }, (_, i) =>
      (Math.fround(Math.sin(i * 2) / 4) + Math.fround(Math.sin(i * 2 + 1) / 4)) / 2);
    assert.equal(measured.monoFoldDown.finiteFrames, 8);
    assert.ok(Math.abs(measured.monoFoldDown.rmsAmplitude! -
      Math.sqrt(expectedMono.reduce((sum, value) => sum + value * value, 0) / 8)) < 1e-12,
    "frame accumulation survives one-byte decoder chunks");
    const mono = await measureNativeAudioSignal({ ...input, channels: 1, expectedFrames: 16 });
    assert.equal(mono.monoFoldDown.finiteFrames, 16);
    assert.equal(mono.monoFoldDown.rmsAmplitude, mono.channelMeasurements[0].rmsAmplitude);
    assert.deepEqual(mono.reviewReasons, []);
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
