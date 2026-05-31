/**
 * Thin ffmpeg / ffprobe wrappers for the lofi assemble + QA blocks.
 *
 * ffmpeg is baked into the Trigger task image via the ffmpeg build extension
 * (trigger.config.ts) and is present on the host for local runs.
 *
 * Assembly technique (locked, 12-template-c-lofi-spec):
 *   1. concat clip1 + clip2 (A→B→A) → a short seamless loop unit (~10s).
 *   2. stream_loop the loop unit under the full music track to the target
 *      duration; mux audio; output mp4 (yuv420p, +faststart).
 */
import { spawn } from "node:child_process";

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

function run(
  bin: string,
  args: string[],
  timeoutMs = 1_800_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new FfmpegError(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new FfmpegError(`${bin} spawn failed: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new FfmpegError(`${bin} exited ${code}: ${stderr.slice(-800)}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN ?? "ffprobe";

/**
 * Concat two clips (re-encoded for safe joins of differently-encoded inputs)
 * into a single seamless loop-unit mp4. We re-encode rather than stream-copy
 * because Kling outputs may not be concat-demuxer-safe.
 */
export async function concatClips(
  clipPaths: string[],
  outPath: string,
): Promise<string> {
  if (clipPaths.length < 1) throw new FfmpegError("concatClips: no inputs");
  const inputs: string[] = [];
  for (const p of clipPaths) {
    inputs.push("-i", p);
  }
  const n = clipPaths.length;
  const streams = clipPaths.map((_, i) => `[${i}:v:0]`).join("");
  const filter = `${streams}concat=n=${n}:v=1:a=0[outv]`;
  await run(FFMPEG, [
    "-y",
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "[outv]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-an",
    outPath,
  ]);
  return outPath;
}

/**
 * stream_loop the loop unit under an audio track to a target duration, muxing
 * audio. `-stream_loop -1` repeats the silent loop video; `-shortest` + an
 * explicit `-t` cut to the target length.
 */
export async function loopUnderAudio(args: {
  loopUnitPath: string;
  audioPath: string;
  outPath: string;
  durationSec: number;
}): Promise<string> {
  await run(FFMPEG, [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    args.loopUnitPath,
    "-i",
    args.audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-t",
    String(args.durationSec),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-shortest",
    args.outPath,
  ]);
  return args.outPath;
}

/** Extract a single frame at `offsetSec` to a JPEG. */
export async function grabFrame(
  videoPath: string,
  offsetSec: number,
  outJpg: string,
): Promise<string> {
  await run(FFMPEG, [
    "-y",
    "-ss",
    String(offsetSec),
    "-i",
    videoPath,
    "-vframes",
    "1",
    "-q:v",
    "2",
    outJpg,
  ]);
  return outJpg;
}

/**
 * Title-card thumbnail: draw the channel name + topic over a still using
 * drawtext. Pure ffmpeg, $0. Uses DejaVu Sans Bold (present on Ubuntu).
 */
export async function titleCard(args: {
  basePath: string;
  outJpg: string;
  title: string;
  subtitle: string;
  fontFile?: string;
}): Promise<string> {
  const font =
    args.fontFile ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’");
  const draw =
    `drawtext=fontfile=${font}:text='${esc(args.title)}':fontcolor=white:fontsize=72:` +
    `box=1:boxcolor=black@0.5:boxborderw=24:x=(w-text_w)/2:y=(h-text_h)/2-40,` +
    `drawtext=fontfile=${font}:text='${esc(args.subtitle)}':fontcolor=white@0.85:fontsize=40:` +
    `box=1:boxcolor=black@0.4:boxborderw=16:x=(w-text_w)/2:y=(h-text_h)/2+70`;
  await run(FFMPEG, [
    "-y",
    "-i",
    args.basePath,
    "-vf",
    `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,${draw}`,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    args.outJpg,
  ]);
  return args.outJpg;
}

export interface ProbeResult {
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
}

/** ffprobe a media file into a structured summary. */
export async function probe(path: string): Promise<ProbeResult> {
  const { stdout } = await run(FFPROBE, [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    path,
  ]);
  const json = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
    }>;
  };
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  return {
    durationSec: Number(json.format?.duration ?? 0),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: video?.width,
    height: video?.height,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
  };
}
