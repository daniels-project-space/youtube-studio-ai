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
import { stat, copyFile } from "node:fs/promises";

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
  /**
   * Optional max output height. The Topaz loop unit can be true 4K
   * (e.g. 5088x2880); re-encoding that to H.264 on a CPU-only host at
   * `preset medium` is impractically slow (~0.3x realtime → hours). Capping the
   * height to a clean delivery resolution (default 2160 = UHD) keeps the Topaz
   * detail while staying encodable. Even width/height are forced (yuv420p).
   */
  maxHeight?: number;
  /** libx264 preset for the long stream-loop encode (default "veryfast"). */
  preset?: string;
  /** Hard timeout (ms) — default 45min for long/large encodes. */
  timeoutMs?: number;
}): Promise<string> {
  const maxHeight = args.maxHeight ?? 2160;
  // Downscale only if taller than the cap; always force even dims for yuv420p.
  const vf = `scale=-2:'min(${maxHeight},ih)':flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
  await run(
    FFMPEG,
    [
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
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      args.preset ?? "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      // Highest-quality AAC-LC delivery (YouTube's recommended stereo ceiling).
      // Source is the lossless FLAC master when the provider offers one.
      "384k",
      "-movflags",
      "+faststart",
      "-shortest",
      args.outPath,
    ],
    args.timeoutMs ?? 2_700_000,
  );
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

/* --------------------------- intro card (Remotion) ---------------------- */

/** npx invocation for a single CLI command with a timeout. */
function runCmd(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs = 300_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, npm_config_userconfig: "/tmp/empty-npmrc" },
    });
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

export interface RenderIntroArgs {
  /** Absolute path to the motion-graphics Remotion project. */
  motionGraphicsDir: string;
  /** Output path for the rendered transparent intro (WebM, alpha). */
  outputPath: string;
  /** Channel name shown in the intro. */
  channelName: string;
  /** Subtitle / video title shown in the intro. */
  videoTitle: string;
  /** Pre-rendered fallback template (copied if on-demand render fails). */
  fallbackTemplate?: string;
  /** Render timeout (ms). */
  timeoutMs?: number;
}

/**
 * Render the lofi intro card (transparent/alpha WebM) via Remotion — a faithful
 * port of legacy `intro_renderer.render_intro()`. On-demand renders the
 * `LofiIntroV2Transparent` composition with custom props; if the render is
 * unavailable (no node_modules / failure) and a pre-rendered template exists, it
 * copies that instead (legacy's "copy pre-rendered template" branch).
 *
 * Returns `{ path, rendered }` — `rendered=false` means the fallback template
 * was used (still a real animated intro, just with default channel name).
 */
export async function renderLofiIntro(
  args: RenderIntroArgs,
): Promise<{ path: string; rendered: boolean }> {
  const props = JSON.stringify({
    channelName: args.channelName,
    videoTitle: args.videoTitle,
    transparent: true,
  });
  try {
    await runCmd(
      "npx",
      [
        "remotion",
        "render",
        "src/index.ts",
        "LofiIntroV2Transparent",
        "--output",
        args.outputPath,
        "--codec=vp8",
        "--props",
        props,
      ],
      args.motionGraphicsDir,
      args.timeoutMs ?? 300_000,
    );
    const size = (await stat(args.outputPath)).size;
    if (size < 10_000) {
      throw new FfmpegError(`intro render produced a tiny file (${size}B)`);
    }
    return { path: args.outputPath, rendered: true };
  } catch (e) {
    if (args.fallbackTemplate) {
      await copyFile(args.fallbackTemplate, args.outputPath);
      return { path: args.outputPath, rendered: false };
    }
    throw e instanceof Error ? e : new FfmpegError(String(e));
  }
}

/**
 * Overlay a transparent intro (WebM with alpha) on the first N seconds of a
 * video — VERBATIM port of legacy `overlay_intro_ffmpeg`. N is read from the
 * intro's own duration via ffprobe.
 */
export async function overlayIntro(args: {
  introWebm: string;
  videoPath: string;
  outPath: string;
  timeoutMs?: number;
}): Promise<string> {
  const introInfo = await probe(args.introWebm);
  const introDuration = introInfo.durationSec || 8;
  await run(
    FFMPEG,
    [
      "-y",
      "-i",
      args.videoPath,
      "-i",
      args.introWebm,
      "-filter_complex",
      `[0:v][1:v]overlay=0:0:enable='between(t,0,${introDuration})'[vout]`,
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "copy",
      args.outPath,
    ],
    args.timeoutMs ?? 1_800_000,
  );
  const size = (await stat(args.outPath)).size;
  if (size < 100_000) {
    throw new FfmpegError(`overlayIntro produced a tiny file (${size}B)`);
  }
  return args.outPath;
}
