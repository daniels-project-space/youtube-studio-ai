import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MUSIC_PROGRAM_MAX_OPENING_HIGH_BAND_DROP_DB } from "@/engine/channelMusicProgram";

/**
 * Native Music3 takes must be measured from the exact WAV that is retained for
 * audition. A worker success response is not audio-quality evidence: an open
 * ComfyUI report shows a severe loss of bandwidth shortly after an apparently
 * healthy start. This analyzer uses only FFmpeg and local bytes, so the owner
 * cannot accidentally type (or copy) technical QC numbers for a different
 * take.
 */
export const NATIVE_MUSIC_QUALITY_ANALYSIS_VERSION = "native-music-quality/v1" as const;
export const MAX_OPENING_HIGH_BAND_DROP_DB = MUSIC_PROGRAM_MAX_OPENING_HIGH_BAND_DROP_DB;

export interface NativeMusicMeasurements {
  integratedLufs: number;
  truePeakDbtp: number;
  lraLu: number;
  crestDb: number;
  clippedSamples: number;
  maximumConsecutiveCeilingSamples: number;
  dcOffsetAbsolute: number;
  silenceFraction: number;
  mechanicalArtifactScore: number;
  /**
   * Loss of 5 kHz+ energy from an early, non-silent window to the first
   * post-opening window. A dramatic loss is the reported Music3 defect.
   */
  openingHighBandDropDb: number;
}

export interface NativeMusicQualityAnalysis {
  version: typeof NATIVE_MUSIC_QUALITY_ANALYSIS_VERSION;
  measurements: NativeMusicMeasurements;
  openingHighBand: {
    startSec: number;
    durationSec: number;
    meanDbfs: number;
  };
  postOpeningHighBand: {
    startSec: number;
    durationSec: number;
    meanDbfs: number;
  };
}

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

function runFfmpeg(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      /* turbopackIgnore: true */
      FFMPEG,
      args,
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`native music QA FFmpeg exited ${String(code)}: ${stderr.slice(-600)}`));
    });
  });
}

function lastNumber(output: string, expression: RegExp, label: string): number {
  const matches = [...output.matchAll(expression)];
  const value = matches.at(-1)?.[1];
  const parsed = value === undefined ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`native music QA could not measure ${label}`);
  return parsed;
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number, places = 4): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function silenceDurationSec(output: string, durationSec: number): number {
  const starts = [...output.matchAll(/silence_start:\s*([0-9.]+)/gu)].map((match) => Number(match[1]));
  const ends = [...output.matchAll(/silence_end:\s*([0-9.]+)/gu)].map((match) => Number(match[1]));
  let total = 0;
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!;
    const end = ends[index] ?? durationSec;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) total += end - start;
  }
  return bounded(total, 0, durationSec);
}

async function highBandWindow(inputPath: string, startSec: number, durationSec: number): Promise<number> {
  const output = await runFfmpeg([
    "-hide_banner", "-ss", startSec.toFixed(3), "-t", durationSec.toFixed(3), "-i", inputPath,
    "-map", "a:0", "-af", "highpass=f=5000,volumedetect", "-f", "null", "-",
  ]);
  return lastNumber(output, /mean_volume:\s*(-?(?:[0-9]+(?:\.[0-9]+)?|inf))\s+dB/gu, "high-band level");
}

/**
 * Measures an already-retained WAV. It intentionally runs again at approval
 * time, after the R2 byte-identity check, so no stale browser result can
 * certify a replacement object.
 */
export async function measureNativeMusicQuality(input: {
  readonly audio: Uint8Array;
  readonly durationSec: number;
}): Promise<NativeMusicQualityAnalysis> {
  if (!Number.isFinite(input.durationSec) || input.durationSec < 6 || input.durationSec > 300) {
    throw new Error("native music QA requires a measured WAV duration from 6 to 300 seconds");
  }
  if (input.audio.byteLength < 44 || input.audio.byteLength > 50_000_000) {
    throw new Error("native music QA received WAV bytes outside its bounded range");
  }
  const workDir = await mkdtemp(join(tmpdir(), "native-music-qa-"));
  const inputPath = join(workDir, "native.wav");
  await writeFile(inputPath, input.audio);
  try {
    const durationSec = input.durationSec;
    const [loudness, statistics, silence] = await Promise.all([
      runFfmpeg(["-hide_banner", "-i", inputPath, "-map", "a:0", "-af", "ebur128=peak=true", "-f", "null", "-"]),
      runFfmpeg(["-hide_banner", "-i", inputPath, "-map", "a:0", "-af", "astats=metadata=0:reset=0", "-f", "null", "-"]),
      runFfmpeg(["-hide_banner", "-i", inputPath, "-map", "a:0", "-af", "silencedetect=noise=-50dB:d=0.05", "-f", "null", "-"]),
    ]);
    const windowDurationSec = Math.min(1.5, Math.max(0.75, durationSec * 0.1));
    const openingStartSec = Math.min(0.75, Math.max(0, durationSec - (windowDurationSec * 2)));
    const postOpeningStartSec = Math.min(
      Math.max(3.75, openingStartSec + windowDurationSec),
      durationSec - windowDurationSec,
    );
    const [openingHighBandDbfs, postOpeningHighBandDbfs] = await Promise.all([
      highBandWindow(inputPath, openingStartSec, windowDurationSec),
      highBandWindow(inputPath, postOpeningStartSec, windowDurationSec),
    ]);
    const integratedLufs = lastNumber(loudness, /^\s*I:\s*(-?[0-9.]+)\s+LUFS/mgu, "integrated loudness");
    const lraLu = lastNumber(loudness, /^\s*LRA:\s*(-?[0-9.]+)\s+LU/mgu, "loudness range");
    const truePeakDbtp = lastNumber(loudness, /^\s*Peak:\s*(-?[0-9.]+)\s+dBFS/mgu, "true peak");
    const rmsDb = lastNumber(statistics, /RMS level dB:\s*(-?[0-9.]+)/gu, "RMS level");
    const dcOffsetAbsolute = Math.abs(lastNumber(statistics, /DC offset:\s*(-?[0-9.]+)/gu, "DC offset"));
    const peakCount = Math.max(0, Math.round(lastNumber(statistics, /Peak count:\s*([0-9.]+)/gu, "peak count")));
    const openingHighBandDropDb = Math.max(0, openingHighBandDbfs - postOpeningHighBandDbfs);
    // This score is intentionally narrow: it is a repeatable integrity score
    // for a catastrophic opening spectral collapse, not a pretend aesthetic
    // judgement. Human section/aesthetic review remains a separate gate.
    const mechanicalArtifactScore = openingHighBandDbfs > -55
      ? bounded((openingHighBandDropDb - MAX_OPENING_HIGH_BAND_DROP_DB) / 20, 0, 1)
      : 0;
    const clippedSamples = truePeakDbtp >= -0.1 ? peakCount : 0;
    return {
      version: NATIVE_MUSIC_QUALITY_ANALYSIS_VERSION,
      measurements: {
        integratedLufs: rounded(integratedLufs),
        truePeakDbtp: rounded(truePeakDbtp),
        lraLu: rounded(lraLu),
        crestDb: rounded(Math.max(0, truePeakDbtp - rmsDb)),
        clippedSamples,
        // astats reports a total peak count rather than a run length. When a
        // take reaches digital full scale, the total is a safe upper bound.
        maximumConsecutiveCeilingSamples: clippedSamples,
        dcOffsetAbsolute: rounded(dcOffsetAbsolute, 6),
        silenceFraction: rounded(silenceDurationSec(silence, durationSec) / durationSec, 6),
        mechanicalArtifactScore: rounded(mechanicalArtifactScore, 6),
        openingHighBandDropDb: rounded(openingHighBandDropDb),
      },
      openingHighBand: { startSec: openingStartSec, durationSec: windowDurationSec, meanDbfs: rounded(openingHighBandDbfs) },
      postOpeningHighBand: { startSec: postOpeningStartSec, durationSec: windowDurationSec, meanDbfs: rounded(postOpeningHighBandDbfs) },
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
