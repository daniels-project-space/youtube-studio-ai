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
import { stat, copyFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  planThumbnailText,
  type ThumbnailHeadlineLine,
  type ThumbnailTextZone,
} from "@/lib/thumbnailLayout";

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
 * Compare the same bounded regions in two still images with FFmpeg SSIM.
 * Returns the weakest region so callers cannot hide a large alteration behind
 * a mostly unchanged canvas.
 */
export async function measureImageRegionSsim(
  firstPath: string,
  secondPath: string,
  regions: readonly { x: number; y: number; width: number; height: number }[],
  opts: { canvasWidth?: number; canvasHeight?: number; timeoutMs?: number } = {},
): Promise<number> {
  const canvasWidth = opts.canvasWidth ?? 1_280;
  const canvasHeight = opts.canvasHeight ?? 720;
  if (
    !Number.isInteger(canvasWidth) || canvasWidth < 1 ||
    !Number.isInteger(canvasHeight) || canvasHeight < 1 ||
    !regions.length
  ) {
    throw new FfmpegError("image-region SSIM requires a positive canvas and at least one region");
  }
  const scores: number[] = [];
  for (const region of regions) {
    if (
      ![region.x, region.y, region.width, region.height].every(Number.isInteger) ||
      region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 ||
      region.x + region.width > canvasWidth || region.y + region.height > canvasHeight
    ) {
      throw new FfmpegError("image-region SSIM received an out-of-bounds crop");
    }
    const filter =
      `[0:v]scale=${canvasWidth}:${canvasHeight}:flags=area,` +
      `crop=${region.width}:${region.height}:${region.x}:${region.y}[a];` +
      `[1:v]scale=${canvasWidth}:${canvasHeight}:flags=area,` +
      `crop=${region.width}:${region.height}:${region.x}:${region.y}[b];` +
      "[a][b]ssim";
    const { stderr } = await run(
      FFMPEG,
      ["-i", firstPath, "-i", secondPath, "-lavfi", filter, "-f", "null", "-"],
      opts.timeoutMs ?? 60_000,
    );
    const similarity = Number(/All:([0-9.]+)/.exec(stderr)?.[1] ?? Number.NaN);
    if (!Number.isFinite(similarity)) {
      throw new FfmpegError("image-region measurement did not emit an SSIM score");
    }
    scores.push(Math.max(0, Math.min(1, similarity)));
  }
  return Number(Math.min(...scores).toFixed(6));
}

/** Return the weakest flat-colour score across bounded regions (1 = uniform). */
export async function measureImageRegionUniformity(
  imagePath: string,
  regions: readonly { x: number; y: number; width: number; height: number }[],
  opts: { timeoutMs?: number } = {},
): Promise<number> {
  if (!regions.length) throw new FfmpegError("image uniformity requires at least one region");
  const scores: number[] = [];
  for (const region of regions) {
    if (
      ![region.x, region.y, region.width, region.height].every(Number.isInteger) ||
      region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1
    ) {
      throw new FfmpegError("image uniformity received an invalid crop");
    }
    const filter =
      `crop=${region.width}:${region.height}:${region.x}:${region.y},` +
      "signalstats,metadata=print";
    const { stderr } = await run(
      FFMPEG,
      ["-i", imagePath, "-vf", filter, "-frames:v", "1", "-f", "null", "-"],
      opts.timeoutMs ?? 60_000,
    );
    const value = (key: string): number =>
      Number(new RegExp(`lavfi\\.signalstats\\.${key}=([0-9.]+)`).exec(stderr)?.[1] ?? Number.NaN);
    const ranges = [value("YMAX") - value("YMIN"), value("UMAX") - value("UMIN"), value("VMAX") - value("VMIN")];
    if (!ranges.every(Number.isFinite)) {
      throw new FfmpegError("image uniformity measurement did not emit bounded signal statistics");
    }
    scores.push(Math.max(0, Math.min(1, 1 - Math.max(...ranges) / 255)));
  }
  return Number(Math.min(...scores).toFixed(6));
}

/**
 * Composite provider-rendered typography from a chroma matte over an immutable
 * source frame. This never typesets locally; it only removes the sealed matte
 * colour around the lettering returned by the provider.
 */
export async function compositeProviderTypographyOverlay(args: {
  baseFramePath: string;
  providerOverlayPath: string;
  outPath: string;
  width?: number;
  height?: number;
  matteColor?: string;
  timeoutMs?: number;
}): Promise<string> {
  const width = args.width ?? 1_280;
  const height = args.height ?? 720;
  const matte = (args.matteColor ?? "#00ff00").replace(/^#/u, "0x");
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new FfmpegError("provider typography composite requires positive integer dimensions");
  }
  const filter =
    `[0:v]scale=${width}:${height}:flags=lanczos[base];` +
    `[1:v]scale=${width}:${height}:flags=lanczos,format=rgba,` +
    `colorkey=${matte}:0.48:0.08[type];` +
    "[base][type]overlay=0:0:format=auto,format=yuvj420p[out]";
  await run(
    FFMPEG,
    [
      "-y", "-i", args.baseFramePath, "-i", args.providerOverlayPath,
      "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", "-q:v", "2", args.outPath,
    ],
    args.timeoutMs ?? 60_000,
  );
  return args.outPath;
}

/**
 * Lightweight duration probe (seconds); returns 0 on any failure and never
 * throws. The shared version of the one-liner several render libs each
 * re-implemented (lofi/loreshort/motionComic). Respects FFPROBE_BIN.
 */
export async function ffprobeDuration(path: string): Promise<number> {
  try {
    const { stdout } = await run(FFPROBE, [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", path,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

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
 * Build a SEAMLESS loop unit from a SINGLE forward clip (golden-loop technique).
 *
 * The last `crossfadeSec` of the clip is crossfaded (time-blended) from the
 * clip's own TAIL into its own HEAD, so the final frame ≈ the first frame and
 * the unit can be stream_looped with no visible cut. Motion always plays
 * FORWARD (unlike a ping-pong/boomerang, which reverses rain/steam and looks
 * wrong), which is why this is the reliable default for arbitrary lofi motion.
 *
 * Output duration = D (input duration). If the clip is too short for the
 * requested crossfade we clamp it to 35% of the clip so the math stays valid.
 */
export async function seamlessLoopUnit(
  inputPath: string,
  outPath: string,
  opts: { crossfadeSec?: number; preset?: string; timeoutMs?: number } = {},
): Promise<string> {
  const D = (await probe(inputPath)).durationSec || 5;
  // Clamp crossfade so 0 < C < D and we keep a real non-faded body.
  const C = Math.max(0.4, Math.min(opts.crossfadeSec ?? 0.8, D * 0.35));
  const head = (D - C).toFixed(3);
  const dEnd = D.toFixed(3);
  const cc = C.toFixed(3);
  // a = body [0, D-C); btail = [D-C, D); chead = [0, C). Crossfade btail→chead,
  // then concat body + crossfade. blend `T` is the time within the segment.
  const filter =
    `[0:v]trim=0:${head},setpts=PTS-STARTPTS[a];` +
    `[0:v]trim=${head}:${dEnd},setpts=PTS-STARTPTS[btail];` +
    `[0:v]trim=0:${cc},setpts=PTS-STARTPTS[chead];` +
    `[btail][chead]blend=all_expr='A*(1-(T/${cc}))+B*(T/${cc})'[xf];` +
    `[a][xf]concat=n=2:v=1:a=0[v]`;
  await run(
    FFMPEG,
    [
      "-y", "-i", inputPath,
      "-filter_complex", filter, "-map", "[v]",
      "-c:v", "libx264", "-preset", opts.preset ?? "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", "-an", outPath,
    ],
    opts.timeoutMs ?? 600_000,
  );
  return outPath;
}

/**
 * Measure the visual discontinuity at a loop boundary. The value is
 * `1 - SSIM(firstFrame, lastFrame)`, so 0 is a perfect match and lower is
 * better. Frames are downscaled before SSIM: this is a stable boundary check,
 * not a perceptual-quality grade, and it should remain cheap even for a 4K
 * loop unit.
 */
export async function measureLoopSeamDiff(
  inputPath: string,
  workDir: string,
  opts: { sampleOffsetSec?: number; timeoutMs?: number } = {},
): Promise<number> {
  const durationSec = (await probe(inputPath)).durationSec;
  if (!Number.isFinite(durationSec) || durationSec < 0.2) {
    throw new FfmpegError(`loop seam measurement requires a video of at least 0.2s (received ${durationSec})`);
  }
  const offsetSec = Math.min(
    Math.max(0.02, opts.sampleOffsetSec ?? 0.08),
    Math.max(0.02, durationSec / 4),
  );
  const firstPath = join(workDir, "loop-seam-first.png");
  const lastPath = join(workDir, "loop-seam-last.png");
  const frameArgs = (atSec: number, outPath: string) => [
    "-y",
    "-i",
    inputPath,
    "-ss",
    atSec.toFixed(3),
    "-vframes",
    "1",
    "-vf",
    "scale=480:-2:flags=area",
    outPath,
  ];
  await Promise.all([
    run(FFMPEG, frameArgs(offsetSec, firstPath), opts.timeoutMs ?? 60_000),
    run(FFMPEG, frameArgs(Math.max(offsetSec, durationSec - offsetSec), lastPath), opts.timeoutMs ?? 60_000),
  ]);
  const { stderr } = await run(
    FFMPEG,
    ["-i", firstPath, "-i", lastPath, "-lavfi", "[0:v][1:v]ssim", "-f", "null", "-"],
    opts.timeoutMs ?? 60_000,
  );
  const match = /All:([0-9.]+)/.exec(stderr);
  const similarity = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(similarity)) {
    throw new FfmpegError("loop seam measurement did not emit an SSIM score");
  }
  return Number(Math.max(0, Math.min(1, 1 - similarity)).toFixed(6));
}

/**
 * Join two independently rendered loop segments into one exact-duration source
 * unit. Each segment is retimed by a tiny deterministic factor to its nominal
 * duration, preserving its reviewed first/end-frame closure while avoiding a
 * 30.16s unit caused by LTX's mandatory 8n+1 frame cadence.
 */
export async function composeLoopSourceUnit(args: {
  segmentPaths: readonly [string, string];
  outPath: string;
  segmentSeconds: number;
  fps?: number;
  preset?: string;
  timeoutMs?: number;
}): Promise<string> {
  if (!Number.isFinite(args.segmentSeconds) || args.segmentSeconds <= 0) {
    throw new FfmpegError("loop source segment duration must be positive and finite");
  }
  const fps = Math.max(1, Math.round(args.fps ?? 25));
  const media = await Promise.all(args.segmentPaths.map((path) => probe(path)));
  for (const [index, item] of media.entries()) {
    if (!Number.isFinite(item.durationSec) || item.durationSec < 0.2) {
      throw new FfmpegError(`loop source segment ${index + 1} has no usable video duration`);
    }
    if (!item.width || !item.height) {
      throw new FfmpegError(`loop source segment ${index + 1} has no measurable frame geometry`);
    }
  }
  if (media[0].width !== media[1].width || media[0].height !== media[1].height) {
    throw new FfmpegError(
      `loop source segments must share exact geometry (${media[0].width}x${media[0].height} vs ${media[1].width}x${media[1].height})`,
    );
  }
  const filters = media.map((item, index) => {
    const factor = args.segmentSeconds / item.durationSec;
    return `[${index}:v]setpts=${factor.toFixed(9)}*PTS,fps=${fps},format=yuv420p[v${index}]`;
  });
  filters.push("[v0][v1]concat=n=2:v=1:a=0[outv]");
  const totalSeconds = args.segmentSeconds * args.segmentPaths.length;
  await run(
    FFMPEG,
    [
      "-y",
      "-i", args.segmentPaths[0],
      "-i", args.segmentPaths[1],
      "-filter_complex", filters.join(";"),
      "-map", "[outv]",
      "-t", totalSeconds.toFixed(3),
      "-r", String(fps),
      "-c:v", "libx264",
      "-preset", args.preset ?? "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-an",
      args.outPath,
    ],
    args.timeoutMs ?? 900_000,
  );
  const output = await probe(args.outPath);
  if (Math.abs(output.durationSec - totalSeconds) > Math.max(0.08, 2 / fps)) {
    throw new FfmpegError(
      `loop source unit duration ${output.durationSec.toFixed(3)}s does not match ${totalSeconds.toFixed(3)}s contract`,
    );
  }
  return args.outPath;
}

/** Compare the frames immediately around one internal video join. */
export async function measureVideoBoundaryDiff(
  inputPath: string,
  workDir: string,
  opts: { boundarySec: number; sampleOffsetSec?: number; label?: string; timeoutMs?: number },
): Promise<number> {
  const durationSec = (await probe(inputPath)).durationSec;
  const boundarySec = Number(opts.boundarySec);
  const offsetSec = Math.max(0.02, opts.sampleOffsetSec ?? 0.08);
  if (
    !Number.isFinite(durationSec)
    || !Number.isFinite(boundarySec)
    || boundarySec <= offsetSec
    || boundarySec >= durationSec - offsetSec
  ) {
    throw new FfmpegError(
      `video boundary ${String(opts.boundarySec)}s is outside the measurable ${durationSec.toFixed(3)}s source`,
    );
  }
  const label = (opts.label ?? "boundary").replace(/[^a-z0-9_-]/gi, "-").slice(0, 40) || "boundary";
  const beforePath = join(workDir, `${label}-before.png`);
  const afterPath = join(workDir, `${label}-after.png`);
  const frameArgs = (atSec: number, outPath: string) => [
    "-y",
    "-i", inputPath,
    "-ss", atSec.toFixed(3),
    "-vframes", "1",
    "-vf", "scale=480:-2:flags=area",
    outPath,
  ];
  await Promise.all([
    run(FFMPEG, frameArgs(boundarySec - offsetSec, beforePath), opts.timeoutMs ?? 60_000),
    run(FFMPEG, frameArgs(boundarySec + offsetSec, afterPath), opts.timeoutMs ?? 60_000),
  ]);
  const { stderr } = await run(
    FFMPEG,
    ["-i", beforePath, "-i", afterPath, "-lavfi", "[0:v][1:v]ssim", "-f", "null", "-"],
    opts.timeoutMs ?? 60_000,
  );
  const similarity = Number(/All:([0-9.]+)/.exec(stderr)?.[1] ?? Number.NaN);
  if (!Number.isFinite(similarity)) {
    throw new FfmpegError("video boundary measurement did not emit an SSIM score");
  }
  return Number(Math.max(0, Math.min(1, 1 - similarity)).toFixed(6));
}

/**
 * BOOMERANG (ping-pong) loop unit — the most RELIABLE seamless loop for AI i2v
 * output. Plays the clip forward then reversed, so the unit is seamless at BOTH
 * joins (forward-end == reverse-start, and reverse-end == forward-start) NO MATTER
 * what the model did with the camera — even a slow zoom/drift just becomes a gentle
 * "breathing" in-out instead of a visible pop. Best paired with NON-directional
 * ambient motion (steam/glow/shimmer/sway) so the reversed half reads naturally.
 * The reverse filter buffers frames in memory, so only use it on the SHORT raw
 * loop clip (≤~10s), never the full render. Output duration = 2× input.
 */
export async function boomerangLoopUnit(
  inputPath: string,
  outPath: string,
  opts: { preset?: string; timeoutMs?: number } = {},
): Promise<string> {
  const filter = `[0:v]reverse[r];[0:v][r]concat=n=2:v=1:a=0[v]`;
  await run(
    FFMPEG,
    [
      "-y", "-i", inputPath,
      "-filter_complex", filter, "-map", "[v]",
      "-c:v", "libx264", "-preset", opts.preset ?? "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", "-an", outPath,
    ],
    opts.timeoutMs ?? 600_000,
  );
  return outPath;
}

/**
 * Depth-based PARALLAX loop unit — fakes a gentle 2.5D camera move by displacing
 * each pixel by its depth on a CLOSED sinusoidal path: sin(0)=sin(2π)=0, so the
 * first frame equals the last → perfectly seamless, with NO boomerang
 * velocity-flip. Inputs are the keyframe still + a grayscale depth map (from
 * src/lib/depth.ts). A 1.08 overscan hides the edge holes the displacement opens.
 *
 * IMPORTANT: this animates the CAMERA (parallax depth), not scene ELEMENTS. For
 * scenes whose motion IS the point (foaming waves, billowing curtains, drifting
 * lanterns) prefer/也 combine animated i2v — parallax alone leaves those static.
 * Marigold depth is BRIGHTER=FARTHER, so nearness = (255-lum) and near pixels
 * displace the most.
 */
export async function parallaxLoopUnit(
  stillPath: string,
  depthPath: string,
  outPath: string,
  opts: {
    width?: number;
    height?: number;
    periodSec?: number;
    fps?: number;
    amplitudePx?: number;
    preset?: string;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  const W = opts.width ?? 1344;
  const H = opts.height ?? 768;
  const PER = opts.periodSec ?? 10;
  const FPS = opts.fps ?? 24;
  const A = opts.amplitudePx ?? 18; // max horizontal shift (px) for the nearest pixels
  const fc =
    `[0:v]scale=${W}:${H},format=rgb24,scale=iw*1.08:ih*1.08,crop=${W}:${H}[base];` +
    `[1:v]scale=${W}:${H},format=gray,scale=iw*1.08:ih*1.08,crop=${W}:${H},` +
    `geq=lum='128+((255-lum(X,Y))/255)*${A}*sin(2*PI*T/${PER})'[xm];` +
    `color=c=0x808080:s=${W}x${H}:d=${PER}:r=${FPS},format=gray[ym];` +
    `[base][xm][ym]displace=edge=smear[v]`;
  await run(
    FFMPEG,
    [
      "-y",
      "-loop", "1", "-t", String(PER), "-r", String(FPS), "-i", stillPath,
      "-loop", "1", "-t", String(PER), "-r", String(FPS), "-i", depthPath,
      "-filter_complex", fc, "-map", "[v]",
      "-t", String(PER), "-r", String(FPS),
      "-c:v", "libx264", "-preset", opts.preset ?? "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", "-an", outPath,
    ],
    opts.timeoutMs ?? 600_000,
  );
  return outPath;
}

/**
 * Beat-aligned body: show clips in sequence cut on (roughly) sentence beats so
 * the visuals CHANGE with the narration instead of looping the same footage.
 * Each clip fills exactly one segment (stream-looped if shorter, trimmed if
 * longer), so every clip appears once before any repeat and the body is exactly
 * `targetSec`. Memory-flat: one clip per ffmpeg pass (vs concatScaled's N-input
 * graph that OOMs with many clips), then a concat-copy.
 */
/**
 * Detect internal scene-change timestamps (hard cuts) in a clip — downscaled
 * decode pass, cheap. Returns [] on any failure (callers fall back).
 */
/**
 * Return the approximate timestamps of visible scene changes.  Keep this
 * lightweight helper shared by assembly and post-render visual review so the
 * reviewer sees edit boundaries instead of only evenly-spaced stills.
 */
export async function detectSceneChanges(path: string, timeoutMs = 30_000): Promise<number[]> {
  try {
    const { stderr } = await run(
      FFMPEG,
      ["-i", path, "-vf", "scale=160:-2,select='gt(scene,0.35)',showinfo", "-f", "null", "-"],
      timeoutMs,
    );
    const times: number[] = [];
    for (const m of stderr.matchAll(/pts_time:([0-9.]+)/g)) {
      const t = Number(m[1]);
      if (Number.isFinite(t)) times.push(t);
    }
    return times;
  } catch {
    return [];
  }
}

export async function assembleBeatBody(args: {
  clipPaths: string[];
  outPath: string;
  targetSec: number;
  tmpDir: string;
  beats?: number[]; // accepted for compatibility; no longer used (no looping)
  maxSegSec?: number;
  /**
   * Optional PLANNED per-entry screen time, aligned with clipPaths. When given
   * (the EDL renderer's per-segment durSec — pacing curve, cutEnergy), each
   * entry plays min(planned, real length) instead of the flat maxSeg cap — the
   * plan's edit decisions actually reach the render. Absent ⇒ legacy maxSeg.
   */
  segDurationsSec?: number[];
  width?: number;
  height?: number;
  fps?: number;
  /** Preserve in-world source audio. `required` rejects any silent source take. */
  bodyAudioMode?: "off" | "available" | "required";
  preset?: string;
  /** Exact accepted segment timing, emitted only after the black-frame gate. */
  onSegmentAccepted?: (input: { index: number; screenSeconds: number }) => void;
}): Promise<string> {
  const { clipPaths, targetSec, tmpDir } = args;
  if (clipPaths.length === 0) throw new FfmpegError("assembleBeatBody: no clips");
  const W = args.width ?? 1920;
  const H = args.height ?? 1080;
  const fps = args.fps ?? 30;
  const maxSeg = args.maxSegSec ?? 10;
  const bodyAudioMode = args.bodyAudioMode ?? "off";

  // MEMOIZE probe + scene-detect per PATH: an EDL plan cycles its pool, so the
  // same file can appear many times — re-probing and re-scene-scanning each
  // occurrence was pure waste (a full decode pass per duplicate).
  const durCache = new Map<string, number>();
  const clipDurOf = async (p: string): Promise<number> => {
    const hit = durCache.get(p);
    if (hit !== undefined) return hit;
    let d = maxSeg;
    try {
      d = (await probe(p)).durationSec || maxSeg;
    } catch {
      d = maxSeg;
    }
    durCache.set(p, d);
    return d;
  };
  const sceneCache = new Map<string, number[]>();
  const audioCache = new Map<string, boolean>();
  const hasSourceAudio = async (path: string): Promise<boolean> => {
    const hit = audioCache.get(path);
    if (hit !== undefined) return hit;
    let hasAudio = false;
    try { hasAudio = (await probe(path)).hasAudio; } catch { /* handled below for required takes */ }
    audioCache.set(path, hasAudio);
    return hasAudio;
  };
  const scenesOf = async (p: string): Promise<number[]> => {
    const hit = sceneCache.get(p);
    if (hit) return hit;
    const cuts = await detectSceneChanges(p);
    sceneCache.set(p, cuts);
    return cuts;
  };
  // Occurrence bookkeeping: when a path repeats, SPREAD the cut windows across
  // the clip instead of re-cutting the identical centered window (identical
  // repeated segments are the exact "duplicate footage" defect QA flags).
  const occTotal = new Map<string, number>();
  for (const p of clipPaths) occTotal.set(p, (occTotal.get(p) ?? 0) + 1);
  const occSeen = new Map<string, number>();

  // Walk each entry AT MOST ONCE, playing it for up to its planned/maxSeg time
  // but NEVER longer than its real duration — no stream_loop. Coverage comes
  // from the quantity of clips (stock_footage provisions sum(min(dur,8)) ≥
  // target), so the body reaches targetSec without ever looping a clip.
  const segFiles: string[] = [];
  let total = 0;
  for (let i = 0; i < clipPaths.length; i++) {
    if (total >= targetSec) break;
    const dur = await clipDurOf(clipPaths[i]);
    if (dur < 0.3) continue;
    const planned = args.segDurationsSec?.[i];
    let segLen = Math.min(dur, planned && planned > 0 ? planned : maxSeg);
    // trim the last clip so we don't overshoot the target by much
    if (total + segLen > targetSec) segLen = Math.max(0.5, targetSec - total + 0.5);
    segLen = Math.min(segLen, dur, planned && planned > 0 ? planned : Number.POSITIVE_INFINITY); // never exceed source or plan
    if (segLen < 0.4) {
      if (planned && planned > 0) continue; // a tiny PLANNED seg skips, not aborts
      break;
    }
    const nOcc = occTotal.get(clipPaths[i]) ?? 1;
    const kOcc = occSeen.get(clipPaths[i]) ?? 0;
    occSeen.set(clipPaths[i], kOcc + 1);
    // CENTER-CUT: stock clips routinely open on a black fade-in (and end on a
    // fade-out) — cutting from t=0 turned one such clip into a full-black
    // segment that then repeated at every body loop. Cutting from the middle
    // lands on the clip's actual content. REPEATED paths spread their windows
    // evenly across the clip so each occurrence shows different footage.
    let ss =
      nOcc > 1
        ? Math.max(0, ((dur - segLen) / (nOcc + 1)) * (kOcc + 1))
        : Math.max(0, (dur - segLen) / 2);
    // SCENE-AWARE CUT (long holds, single-occurrence only — spread windows for
    // repeats already vary the cut): stock clips often contain internal hard
    // cuts; a 16s contemplative hold crossing one jumps mid-shot. Fit the
    // window inside the longest internal scene; shrink into it if needed;
    // center-cut stays the fallback.
    if (segLen >= 6 && nOcc === 1) {
      const cuts = await scenesOf(clipPaths[i]);
      if (cuts.length > 0) {
        const bounds = [0, ...cuts.filter((t) => t > 0.1 && t < dur - 0.1).sort((a, b) => a - b), dur];
        let best: { start: number; len: number } | null = null;
        for (let b = 0; b < bounds.length - 1; b++) {
          const len = bounds[b + 1] - bounds[b];
          if (!best || len > best.len) best = { start: bounds[b], len };
        }
        if (best && best.len >= segLen + 0.2) {
          ss = best.start + (best.len - segLen) / 2;
        } else if (best && best.len >= 2.5) {
          segLen = Math.max(0.5, Math.min(segLen, best.len - 0.2));
          ss = best.start + 0.1;
        }
      }
    }
    // AAC carries encoder delay. Keep intermediate in-world audio lossless so
    // every later concat boundary remains exactly on the planned visual cut;
    // the finished body is encoded to AAC once below.
    const sf = join(tmpDir, `beatseg_${i}${bodyAudioMode === "off" ? ".mp4" : ".mkv"}`);
    const sourceHasAudio = bodyAudioMode === "off" ? false : await hasSourceAudio(clipPaths[i]);
    if (bodyAudioMode === "required" && !sourceHasAudio) {
      throw new FfmpegError(`assembleBeatBody: required diegetic audio missing from segment ${i}`);
    }
    const sourceAudio = sourceHasAudio
      ? "[0:a]"
      : "anullsrc=channel_layout=stereo:sample_rate=44100";
    // Preserve the cut timing while avoiding a discontinuity click when LTX
    // changes physical sound sources between adjacent visual shots.
    const audioEdgeFadeSec = Math.min(0.02, segLen / 4);
    const audioEdgeFades = `afade=t=in:st=0:d=${audioEdgeFadeSec.toFixed(3)},` +
      `afade=t=out:st=${Math.max(0, segLen - audioEdgeFadeSec).toFixed(3)}:d=${audioEdgeFadeSec.toFixed(3)}`;
    const av = bodyAudioMode === "off"
      ? ["-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps}`, "-an"]
      : [
          "-filter_complex",
          `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps},setpts=PTS-STARTPTS[v];${sourceAudio}aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${segLen.toFixed(3)},asetpts=PTS-STARTPTS,${audioEdgeFades}[a]`,
          "-map", "[v]", "-map", "[a]",
        ];
    await run(FFMPEG, [
      "-y",
      "-ss",
      ss.toFixed(3),
      "-i",
      clipPaths[i],
      "-t",
      segLen.toFixed(3),
      ...av,
      "-c:v",
      "libx264",
      "-preset",
      args.preset ?? "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      ...(bodyAudioMode === "off" ? [] : ["-c:a", "pcm_s16le"]),
      sf,
    ]);
    // BLACK-SEGMENT GUARD: sample two frames; a (near-)black segment is dropped
    // instead of shipping 8s of dead air the deterministic QA will fail anyway.
    try {
      const f1 = `${sf}.q1.jpg`;
      const f2 = `${sf}.q3.jpg`;
      await grabFrame(sf, Math.max(0.2, segLen * 0.25), f1);
      await grabFrame(sf, Math.max(0.4, segLen * 0.75), f2);
      const l1 = await regionLuma(f1, 0, 1);
      const l2 = await regionLuma(f2, 0, 1);
      if (l1 < 14 && l2 < 14) {
        console.warn(`assembleBeatBody: segment ${i} is black (luma ${l1.toFixed(0)}/${l2.toFixed(0)}) — dropped`);
        continue;
      }
    } catch {
      /* probe failure → keep the segment (validateRender still backstops) */
    }
    args.onSegmentAccepted?.({ index: i, screenSeconds: segLen });
    segFiles.push(sf);
    total += segLen;
  }
  if (segFiles.length === 0) throw new FfmpegError("assembleBeatBody: no usable clips");
  if (total < targetSec) {
    // not enough distinct footage to fully cover — log it (no silent looping).
    console.warn(`assembleBeatBody: body ${total.toFixed(1)}s < target ${targetSec.toFixed(1)}s (need more distinct clips)`);
  }

  const listFile = join(tmpDir, "beatsegs.txt");
  await writeFile(
    listFile,
    segFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"),
  );
  await run(FFMPEG, [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    ...(bodyAudioMode === "off" ? ["-c", "copy"] : ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]),
    args.outPath,
  ]);
  return args.outPath;
}

/**
 * Assemble an authored story body without reordering, recycling, center-cuts,
 * scene substitution, or silent segment drops. Each source starts at frame 0
 * and occupies its declared duration; the final frame may be held only for the
 * explicit post-narration tail.
 */
export async function assembleAuthoredBody(args: {
  clipPaths: string[];
  segDurationsSec: number[];
  outPath: string;
  tmpDir: string;
  tailHoldSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Preserve LTX's in-world audio; `required` rejects a video-only take. */
  bodyAudioMode?: "off" | "available" | "required";
  preset?: string;
}): Promise<string> {
  if (args.clipPaths.length === 0 || args.clipPaths.length !== args.segDurationsSec.length) {
    throw new FfmpegError("assembleAuthoredBody: clip/duration mapping must be non-empty and one-to-one");
  }
  const W = args.width ?? 1920;
  const H = args.height ?? 1080;
  const fps = args.fps ?? 30;
  const tailHold = Math.max(0, args.tailHoldSec ?? 0);
  const bodyAudioMode = args.bodyAudioMode ?? "off";
  const segFiles: string[] = [];
  let expectedTotal = 0;

  for (let index = 0; index < args.clipPaths.length; index++) {
    const authored = args.segDurationsSec[index];
    if (!Number.isFinite(authored) || authored <= 0) {
      throw new FfmpegError(`assembleAuthoredBody: invalid duration for segment ${index}`);
    }
    const media = await probe(args.clipPaths[index]);
    if (!media.hasVideo || !Number.isFinite(media.durationSec) || media.durationSec <= 0) {
      throw new FfmpegError(`assembleAuthoredBody: segment ${index} is not a valid video`);
    }
    if (bodyAudioMode === "required" && !media.hasAudio) {
      throw new FfmpegError(`assembleAuthoredBody: required diegetic audio missing from segment ${index}`);
    }
    // LTX clips are quantized to 8n+1 frames, so their container duration can
    // differ from the authored window by a few frames. Larger deficits are a
    // provider contract violation; tiny deficits are held to the exact cut.
    if (media.durationSec < authored - Math.max(0.2, 3 / fps)) {
      throw new FfmpegError(
        `assembleAuthoredBody: segment ${index} is ${media.durationSec.toFixed(3)}s, shorter than authored ${authored.toFixed(3)}s`,
      );
    }
    const outputDur = authored + (index === args.clipPaths.length - 1 ? tailHold : 0);
    const pad = Math.max(0, outputDur - media.durationSec);
    const vf =
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps},` +
      `tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)},` +
      `trim=duration=${outputDur.toFixed(3)},setpts=PTS-STARTPTS`;
    // See beat assembly: lossless intermediates prevent AAC priming samples
    // from accumulating between narrated LTX cuts.
    const segmentPath = join(
      args.tmpDir,
      `authored_${String(index).padStart(4, "0")}${bodyAudioMode === "off" ? ".mp4" : ".mkv"}`,
    );
    const sourceAudio = media.hasAudio
      ? "[0:a]"
      : "anullsrc=channel_layout=stereo:sample_rate=44100";
    // A 20ms boundary fade is short enough not to move a causal cut, but
    // prevents a phase/amplitude jump from producing a click in the master.
    const audioEdgeFadeSec = Math.min(0.02, outputDur / 4);
    const audioEdgeFades = `afade=t=in:st=0:d=${audioEdgeFadeSec.toFixed(3)},` +
      `afade=t=out:st=${Math.max(0, outputDur - audioEdgeFadeSec).toFixed(3)}:d=${audioEdgeFadeSec.toFixed(3)}`;
    const av = bodyAudioMode === "off"
      ? ["-vf", vf, "-an"]
      : [
          "-filter_complex",
          `[0:v]${vf}[v];${sourceAudio}aresample=44100,aformat=channel_layouts=stereo,apad=pad_dur=${pad.toFixed(3)},atrim=duration=${outputDur.toFixed(3)},asetpts=PTS-STARTPTS,${audioEdgeFades}[a]`,
          "-map", "[v]", "-map", "[a]",
        ];
    await run(FFMPEG, [
      "-y",
      "-i",
      args.clipPaths[index],
      ...av,
      "-c:v",
      "libx264",
      "-preset",
      args.preset ?? "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      ...(bodyAudioMode === "off" ? [] : ["-c:a", "pcm_s16le"]),
      segmentPath,
    ]);

    const q1 = `${segmentPath}.q1.jpg`;
    const q3 = `${segmentPath}.q3.jpg`;
    await grabFrame(segmentPath, Math.max(0.08, Math.min(outputDur * 0.25, outputDur - 0.08)), q1);
    await grabFrame(segmentPath, Math.max(0.08, Math.min(outputDur * 0.75, outputDur - 0.08)), q3);
    const [l1, l2] = await Promise.all([regionLuma(q1, 0, 1), regionLuma(q3, 0, 1)]);
    if (l1 < 14 && l2 < 14) {
      throw new FfmpegError(
        `assembleAuthoredBody: segment ${index} is black (luma ${l1.toFixed(0)}/${l2.toFixed(0)})`,
      );
    }
    segFiles.push(segmentPath);
    expectedTotal += outputDur;
  }

  const listFile = join(args.tmpDir, "authored_segments.txt");
  await writeFile(
    listFile,
    segFiles.map((file) => `file '${file.replace(/'/g, "'\\\\''")}'`).join("\n"),
  );
  await run(FFMPEG, [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    ...(bodyAudioMode === "off" ? ["-c", "copy"] : ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]),
    args.outPath,
  ]);
  const assembled = await probe(args.outPath);
  if (Math.abs(assembled.durationSec - expectedTotal) > Math.max(0.2, 3 / fps)) {
    throw new FfmpegError(
      `assembleAuthoredBody: assembled duration ${assembled.durationSec.toFixed(3)}s != ${expectedTotal.toFixed(3)}s`,
    );
  }
  return args.outPath;
}

/**
 * Build a body from an ordered list of WINDOWS (the chapter "multi-stage"
 * structure): each window is either a CARD (a pre-rendered heading clip, shown
 * while the heading is read out) or FOOTAGE (filled from the clip pool, each clip
 * ≤ its real length, advancing through the pool and wrapping only if it runs
 * out). One concat pass — scales to long videos (no per-card re-encode). The
 * windows' durations mirror the narration timeline so cards align with the
 * spoken headings. Memory-flat. No audio.
 */
export async function assembleStructuredBody(args: {
  windows: { kind: "footage" | "card"; durSec: number; cardPath?: string }[];
  clipPaths: string[];
  outPath: string;
  tmpDir: string;
  width?: number;
  height?: number;
  fps?: number;
  /** Preserve in-world source audio; silent cards/inserts receive a silent track. */
  bodyAudioMode?: "off" | "available" | "required";
  maxSegSec?: number;
  preset?: string;
}): Promise<string> {
  const W = args.width ?? 1920;
  const H = args.height ?? 1080;
  const fps = args.fps ?? 30;
  const maxSeg = args.maxSegSec ?? 25;
  const bodyAudioMode = args.bodyAudioMode ?? "off";
  const scalePad =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps}`;
  const clipDur: number[] = [];
  const clipHasAudio: boolean[] = [];
  for (const c of args.clipPaths) {
    try {
      const media = await probe(c);
      clipDur.push(media.durationSec || maxSeg);
      clipHasAudio.push(media.hasAudio);
    } catch {
      clipDur.push(maxSeg);
      clipHasAudio.push(false);
    }
  }
  const segFiles: string[] = [];
  let sj = 0;
  let ci = 0;
  // Per-clip reuse counter: when the pool wraps, each reuse takes a DIFFERENT
  // window of the clip instead of re-cutting the identical opening (visible
  // duplicate segments — the defect the beat body already guards against).
  const useCount = new Map<number, number>();
  const cut = async (input: string, dur: number, ssSec = 0, sourceHasAudio = false) => {
    const sf = join(args.tmpDir, `sbody_${sj++}${bodyAudioMode === "off" ? ".mp4" : ".mkv"}`);
    if (bodyAudioMode === "required" && !sourceHasAudio) {
      throw new FfmpegError("assembleStructuredBody: required diegetic audio missing from a source segment");
    }
    const sourceAudio = sourceHasAudio
      ? "[0:a]"
      : "anullsrc=channel_layout=stereo:sample_rate=44100";
    const audioEdgeFadeSec = Math.min(0.02, dur / 4);
    const audioEdgeFades = `afade=t=in:st=0:d=${audioEdgeFadeSec.toFixed(3)},` +
      `afade=t=out:st=${Math.max(0, dur - audioEdgeFadeSec).toFixed(3)}:d=${audioEdgeFadeSec.toFixed(3)}`;
    const av = bodyAudioMode === "off"
      ? ["-vf", scalePad, "-an"]
      : [
          "-filter_complex",
          `[0:v]${scalePad},setpts=PTS-STARTPTS[v];${sourceAudio}aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${dur.toFixed(3)},asetpts=PTS-STARTPTS,${audioEdgeFades}[a]`,
          "-map", "[v]", "-map", "[a]",
        ];
    await run(FFMPEG, [
      "-y", ...(ssSec > 0.01 ? ["-ss", ssSec.toFixed(3)] : []), "-i", input,
      "-t", dur.toFixed(3), ...av,
      "-c:v", "libx264", "-preset", args.preset ?? "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      ...(bodyAudioMode === "off" ? [] : ["-c:a", "pcm_s16le"]), sf,
    ]);
    segFiles.push(sf);
  };
  for (const w of args.windows) {
    if (w.durSec < 0.3) continue;
    if (w.kind === "card" && w.cardPath) {
      await cut(w.cardPath, w.durSec); // cards play from t=0 (authored start)
    } else if (args.clipPaths.length > 0) {
      let need = w.durSec;
      while (need > 0.4) {
        const idx = ci % args.clipPaths.length;
        const clip = args.clipPaths[idx];
        const cd = clipDur[idx] || maxSeg;
        const seg = Math.min(cd, maxSeg, need);
        if (seg < 0.4) break;
        // CENTER-CUT footage (same rationale as assembleBeatBody: stock clips
        // routinely open on a black fade-in); on reuse, walk the window across
        // the clip so wrapped fills don't repeat identical footage.
        const k = useCount.get(idx) ?? 0;
        useCount.set(idx, k + 1);
        const head = Math.max(0, cd - seg);
        // golden-ratio hop: k=0 ⇒ center; each reuse lands on a well-spread,
        // deterministic, non-repeating offset within the clip.
        const ss = head * ((0.5 + k * 0.381966) % 1);
        await cut(clip, seg, Math.min(ss, head), clipHasAudio[idx] ?? false);
        need -= seg;
        ci++;
      }
    }
  }
  if (segFiles.length === 0) throw new FfmpegError("assembleStructuredBody: no segments");
  const listFile = join(args.tmpDir, "sbody_list.txt");
  await writeFile(listFile, segFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await run(FFMPEG, [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    ...(bodyAudioMode === "off" ? ["-c", "copy"] : ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]),
    args.outPath,
  ]);
  return args.outPath;
}

/**
 * Concat clips of MIXED resolution/fps into one silent video on a uniform
 * canvas (default 1920x1080@30): each input is scaled to fit, letterbox-padded,
 * SAR-normalized, then concatenated. Used by timeline_assemble for Pexels stock
 * footage (clips vary in size). No audio — narration is muxed later.
 */
export async function concatScaled(
  clipPaths: string[],
  outPath: string,
  width = 1920,
  height = 1080,
  fps = 30,
): Promise<string> {
  if (clipPaths.length < 1) throw new FfmpegError("concatScaled: no inputs");
  const inputs: string[] = [];
  for (const p of clipPaths) inputs.push("-i", p);
  const n = clipPaths.length;
  const norm = clipPaths
    .map(
      (_, i) =>
        `[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps}[v${i}]`,
    )
    .join(";");
  const chain = clipPaths.map((_, i) => `[v${i}]`).join("");
  const filter = `${norm};${chain}concat=n=${n}:v=1:a=0[outv]`;
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
    "veryfast",
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
  /**
   * Extra video AFTER the audio ends, so the narration finishes BEFORE the video
   * does (no voice talking over the very end). The tail is silent video.
   */
  tailSec?: number;
  /** Fade video to black + fade the audio out over the last N seconds. */
  fadeOutSec?: number;
}): Promise<string> {
  const maxHeight = args.maxHeight ?? 2160;
  const tail = Math.max(0, args.tailSec ?? 0);
  const fade = Math.max(0, args.fadeOutSec ?? 0);
  const audioSec = args.durationSec;
  const totalSec = audioSec + tail; // video length (≥ audio when tail > 0)

  // Scale chain (cap height, force even dims) + optional end fade-to-black.
  let vf = `scale=-2:'min(${maxHeight},ih)':flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
  if (fade > 0) {
    vf += `,fade=t=out:st=${(totalSec - fade).toFixed(2)}:d=${fade.toFixed(2)}`;
  }

  const a: string[] = [
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
    String(totalSec),
    "-vf",
    vf,
  ];
  // Fade the narration out as it ends (kept within the audio's own length).
  if (fade > 0) {
    a.push("-af", `afade=t=out:st=${Math.max(0, audioSec - fade).toFixed(2)}:d=${fade.toFixed(2)}`);
  }
  a.push(
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
    "384k", // YouTube's recommended AAC-LC stereo ceiling
    "-movflags",
    "+faststart",
  );
  // -shortest only when there's no tail (otherwise it would cut at the audio).
  if (tail === 0) a.push("-shortest");
  a.push(args.outPath);

  await run(FFMPEG, a, args.timeoutMs ?? 2_700_000);
  return args.outPath;
}

/**
 * Add a looped instrumental bed to a finished silent master without
 * re-encoding its video stream. Self-contained game and data-rendered formats
 * use this when their renderer owns pixels but a separate original-music block
 * owns audio. The explicit duration prevents a long music source from changing
 * the visual format's authored cadence.
 */
export async function muxLoopedMusicBed(args: {
  videoPath: string;
  musicPath: string;
  outPath: string;
  durationSec: number;
  /** Linear bed gain; defaults to a present-but-background 0.42. */
  volume?: number;
  /** Small musical tail fade, bounded inside the authored video length. */
  fadeOutSec?: number;
}): Promise<string> {
  const durationSec = Math.max(1, Number(args.durationSec) || 1);
  const requestedVolume = Number(args.volume);
  const volume = Number.isFinite(requestedVolume) ? Math.min(1, Math.max(0, requestedVolume)) : 0.42;
  const fadeOutSec = Math.min(
    Math.max(0, Number(args.fadeOutSec) || 0),
    Math.max(0, durationSec - 0.05),
  );
  const fade = fadeOutSec > 0
    ? `,afade=t=out:st=${Math.max(0, durationSec - fadeOutSec).toFixed(2)}:d=${fadeOutSec.toFixed(2)}`
    : "";
  await run(FFMPEG, [
    "-y",
    "-i",
    args.videoPath,
    "-stream_loop",
    "-1",
    "-i",
    args.musicPath,
    "-filter_complex",
    `[1:a]volume=${volume.toFixed(3)}${fade}[bed]`,
    "-map",
    "0:v:0",
    "-map",
    "[bed]",
    "-t",
    durationSec.toFixed(3),
    "-c:v",
    "copy",
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

/**
 * Final composition with a Remotion title-card intro + a music bed.
 *
 * Timeline (all on one uniform W×H canvas):
 *   [0 ── introSec ──][──── bodySec (narration) ────][── tailSec ──]
 *    title card +        footage/loop + narration,       fade to black
 *    music (full)        music ducked low               music fades out
 *
 * Guarantees the user's spec:
 *  - a real title-card intro where MUSIC plays but NO narration yet (narration is
 *    delayed by introSec so the intro is voice-free);
 *  - a low music BED throughout — full during the intro, ducked under narration;
 *  - narration time (bodySec) < video time (introSec+bodySec+tailSec): the video
 *    runs past the voice and ENDS on a clean fade-to-black with no text.
 *
 * `narrationPath` omitted → no ducking, music stays full the whole way (lofi).
 * `introCardPath` omitted → no intro segment (degrade path if the card render
 * failed); narration then starts at t=0.
 *
 * The body video is stream-looped to cover bodySec+tailSec, so short footage
 * (or a lofi loop unit) tiles to length without extra cost.
 */
/**
 * Build an ffmpeg video-filter fragment applying film grain (noise) and a
 * vignette darkening, driven by 0-1 strength values on the SAME scale as
 * DocuTheme.grain/vignette (src/remotion/docuStyles.ts) and LtxStyleDef.
 * grain/vignette (src/engine/ltxStylePresets.ts). Pure string construction —
 * no I/O, no ffmpeg invocation — so it is independently unit-testable.
 * Returns "" when both values are ~0 so callers can omit the filter
 * entirely instead of chaining a zero-strength no-op.
 */
export function filmGrainVignetteFilter(grain: number, vignette: number): string {
  const g = Math.max(0, Math.min(1, Number.isFinite(grain) ? grain : 0));
  const v = Math.max(0, Math.min(1, Number.isFinite(vignette) ? vignette : 0));
  const parts: string[] = [];
  if (g > 0.001) {
    // ffmpeg `noise` filter: alls is an integer per-plane strength (0-100);
    // allf mixes temporal ("t") + uniform ("u") noise for a photographic-
    // grain feel rather than flat static. Real film grain reads convincingly
    // at low strength, so 0-1 maps onto a subtle 0-40 range, not 0-100.
    const alls = Math.round(g * 40);
    parts.push(`noise=alls=${alls}:allf=t+u`);
  }
  if (v > 0.001) {
    // ffmpeg `vignette` filter: `angle` is the radius (radians) of the
    // UNvignetted center — smaller angle = a tighter, stronger vignette;
    // larger angle = a weaker, barely-visible one. Map 0-1 vignette
    // strength onto a PI/8 (strong) .. PI/2 (very weak) range.
    const angle = Math.PI / 2 - v * (Math.PI / 2 - Math.PI / 8);
    parts.push(`vignette=angle=${angle.toFixed(4)}:mode=forward`);
  }
  return parts.join(",");
}

/**
 * Standalone grain+vignette finishing pass over an already-assembled video:
 * re-encodes the video stream only (audio is stream-copied, untouched), so
 * it can be applied to any finished export without re-running the full
 * compose graph. No-ops to a straight remux when both grain and vignette
 * are ~0 (filmGrainVignetteFilter returns "").
 */
export async function applyFilmGrainVignette(
  inputPath: string,
  outputPath: string,
  opts: { grain: number; vignette: number; timeoutMs?: number },
): Promise<string> {
  const vf = filmGrainVignetteFilter(opts.grain, opts.vignette);
  if (!vf) {
    await run(FFMPEG, ["-y", "-i", inputPath, "-c", "copy", outputPath], opts.timeoutMs ?? 600_000);
    return outputPath;
  }
  await run(
    FFMPEG,
    [
      "-y",
      "-i",
      inputPath,
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    opts.timeoutMs ?? 900_000,
  );
  return outputPath;
}

/**
 * Character-introduction NAME CARD typography — the on-screen exception
 * carved out narrowly for `narrativeRole: "introduction"` beats in the
 * source-bound Casefile cinematic sequence (see `nameCardText` on
 * `CinematicCoverageShotSchema` and the `name_card_invalid` checks in
 * `evaluateCinematicCaseSequence`, src/engine/cinematicCaseSequence.ts).
 * Every other narrative role stays governed by that module's "never render
 * this as on-screen text" prompt discipline; this is the one narrow,
 * explicit carve-out, and it renders ONLY the reviewed name-card string —
 * never a causal question or any other prose.
 *
 * FINDING (Phase 14): the source-bound Casefile cinematic route has no
 * Remotion compositing pass at all today. Its LTX clips flow
 * cinematicCaseSequence.ts → genFootageBlocks.ts (render) →
 * cinematicSequenceRenderBinding.ts → cinematicHandoff.ts's
 * CinematicAssemblyHandoff ("the exact clip-order assembler"), and nothing
 * in src/lib/assembly/*.ts actually implements that assembler yet — it is
 * re-exported from src/lib/assembly/index.ts but has no ffmpeg concat/mux
 * call site to wire an overlay into. Remotion's CinematicFrame/
 * CinematicSpeech (src/remotion/speech/) and DocuMotion.tsx are a DIFFERENT
 * pipeline (raw-footage motivational-speech and parallax-cutout
 * documentary renders), not the Casefile mannequin-reconstruction route.
 * Rather than invent a parallel compositing mechanism (Remotion or
 * otherwise) for an assembler that does not exist yet, this adds ONE
 * reusable primitive to this module's existing post-render finishing-pass
 * family — same doctrine as `filmGrainVignetteFilter`/
 * `applyFilmGrainVignette` above: applied once to an already-rendered clip
 * (video re-encoded, audio stream-copied), never baked into the LTX
 * generation prompt itself — ready for the exact clip-order assembler to
 * call on a beat's name-card shot once that assembler is built.
 *
 * Theme-driven (accent color from the channel's DocuTheme — see
 * src/remotion/docuStyles.ts DETECTIVE/ROBBERY `theme.accent`) so a name
 * card reads consistently with whatever documentary look the cinematic
 * beat sits beside, instead of inventing new typography. NOTE: ffmpeg's
 * drawtext filter needs a local TTF file, not the Google Fonts CSS stack
 * (`fontCss` / `theme.fontDisplay: "Oswald, sans-serif"`) that powers the
 * Remotion/browser rendering path — a caller with a resolved Oswald .ttf on
 * disk may pass `fontFile`; otherwise this falls back to the same
 * CLOUD_FONTS condensed-sans face already used for on-brand title/
 * lower-third text elsewhere in this module.
 *
 * A true "typography behind/beside the mannequin figure" composite would
 * need a subject-aware alpha mask, which an already-rendered LTX clip does
 * not provide; this renders a themed lower-third/side name card instead —
 * the same realistic approximation SpeakerNameTag.tsx uses for the
 * Remotion speech pipeline, adapted to a post-render ffmpeg pass for LTX
 * clips that never go through Remotion.
 */
export function nameCardOverlayFilter(opts: {
  text: string;
  durationSec: number;
  accentColor?: string;
  fontFile?: string;
  fadeInSec?: number;
  fadeOutSec?: number;
  position?: "left" | "right" | "center";
}): string {
  const text = opts.text.trim();
  // Degrade-safe like filmGrainVignetteFilter above: a non-finite or
  // non-positive duration must never reach the filter graph as NaN — treat
  // it the same as "no text" (empty filter, straight remux).
  if (!text || !Number.isFinite(opts.durationSec) || opts.durationSec <= 0) return "";
  const duration = Math.max(0.1, opts.durationSec);
  const safeFadeInSec = Number.isFinite(opts.fadeInSec) ? opts.fadeInSec : undefined;
  const safeFadeOutSec = Number.isFinite(opts.fadeOutSec) ? opts.fadeOutSec : undefined;
  const fadeIn = Math.max(0.01, Math.min(duration / 2, safeFadeInSec ?? 0.5));
  const fadeOut = Math.max(0.01, Math.min(duration / 2, safeFadeOutSec ?? 0.6));
  const holdStart = fadeIn;
  const holdEnd = Math.max(holdStart, duration - fadeOut);
  const font = opts.fontFile ?? CLOUD_FONTS.impact;
  const color = opts.accentColor ? thumbnailColor(opts.accentColor, "0xffd400") : "white";
  // Unescaped commas match this file's established alpha-expression
  // convention (see composeMusicLoopDeblur's aName/aTitle above): the value
  // sits inside a single-quoted drawtext option, so ffmpeg's filtergraph
  // parser treats it literally without needing `\,` escapes.
  const alpha =
    `if(lt(t,${holdStart.toFixed(2)}),t/${fadeIn.toFixed(2)},` +
    `if(lt(t,${holdEnd.toFixed(2)}),1,` +
    `max(0,1-(t-${holdEnd.toFixed(2)})/${fadeOut.toFixed(2)})))`;
  const x = opts.position === "left" ? "w*0.08" : opts.position === "right" ? "w-text_w-w*0.08" : "(w-text_w)/2";
  return (
    `drawtext=fontfile=${font}:text='${escapeDrawtext(text)}':expansion=none:` +
    `fontcolor=${color}:fontsize=h*0.055:` +
    `box=1:boxcolor=black@0.38:boxborderw=18:` +
    `borderw=2:bordercolor=black@0.7:` +
    `alpha='${alpha}':x=${x}:y=h*0.74`
  );
}

/**
 * Standalone name-card finishing pass over one already-rendered cinematic
 * clip: re-encodes the video stream only (audio is stream-copied,
 * untouched), matching `applyFilmGrainVignette`'s no-op-safe shape. Empty
 * `text` is a straight remux (no drawtext filter emitted).
 */
function escapeSourceProofCitationDrawtext(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Keeps every character of a sealed Casefile citation visible without asking
 * a generative renderer to create typography. Newlines are presentation-only;
 * the signed citation label itself is never shortened or rewritten.
 */
function wrapSourceProofCitationLabel(label: string, maxLineChars = 48): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of label.trim().split(/\s+/)) {
    let remaining = word;
    while (remaining.length > maxLineChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(remaining.slice(0, maxLineChars));
      remaining = remaining.slice(maxLineChars);
    }
    const candidate = line ? `${line} ${remaining}` : remaining;
    if (candidate.length > maxLineChars && line) {
      lines.push(line);
      line = remaining;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Deterministic, full-duration citation plate for an already verified
 * source-proof clip. This deliberately has no empty/no-op branch: a missing
 * citation must stop assembly rather than silently emit uncited evidence.
 */
export function sourceProofCitationOverlayFilter(opts: {
  label: string;
  durationSec: number;
  accentColor?: string;
  fontFile?: string;
}): string {
  const label = opts.label.trim();
  if (!label || !Number.isFinite(opts.durationSec) || opts.durationSec <= 0) {
    throw new Error("source-proof citation overlay requires a non-empty sealed label and positive duration");
  }
  const labelLines = wrapSourceProofCitationLabel(label);
  if (!labelLines.length || labelLines.some((line) => !line)) {
    throw new Error("source-proof citation overlay could not lay out the sealed label");
  }
  const lineCount = labelLines.length + 1;
  const fontScale = lineCount > 6 ? "0.022" : lineCount > 4 ? "0.026" : "0.031";
  const color = opts.accentColor ? thumbnailColor(opts.accentColor, "0xffd400") : "0xffd400";
  const text = ["SOURCE PROOF", ...labelLines].join("\n");
  const font = opts.fontFile ?? CLOUD_FONTS.sans;
  return (
    `drawtext=fontfile=${font}:text='${escapeSourceProofCitationDrawtext(text)}':expansion=none:` +
    `fontcolor=${color}:fontsize=h*${fontScale}:line_spacing=8:` +
    "box=1:boxcolor=black@0.68:boxborderw=14:borderw=1:bordercolor=white@0.45:" +
    "x=w*0.05:y=h*0.07"
  );
}

export async function applySourceProofCitationOverlay(
  inputPath: string,
  outputPath: string,
  opts: {
    label: string;
    durationSec: number;
    accentColor?: string;
    fontFile?: string;
    timeoutMs?: number;
  },
): Promise<string> {
  const vf = sourceProofCitationOverlayFilter(opts);
  await run(
    FFMPEG,
    [
      "-y",
      "-i",
      inputPath,
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    opts.timeoutMs ?? 900_000,
  );
  return outputPath;
}

export async function applyNameCardOverlay(
  inputPath: string,
  outputPath: string,
  opts: {
    text: string;
    durationSec: number;
    accentColor?: string;
    fontFile?: string;
    fadeInSec?: number;
    fadeOutSec?: number;
    position?: "left" | "right" | "center";
    timeoutMs?: number;
  },
): Promise<string> {
  const vf = nameCardOverlayFilter(opts);
  if (!vf) {
    await run(FFMPEG, ["-y", "-i", inputPath, "-c", "copy", outputPath], opts.timeoutMs ?? 600_000);
    return outputPath;
  }
  await run(
    FFMPEG,
    [
      "-y",
      "-i",
      inputPath,
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    opts.timeoutMs ?? 900_000,
  );
  return outputPath;
}

/**
 * Composite a rendered HyperFrames evidence-overlay clip (src/lib/
 * hyperframesOverlay.ts `buildOverlayComposition`/`renderOverlay`) onto an
 * already-rendered base clip — the pure filter-graph half of
 * `applyHyperframesOverlayClip` below, split out the same way
 * `nameCardOverlayFilter`/`applyNameCardOverlay` are, so it is unit-testable
 * without shelling out to ffmpeg.
 *
 * `renderOverlay` renders its composition to WEBM with `--format webm`
 * (Phase 18): the overlay is a brief graphic ACCENT meant to sit over
 * existing footage, so it needs a real alpha channel, not a `background:
 * transparent` CSS body silently flattened to opaque by a non-alpha codec.
 * This filter decodes that WebM with `-c:v libvpx` (input codec set by the
 * caller, see `applyHyperframesOverlayClip`) and `format=yuva420p` so the
 * alpha channel is honored — the SAME convention already established here
 * for Remotion-rendered alpha cards (`applyQuoteOverlays`/
 * `applyOverlaysAndCaptions` above; `codec: "vp8", pixelFormat: "yuva420p"`
 * in src/lib/remotionRender.ts) — then overlays it at the top-left corner
 * for exactly `durationSec` from the start of the base clip (evidence
 * overlays are always a brief opening accent on the shot they are placed
 * on, never a full-clip treatment).
 */
export function hyperframesOverlayCompositeFilter(opts: { durationSec: number }): string {
  const duration = Number.isFinite(opts.durationSec) ? opts.durationSec : 0;
  // Degrade-safe like nameCardOverlayFilter/filmGrainVignetteFilter above: a
  // non-finite or non-positive duration must never reach the filter graph —
  // treat it the same as "no overlay", empty filter, straight remux.
  if (duration <= 0) return "";
  const dur = Math.max(0.1, duration).toFixed(3);
  return (
    `[1:v]format=yuva420p[ov];` +
    `[0:v][ov]overlay=0:0:eof_action=pass:enable='between(t,0,${dur})'[vout]`
  );
}

/**
 * Standalone HyperFrames evidence-overlay finishing pass over one
 * already-rendered clip: re-encodes the video stream only (audio is
 * stream-copied, untouched), matching `applyNameCardOverlay`'s no-op-safe
 * shape. `overlayWebmPath` must be the WEBM `renderOverlay` produced (its
 * alpha channel is required for a correct composite — see
 * `hyperframesOverlayCompositeFilter` above). A non-finite/non-positive
 * `durationSec` is a straight remux (no overlay filter emitted).
 */
export async function applyHyperframesOverlayClip(
  basePath: string,
  overlayWebmPath: string,
  outputPath: string,
  opts: { durationSec: number; timeoutMs?: number },
): Promise<string> {
  const filter = hyperframesOverlayCompositeFilter(opts);
  if (!filter) {
    await run(FFMPEG, ["-y", "-i", basePath, "-c", "copy", outputPath], opts.timeoutMs ?? 600_000);
    return outputPath;
  }
  await run(
    FFMPEG,
    [
      "-y",
      "-i",
      basePath,
      // libvpx decoder for the overlay input so its WebM ALPHA channel is
      // honored — the native vp8 decoder ignores it, making the card
      // opaque black (same convention as applyOverlaysAndCaptions above).
      "-c:v",
      "libvpx",
      "-i",
      overlayWebmPath,
      "-filter_complex",
      filter,
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    opts.timeoutMs ?? 900_000,
  );
  return outputPath;
}

export async function composeWithIntro(args: {
  introCardPath?: string;
  loopBodyPath: string;
  musicPath: string;
  narrationPath?: string;
  outPath: string;
  introSec: number;
  /** Narration length (narrated) or target loop length (lofi). */
  bodySec: number;
  /** Silent video AFTER the body so the voice ends before the picture does. */
  tailSec?: number;
  /** Fade VIDEO to black over the last N seconds. */
  fadeOutSec?: number;
  /** Fade AUDIO/music out over the last N seconds (defaults to fadeOutSec). Lets
   * the outro card stay visible while the music slowly fades. */
  audioFadeOutSec?: number;
  /** Crossfade (xfade) seconds from the title card into the body. Default 0.8. */
  crossfadeSec?: number;
  /**
   * Title→body transition. Defaults to the historical crossfade; hardcut and
   * dip_to_black are closed, assembler-owned effects—not arbitrary filters.
   */
  transition?: "hardcut" | "crossfade" | "dip_to_black";
  width?: number;
  height?: number;
  /** Music volume during the intro (no voice) and under narration. */
  introMusicVol?: number;
  bodyMusicVol?: number;
  /** Seconds over which the music GRADUALLY ducks from intro→body level once the
   * narration starts (instead of an instant drop). Default 3s. */
  musicDuckRampSec?: number;
  /** Mix the body track's admitted in-world audio beneath narration. */
  bodyAudioMode?: "off" | "available" | "required";
  /** Linear gain before sidechain ducking; deliberately below narration. */
  diegeticBodyAudioVol?: number;
  /**
   * Outro card FOLDED into this same encode: the tail dissolves into this card
   * via xfade so the video ends on a deliberate beat. Previously the outro was
   * patched on afterwards (patchSegment) — an ENTIRE second full-video x264
   * pass for a 3-second change. Requires tailSec ≥ ~2 (the card covers the
   * tail window exactly, matching the old patch behavior).
   */
  outroCardPath?: string;
  /** Outro dissolve duration (seconds). Default 1.2 (the old patch fade-in). */
  outroFadeInSec?: number;
  /**
   * Per-style film grain + vignette (0-1 scale, see filmGrainVignetteFilter
   * above / LtxStyleDef.grain+vignette in ltxStylePresets.ts) applied to the
   * WHOLE composed video (intro card through outro) in this same encode —
   * no second full-video pass. Omitted (undefined) reproduces the exact
   * prior output for every existing caller.
   */
  filmGrain?: { grain: number; vignette: number };
  preset?: string;
  timeoutMs?: number;
}): Promise<string> {
  const W = args.width ?? 1920;
  const H = args.height ?? 1080;
  const fps = 30;
  const intro = Math.max(0, args.introCardPath ? args.introSec : 0);
  const tail = Math.max(0, args.tailSec ?? 0);
  const fade = Math.max(0, args.fadeOutSec ?? 0);
  const afade = Math.max(0, args.audioFadeOutSec ?? fade); // music fade (can outlast the video fade)
  const bodyTail = args.bodySec + tail;
  const total = intro + args.bodySec + tail;
  const fadeSt = Math.max(0, total - fade);
  const afadeSt = Math.max(0, total - afade);
  const introMs = Math.round(intro * 1000);
  const introVol = args.introMusicVol ?? 0.6;
  const bodyVol = args.narrationPath ? (args.bodyMusicVol ?? 0.12) : introVol;
  const duckRamp = Math.max(0.05, args.musicDuckRampSec ?? 3);
  const titleTransition = args.transition === "hardcut" || args.transition === "dip_to_black" || args.transition === "crossfade"
    ? args.transition
    : "crossfade";
  const bodyAudioMode = args.bodyAudioMode ?? "off";
  const includeBodyAudio = bodyAudioMode !== "off";
  const diegeticVol = Math.min(0.35, Math.max(0.03, args.diegeticBodyAudioVol ?? 0.18));

  const scalePad =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps}`;

  // ----- inputs (order is referenced by index in the filter graph) -----
  const inputs: string[] = [];
  let idx = 0;
  let cardIdx = -1;
  if (args.introCardPath) {
    inputs.push("-i", args.introCardPath);
    cardIdx = idx++;
  }
  inputs.push("-stream_loop", "-1", "-i", args.loopBodyPath);
  const bodyIdx = idx++;
  inputs.push("-stream_loop", "-1", "-i", args.musicPath);
  const musicIdx = idx++;
  let narrIdx = -1;
  if (args.narrationPath) {
    inputs.push("-i", args.narrationPath);
    narrIdx = idx++;
  }
  // Outro card only participates when the tail window can actually hold it.
  const outroLen = args.outroCardPath && tail >= 2 ? tail : 0;
  let outroIdx = -1;
  if (outroLen > 0) {
    inputs.push("-i", args.outroCardPath as string);
    outroIdx = idx++;
  }

  // ----- video -----
  // With a title card, CROSSFADE it into the body (xfade) so the intro dissolves
  // into the first footage. The body is extended by the crossfade so the output
  // length stays intro+bodyTail (aligned with the audio timeline).
  const vparts: string[] = [];
  let vcat: string;
  if (cardIdx >= 0) {
    const requestedCrossfadeSec = titleTransition === "hardcut" ? 0 : (args.crossfadeSec ?? 0.8);
    const xf = Math.max(0, Math.min(intro, bodyTail, requestedCrossfadeSec));
    vparts.push(
      `[${cardIdx}:v]${scalePad},trim=0:${intro.toFixed(3)},setpts=PTS-STARTPTS[card]`,
    );
    if (xf > 0) {
      vparts.push(
        `[${bodyIdx}:v]${scalePad},trim=0:${(bodyTail + xf).toFixed(3)},setpts=PTS-STARTPTS[body]`,
      );
      const xfade = titleTransition === "dip_to_black" ? "fadeblack" : "fade";
      vparts.push(
        `[card][body]xfade=transition=${xfade}:duration=${xf.toFixed(3)}:offset=${(intro - xf).toFixed(3)}[vcat]`,
      );
    } else {
      vparts.push(
        `[${bodyIdx}:v]${scalePad},trim=0:${bodyTail.toFixed(3)},setpts=PTS-STARTPTS[body]`,
      );
      vparts.push(`[card][body]concat=n=2:v=1:a=0[vcat]`);
    }
    vcat = "[vcat]";
  } else {
    vparts.push(
      `[${bodyIdx}:v]${scalePad},trim=0:${bodyTail.toFixed(3)},setpts=PTS-STARTPTS[body]`,
    );
    vcat = "[body]";
  }
  // OUTRO FOLD: dissolve the footage into the outro card across the tail — in
  // THIS graph, so no post-hoc full re-encode. xfade output length stays
  // `total` (offset + card length == total).
  if (outroIdx >= 0) {
    const oFade = Math.max(0.4, Math.min(outroLen - 0.2, args.outroFadeInSec ?? 1.2));
    const oOffset = Math.max(0, total - outroLen);
    vparts.push(
      `[${outroIdx}:v]${scalePad},trim=0:${outroLen.toFixed(3)},setpts=PTS-STARTPTS[ocard]`,
    );
    vparts.push(`${vcat}null[vpre]`);
    vparts.push(`[vpre][ocard]xfade=transition=fade:duration=${oFade.toFixed(3)}:offset=${oOffset.toFixed(3)}[vwo]`);
    vcat = "[vwo]";
  }
  // Grain/vignette (when supplied) chains onto the SAME video pad before the
  // fade-out, one filter_complex, one encode — never a second full-video pass.
  const grainVignette = args.filmGrain
    ? filmGrainVignetteFilter(args.filmGrain.grain, args.filmGrain.vignette)
    : "";
  const preOut = [grainVignette, fade > 0 ? `fade=t=out:st=${fadeSt.toFixed(2)}:d=${fade.toFixed(2)}` : ""]
    .filter(Boolean)
    .join(",");
  const vout = preOut ? `${vcat}${preOut}[vout]` : `${vcat}null[vout]`;

  // ----- audio -----
  const aparts: string[] = [];
  // Music bed: full during the intro, then GRADUALLY ducks to the under-voice
  // level over `duckRamp` seconds once narration starts (no instant drop), then
  // holds. eval=frame so the volume tracks time. Looped, trimmed to total.
  const dStart = intro.toFixed(3);
  const dEnd = (intro + duckRamp).toFixed(3);
  const volExpr =
    `if(lt(t,${dStart}),${introVol},` +
    `if(lt(t,${dEnd}),${introVol}+(${bodyVol}-${introVol})*(t-${dStart})/${duckRamp.toFixed(3)},${bodyVol}))`;
  aparts.push(
    `[${musicIdx}:a]aresample=44100,atrim=0:${total.toFixed(3)},volume='${volExpr}':eval=frame[mbed]`,
  );
  if (includeBodyAudio) {
    // LTX's audio VAE creates in-world sound for the take. It begins with the
    // body (never under the title card), then gets aggressively ducked by the
    // spoken track below. This is a distinct narration-safe layer, not score.
    aparts.push(
      `[${bodyIdx}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${introMs}:all=1,` +
        `atrim=0:${total.toFixed(3)},volume=${diegeticVol.toFixed(3)}[diegeticbase]`,
    );
  }
  let amixOut: string;
  if (narrIdx >= 0) {
    aparts.push(
      `[${narrIdx}:a]aresample=44100,adelay=${introMs}:all=1,` +
        // Keep the sidechain alive through the body. Without this padded silent
        // tail, FFmpeg ends sidechaincompress when narration ends and erases
        // every later LTX sound instead of letting it recover naturally.
        `atrim=0:${total.toFixed(3)},apad=whole_dur=${total.toFixed(3)}[narr]`,
    );
    if (includeBodyAudio) {
      aparts.push(`[narr]asplit=2[narrmix][narrkey]`);
      aparts.push(
        `[diegeticbase][narrkey]sidechaincompress=threshold=0.015:ratio=20:attack=20:release=400:detection=rms[diegeticduck]`,
      );
      aparts.push(`[narrmix][mbed][diegeticduck]amix=inputs=3:duration=longest:normalize=0[amixraw]`);
    } else {
      aparts.push(`[narr][mbed]amix=inputs=2:duration=longest:normalize=0[amixraw]`);
    }
    amixOut = "[amixraw]";
  } else if (includeBodyAudio) {
    aparts.push(`[mbed][diegeticbase]amix=inputs=2:duration=longest:normalize=0[amixraw]`);
    amixOut = "[amixraw]";
  } else {
    amixOut = "[mbed]";
  }
  const aout =
    afade > 0
      ? `${amixOut}afade=t=out:st=${afadeSt.toFixed(2)}:d=${afade.toFixed(2)},atrim=0:${total.toFixed(3)}[aout]`
      : `${amixOut}atrim=0:${total.toFixed(3)}[aout]`;

  const filter = [...vparts, vout, ...aparts, aout].join(";");

  await run(
    FFMPEG,
    [
      "-y",
      ...inputs,
      "-filter_complex",
      filter,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-t",
      total.toFixed(3),
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
      "384k",
      "-movflags",
      "+faststart",
      args.outPath,
    ],
    args.timeoutMs ?? 2_700_000,
  );
  return args.outPath;
}

/**
 * Ken Burns clip from a still image (slow zoom-in), normalized to the canvas.
 * Brings entity/concept images to life (e.g. a Marcus Aurelius portrait).
 */
export async function kenBurns(
  imagePath: string,
  outPath: string,
  durationSec = 5,
  width = 1920,
  height = 1080,
): Promise<string> {
  const fps = 30;
  const frames = Math.max(1, Math.round(durationSec * fps));
  const vf =
    `scale=${width * 2}:-2,` +
    `zoompan=z='min(zoom+0.0008,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
    `d=${frames}:s=${width}x${height}:fps=${fps},setsar=1`;
  await run(FFMPEG, [
    "-y",
    "-loop",
    "1",
    "-i",
    imagePath,
    "-vf",
    vf,
    "-t",
    String(durationSec),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
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
 * Normalize any image to a 1280x720 JPEG (YouTube thumbnail spec). Scales to
 * cover then center-crops. Used for the Ideogram thumbnail (text already baked).
 */
export async function imageToJpeg(
  inPath: string,
  outJpg: string,
  width = 1280,
  height = 720,
): Promise<string> {
  await run(FFMPEG, [
    "-y",
    "-i",
    inPath,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outJpg,
  ]);
  return outJpg;
}

/**
 * Crop the physical centered region of an already-normalized image. Unlike
 * imageToJpeg(), this never rescales to make a requested aspect ratio fit.
 * Use it for device-safe-region review where changing the source geometry
 * would silently grade the wrong pixels.
 */
export async function cropCenterImageToJpeg(
  inPath: string,
  outJpg: string,
  width: number,
  height: number,
): Promise<string> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new FfmpegError("cropCenterImageToJpeg requires positive integer dimensions");
  }
  await run(FFMPEG, [
    "-y",
    "-i",
    inPath,
    "-vf",
    `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2`,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outJpg,
  ]);
  return outJpg;
}

/**
 * Concatenate per-sentence narration clips with a silence GAP between each — the
 * pauses that make TTS sound organic. Every clip but the last is end-padded with
 * `gapSec` of silence, then all are concatenated. Returns the muxed mp3.
 */
export async function concatAudioWithGaps(
  paths: string[],
  gaps: number | number[],
  outPath: string,
): Promise<string> {
  if (paths.length === 0) throw new FfmpegError("concatAudioWithGaps: no inputs");
  const gapArr = typeof gaps === "number" ? paths.map(() => gaps) : gaps;
  if (paths.length === 1 && (gapArr[0] ?? 0) <= 0) {
    await copyFile(paths[0], outPath);
    return outPath;
  }
  const inputs: string[] = [];
  for (const p of paths) inputs.push("-i", p);
  const parts = paths
    .map((_, i) =>
      i < paths.length - 1
        ? `[${i}:a]apad=pad_dur=${Math.max(0, gapArr[i] ?? 0).toFixed(3)}[a${i}]`
        : `[${i}:a]anull[a${i}]`,
    )
    .join(";");
  const chain = paths.map((_, i) => `[a${i}]`).join("");
  const filter = `${parts};${chain}concat=n=${paths.length}:v=0:a=1[out]`;
  await run(FFMPEG, [
    "-y",
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-ar",
    "44100",
    outPath,
  ]);
  return outPath;
}

/**
 * Crossfade-concat N audio tracks into one continuous mix (3s triangular
 * crossfades — the proven legacy-autostudio lofi-mix recipe). Single track
 * passes through unchanged. Output is an intermediate-quality mp3; run
 * masterAudio() on the result before muxing into the final video.
 */
export async function crossfadeConcatAudio(
  paths: string[],
  outPath: string,
  fadeSec = 3,
): Promise<string> {
  if (paths.length === 0) throw new FfmpegError("crossfadeConcatAudio: no inputs");
  if (paths.length === 1) {
    await copyFile(paths[0], outPath);
    return outPath;
  }
  const inputs: string[] = [];
  for (const p of paths) inputs.push("-i", p);
  // Chain acrossfade pairwise: [0][1]->x0, [x0][2]->x1, …
  const parts: string[] = [];
  let prev = "[0:a]";
  for (let i = 1; i < paths.length; i++) {
    const out = i === paths.length - 1 ? "[out]" : `[x${i}]`;
    parts.push(`${prev}[${i}:a]acrossfade=d=${fadeSec}:c1=tri:c2=tri${out}`);
    prev = `[x${i}]`;
  }
  await run(FFMPEG, [
    "-y",
    ...inputs,
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[out]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "320k",
    "-ar",
    "44100",
    outPath,
  ]);
  return outPath;
}

/**
 * Composite a transparent PNG layer (Remotion ThumbText) over an image base —
 * the thumbnail text compositor. Base is cover-fitted to the canvas.
 */
export async function overlayPngOnImage(
  basePath: string,
  pngPath: string,
  outJpg: string,
  w = 1280,
  h = 720,
): Promise<string> {
  await run(FFMPEG, [
    "-y",
    "-i", basePath,
    "-i", pngPath,
    "-filter_complex",
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[b];[b][1:v]overlay=0:0`,
    "-frames:v", "1",
    "-q:v", "2",
    "-update", "1",
    outJpg,
  ]);
  return outJpg;
}

/**
 * Master a music track for YouTube: gentle low-pass to tame AI-generation hiss,
 * a touch of low-end warmth, then loudness-normalize to the channel's LUFS
 * target (YouTube reference = -14; it turns louder uploads DOWN, so mastering
 * to target preserves perceived quality). 320k mp3 @ 44.1k out.
 */
export async function masterAudio(
  inPath: string,
  outPath: string,
  opts?: { lufs?: number; lowpassHz?: number },
): Promise<string> {
  const lufs = Math.max(-24, Math.min(-9, opts?.lufs ?? -14));
  const lowpass = opts?.lowpassHz ?? 16000;
  await run(FFMPEG, [
    "-y",
    "-i",
    inPath,
    "-af",
    `lowpass=f=${lowpass},equalizer=f=80:width_type=o:width=2:g=1.2,loudnorm=I=${lufs}:LRA=11:TP=-1.5`,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "320k",
    "-ar",
    "44100",
    outPath,
  ]);
  return outPath;
}

/**
 * Master a generated music program with one transparent, constant gain only.
 * Unlike `masterAudio`, this path never compresses, limits, equalizes, or asks
 * loudnorm to reshape dynamics. It first measures the complete source, proves
 * the requested gain can respect the true-peak ceiling, applies that fixed
 * gain, then measures the encoded result again before release.
 */
export async function masterAudioTransparentGain(
  inPath: string,
  outPath: string,
  opts: { lufs: number; truePeakMaxDbtp?: number },
): Promise<string> {
  const targetLufs = Math.max(-24, Math.min(-9, opts.lufs));
  const truePeakMaxDbtp = Math.max(-6, Math.min(-0.1, opts.truePeakMaxDbtp ?? -1));
  const { stderr } = await run(FFMPEG, [
    "-nostats", "-i", inPath,
    "-map", "a:0",
    "-filter:a", "ebur128=peak=true",
    "-f", "null", "-",
  ], 600_000);
  const loudnessMatches = [...stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/gu)];
  const peakMatches = [...stderr.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/gu)];
  const inputLufs = Number(loudnessMatches.at(-1)?.[1]);
  const inputPeakDbfs = Number(peakMatches.at(-1)?.[1]);
  if (!Number.isFinite(inputLufs) || !Number.isFinite(inputPeakDbfs)) {
    throw new Error("transparent music master could not measure source loudness and true peak");
  }
  const gainDb = targetLufs - inputLufs;
  if (inputPeakDbfs + gainDb > truePeakMaxDbtp + 0.05) {
    throw new Error(
      `transparent music master cannot reach ${targetLufs} LUFS without exceeding ${truePeakMaxDbtp} dBTP; ` +
      `source is ${inputLufs.toFixed(2)} LUFS / ${inputPeakDbfs.toFixed(2)} dBFS and needs ${gainDb.toFixed(2)} dB`,
    );
  }
  await run(FFMPEG, [
    "-y", "-i", inPath,
    "-af", `volume=${gainDb.toFixed(3)}dB`,
    "-c:a", "libmp3lame", "-b:a", "320k", "-ar", "44100",
    outPath,
  ]);
  const verification = await measureAudio(outPath);
  if (verification.integratedLufs === null || Math.abs(verification.integratedLufs - targetLufs) > 0.65) {
    throw new Error(
      `transparent music master verification missed ${targetLufs} LUFS ` +
      `(measured ${verification.integratedLufs ?? "unavailable"})`,
    );
  }
  return outPath;
}

/**
 * Apply a stylized voice filter to a narration track (in-place safe — writes to
 * a new file). "radio" = vintage AM/shortwave: band-limited (≈350-3000 Hz),
 * lightly compressed + driven, a slow AM wobble, and low-level brown static bed
 * mixed under it so it reads as an old radio set, not a phone call.
 *
 * Unknown/empty fx returns the input path unchanged (no-op).
 */
export async function applyVoiceFx(
  inPath: string,
  fx: string | undefined,
  outPath: string,
): Promise<string> {
  if (!fx || fx === "none") return inPath;
  if (fx !== "radio") {
    // Unknown fx: don't silently distort the voice — pass through untouched.
    return inPath;
  }
  // Voice chain: band-limit → compress → soft saturate → slow tremolo (AM wobble).
  const voice =
    "[0:a]highpass=f=350,lowpass=f=3000," +
    "acompressor=threshold=-18dB:ratio=4:attack=5:release=120," +
    "alimiter=limit=0.95,tremolo=f=5:d=0.06,volume=1.1[v]";
  // Brown-noise static, band-limited and kept very low; amix duration=first
  // trims the (infinite) noise to the voice length.
  const noise = "[1:a]highpass=f=1000,lowpass=f=4500,volume=0.05[n]";
  // normalize=0 is CRITICAL: amix's default normalization scales each input by
  // 1/n, so voice+static were both halved — every radio-fx channel shipped its
  // narration ~6 dB under the intended voice/music ratio (music then ducked
  // relative to a full-scale voice that wasn't there).
  const filter = `${voice};${noise};[v][n]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,volume=1.0[out]`;
  await run(FFMPEG, [
    "-y",
    "-i", inPath,
    "-f", "lavfi", "-i", "anoisesrc=color=brown:amplitude=0.6",
    "-filter_complex", filter,
    "-map", "[out]",
    "-c:a", "libmp3lame",
    "-b:a", "128k",
    "-ar", "44100",
    outPath,
  ]);
  return outPath;
}

/**
 * DETERMINISTIC EARS — cheap audio meters for the QA gate (the ear vision QA
 * never had). All ffmpeg, no LLM, seconds to run:
 *  - integratedLufs: ebur128 integrated loudness of the FULL mix,
 *  - windowMeanDb:   volumedetect mean over an arbitrary window (used to prove
 *    the music bed is actually audible in a narration-free window, e.g. the
 *    intro), null when the window is too short to measure.
 * A null field means "could not measure" — callers must treat that as skip,
 * never as pass/fail.
 */
export async function measureAudio(
  videoPath: string,
  opts: { windowStartSec?: number; windowDurSec?: number } = {},
): Promise<{ integratedLufs: number | null; windowMeanDb: number | null }> {
  let integratedLufs: number | null = null;
  let windowMeanDb: number | null = null;
  try {
    const { stderr } = await run(FFMPEG, [
      "-nostats", "-i", videoPath, "-map", "a:0", "-filter:a", "ebur128", "-f", "null", "-",
    ], 600_000);
    // Summary block: "I:  -14.2 LUFS"
    const m = stderr.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g);
    if (m && m.length) {
      const last = m[m.length - 1].match(/(-?\d+(?:\.\d+)?)/);
      if (last) integratedLufs = Number(last[1]);
    }
  } catch { /* unmeasurable → null */ }
  const ws = opts.windowStartSec ?? 0;
  const wd = opts.windowDurSec ?? 0;
  if (wd >= 1.5) {
    try {
      const { stderr } = await run(FFMPEG, [
        "-nostats", "-ss", ws.toFixed(2), "-t", wd.toFixed(2), "-i", videoPath,
        "-map", "a:0", "-filter:a", "volumedetect", "-f", "null", "-",
      ], 300_000);
      const mv = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
      if (mv) windowMeanDb = Number(mv[1]);
    } catch { /* unmeasurable → null */ }
  }
  return { integratedLufs, windowMeanDb };
}

/**
 * Proves that an authored narration signal survives into the assembled master.
 * Unlike final-mix loudness, this is resistant to a music bed masking a missing
 * dialogue track: FFmpeg cross-correlates the narration waveform with the
 * final mix after the planned intro offset. It measures presence, not speech
 * intelligibility or aesthetic quality.
 */
export async function measureNarrationMixCorrelation(args: {
  narrationPath: string;
  masterPath: string;
  narrationStartSec?: number;
}): Promise<{ correlation: number | null }> {
  const offset = Number.isFinite(args.narrationStartSec) && (args.narrationStartSec ?? 0) > 0
    ? args.narrationStartSec!
    : 0;
  try {
    const { stderr } = await run(FFMPEG, [
      "-nostats",
      "-i", args.narrationPath,
      ...(offset > 0 ? ["-ss", offset.toFixed(3)] : []),
      "-i", args.masterPath,
      "-filter_complex",
      "[0:a]aresample=16000,aformat=channel_layouts=mono[narration];" +
        "[1:a]aresample=16000,aformat=channel_layouts=mono[master];" +
        "[narration][master]axcorrelate=size=2048:algo=fast,astats=metadata=1:reset=0[correlation]",
      "-map", "[correlation]",
      "-f", "null", "-",
    ], 600_000);
    const matches = [...stderr.matchAll(/DC offset:\s*(-?\d+(?:\.\d+)?)/g)];
    const value = matches.length ? Number(matches[matches.length - 1]![1]) : Number.NaN;
    // Polarity can flip during a legitimate encoder/mixer pass. Presence is
    // its magnitude; a missing narration signal remains near zero.
    return { correlation: Number.isFinite(value) ? Math.abs(value) : null };
  } catch {
    return { correlation: null };
  }
}

/**
 * Final loudness normalization — AUDIO-ONLY (video stream copied, no x264
 * pass): measure with loudnorm print_format=json, then apply LINEAR gain with
 * the measured values (one-pass dynamic loudnorm audibly pumps under music
 * swells). Shipped mixes previously had whatever loudness the TTS happened to
 * output — this pins every video to a consistent target.
 */
export async function normalizeAudioOnly(
  inPath: string,
  outPath: string,
  targetLufs = -14,
): Promise<string> {
  // Pass 1: measure.
  const { stderr } = await run(FFMPEG, [
    "-nostats", "-i", inPath, "-map", "a:0",
    "-filter:a", `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:print_format=json`,
    "-f", "null", "-",
  ], 600_000);
  const jm = stderr.match(/\{[\s\S]*\}/);
  if (!jm) throw new FfmpegError("normalizeAudioOnly: no loudnorm JSON in output");
  const j = JSON.parse(jm[0]) as Record<string, string>;
  const f = (k: string) => Number(j[k]);
  if (![f("input_i"), f("input_tp"), f("input_lra"), f("input_thresh")].every(Number.isFinite)) {
    throw new FfmpegError("normalizeAudioOnly: unparseable loudnorm measurement");
  }
  // Pass 2: apply linear with measured values; video stream copied.
  await run(FFMPEG, [
    "-y", "-i", inPath,
    "-map", "0:v", "-map", "0:a:0",
    "-c:v", "copy",
    "-filter:a",
    `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:linear=true:` +
      `measured_I=${j["input_i"]}:measured_TP=${j["input_tp"]}:` +
      `measured_LRA=${j["input_lra"]}:measured_thresh=${j["input_thresh"]}`,
    "-c:a", "aac", "-b:a", "384k",
    "-movflags", "+faststart",
    outPath,
  ], 900_000);
  return outPath;
}

export interface QuoteOverlaySpec {
  /** Transparent (VP8/alpha) overlay clip. */
  path: string;
  /**
   * Run-scoped R2 key backing `path`. REQUIRED by the render-split contract:
   * timeline_assemble runs on a SEPARATE worker (and heal re-runs on fresh
   * machines), so a local-only path is unreachable there — the child
   * re-downloads from this key. Producers that omit it get their overlay
   * dropped (typed warning) instead of crashing the compose.
   */
  key?: string;
  /** Absolute start time in the final video (seconds). */
  startSec: number;
  durSec: number;
  /** Source quote text for deterministic re-render or targeted self-heal. */
  text?: string;
  /** Highlight words (yellow) for re-render. */
  highlights?: string[];
  /** Overlay canvas size (for re-render). */
  width?: number;
  height?: number;
  /** Composite WITHOUT the blur-under window (small badges/lower thirds). */
  noBlur?: boolean;
}

/**
 * Composite Remotion quote cards with a GENUINE gradual blur: per window we
 * trim that slice, gaussian-blur it, and fade its ALPHA in then out — so the
 * background blur ramps up as the quote appears and ramps back down as it leaves
 * (not a hard on/off). The alpha card (quote + yellow highlights) is overlaid on
 * top. Only the quote windows are blurred (cheap). Single pass. Audio copied.
 */
export async function applyQuoteOverlays(
  videoPath: string,
  overlays: QuoteOverlaySpec[],
  outPath: string,
  opts: { blurSigma?: number; rampSec?: number; timeoutMs?: number } = {},
): Promise<string> {
  if (overlays.length === 0) {
    await copyFile(videoPath, outPath);
    return outPath;
  }
  const sigma = opts.blurSigma ?? 20;
  const rampMax = opts.rampSec ?? 2.0; // very slow, calm blur fade-in/out
  // SEQUENTIAL — one light ffmpeg pass per quote (split into base + a single
  // trimmed/blurred window + the card). Avoids the OOM of N simultaneous gblur
  // branches in one graph. Audio is stream-copied each pass.
  let cur = videoPath;
  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    const s = o.startSec.toFixed(3);
    const e = (o.startSec + o.durSec).toFixed(3);
    // GUARD: clamp the ramp so fade-in + a short hold + fade-out always FIT the
    // card. Otherwise on a short card the in/out fades overlap and the blur never
    // fully forms (looks abrupt / "skipped"). Leaves ≥0.5s of full blur.
    const ramp = Math.max(0.6, Math.min(rampMax, (o.durSec - 0.5) / 2));
    const outEdge = Math.max(0, o.durSec - ramp).toFixed(3);
    const stepOut = i === overlays.length - 1 ? outPath : `${outPath}.step${i}.mp4`;
    if (o.noBlur) {
      // Small badge: composite the alpha card only (no blur window).
      const f = [
        `[1:v]format=yuva420p,tpad=start_duration=${s}:color=0x00000000[c]`,
        `[0:v][c]overlay=0:0:eof_action=pass:enable='between(t,${s},${e})'[vout]`,
      ].join(";");
      await run(
        FFMPEG,
        ["-y", "-i", cur, "-c:v", "libvpx", "-i", o.path, "-filter_complex", f,
          "-map", "[vout]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast",
          "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", stepOut],
        opts.timeoutMs ?? 1_800_000,
      );
      // Drop the superseded intermediate (never the caller's input) — each step
      // is a FULL-LENGTH video; leaving N of them risks ENOSPC on long-form.
      if (cur !== videoPath) await unlink(cur).catch(() => {});
      cur = stepOut;
      continue;
    }
    // Time-align the blurred window + card with `tpad` (real transparent lead
    // frames) — NOT `setpts=PTS+s/TB`. A delayed second overlay input forces
    // `overlay` to BUFFER every base frame until the input arrives; for a quote
    // near the end (s≈120s) that buffers minutes of 1080p frames → OOM. tpad
    // keeps both streams in lockstep from t=0 (zero buffering). `eof_action=pass`
    // lets the base pass through after the short window ends.
    const filter = [
      `[0:v]split[base][b]`,
      `[b]trim=${s}:${e},setpts=PTS-STARTPTS,gblur=sigma=${sigma},format=yuva420p,` +
        `fade=t=in:st=0:d=${ramp}:alpha=1,fade=t=out:st=${outEdge}:d=${ramp}:alpha=1,` +
        `tpad=start_duration=${s}:color=0x00000000[bf]`,
      `[base][bf]overlay=0:0:eof_action=pass:enable='between(t,${s},${e})'[bg]`,
      `[1:v]format=yuva420p,tpad=start_duration=${s}:color=0x00000000[c]`,
      `[bg][c]overlay=0:0:eof_action=pass:enable='between(t,${s},${e})'[vout]`,
    ].join(";");
    await run(
      FFMPEG,
      [
        "-y",
        "-i",
        cur,
        // Decode the overlay with libvpx so the WebM ALPHA channel is honored —
        // the native vp8 decoder ignores it, making the card opaque black.
        "-c:v",
        "libvpx",
        "-i",
        o.path,
        "-filter_complex",
        filter,
        "-map",
        "[vout]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        stepOut,
      ],
      opts.timeoutMs ?? 1_800_000,
    );
    if (cur !== videoPath) await unlink(cur).catch(() => {});
    cur = stepOut;
  }
  return outPath;
}

/**
 * SINGLE-PASS finishing: burn captions (ass) + composite EVERY overlay card in
 * ONE filter graph / ONE x264 encode. The per-overlay sequential path above
 * re-encodes the FULL video once per card (2 quotes + 3 inserts = 5 full
 * passes on a 14-min video) — the dominating assembly cost. Each overlay chain
 * uses the proven trim+tpad lockstep pattern (zero frame buffering), so N
 * short windows in one graph stay memory-bounded. Caller falls back to
 * burnCaptions + applyQuoteOverlays on any failure.
 */
export async function applyOverlaysAndCaptions(
  videoPath: string,
  overlays: QuoteOverlaySpec[],
  assPath: string | null,
  outPath: string,
  opts: { blurSigma?: number; rampSec?: number; timeoutMs?: number } = {},
): Promise<string> {
  if (overlays.length === 0 && !assPath) {
    await copyFile(videoPath, outPath);
    return outPath;
  }
  const sigma = opts.blurSigma ?? 20;
  const rampMax = opts.rampSec ?? 2.0;

  const args: string[] = ["-y", "-i", videoPath];
  for (const o of overlays) {
    // libvpx decoder per input so the WebM ALPHA channel is honored.
    args.push("-c:v", "libvpx", "-i", o.path);
  }

  const chains: string[] = [];
  let cur = "0:v";
  if (assPath) {
    const p = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    chains.push(`[0:v]ass='${p}'[v0]`);
    cur = "v0";
  }
  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    const s = o.startSec.toFixed(3);
    const e = (o.startSec + o.durSec).toFixed(3);
    const ramp = Math.max(0.6, Math.min(rampMax, (o.durSec - 0.5) / 2));
    const outEdge = Math.max(0, o.durSec - ramp).toFixed(3);
    if (o.noBlur) {
      // Small badge (lower third): just the alpha card, footage untouched.
      chains.push(
        `[${i + 1}:v]format=yuva420p,tpad=start_duration=${s}:color=0x00000000[c${i}]`,
        `[${cur}][c${i}]overlay=0:0:eof_action=pass:enable='between(t,${s},${e})'[ov${i}]`,
      );
      cur = `ov${i}`;
      continue;
    }
    chains.push(
      `[${cur}]split[a${i}][b${i}]`,
      `[b${i}]trim=${s}:${e},setpts=PTS-STARTPTS,gblur=sigma=${sigma},format=yuva420p,` +
        `fade=t=in:st=0:d=${ramp}:alpha=1,fade=t=out:st=${outEdge}:d=${ramp}:alpha=1,` +
        `tpad=start_duration=${s}:color=0x00000000[bf${i}]`,
      `[a${i}][bf${i}]overlay=0:0:eof_action=pass:enable='between(t,${s},${e})'[bg${i}]`,
      `[${i + 1}:v]format=yuva420p,tpad=start_duration=${s}:color=0x00000000[c${i}]`,
      `[bg${i}][c${i}]overlay=0:0:eof_action=pass:enable='between(t,${s},${e})'[ov${i}]`,
    );
    cur = `ov${i}`;
  }

  args.push(
    "-filter_complex", chains.join(";"),
    "-map", `[${cur}]`,
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart",
    outPath,
  );
  await run(FFMPEG, args, opts.timeoutMs ?? 2_400_000);
  return outPath;
}

/**
 * GOLDEN music-loop assembler (v1 lofi `video_builder._build_with_overlay`):
 * stream-loop the seamless animated unit under the full music, and over the first
 * ~8s overlay the channel name + title with a 20-step PROGRESSIVE DEBLUR
 * (gblur sigma 20→1, 0.4s/step) + 2s fade-in — the signature "intro card + blur"
 * look, with NO separate static card (animation plays from frame 1). One pass.
 */
export async function composeMusicLoopDeblur(args: {
  loopUnitPath: string;
  musicPath: string;
  outPath: string;
  durationSec: number;
  title?: string;
  channel?: string;
  width?: number;
  height?: number;
  fps?: number;
  preset?: string;
  fontFile?: string;
  timeoutMs?: number;
}): Promise<string> {
  const W = args.width ?? 1920;
  const H = args.height ?? 1080;
  const fps = args.fps ?? 30;
  const font = args.fontFile ?? CLOUD_FONTS.sans;
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’");
  // 20-step deblur over 8s (0.4s/step), strong → none.
  const deblur = Array.from({ length: 20 }, (_, i) =>
    `gblur=sigma=${20 - i}:enable='between(t\\,${(i * 0.4).toFixed(1)}\\,${((i + 1) * 0.4).toFixed(1)})'`,
  ).join(",");
  // alpha fade: name in 0.5-2s, hold, out 5-7.5s; title in 1.5-3s, out 5-7.5s.
  const aName = "if(lt(t,0.5),0,if(lt(t,2),(t-0.5)/1.5,if(lt(t,5),1,if(lt(t,7.5),1-(t-5)/2.5,0))))";
  const aTitle = "if(lt(t,1.5),0,if(lt(t,3),(t-1.5)/1.5,if(lt(t,5),1,if(lt(t,7.5),1-(t-5)/2.5,0))))";
  const fsTitle = Math.round(H * 0.052);
  const fsName = Math.round(H * 0.03);
  const draws: string[] = [];
  // Lower-third layout (not dead-center) so the title never covers the focal
  // point of the scene — the clean lofi look. Title sits ~72% down with a soft
  // translucent backing pill; the channel tag sits just below it.
  if (args.title) {
    draws.push(
      `drawtext=fontfile=${font}:text='${esc(args.title)}':expansion=none:fontcolor=white:fontsize=${fsTitle}:` +
        `box=1:boxcolor=black@0.32:boxborderw=${Math.round(fsTitle * 0.6)}:` +
        `shadowcolor=black@0.6:shadowx=2:shadowy=2:alpha='${aTitle}':x=(w-text_w)/2:y=${Math.round(H * 0.72)}`,
    );
  }
  if (args.channel) {
    draws.push(
      `drawtext=fontfile=${font}:text='${esc(args.channel.toUpperCase())}':expansion=none:fontcolor=white@0.92:fontsize=${fsName}:` +
        `borderw=2:bordercolor=black@0.6:alpha='${aName}':x=(w-text_w)/2:y=${Math.round(H * 0.82)}`,
    );
  }
  const vf = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps}`,
    deblur,
    "fade=t=in:st=0:d=2.0",
    ...draws,
  ].join(",");
  // BUGFIX: the MUSIC must also be stream-looped, else a track shorter than
  // durationSec leaves the tail of the video silent. We loop both, trim to
  // duration, and fade the audio out over the last 4s for a clean ending.
  const aFadeDur = Math.min(4, Math.max(1, args.durationSec * 0.1));
  const aFadeSt = Math.max(0, args.durationSec - aFadeDur).toFixed(2);
  // Long mixes must not decode and re-encode the same 30 seconds for eight
  // hours. Normalize one plain body unit and one visually identical intro unit
  // with the same H.264/GOP contract, then concat-repeat those video packets
  // while encoding the looped audio exactly once. Runtime scales with source
  // complexity and final I/O, not with repeated pixel work.
  const unitSec = 30;
  if (args.durationSec >= unitSec) {
    const repeats = Math.ceil(args.durationSec / unitSec);
    const workDir = dirname(args.outPath);
    const bodyPath = join(workDir, "music-loop-body-unit.mp4");
    const introPath = join(workDir, "music-loop-intro-unit.mp4");
    const concatPath = join(workDir, "music-loop-concat.txt");
    const codec = [
      "-c:v", "libx264",
      "-preset", args.preset ?? "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-g", String(fps * unitSec),
      "-keyint_min", String(fps * unitSec),
      "-sc_threshold", "0",
      "-an",
      "-movflags", "+faststart",
    ];
    const baseVf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps}`;
    await run(
      FFMPEG,
      [
        "-y", "-stream_loop", "-1", "-i", args.loopUnitPath,
        "-t", String(unitSec), "-vf", baseVf,
        ...codec,
        bodyPath,
      ],
      args.timeoutMs ?? 2_700_000,
    );
    await run(
      FFMPEG,
      [
        "-y", "-stream_loop", "-1", "-i", args.loopUnitPath,
        "-t", String(unitSec), "-vf", vf,
        ...codec,
        introPath,
      ],
      args.timeoutMs ?? 2_700_000,
    );
    for (const path of [introPath, bodyPath]) {
      if (/[\r\n']/.test(path)) {
        throw new FfmpegError("music-loop temporary path cannot be represented safely in a concat manifest");
      }
    }
    await writeFile(
      concatPath,
      [
        `file '${introPath}'`,
        ...Array.from({ length: Math.max(0, repeats - 1) }, () => `file '${bodyPath}'`),
      ].join("\n") + "\n",
      "utf8",
    );
    await run(
      FFMPEG,
      [
        "-y",
        "-f", "concat", "-safe", "0", "-i", concatPath,
        "-stream_loop", "-1", "-i", args.musicPath,
        "-map", "0:v:0", "-map", "1:a:0",
        "-t", String(args.durationSec),
        "-c:v", "copy",
        "-af", `afade=t=in:st=0:d=2,afade=t=out:st=${aFadeSt}:d=${aFadeDur.toFixed(2)}`,
        "-c:a", "aac", "-b:a", "384k",
        "-movflags", "+faststart",
        args.outPath,
      ],
      args.timeoutMs ?? 2_700_000,
    );
    return args.outPath;
  }
  await run(
    FFMPEG,
    [
      "-y",
      "-stream_loop", "-1", "-i", args.loopUnitPath,
      "-stream_loop", "-1", "-i", args.musicPath,
      "-map", "0:v:0", "-map", "1:a:0", "-t", String(args.durationSec),
      "-vf", vf,
      // 2s audio fade-in (match the video fade from black) + fade-out at the end.
      "-af", `afade=t=in:st=0:d=2,afade=t=out:st=${aFadeSt}:d=${aFadeDur.toFixed(2)}`,
      "-c:v", "libx264", "-preset", args.preset ?? "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "384k", "-movflags", "+faststart",
      args.outPath,
    ],
    args.timeoutMs ?? 2_700_000,
  );
  return args.outPath;
}

export interface CaptionCue { startSec: number; endSec: number; text: string }

/** ASS timestamp H:MM:SS.cc */
function assTs(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cc = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(Math.min(99, cc)).padStart(2, "0")}`;
}
const assText = (t: string) => t.replace(/[{}]/g, "").replace(/\r?\n/g, " ").trim();

/**
 * Burn bottom-centered captions onto a video via libass (one pass, scales to any
 * length). Cues come from our ground-truth sentence timings (audio-synced, exact
 * text — no ASR errors). White text, heavy black outline + shadow, sat near the
 * bottom. Non-fatal at the call site: caller keeps the uncaptioned video on error.
 */
/**
 * Aspect-aware caption geometry (font size + margins), shared by every caption
 * writer so landscape and portrait stay consistent.
 *
 * ASS `Fontsize` is expressed in PlayRes units, so deriving it from HEIGHT alone
 * — correct for 16:9 — is catastrophic for 9:16. At 1080x1920 `H * 0.053` gives a
 * 102px font with only 908px of usable width, so a 42-char cue needs ~2.8x the
 * room it has. Combined with the old `WrapStyle: 2` (explicit `\N` breaks ONLY,
 * no auto-wrap) the overflow was silently CLIPPED at both frame edges rather than
 * wrapped — every portrait Short shipped with captions cut off on the left and
 * right. For portrait frames WIDTH is the binding constraint, so we size off W.
 *
 * Landscape behaviour is unchanged (`H * fontRatio`, 8% side margins).
 */
export function captionGeometry(
  W: number,
  H: number,
  opts: { fontRatio?: number; marginRatio?: number } = {},
): { fontSize: number; marginV: number; sideM: number; availableWidth: number; portrait: boolean } {
  const fontRatio = opts.fontRatio ?? 0.053;
  const marginRatio = opts.marginRatio ?? 0.06;
  const portrait = W < H;
  // Portrait: size off width; the 1.15 bump keeps captions legible at Shorts scale.
  const fontSize = Math.round(portrait ? W * fontRatio * 1.15 : H * fontRatio);
  const marginV = Math.round(H * marginRatio);
  // Tighter side margins in portrait buy back horizontal room for wrapped lines.
  const sideM = Math.round(W * (portrait ? 0.06 : 0.08));
  return { fontSize, marginV, sideM, availableWidth: W - 2 * sideM, portrait };
}

/**
 * Shared `[Script Info]` header. `WrapStyle: 0` = smart auto-wrap (balanced
 * lines). Safe for both orientations: wrapping only ever engages on a line that
 * would otherwise overflow the available width — which under the old
 * `WrapStyle: 2` just got clipped — so cues that already fit render identically.
 */
const ASS_WRAP_STYLE = 0;
const assScriptInfo = (W: number, H: number) =>
  `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: ${ASS_WRAP_STYLE}\nScaledBorderAndShadow: yes\n\n`;

/** Write the styled .ass caption file (shared by burnCaptions + the
 * single-pass finisher). Returns null when there are no cues. */
export async function writeCaptionsAss(
  cues: CaptionCue[],
  tmpDir: string,
  opts: { width?: number; height?: number } = {},
): Promise<string | null> {
  if (cues.length === 0) return null;
  const W = opts.width ?? 1920;
  const H = opts.height ?? 1080;
  const { fontSize, marginV, sideM } = captionGeometry(W, H);
  const head =
    assScriptInfo(W, H) +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Cap,DejaVu Sans,${fontSize},&H00FFFFFF,&H00000000,&H64000000,1,1,4,2,2,${sideM},${sideM},${marginV},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const body = cues
    .map((c) => `Dialogue: 0,${assTs(c.startSec)},${assTs(c.endSec)},Cap,,0,0,0,,${assText(c.text)}`)
    .join("\n");
  const assPath = join(tmpDir, "captions.ass");
  await writeFile(assPath, head + body + "\n");
  return assPath;
}

export async function burnCaptions(
  videoPath: string,
  cues: CaptionCue[],
  outPath: string,
  opts: { tmpDir: string; width?: number; height?: number; timeoutMs?: number },
): Promise<string> {
  if (cues.length === 0) { await copyFile(videoPath, outPath); return outPath; }
  const W = opts.width ?? 1920;
  const H = opts.height ?? 1080;
  // Aspect-aware: 0.053H in landscape, 0.053W*1.15 in portrait (see captionGeometry).
  const { fontSize, marginV, sideM } = captionGeometry(W, H);
  const head =
    assScriptInfo(W, H) +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    // BorderStyle 1 = outline+shadow; Alignment 2 = bottom-center; colours are &HAABBGGRR
    `Style: Cap,DejaVu Sans,${fontSize},&H00FFFFFF,&H00000000,&H64000000,1,1,4,2,2,${sideM},${sideM},${marginV},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const body = cues
    .map((c) => `Dialogue: 0,${assTs(c.startSec)},${assTs(c.endSec)},Cap,,0,0,0,,${assText(c.text)}`)
    .join("\n");
  const assPath = join(opts.tmpDir, "captions.ass");
  await writeFile(assPath, head + body + "\n");
  // Escape the filter path (Windows drive-colon + backslashes; harmless on Linux).
  const p = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  await run(
    FFMPEG,
    [
      "-y", "-i", videoPath, "-vf", `ass='${p}'`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-movflags", "+faststart", outPath,
    ],
    opts.timeoutMs ?? 1_800_000,
  );
  return outPath;
}

/**
 * Cut a [startSec, startSec+durSec] window from a video and reframe it to vertical
 * 9:16 (1080x1920) by scale-to-cover + center-crop — for the Shorts spinoff. Audio
 * re-encoded to AAC so the clip is upload-ready.
 */
export async function makeVerticalClip(
  srcPath: string,
  outPath: string,
  opts: { startSec: number; durSec: number; width?: number; height?: number; timeoutMs?: number },
): Promise<string> {
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  await run(
    FFMPEG,
    [
      "-y",
      "-ss", String(Math.max(0, opts.startSec)),
      "-t", String(Math.max(1, opts.durSec)),
      "-i", srcPath,
      "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
      outPath,
    ],
    opts.timeoutMs ?? 600_000,
  );
  return outPath;
}

/**
 * Split sentence timings into short, readable caption cues (≤ ~7 words / ~42
 * chars), distributing each sentence's time window proportionally. `offsetSec`
 * shifts cues to the final timeline (narration starts after the intro card).
 */
export function captionCuesFromTimings(
  timings: { text: string; start: number; end: number }[],
  offsetSec = 0,
  opts: { maxChars?: number; maxWords?: number } = {},
): CaptionCue[] {
  const maxChars = opts.maxChars ?? 42;
  const maxWords = opts.maxWords ?? 7;
  const cues: CaptionCue[] = [];
  for (const t of timings) {
    const dur = Math.max(0.4, t.end - t.start);
    const words = assText(t.text).split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    // group words into chunks
    const chunks: string[] = [];
    let cur = "";
    let curWords = 0;
    for (const w of words) {
      if (cur && (curWords >= maxWords || (cur + " " + w).length > maxChars)) {
        chunks.push(cur); cur = w; curWords = 1;
      } else { cur = cur ? `${cur} ${w}` : w; curWords++; }
    }
    if (cur) chunks.push(cur);
    // distribute time by chunk character length
    const totalLen = chunks.reduce((s, c) => s + c.length, 0) || 1;
    let acc = 0;
    for (const c of chunks) {
      const frac = c.length / totalLen;
      const cs = t.start + (acc / totalLen) * dur;
      const ce = cs + frac * dur;
      acc += c.length;
      cues.push({ startSec: offsetSec + cs, endSec: offsetSec + ce, text: c });
    }
  }
  return cues;
}

/**
 * Patch a time window of a video with a REPLACEMENT clip (opaque, full-frame) —
 * used by the assembly backend to replace a bounded timeline window without
 * re-rendering the whole body. The replacement is scaled/cropped to fill, trimmed
 * to the window, and overlaid only during [startSec, startSec+durSec] via the
 * same memory-flat `tpad`+`enable` technique as the quote overlays (no buffering).
 * Original audio is preserved. If the replacement is shorter than the window the
 * patch simply ends early (no looping).
 */
export async function patchSegment(
  baseVideo: string,
  patchClip: string,
  startSec: number,
  durSec: number,
  outPath: string,
  opts: { width?: number; height?: number; fps?: number; timeoutMs?: number; fadeInSec?: number } = {},
): Promise<string> {
  const W = opts.width ?? 1920;
  const H = opts.height ?? 1080;
  const fps = opts.fps ?? 30;
  const fadeIn = Math.max(0, opts.fadeInSec ?? 0);
  const s = startSec.toFixed(3);
  const e = (startSec + durSec).toFixed(3);
  // With fadeInSec the patch CROSSFADES in via alpha (transparent lead frames so
  // the base shows through during the dissolve); otherwise it's an opaque cut.
  const patchChain = fadeIn > 0
    ? `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},` +
      `trim=0:${durSec.toFixed(3)},setpts=PTS-STARTPTS,format=yuva420p,fade=t=in:st=0:d=${fadeIn.toFixed(2)}:alpha=1,` +
      `tpad=start_duration=${s}:color=0x00000000[patch]`
    : `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},` +
      `trim=0:${durSec.toFixed(3)},setpts=PTS-STARTPTS,tpad=start_duration=${s}:color=black[patch]`;
  const filter = [
    patchChain,
    `[0:v][patch]overlay=0:0:eof_action=pass:enable='between(t,${s},${e})'[vout]`,
  ].join(";");
  await run(
    FFMPEG,
    [
      "-y",
      "-i",
      baseVideo,
      "-i",
      patchClip,
      "-filter_complex",
      filter,
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outPath,
    ],
    opts.timeoutMs ?? 1_800_000,
  );
  return outPath;
}

/**
 * Mean luminance (0-255) of a vertical region of an image — `xFrac`/`wFrac` are
 * fractions of width. DETERMINISTIC subject-side detection: a bright marble bust
 * on a near-black field shows up as a high-luma region, far more reliable than
 * asking a vision model "which side is the subject on" (which false-positives).
 */
export async function regionLuma(path: string, xFrac: number, wFrac: number): Promise<number> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    // FFMPEG is deliberately resolved from FFMPEG_BIN/PATH in the renderer
    // image; it is not a project asset that Next should trace into the server.
    execFile(/* turbopackIgnore: true */ FFMPEG,
      [
        "-v", "error", "-i", path,
        "-vf", `crop=iw*${wFrac}:ih:iw*${xFrac}:0,signalstats,metadata=print:file=-`,
        "-frames:v", "1", "-f", "null", "-",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 },
      (err, stdout, stderr) => {
        if (err) return resolve(Number.NaN);
        const mean = Number(/lavfi\.signalstats\.YAVG=([0-9.]+)/u.exec(`${stdout}\n${stderr}`)?.[1]);
        resolve(Number.isFinite(mean) ? mean : Number.NaN);
      },
    );
  });
}

/** Mean luminance (0-255) of an exact rectangular still-image region. */
export async function imageRegionLuma(
  path: string,
  region: { x: number; y: number; width: number; height: number },
): Promise<number> {
  const { x, y, width, height } = region;
  if (
    ![x, y, width, height].every(Number.isInteger) ||
    x < 0 || y < 0 || width < 1 || height < 1
  ) return Number.NaN;
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(/* turbopackIgnore: true */ FFMPEG,
      [
        "-v", "error", "-i", path,
        "-vf", `crop=${width}:${height}:${x}:${y},signalstats,metadata=print:file=-`,
        "-frames:v", "1", "-f", "null", "-",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 },
      (err, stdout, stderr) => {
        if (err) return resolve(Number.NaN);
        const mean = Number(/lavfi\.signalstats\.YAVG=([0-9.]+)/u.exec(`${stdout}\n${stderr}`)?.[1]);
        resolve(Number.isFinite(mean) ? mean : Number.NaN);
      },
    );
  });
}

/** Solid-colour JPEG (last-resort thumbnail base when no keyframe/Flux). */
export async function solidImage(
  outJpg: string,
  width = 1280,
  height = 720,
  color = "#101418",
): Promise<string> {
  const c = color.replace(/^#/, "0x");
  await run(FFMPEG, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${c}:s=${width}x${height}`,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outJpg,
  ]);
  return outJpg;
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
 * Size title-card text to stay inside the thumbnail safe area. Drawtext does not
 * wrap automatically, and a fixed 72px size previously shipped clipped titles
 * on both edges. The conservative glyph ratio covers wide uppercase text too.
 */
export function fitTitleCardFontSize(
  text: string,
  options: { min?: number; max?: number; safeWidth?: number; glyphWidthRatio?: number } = {},
): number {
  const min = options.min ?? 38;
  const max = options.max ?? 72;
  const safeWidth = options.safeWidth ?? 1_104;
  const glyphWidthRatio = options.glyphWidthRatio ?? 0.72;
  const glyphs = Math.max(1, Array.from(text.trim()).length);
  return Math.max(min, Math.min(max, Math.floor(safeWidth / (glyphs * glyphWidthRatio))));
}

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
  const titleSize = fitTitleCardFontSize(args.title);
  const subtitleSize = fitTitleCardFontSize(args.subtitle, {
    min: 26,
    max: 40,
    safeWidth: 1_040,
    glyphWidthRatio: 0.68,
  });
  const draw =
    `drawtext=fontfile=${font}:text='${esc(args.title)}':expansion=none:fontcolor=white:fontsize=${titleSize}:` +
    `box=1:boxcolor=black@0.5:boxborderw=24:x=(w-text_w)/2:y=(h-text_h)/2-40,` +
    `drawtext=fontfile=${font}:text='${esc(args.subtitle)}':expansion=none:fontcolor=white@0.85:fontsize=${subtitleSize}:` +
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

/**
 * Bold title overlay for the real-scene thumbnail path (a styled headline over
 * the run's own keyframe still), with a strong outline (and optional drop
 * shadow) so it stays legible at small size. Pure ffmpeg, $0. Auto-wraps to
 * ~14 chars/line so ≤8-word titles fit.
 */
const CLOUD_FONTS = {
  sans: join(process.cwd(), "public/fonts/Anton.ttf"),
  serif: join(process.cwd(), "public/fonts/DMSerifDisplay.ttf"),
  impact: join(process.cwd(), "public/fonts/Anton.ttf"),
  bebas: join(process.cwd(), "public/fonts/BebasNeue.ttf"),
  marker: join(process.cwd(), "public/fonts/PermanentMarker.ttf"),
  rounded: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
};

export const THUMBNAIL_TEXT_OBJECTS = [
  "torn_strip",
  "paint_smear",
  "censor_bar",
  "grunge_sticker",
  "spaced_elegant",
  "block_plate",
  "neon_sign",
  "spray_paint",
  "stamp_ink",
  "movie_poster",
  "ransom_note",
  "carved",
] as const;

export type ThumbnailTextObject = typeof THUMBNAIL_TEXT_OBJECTS[number];
type ThumbnailFontPreset = keyof typeof CLOUD_FONTS;
type ThumbnailTreatment = "plate" | "sticker" | "stamp" | "neon" | "clean";
type ThumbnailTextSurface =
  | "none"
  | "paper_strips"
  | "paint_smear"
  | "censor_bar"
  | "grunge_sticker"
  | "block_plates"
  | "letter_tiles";
type ThumbnailTextEffect = "clean" | "hard_shadow" | "glow" | "spray" | "double_stamp" | "bevel" | "carved";

export interface ResolvedThumbnailTextStyle {
  motif: ThumbnailTextObject | "legacy";
  font: ThumbnailFontPreset;
  casing: "upper" | "lower" | "configured";
  tracking: 0 | 1 | 2;
  fontScale: number;
  surface: ThumbnailTextSurface;
  effect: ThumbnailTextEffect;
}

const THUMBNAIL_TEXT_STYLES: Record<ThumbnailTextObject, Omit<ResolvedThumbnailTextStyle, "motif">> = {
  torn_strip: { font: "serif", casing: "upper", tracking: 0, fontScale: 0.92, surface: "paper_strips", effect: "hard_shadow" },
  paint_smear: { font: "serif", casing: "upper", tracking: 1, fontScale: 0.78, surface: "paint_smear", effect: "clean" },
  censor_bar: { font: "impact", casing: "upper", tracking: 0, fontScale: 0.94, surface: "censor_bar", effect: "clean" },
  grunge_sticker: { font: "marker", casing: "lower", tracking: 0, fontScale: 0.94, surface: "grunge_sticker", effect: "hard_shadow" },
  spaced_elegant: { font: "serif", casing: "upper", tracking: 2, fontScale: 0.64, surface: "none", effect: "clean" },
  block_plate: { font: "impact", casing: "upper", tracking: 0, fontScale: 1, surface: "block_plates", effect: "hard_shadow" },
  neon_sign: { font: "rounded", casing: "upper", tracking: 0, fontScale: 0.9, surface: "none", effect: "glow" },
  spray_paint: { font: "marker", casing: "upper", tracking: 0, fontScale: 0.94, surface: "none", effect: "spray" },
  stamp_ink: { font: "marker", casing: "upper", tracking: 0, fontScale: 0.96, surface: "none", effect: "double_stamp" },
  movie_poster: { font: "impact", casing: "upper", tracking: 0, fontScale: 1, surface: "none", effect: "bevel" },
  ransom_note: { font: "sans", casing: "configured", tracking: 0, fontScale: 0.72, surface: "letter_tiles", effect: "hard_shadow" },
  carved: { font: "serif", casing: "upper", tracking: 0, fontScale: 0.92, surface: "none", effect: "carved" },
};

export function isThumbnailTextObject(value: unknown): value is ThumbnailTextObject {
  return typeof value === "string" &&
    (THUMBNAIL_TEXT_OBJECTS as readonly string[]).includes(value);
}

/** Resolve the executable visual contract behind a Style-DNA text-object key. */
export function resolveThumbnailTextStyle(args: {
  textObject?: string;
  treatment?: ThumbnailTreatment;
  font?: ThumbnailFontPreset;
}): ResolvedThumbnailTextStyle {
  if (isThumbnailTextObject(args.textObject)) {
    const motif = THUMBNAIL_TEXT_STYLES[args.textObject];
    return { ...motif, motif: args.textObject, font: args.font ?? motif.font };
  }
  // Style DNA predates explicit text-object motifs. Infer the strongest physical
  // treatment for older channels while preserving deliberately invalid values as
  // the legacy compatibility path.
  if (args.textObject === undefined) {
    const inferredMotif: ThumbnailTextObject = args.treatment === "plate"
      ? "block_plate"
      : args.treatment === "sticker"
        ? "grunge_sticker"
        : args.treatment === "stamp"
          ? "stamp_ink"
          : args.treatment === "neon"
            ? "neon_sign"
            : args.font === "bebas" || args.font === "impact"
              ? "movie_poster"
              : args.font === "serif"
                ? "spaced_elegant"
                : "block_plate";
    const motif = THUMBNAIL_TEXT_STYLES[inferredMotif];
    return { ...motif, motif: inferredMotif, font: args.font ?? motif.font };
  }
  const treatment = args.treatment ?? "plate";
  const legacy: Omit<ResolvedThumbnailTextStyle, "motif" | "font"> = treatment === "plate"
    ? { casing: "configured", tracking: 0, fontScale: 1, surface: "block_plates", effect: "hard_shadow" }
    : treatment === "sticker"
      ? { casing: "configured", tracking: 0, fontScale: 1, surface: "paper_strips", effect: "hard_shadow" }
      : treatment === "stamp"
        ? { casing: "configured", tracking: 0, fontScale: 1, surface: "none", effect: "double_stamp" }
        : treatment === "neon"
          ? { casing: "configured", tracking: 0, fontScale: 1, surface: "none", effect: "glow" }
          : { casing: "configured", tracking: 0, fontScale: 1, surface: "none", effect: "clean" };
  return { ...legacy, motif: "legacy", font: args.font ?? "sans" };
}

export interface ThumbnailTextOverlayArgs {
  title: string;
  lines?: ThumbnailHeadlineLine[];
  position?: ThumbnailTextZone;
  subtitle?: string;
  footerLabel?: string;
  badgePlacement?: "bottomCenter" | "bottomRight" | "topRight";
  textColor?: string;
  baseColor?: string;
  accentColor?: string;
  badgeStyle?: "center" | "pill";
  textShadow?: boolean;
  fontFile?: string;
  font?: ThumbnailFontPreset;
  uppercase?: boolean;
  treatment?: ThumbnailTreatment;
  textObject?: ThumbnailTextObject;
}

function thumbnailColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const hex = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? `0x${hex}` : fallback;
}

/** Choose the higher-contrast black/white foreground for an opaque surface. */
function thumbnailContrastText(surface: string): "black" | "white" {
  const match = /^(?:0x|#)?([0-9a-f]{6})$/i.exec(surface.trim());
  if (!match) return "white";
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const linear = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.179 ? "black" : "white";
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")
    .replace(/%/g, "\\%");
}

function applyThumbnailCasing(
  value: string,
  style: ResolvedThumbnailTextStyle,
  uppercase: boolean | undefined,
): string {
  if (style.casing === "upper") return value.toUpperCase();
  if (style.casing === "lower") {
    const lower = value.toLowerCase().trim();
    return /[.!?:;]$/.test(lower) ? lower : `${lower}.`;
  }
  return uppercase === false ? value : value.toUpperCase();
}

function trackThumbnailText(value: string, tracking: 0 | 1 | 2): string {
  if (tracking === 0) return value;
  const gap = "\u2009".repeat(tracking);
  return Array.from(value).join(gap);
}

function drawtextX(align: "left" | "right" | "center", safeInset: number, offset = 0): string {
  const delta = offset === 0 ? "" : offset > 0 ? `+${offset}` : String(offset);
  if (align === "left") return `${safeInset + 16}${delta}`;
  if (align === "right") return `w-${safeInset + 16}-text_w${delta}`;
  return `(w-text_w)/2${delta}`;
}

/** Build the exact local FFmpeg filter graph. Exported so every promised motif
 * is regression-tested at the renderer boundary, without a provider call. */
export function buildThumbnailTextFilterGraph(args: ThumbnailTextOverlayArgs): string {
  const style = resolveThumbnailTextStyle(args);
  const textColor = thumbnailColor(args.textColor, "white");
  const baseColor = thumbnailColor(args.baseColor, "black");
  const accent = thumbnailColor(args.accentColor, "0xffd400");
  const preparedLines = (args.lines?.length ? args.lines : [{ text: args.title }]).map((line) => ({
    ...line,
    text: applyThumbnailCasing(line.text, style, args.uppercase),
  }));
  const plan = planThumbnailText({
    lines: preparedLines,
    zone: args.position,
    uppercase: false,
    tracking: style.tracking,
    fontScale: style.fontScale,
  });
  const defaultFont = args.fontFile ?? CLOUD_FONTS[style.font];
  const filters: string[] = [];

  const addText = (line: typeof plan.lines[number], options: {
    text?: string;
    font?: string;
    color?: string;
    fontSize?: number;
    xOffset?: number;
    yOffset?: number;
    borderWidth?: number;
    borderColor?: string;
    shadow?: string;
    box?: string;
  } = {}): void => {
    filters.push(
      `drawtext=fontfile=${options.font ?? defaultFont}:text='${escapeDrawtext(options.text ?? line.text)}':expansion=none:` +
      `fontcolor=${options.color ?? textColor}:fontsize=${Math.max(20, Math.round(options.fontSize ?? line.fontSize * style.fontScale))}:` +
      `${options.box ?? ""}borderw=${options.borderWidth ?? 0}:bordercolor=${options.borderColor ?? "black@0.92"}:` +
      `${options.shadow ?? ""}x=${drawtextX(plan.align, plan.safeInset, options.xOffset)}:` +
      `y=${Math.round(line.y + 10 + (options.yOffset ?? 0))}`,
    );
  };

  for (const [index, line] of plan.lines.entries()) {
    const payoff = line.accent === true || line.payoff === true;
    const fontSize = Math.max(20, Math.round(line.fontSize * style.fontScale));
    const y = Math.round(line.y + 7);
    const jitter = index % 2 === 0 ? -5 : 6;

    if (style.surface === "letter_tiles") {
      const chars = Array.from(line.text);
      const advance = Math.max(20, Math.round(fontSize * 0.7));
      const totalWidth = chars.length * advance;
      const startX = plan.align === "left"
        ? plan.safeInset + 16
        : plan.align === "right"
          ? plan.width - plan.safeInset - 16 - totalWidth
          : Math.round((plan.width - totalWidth) / 2);
      const tileColors = ["0xfff4d6", "0xffd166", "0xf4f4f4", "0xff8f80", "0x8fd7ff"];
      const tileFonts = [CLOUD_FONTS.serif, CLOUD_FONTS.sans, CLOUD_FONTS.marker];
      chars.forEach((char, charIndex) => {
        if (/\s/.test(char)) return;
        const tileX = startX + charIndex * advance;
        const tileY = y + [-5, 3, 0, 5, -2][charIndex % 5];
        filters.push(
          `drawbox=x=${tileX - 4}:y=${tileY - 3}:w=${advance}:h=${fontSize + 13}:` +
          `color=${tileColors[charIndex % tileColors.length]}@0.96:t=fill`,
        );
        filters.push(
          `drawtext=fontfile=${tileFonts[charIndex % tileFonts.length]}:text='${escapeDrawtext(char)}':expansion=none:` +
          `fontcolor=0x151515:fontsize=${fontSize}:borderw=0:` +
          `shadowcolor=black@0.45:shadowx=3:shadowy=4:x=${tileX}:y=${tileY}`,
        );
      });
      continue;
    }

    if (style.surface === "paper_strips") {
      const paper = index % 2 === 0 ? "0xfff4d6" : "0xf5efe4";
      filters.push(`drawbox=x=${line.x + jitter + 7}:y=${y + 7}:w=${line.width + 18}:h=${line.height + 9}:color=${baseColor}@0.48:t=fill`);
      filters.push(`drawbox=x=${line.x + jitter}:y=${y}:w=${line.width + 18}:h=${line.height + 9}:color=${paper}@0.97:t=fill`);
    } else if (style.surface === "paint_smear") {
      const smearY = y + Math.round(fontSize * 0.31);
      filters.push(`drawbox=x=${line.x - 14}:y=${smearY}:w=${line.width + 34}:h=${Math.round(fontSize * 0.58)}:color=${accent}@0.82:t=fill`);
      filters.push(`drawbox=x=${line.x - 25}:y=${smearY + 8}:w=13:h=5:color=${accent}@0.68:t=fill`);
      filters.push(`drawbox=x=${line.x + line.width + 22}:y=${smearY + 17}:w=19:h=4:color=${accent}@0.58:t=fill`);
    } else if (style.surface === "censor_bar") {
      filters.push(`drawbox=x=${line.x - 18}:y=${y - 3}:w=${line.width + 52}:h=${line.height + 10}:color=${accent}@0.96:t=fill`);
    } else if (style.surface === "grunge_sticker") {
      filters.push(`drawbox=x=${line.x + 8}:y=${y + 8}:w=${line.width + 28}:h=${line.height + 12}:color=${accent}@0.78:t=fill`);
      filters.push(`drawbox=x=${line.x - 5}:y=${y - 3}:w=${line.width + 28}:h=${line.height + 12}:color=${baseColor}@0.96:t=fill`);
    } else if (style.surface === "block_plates") {
      const plateColor = payoff ? accent : baseColor;
      filters.push(`drawbox=x=${line.x - 5}:y=${y - 3}:w=${line.width + 26}:h=${line.height + 11}:color=${plateColor}@0.9:t=fill`);
      if (payoff) {
        filters.push(`drawbox=x=${line.x - 2}:y=${y + line.height + 4}:w=${line.width + 20}:h=8:color=${accent}@0.95:t=fill`);
      }
    }

    const tracked = trackThumbnailText(line.text, style.tracking);
    const surfaceColor = style.surface === "paper_strips"
      ? (payoff ? accent : "0x151515")
      : style.surface === "paint_smear"
        ? thumbnailContrastText(accent)
      : style.surface === "censor_bar"
        ? "white"
        : style.surface === "grunge_sticker"
          ? "white"
          : style.surface === "block_plates" && payoff
            ? "0x111111"
            : payoff
              ? accent
              : textColor;
    const baseOffset = style.surface === "paper_strips" ? jitter : 0;

    if (style.effect === "glow") {
      addText(line, { text: tracked, color: `${accent}@0.32`, fontSize, xOffset: baseOffset, borderWidth: 15, borderColor: `${accent}@0.20` });
      addText(line, { text: tracked, color: "white", fontSize, xOffset: baseOffset, borderWidth: 3, borderColor: accent, shadow: `shadowcolor=${accent}@0.95:shadowx=4:shadowy=4:` });
    } else if (style.effect === "double_stamp") {
      addText(line, { text: tracked, color: `${surfaceColor}@0.34`, fontSize, xOffset: baseOffset + 5, yOffset: 4, borderWidth: 1, borderColor: `${surfaceColor}@0.25` });
      addText(line, { text: tracked, color: surfaceColor, fontSize, xOffset: baseOffset, borderWidth: 2, borderColor: "black@0.38" });
    } else if (style.effect === "bevel") {
      addText(line, { text: tracked, color: "black@0.72", fontSize, xOffset: baseOffset + 6, yOffset: 7, borderWidth: 7, borderColor: "black@0.55" });
      addText(line, { text: tracked, color: payoff ? accent : "white", fontSize, xOffset: baseOffset, borderWidth: 5, borderColor: `${accent}@0.78` });
      addText(line, { text: tracked, color: payoff ? accent : "white", fontSize, xOffset: baseOffset - 2, yOffset: -2, borderWidth: 1, borderColor: "white@0.42" });
    } else if (style.effect === "carved") {
      addText(line, { text: tracked, color: "white@0.34", fontSize, xOffset: baseOffset - 3, yOffset: -3, borderWidth: 2, borderColor: "white@0.25" });
      addText(line, { text: tracked, color: "black@0.76", fontSize, xOffset: baseOffset + 4, yOffset: 5, borderWidth: 4, borderColor: "black@0.66" });
      addText(line, { text: tracked, color: payoff ? accent : "0xb9b2a5", fontSize, xOffset: baseOffset, borderWidth: 2, borderColor: "0x27231f@0.9" });
    } else {
      const shadow = args.textShadow === false || style.effect === "clean"
        ? ""
        : "shadowcolor=black@0.9:shadowx=5:shadowy=5:";
      addText(line, {
        text: tracked,
        color: surfaceColor,
        fontSize,
        xOffset: baseOffset,
        borderWidth: style.surface === "paint_smear" ? 2 : style.surface === "censor_bar" ? 0 : 4,
        borderColor: "black@0.88",
        shadow,
      });
      if (style.effect === "spray") {
        const dripX = line.x + Math.round(line.width * (0.28 + (index % 3) * 0.16));
        filters.push(`drawbox=x=${dripX}:y=${y + line.height - 2}:w=5:h=${18 + index * 4}:color=${accent}@0.76:t=fill`);
        filters.push(`drawbox=x=${dripX + 13}:y=${y + line.height + 2}:w=3:h=${10 + index * 3}:color=${accent}@0.54:t=fill`);
      }
    }
  }

  if (args.subtitle) {
    const badge = args.badgeStyle === "pill"
      ? `box=1:boxcolor=${baseColor}@0.82:boxborderw=10:`
      : "";
    const badgeAtTop = args.badgePlacement === "topRight" || Boolean(args.footerLabel);
    const badgePosition = badgeAtTop
      ? `x=w-text_w-44:y=38`
      : args.badgePlacement === "bottomRight"
        ? `x=w-text_w-62:y=h-104`
        : `x=(w-text_w)/2:y=h*0.92`;
    filters.push(
      `drawtext=fontfile=${CLOUD_FONTS.sans}:text='${escapeDrawtext(args.subtitle.toUpperCase())}':expansion=none:` +
      `fontcolor=white@0.9:fontsize=30:${badge}borderw=2:bordercolor=black:` +
      `shadowcolor=black@0.9:shadowx=2:shadowy=2:` +
      badgePosition,
    );
  }
  if (args.footerLabel) {
    const footer = Array.from(args.footerLabel.toUpperCase()).join("\u2009");
    filters.push(
      `drawtext=fontfile=${CLOUD_FONTS.sans}:text='${escapeDrawtext(footer)}':expansion=none:` +
      `fontcolor=${accent}:fontsize=30:borderw=1:bordercolor=black@0.7:` +
      `shadowcolor=black@0.8:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h-58`,
    );
  }
  return filters.join(",");
}

export async function thumbnailText(args: {
  basePath: string;
  outJpg: string;
} & ThumbnailTextOverlayArgs): Promise<string> {
  const filterGraph = buildThumbnailTextFilterGraph(args);
  await run(FFMPEG, [
    "-y",
    "-i",
    args.basePath,
    "-vf",
    `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,${filterGraph}`,
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
