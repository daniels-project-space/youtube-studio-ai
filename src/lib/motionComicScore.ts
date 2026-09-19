import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { normalizeAudioOnly } from "@/lib/ffmpeg";

const execute = promisify(execFile);
const MAX_SCORE_BYTES = 256 * 1024 * 1024;
// Consumer bound for a finished shared score, including concatenated tracks.
// This is independent of the accepted arrangement/YuE source-piece 300s limit.
export const MOTION_COMIC_SCORE_MAX_DURATION_SEC = 7200;
export const MotionComicExternalScoreSchema = z.object({
  path: z.string().min(1).refine((value) => isAbsolute(value) && !value.includes("\0"), "absolute local path required"),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().positive().max(MAX_SCORE_BYTES),
  playback: z.enum(["once", "repeat"]),
  gain: z.number().finite().min(0).max(2),
  targetLufs: z.number().finite().min(-23).max(-12),
}).strict();

export type MotionComicExternalScore = z.infer<typeof MotionComicExternalScoreSchema>;
export type MotionComicScoreEvidence = Omit<MotionComicExternalScore, "path"> & { durationSec: number };

async function command(bin: string, args: string[]) {
  return execute(bin, args, { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
}

async function checkedBytes(score: MotionComicExternalScore): Promise<Buffer> {
  const info = await stat(score.path);
  if (!info.isFile() || info.size !== score.byteLength) throw new Error("motionComic external score byte length mismatch");
  const bytes = await readFile(score.path);
  if (bytes.length !== score.byteLength || createHash("sha256").update(bytes).digest("hex") !== score.contentSha256) {
    throw new Error("motionComic external score content hash mismatch");
  }
  return bytes;
}

const ProbeSchema = z.object({
  streams: z.array(z.object({
    codec_type: z.string(), duration: z.string().optional(), start_time: z.string().optional(), sample_rate: z.string().optional(),
  })),
  format: z.object({ duration: z.string().optional(), format_name: z.string() }),
});

async function probe(path: string) {
  const { stdout } = await command(process.env.FFPROBE_BIN ?? "ffprobe", [
    "-v", "error", "-protocol_whitelist", "file", "-show_streams", "-show_format", "-of", "json", path,
  ]);
  return ProbeSchema.parse(JSON.parse(stdout));
}

async function scoreDuration(path: string): Promise<number> {
  const media = await probe(path);
  const supported = new Set(["wav", "mp3", "flac", "ogg", "aac", "mov,mp4,m4a,3gp,3g2,mj2"]);
  if (!supported.has(media.format.format_name) || media.streams.length !== 1 || media.streams[0].codec_type !== "audio") {
    throw new Error("motionComic external score requires a self-contained single audio stream");
  }
  const sampleRate = Number(media.streams[0].sample_rate);
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || sampleRate > 384_000) {
    throw new Error("motionComic external score sample rate is invalid");
  }
  // Container duration can understate decoded audio (e.g. a stale MP3 Xing
  // frame count). Count mono float samples without retaining the decoded PCM.
  const byteCount = await new Promise<number>((resolveCount, reject) => {
    const child = spawn(/* turbopackIgnore: true */ process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-v", "error", "-xerror", "-protocol_whitelist", "file", "-i", path,
      "-map", "0:a:0", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let count = 0, stderr = "";
    let failure: Error | undefined;
    const fail = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
    const timer = setTimeout(() => fail(new Error("external score decode timed out")), 600_000);
    child.stdout.on("data", (bytes: Buffer) => {
      count += bytes.length;
      if (count > sampleRate * 4 * MOTION_COMIC_SCORE_MAX_DURATION_SEC) {
        fail(new Error(`external score decoded duration exceeds ${MOTION_COMIC_SCORE_MAX_DURATION_SEC}s`));
      }
    });
    child.stderr.on("data", (bytes: Buffer) => { stderr = (stderr + bytes.toString()).slice(-4096); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || count === 0 || count % 4 !== 0) reject(new Error(`external score decode failed: ${stderr}`));
      else resolveCount(count);
    });
  });
  return byteCount / 4 / sampleRate;
}

/** Validate a private byte snapshot, so probes cannot read a replaced source. */
export async function validateMotionComicExternalScore(value: unknown): Promise<MotionComicScoreEvidence> {
  const score = MotionComicExternalScoreSchema.parse(value);
  const bytes = await checkedBytes(score);
  const directory = await mkdtemp(join(tmpdir(), "motion-comic-score-check-"));
  try {
    const path = join(directory, "source.audio");
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    const durationSec = await scoreDuration(path);
    const { path: _path, ...evidence } = score;
    void _path;
    return { ...evidence, durationSec };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** External-only mux: no cache lookup, provider, or audio-free fallback. */
export async function muxMotionComicExternalScore(args: {
  externalScore: MotionComicExternalScore;
  videoPath: string;
  narrationPath: string;
  narrationStartSec: number;
  outPath: string;
}): Promise<MotionComicScoreEvidence> {
  const score = MotionComicExternalScoreSchema.parse(args.externalScore);
  if (!Number.isFinite(args.narrationStartSec) || args.narrationStartSec < 0) throw new Error("invalid narration start");
  if ([score.path, args.videoPath, args.narrationPath].some((path) => resolve(path) === resolve(args.outPath))) {
    throw new Error("external score output must not overwrite a source");
  }
  const bytes = await checkedBytes(score);
  const directory = await mkdtemp(join(dirname(args.outPath), ".external-score-"));
  try {
    const source = join(directory, "source.audio");
    await writeFile(source, bytes, { flag: "wx", mode: 0o600 });
    const durationSec = await scoreDuration(source);
    const video = await probe(args.videoPath);
    const stream = video.streams.find((entry) => entry.codec_type === "video");
    const videoDuration = Number(stream?.duration);
    if (!stream || !Number.isFinite(videoDuration) || videoDuration <= 0 || Number(stream.start_time ?? "0") !== 0) {
      throw new Error("external score requires a finite zero-origin video presentation duration");
    }
    if (score.playback === "once" && durationSec > videoDuration) {
      throw new Error("motionComic external score once playback would be truncated by final video");
    }
    const mixed = join(directory, "mixed.mp4");
    const normalized = join(directory, "normalized.mp4");
    const delay = args.narrationStartSec * 1000;
    await command(process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-v", "error", "-y", "-i", args.videoPath, "-i", args.narrationPath,
      ...(score.playback === "repeat" ? ["-stream_loop", "-1"] : []), "-i", source,
      "-filter_complex",
      `[1:a:0]adelay=${delay}:all=1,apad,atrim=end=${videoDuration}[n];` +
      `[2:a:0]volume=${score.gain}[m];` +
      `[n][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,atrim=end=${videoDuration}[a]`,
      "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "384k", mixed,
    ]);
    // This path is deliberately strict; legacy normalization remains fail-soft.
    await normalizeAudioOnly(mixed, normalized, score.targetLufs);
    await rename(normalized, args.outPath);
    const { path: _path, ...evidence } = score;
    void _path;
    return { ...evidence, durationSec };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
