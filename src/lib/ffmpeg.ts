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
  /** Fade video to black + audio out over the last N seconds. */
  fadeOutSec?: number;
  /** Crossfade (xfade) seconds from the title card into the body. Default 0.8. */
  crossfadeSec?: number;
  width?: number;
  height?: number;
  /** Music volume during the intro (no voice) and under narration. */
  introMusicVol?: number;
  bodyMusicVol?: number;
  preset?: string;
  timeoutMs?: number;
}): Promise<string> {
  const W = args.width ?? 1920;
  const H = args.height ?? 1080;
  const fps = 30;
  const intro = Math.max(0, args.introCardPath ? args.introSec : 0);
  const tail = Math.max(0, args.tailSec ?? 0);
  const fade = Math.max(0, args.fadeOutSec ?? 0);
  const bodyTail = args.bodySec + tail;
  const total = intro + args.bodySec + tail;
  const fadeSt = Math.max(0, total - fade);
  const introMs = Math.round(intro * 1000);
  const introVol = args.introMusicVol ?? 0.6;
  const bodyVol = args.narrationPath ? (args.bodyMusicVol ?? 0.12) : introVol;

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

  // ----- video -----
  // With a title card, CROSSFADE it into the body (xfade) so the intro dissolves
  // into the first footage. The body is extended by the crossfade so the output
  // length stays intro+bodyTail (aligned with the audio timeline).
  const vparts: string[] = [];
  let vcat: string;
  if (cardIdx >= 0) {
    const xf = Math.max(0, Math.min(intro, bodyTail, args.crossfadeSec ?? 0.8));
    vparts.push(
      `[${cardIdx}:v]${scalePad},trim=0:${intro.toFixed(3)},setpts=PTS-STARTPTS[card]`,
    );
    vparts.push(
      `[${bodyIdx}:v]${scalePad},trim=0:${(bodyTail + xf).toFixed(3)},setpts=PTS-STARTPTS[body]`,
    );
    vparts.push(
      `[card][body]xfade=transition=fade:duration=${xf.toFixed(3)}:offset=${(intro - xf).toFixed(3)}[vcat]`,
    );
    vcat = "[vcat]";
  } else {
    vparts.push(
      `[${bodyIdx}:v]${scalePad},trim=0:${bodyTail.toFixed(3)},setpts=PTS-STARTPTS[body]`,
    );
    vcat = "[body]";
  }
  const vout =
    fade > 0
      ? `${vcat}fade=t=out:st=${fadeSt.toFixed(2)}:d=${fade.toFixed(2)}[vout]`
      : `${vcat}null[vout]`;

  // ----- audio -----
  const aparts: string[] = [];
  // Music bed: full during the intro, low under the body. eval=frame so the
  // volume tracks time. Looped to cover the whole timeline, trimmed to total.
  aparts.push(
    `[${musicIdx}:a]aresample=44100,atrim=0:${total.toFixed(3)},` +
      `volume='if(lt(t,${intro.toFixed(3)}),${introVol},${bodyVol})':eval=frame[mbed]`,
  );
  let amixOut: string;
  if (narrIdx >= 0) {
    aparts.push(
      `[${narrIdx}:a]aresample=44100,adelay=${introMs}:all=1,` +
        `atrim=0:${total.toFixed(3)}[narr]`,
    );
    aparts.push(`[narr][mbed]amix=inputs=2:duration=longest:normalize=0[amixraw]`);
    amixOut = "[amixraw]";
  } else {
    amixOut = "[mbed]";
  }
  const aout =
    fade > 0
      ? `${amixOut}afade=t=out:st=${fadeSt.toFixed(2)}:d=${fade.toFixed(2)},atrim=0:${total.toFixed(3)}[aout]`
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
    "128k",
    "-ar",
    "44100",
    outPath,
  ]);
  return outPath;
}

export interface QuoteOverlaySpec {
  /** Transparent (VP8/alpha) overlay clip. */
  path: string;
  /** Absolute start time in the final video (seconds). */
  startSec: number;
  durSec: number;
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
  const ramp = opts.rampSec ?? 0.6;
  // SEQUENTIAL — one light ffmpeg pass per quote (split into base + a single
  // trimmed/blurred window + the card). Avoids the OOM of N simultaneous gblur
  // branches in one graph. Audio is stream-copied each pass.
  let cur = videoPath;
  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    const s = o.startSec.toFixed(3);
    const e = (o.startSec + o.durSec).toFixed(3);
    const outEdge = Math.max(0, o.durSec - ramp).toFixed(3);
    const stepOut = i === overlays.length - 1 ? outPath : `${outPath}.step${i}.mp4`;
    const filter = [
      `[0:v]split[base][b]`,
      `[b]trim=${s}:${e},setpts=PTS-STARTPTS,gblur=sigma=${sigma},format=yuva420p,` +
        `fade=t=in:st=0:d=${ramp}:alpha=1,fade=t=out:st=${outEdge}:d=${ramp}:alpha=1,setpts=PTS+${s}/TB[bf]`,
      `[base][bf]overlay=0:0:enable='between(t,${s},${e})'[bg]`,
      `[1:v]setpts=PTS+${s}/TB[c]`,
      `[bg][c]overlay=0:0:enable='between(t,${s},${e})'[vout]`,
    ].join(";");
    await run(
      FFMPEG,
      [
        "-y",
        "-i",
        cur,
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
    cur = stepOut;
  }
  return outPath;
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

/**
 * Bold, centered, Impact-style title overlay for the claude_flux thumbnailer.
 * Renders a punchy YouTube-style headline onto a TEXT-FREE Flux base, with a
 * strong outline (and optional drop shadow) so it stays legible at small size.
 * Pure ffmpeg, $0. Auto-wraps to ~14 chars/line so ≤8-word titles fit.
 */
export async function thumbnailText(args: {
  basePath: string;
  outJpg: string;
  title: string;
  /** Hex like "#FFEE00" or an ffmpeg colour name. Defaults to white. */
  textColor?: string;
  /** Add a drop shadow under the text. */
  textShadow?: boolean;
  fontFile?: string;
}): Promise<string> {
  const font =
    args.fontFile ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’");
  // Normalise colour: ffmpeg accepts 0xRRGGBB or names; map #hex → 0xhex.
  const color = (args.textColor ?? "white").replace(/^#/, "0x");
  // Soft word-wrap so long titles don't run off-frame.
  const words = args.title.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 16 && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  const wrapped = lines.join("\n");

  const draws: string[] = [];
  if (args.textShadow) {
    draws.push(
      `drawtext=fontfile=${font}:text='${esc(wrapped)}':fontcolor=black@0.75:fontsize=96:` +
        `line_spacing=12:x=(w-text_w)/2+6:y=(h-text_h)/2+6`,
    );
  }
  draws.push(
    `drawtext=fontfile=${font}:text='${esc(wrapped)}':fontcolor=${color}:fontsize=96:` +
      `borderw=8:bordercolor=black:line_spacing=12:x=(w-text_w)/2:y=(h-text_h)/2`,
  );

  await run(FFMPEG, [
    "-y",
    "-i",
    args.basePath,
    "-vf",
    `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,${draws.join(",")}`,
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
