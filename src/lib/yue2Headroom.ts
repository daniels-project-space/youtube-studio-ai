import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { measureNativeAudioSignal, type NativeAudioSignal } from "@/lib/nativeAudioSignal";
import { probeYuE2NativeWav } from "@/lib/yue2NativeAudio";
import { verifyYuE2PreClampSource, yue2Sha256, type YuE2VerifiedCompletion } from "@/lib/yue2Evaluation";

const execute = promisify(execFile);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const meter = z.object({
  status: z.enum(["measured", "digital_silence"]), dbtp: z.number().finite().nullable(),
  nonFiniteSamples: z.literal(0), fullScaleSamples: z.number().int().nonnegative(),
  reviewReasons: z.array(z.string()),
}).strict();
export const YuE2HeadroomReceiptSchema = z.object({
  version: z.literal("studio-yue2-headroom/v1"), jobId: z.string(),
  sourceSha256: hash, sourceReceiptSha256: hash, audioSha256: hash,
  audioBytes: z.number().int().positive().max(256 * 1024 * 1024),
  frames: z.number().int().positive(), sampleRateHz: z.literal(48000), channels: z.literal(2),
  ceilingDbtp: z.literal(-1), measurementMarginDb: z.literal(0.2),
  method: z.literal("linear_attenuation_only"), gainDb: z.number().finite().max(0),
  before: meter, after: meter, productionApproved: z.literal(false),
}).strict();
export type YuE2HeadroomReceipt = z.infer<typeof YuE2HeadroomReceiptSchema>;
const inspectedSignals = new Map<string, { promise: Promise<NativeAudioSignal>; settled: boolean }>();

function summary(signal: NativeAudioSignal) {
  if (signal.nonFiniteSamples || !signal.truePeak || signal.truePeak.status === "unavailable") {
    throw new Error("Reliable finite true-peak measurement is required for headroom preparation");
  }
  return meter.parse({ status: signal.truePeak.status, dbtp: signal.truePeak.dbtp,
    nonFiniteSamples: signal.nonFiniteSamples, fullScaleSamples: signal.samplesAtOrAboveFullScale,
    reviewReasons: signal.reviewReasons });
}

function gainFor(before: z.infer<typeof meter>): number {
  if (before.status === "digital_silence") {
    if (before.dbtp !== null) throw new Error("Invalid silence meter");
    return 0;
  }
  if (before.dbtp === null) throw new Error("Missing true peak");
  // Reserve more than the meter's 0.1 dB display resolution, never amplify.
  return Math.min(0, Math.floor((-1.2 - before.dbtp) * 1000) / 1000);
}

function validateReceipt(completion: YuE2VerifiedCompletion, source: { audio: Uint8Array; receipt: Uint8Array },
  audio: Uint8Array, value: unknown): YuE2HeadroomReceipt {
  verifyYuE2PreClampSource(completion, source.audio, source.receipt);
  const receipt = YuE2HeadroomReceiptSchema.parse(value);
  if (receipt.jobId !== completion.request.job.job_id || receipt.sourceSha256 !== yue2Sha256(source.audio) ||
      receipt.sourceReceiptSha256 !== yue2Sha256(source.receipt) || receipt.audioSha256 !== yue2Sha256(audio) ||
      receipt.audioBytes !== audio.length || receipt.frames !== completion.result.frames ||
      receipt.gainDb !== gainFor(receipt.before) || receipt.after.fullScaleSamples !== 0 ||
      receipt.before.status !== receipt.after.status ||
      (receipt.gainDb === 0 && receipt.audioSha256 !== receipt.sourceSha256) ||
      (receipt.after.status === "measured" && (receipt.after.dbtp === null || receipt.after.dbtp > -1)) ||
      (receipt.after.status === "digital_silence" && receipt.after.dbtp !== null)) {
    throw new Error("Headroom identity, gain or measured ceiling mismatch");
  }
  return receipt;
}

/** A derived audition source, never loudness normalization or production approval. */
export async function prepareYuE2Headroom(completion: YuE2VerifiedCompletion,
  source: { audio: Uint8Array; receipt: Uint8Array }): Promise<{ audio: Uint8Array; receipt: YuE2HeadroomReceipt }> {
  verifyYuE2PreClampSource(completion, source.audio, source.receipt);
  const directory = await mkdtemp(join(tmpdir(), "yue2-headroom-"));
  try {
    const input = join(directory, "source.wav"), output = join(directory, "headroom.wav");
    await writeFile(input, source.audio, { flag: "wx", mode: 0o600 });
    await probeYuE2NativeWav(input, completion.result, source.audio.length);
    const measure = (path: string) => measureNativeAudioSignal({ path, sampleRateHz: 48000, channels: 2,
      expectedFrames: completion.result.frames, measureTruePeak: true });
    const before = summary(await measure(input));
    const gainDb = gainFor(before);
    let audio = source.audio;
    if (gainDb < 0) {
      await execute("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-n", "-i", input,
        "-map", "0:a:0", "-af", `volume=${gainDb}dB:precision=float`, "-c:a", "pcm_f32le", output],
      { timeout: 120000, maxBuffer: 65536 });
      if ((await stat(output)).size > 256 * 1024 * 1024) throw new Error("Headroom output exceeds audio bound");
      audio = await readFile(output);
    }
    const outputPath = gainDb < 0 ? output : input;
    await probeYuE2NativeWav(outputPath, completion.result, audio.length);
    const after = gainDb < 0 ? summary(await measure(outputPath)) : before;
    const receipt = validateReceipt(completion, source, audio, {
      version: "studio-yue2-headroom/v1", jobId: completion.request.job.job_id,
      sourceSha256: yue2Sha256(source.audio), sourceReceiptSha256: yue2Sha256(source.receipt),
      audioSha256: yue2Sha256(audio), audioBytes: audio.length, frames: completion.result.frames,
      sampleRateHz: 48000, channels: 2, ceilingDbtp: -1, measurementMarginDb: 0.2,
      method: "linear_attenuation_only", gainDb, before, after, productionApproved: false,
    });
    return { audio, receipt };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Recheck retained bytes and measured output without rendering another derivative. */
export async function inspectYuE2Headroom(completion: YuE2VerifiedCompletion,
  source: { audio: Uint8Array; receipt: Uint8Array }, audio: Uint8Array, value: unknown) {
  const receipt = validateReceipt(completion, source, audio, value);
  // validateReceipt hashes this read's source and output before any cache lookup.
  const key = `${receipt.audioSha256}:${receipt.frames}`;
  let entry = inspectedSignals.get(key);
  if (entry) {
    inspectedSignals.delete(key);
    inspectedSignals.set(key, entry);
  } else {
    const measure = async () => {
      const directory = await mkdtemp(join(tmpdir(), "yue2-headroom-review-"));
      try {
        const path = join(directory, "headroom.wav");
        await writeFile(path, audio, { flag: "wx", mode: 0o600 });
        await probeYuE2NativeWav(path, completion.result, audio.length);
        return await measureNativeAudioSignal({ path, sampleRateHz: 48000, channels: 2,
          expectedFrames: completion.result.frames, measureTruePeak: true });
      } finally { await rm(directory, { recursive: true, force: true }); }
    };
    if (inspectedSignals.size >= 8) {
      const settled = [...inspectedSignals].find(([, item]) => item.settled);
      if (settled) inspectedSignals.delete(settled[0]);
    }
    entry = { promise: measure(), settled: false };
    if (inspectedSignals.size < 8) inspectedSignals.set(key, entry);
  }
  let signal: NativeAudioSignal;
  try { signal = await entry.promise; }
  catch (error) {
    if (inspectedSignals.get(key) === entry) inspectedSignals.delete(key);
    throw error;
  } finally { entry.settled = true; }
  if (canonicalJson(summary(signal)) !== canonicalJson(receipt.after)) throw new Error("Retained headroom measurements disagree");
  return { receipt, signal: structuredClone(signal) };
}

export async function verifyYuE2Headroom(completion: YuE2VerifiedCompletion,
  source: { audio: Uint8Array; receipt: Uint8Array }, audio: Uint8Array, value: unknown): Promise<YuE2HeadroomReceipt> {
  return (await inspectYuE2Headroom(completion, source, audio, value)).receipt;
}
