import { spawn } from "node:child_process";

export type NativeAudioSignal = {
  version: "native-audio-signal/v1";
  frames: number;
  sampleRateHz: number;
  channels: number;
  nonFiniteSamples: number;
  samplesAtOrAboveFullScale: number;
  maximumConsecutiveFullScaleSamples: number;
  quietWindowDurationSec: number;
  quietThresholdDbfs: -60;
  quietWindowFraction: number;
  longestQuietWindowRunSec: number;
  monoFoldDown: {
    method: "arithmetic_channel_mean";
    finiteFrames: number;
    nonZeroFrames: number;
    peakAmplitude: number | null;
    rmsAmplitude: number | null;
  };
  channelMeasurements: Array<{
    peakAmplitude: number | null;
    rmsAmplitude: number | null;
    dcOffset: number | null;
    finiteSamples: number;
    nonZeroSamples: number;
  }>;
  reviewReasons: string[];
};

/** Full-file signal measurements, not an aesthetic score or a true-peak meter. */
export async function measureNativeAudioSignal(input: {
  path: string; sampleRateHz: number; channels: number; expectedFrames: number;
}): Promise<NativeAudioSignal> {
  const { path, sampleRateHz, channels, expectedFrames } = input;
  const expectedBytes = expectedFrames * channels * 4;
  if (!Number.isInteger(sampleRateHz) || sampleRateHz < 8000 || sampleRateHz > 192000 ||
    !Number.isInteger(channels) || channels < 1 || channels > 2 ||
    !Number.isSafeInteger(expectedFrames) || expectedFrames < 1 ||
    !Number.isSafeInteger(expectedBytes) || expectedBytes > 256 * 1024 * 1024) {
    throw new Error("Native signal analysis requires a bounded, probed audio format");
  }
  const channelStats = Array.from({ length: channels }, () => ({
    peak: 0, sum: 0, squareSum: 0, finite: 0, nonZero: 0,
    minimum: Infinity, maximum: -Infinity, ceilingRun: 0,
  }));
  let bytesRead = 0, samples = 0, nonFiniteSamples = 0, samplesAtOrAboveFullScale = 0;
  let maximumConsecutiveFullScaleSamples = 0;
  let carry = Buffer.alloc(0);
  let frameSum = 0, frameFinite = true;
  let monoFinite = 0, monoNonZero = 0, monoPeak = 0, monoSquareSum = 0;
  const windowFrames = Math.max(1, Math.round(sampleRateHz / 10));
  const quietAmplitude = 10 ** (-60 / 20);
  let windowPeak = 0, framesInWindow = 0, windows = 0, quietWindows = 0;
  let quietFrames = 0, longestQuietFrames = 0;
  function finishWindow() {
    if (!framesInWindow) return;
    windows++;
    if (windowPeak < quietAmplitude) {
      quietWindows++;
      quietFrames += framesInWindow;
      longestQuietFrames = Math.max(longestQuietFrames, quietFrames);
    } else quietFrames = 0;
    windowPeak = 0;
    framesInWindow = 0;
  }
  function consume(chunk: Buffer) {
    bytesRead += chunk.length;
    if (bytesRead > expectedBytes) throw new Error("Native signal decode exceeded the probed frame count");
    const bytes = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const completeBytes = bytes.length - bytes.length % 4;
    for (let offset = 0; offset < completeBytes; offset += 4) {
      const sample = bytes.readFloatLE(offset);
      const channel = channelStats[samples % channels];
      samples++;
      if (Number.isFinite(sample)) frameSum += sample;
      else frameFinite = false;
      if (!Number.isFinite(sample)) {
        nonFiniteSamples++;
        windowPeak = Infinity;
        channel.ceilingRun = 0;
      } else {
        const amplitude = Math.abs(sample);
        channel.finite++;
        channel.sum += sample;
        channel.squareSum += sample * sample;
        channel.peak = Math.max(channel.peak, amplitude);
        channel.minimum = Math.min(channel.minimum, sample);
        channel.maximum = Math.max(channel.maximum, sample);
        if (sample !== 0) channel.nonZero++;
        windowPeak = Math.max(windowPeak, amplitude);
        if (amplitude >= 1) {
          samplesAtOrAboveFullScale++;
          channel.ceilingRun++;
          maximumConsecutiveFullScaleSamples = Math.max(maximumConsecutiveFullScaleSamples, channel.ceilingRun);
        } else channel.ceilingRun = 0;
      }
      if (samples % channels === 0) {
        // Measure an equal-weight mono fold-down without modifying the source.
        // A frame with any invalid channel is unknown, never digital silence.
        if (frameFinite) {
          const mono = frameSum / channels;
          monoFinite++;
          if (mono !== 0) monoNonZero++;
          monoPeak = Math.max(monoPeak, Math.abs(mono));
          monoSquareSum += mono * mono;
        }
        frameSum = 0;
        frameFinite = true;
        if (++framesInWindow === windowFrames) finishWindow();
      }
    }
    carry = Buffer.from(bytes.subarray(completeBytes));
  }
  await new Promise<void>((resolve, reject) => {
    // No resampling, remixing, normalisation or repair: inspect the native
    // samples. The caller separately verifies the container's rate/channels.
    const child = spawn(process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1", "-i", path,
      "-map", "0:a:0", "-vn", "-sn", "-dn", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let failure: Error | undefined;
    let errorBytes = 0;
    const stop = (message: string) => {
      failure ??= new Error(message);
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop("Native signal analysis timed out"), 30000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      try { consume(chunk); } catch { stop("Native signal decode exceeded its frame bound"); }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes > 65536) stop("Native signal decoder exceeded its diagnostic bound");
    });
    child.once("error", () => { failure ??= new Error("Native signal decoder unavailable"); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || carry.length || samples !== expectedFrames * channels) {
        reject(new Error("Native signal decode did not match the probed frame count"));
      } else resolve();
    });
  });
  finishWindow();
  const reviewReasons: string[] = [];
  if (nonFiniteSamples) reviewReasons.push("non_finite_samples");
  if (channelStats.every((channel) => channel.finite === expectedFrames && channel.nonZero === 0)) reviewReasons.push("digital_silence");
  else if (channelStats.every((channel) => channel.finite === expectedFrames && channel.minimum === channel.maximum)) reviewReasons.push("constant_signal");
  else if (channelStats.some((channel) => channel.finite === expectedFrames && channel.nonZero === 0)) reviewReasons.push("silent_channel_requires_review");
  if (samplesAtOrAboveFullScale) reviewReasons.push("full_scale_samples_require_review");
  if (channels === 2 && monoFinite === expectedFrames && monoNonZero === 0 &&
    channelStats.some((channel) => channel.minimum !== channel.maximum)) {
    reviewReasons.push("mono_cancellation_requires_review");
  }
  return {
    version: "native-audio-signal/v1", frames: expectedFrames, sampleRateHz, channels,
    nonFiniteSamples, samplesAtOrAboveFullScale, maximumConsecutiveFullScaleSamples,
    quietWindowDurationSec: windowFrames / sampleRateHz, quietThresholdDbfs: -60,
    quietWindowFraction: quietWindows / windows, longestQuietWindowRunSec: longestQuietFrames / sampleRateHz,
    monoFoldDown: {
      method: "arithmetic_channel_mean", finiteFrames: monoFinite, nonZeroFrames: monoNonZero,
      peakAmplitude: monoFinite ? monoPeak : null,
      rmsAmplitude: monoFinite ? Math.sqrt(monoSquareSum / monoFinite) : null,
    },
    channelMeasurements: channelStats.map((channel) => ({
      peakAmplitude: channel.finite ? channel.peak : null,
      rmsAmplitude: channel.finite ? Math.sqrt(channel.squareSum / channel.finite) : null,
      dcOffset: channel.finite ? channel.sum / channel.finite : null,
      finiteSamples: channel.finite, nonZeroSamples: channel.nonZero,
    })),
    reviewReasons,
  };
}
