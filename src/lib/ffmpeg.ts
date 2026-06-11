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
import { stat, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
async function detectSceneChanges(path: string, timeoutMs = 30_000): Promise<number[]> {
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
  width?: number;
  height?: number;
  fps?: number;
  preset?: string;
}): Promise<string> {
  const { clipPaths, targetSec, tmpDir } = args;
  if (clipPaths.length === 0) throw new FfmpegError("assembleBeatBody: no clips");
  const W = args.width ?? 1920;
  const H = args.height ?? 1080;
  const fps = args.fps ?? 30;
  const maxSeg = args.maxSegSec ?? 10;

  // Walk each clip AT MOST ONCE, playing it for up to maxSeg but NEVER longer
  // than its real duration — no stream_loop, no clip reuse. Coverage comes from
  // the quantity of distinct clips (stock_footage provisions sum(min(dur,8)) ≥
  // target), so the body reaches targetSec without ever looping a clip.
  const segFiles: string[] = [];
  let total = 0;
  for (let i = 0; i < clipPaths.length; i++) {
    if (total >= targetSec) break;
    let dur = maxSeg;
    try {
      dur = (await probe(clipPaths[i])).durationSec || maxSeg;
    } catch {
      dur = maxSeg;
    }
    if (dur < 0.3) continue;
    let segLen = Math.min(dur, maxSeg);
    // trim the last clip so we don't overshoot the target by much
    if (total + segLen > targetSec) segLen = Math.max(0.5, targetSec - total + 0.5);
    segLen = Math.min(segLen, dur); // never exceed the clip's real length
    if (segLen < 0.4) break;
    // CENTER-CUT: stock clips routinely open on a black fade-in (and end on a
    // fade-out) — cutting from t=0 turned one such clip into a full-black
    // segment that then repeated at every body loop. Cutting from the middle
    // lands on the clip's actual content.
    let ss = Math.max(0, (dur - segLen) / 2);
    // SCENE-AWARE CUT (long holds only — short segments rarely cross a cut):
    // stock clips often contain internal hard cuts; a 16s contemplative hold
    // crossing one jumps mid-shot. Fit the window inside the longest internal
    // scene; shrink into it if needed; center-cut stays the fallback.
    if (segLen >= 6) {
      const cuts = await detectSceneChanges(clipPaths[i]);
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
    const sf = join(tmpDir, `beatseg_${i}.mp4`);
    await run(FFMPEG, [
      "-y",
      "-ss",
      ss.toFixed(3),
      "-i",
      clipPaths[i],
      "-t",
      segLen.toFixed(3),
      "-vf",
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps}`,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      args.preset ?? "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
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
  await run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", args.outPath]);
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
  maxSegSec?: number;
  preset?: string;
}): Promise<string> {
  const W = args.width ?? 1920;
  const H = args.height ?? 1080;
  const fps = args.fps ?? 30;
  const maxSeg = args.maxSegSec ?? 25;
  const scalePad =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps}`;
  const clipDur: number[] = [];
  for (const c of args.clipPaths) {
    try { clipDur.push((await probe(c)).durationSec || maxSeg); } catch { clipDur.push(maxSeg); }
  }
  const segFiles: string[] = [];
  let sj = 0;
  let ci = 0;
  const cut = async (input: string, dur: number) => {
    const sf = join(args.tmpDir, `sbody_${sj++}.mp4`);
    await run(FFMPEG, [
      "-y", "-i", input, "-t", dur.toFixed(3), "-vf", scalePad, "-an",
      "-c:v", "libx264", "-preset", args.preset ?? "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", sf,
    ]);
    segFiles.push(sf);
  };
  for (const w of args.windows) {
    if (w.durSec < 0.3) continue;
    if (w.kind === "card" && w.cardPath) {
      await cut(w.cardPath, w.durSec);
    } else if (args.clipPaths.length > 0) {
      let need = w.durSec;
      while (need > 0.4) {
        const clip = args.clipPaths[ci % args.clipPaths.length];
        const cd = clipDur[ci % args.clipPaths.length] || maxSeg;
        const seg = Math.min(cd, maxSeg, need);
        if (seg < 0.4) break;
        await cut(clip, seg);
        need -= seg;
        ci++;
      }
    }
  }
  if (segFiles.length === 0) throw new FfmpegError("assembleStructuredBody: no segments");
  const listFile = join(args.tmpDir, "sbody_list.txt");
  await writeFile(listFile, segFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", args.outPath]);
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
  /** Fade VIDEO to black over the last N seconds. */
  fadeOutSec?: number;
  /** Fade AUDIO/music out over the last N seconds (defaults to fadeOutSec). Lets
   * the outro card stay visible while the music slowly fades. */
  audioFadeOutSec?: number;
  /** Crossfade (xfade) seconds from the title card into the body. Default 0.8. */
  crossfadeSec?: number;
  width?: number;
  height?: number;
  /** Music volume during the intro (no voice) and under narration. */
  introMusicVol?: number;
  bodyMusicVol?: number;
  /** Seconds over which the music GRADUALLY ducks from intro→body level once the
   * narration starts (instead of an instant drop). Default 3s. */
  musicDuckRampSec?: number;
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
  const filter = `${voice};${noise};[v][n]amix=inputs=2:duration=first:dropout_transition=0,volume=1.0[out]`;
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

export interface QuoteOverlaySpec {
  /** Transparent (VP8/alpha) overlay clip. */
  path: string;
  /** Absolute start time in the final video (seconds). */
  startSec: number;
  durSec: number;
  /** Source quote text (so qa_refine can re-render a shortened card). */
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
      `drawtext=fontfile=${font}:text='${esc(args.title)}':fontcolor=white:fontsize=${fsTitle}:` +
        `box=1:boxcolor=black@0.32:boxborderw=${Math.round(fsTitle * 0.6)}:` +
        `shadowcolor=black@0.6:shadowx=2:shadowy=2:alpha='${aTitle}':x=(w-text_w)/2:y=${Math.round(H * 0.72)}`,
    );
  }
  if (args.channel) {
    draws.push(
      `drawtext=fontfile=${font}:text='${esc(args.channel.toUpperCase())}':fontcolor=white@0.92:fontsize=${fsName}:` +
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
  const fontSize = Math.round(H * 0.053);
  const marginV = Math.round(H * 0.06);
  const sideM = Math.round(W * 0.08);
  const head =
    `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n` +
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
  const fontSize = Math.round(H * 0.053); // ~20% larger than before (was 0.044)
  const marginV = Math.round(H * 0.06);
  const sideM = Math.round(W * 0.08);
  const head =
    `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n` +
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
 * used by qa_refine to swap footage Gemini flagged as off-theme without
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
    execFile(
      FFMPEG,
      [
        "-v", "error", "-i", path,
        "-vf", `crop=iw*${wFrac}:ih:iw*${xFrac}:0,scale=1:1,format=gray`,
        "-f", "rawvideo", "-frames:v", "1", "-",
      ],
      { encoding: "buffer", maxBuffer: 4096 },
      (err, stdout) => {
        const buf = stdout as unknown as Buffer;
        if (err || !buf || buf.length === 0) return resolve(NaN);
        resolve(buf[0]);
      },
    );
  });
}

/**
 * Decide thumbnail base orientation from brightness: the marble subject belongs
 * on the RIGHT and the left text-zone must be dark. Returns whether to mirror
 * the base (flip) and whether the resulting left zone is clean enough to use.
 */
export async function planSubjectLayout(
  path: string,
): Promise<{ flip: boolean; leftZoneClean: boolean; left: number; right: number }> {
  const left = await regionLuma(path, 0, 0.45);
  const right = await regionLuma(path, 0.55, 0.45);
  const l = Number.isFinite(left) ? left : 0;
  const r = Number.isFinite(right) ? right : 0;
  const flip = l > r; // brighter (marble) side should end up on the RIGHT
  const futureLeft = Math.min(l, r); // the darker side becomes the text zone
  return { flip, leftZoneClean: futureLeft < 55, left: l, right: r };
}

/**
 * Per-column PEAK luminance across the TITLE vertical band, in ONE ffmpeg pass:
 * crop the band, squash to `n`×`rows` grayscale, then take the MAX over each
 * column's rows. Peak (not mean) so a single bright marble pixel — a lit cheek
 * over a dark, shadowed beard — still marks the column as "subject", which a
 * vertical average would dilute below threshold. `flip` mirrors the column order
 * to the FINAL (post-hflip) orientation.
 */
export async function columnBandLuma(
  path: string,
  opts: { n?: number; yFrac?: number; hFrac?: number; flip?: boolean; rows?: number } = {},
): Promise<number[]> {
  const n = opts.n ?? 64;
  const rows = opts.rows ?? 16;
  const yFrac = opts.yFrac ?? 0.28;
  const hFrac = opts.hFrac ?? 0.56;
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(
      FFMPEG,
      [
        "-v", "error", "-i", path,
        "-vf", `crop=iw:ih*${hFrac}:0:ih*${yFrac},scale=${n}:${rows},format=gray`,
        "-f", "rawvideo", "-frames:v", "1", "-",
      ],
      { encoding: "buffer", maxBuffer: 1 << 18 },
      (err, stdout) => {
        const buf = stdout as unknown as Buffer;
        if (err || !buf || buf.length < n * rows) return resolve([]);
        const cols = new Array<number>(n).fill(0);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < n; c++) {
            const v = buf[r * n + c];
            if (v > cols[c]) cols[c] = v;
          }
        }
        resolve(opts.flip ? cols.reverse() : cols);
      },
    );
  });
}

/**
 * Fraction-of-width at which the bright marble subject begins (scanning L→R in
 * the FINAL orientation), measured in the title band. The clear LEFT text zone is
 * everything before this. Returns 1.0 if no subject is found (whole band dark).
 * `thresh` is the luma above which a column counts as "subject" (marble ≈ 120+,
 * near-black bg < 40); a couple of consecutive bright columns are required so a
 * stray ember doesn't trip it.
 */
export async function subjectLeftEdgeFrac(
  path: string,
  opts: { flip?: boolean; thresh?: number } = {},
): Promise<number> {
  const n = 64;
  // Peak-based: bright marble peaks ~180-220, while volumetric haze / light dust
  // / god rays peak much lower — a high threshold keeps the atmosphere from being
  // mistaken for the statue's edge.
  const thresh = opts.thresh ?? 95;
  const cols = await columnBandLuma(path, { n, flip: opts.flip });
  if (cols.length < n) return 1.0; // measurement failed → caller falls back
  for (let i = 0; i < n - 1; i++) {
    if (cols[i] > thresh && cols[i + 1] > thresh) return i / n;
  }
  return 1.0;
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
const CLOUD_FONTS = {
  sans: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  serif: "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
};

export async function thumbnailText(args: {
  basePath: string;
  outJpg: string;
  title: string;
  /** Channel name shown small at the bottom. */
  subtitle?: string;
  /** Main title color (def white). */
  textColor?: string;
  textShadow?: boolean;
  /** Explicit font path (wins over `font`). */
  fontFile?: string;
  /** Font family preset → concrete cloud font. Def "sans" (heavier/bolder). */
  font?: "serif" | "sans";
  /** Uppercase the title for max impact (def true). */
  uppercase?: boolean;
}): Promise<string> {
  // BOLD, high-CTR overlay: large title in the reserved negative space, drawn
  // LINE BY LINE (an embedded newline renders as a tofu box on the cloud font),
  // with a thick black outline + drop shadow so it stays legible over bright OR
  // dark areas. The image carries the thumbnail; text is big but uncluttered.
  const font =
    args.fontFile ?? CLOUD_FONTS[args.font ?? "sans"] ?? CLOUD_FONTS.sans;
  const color = args.textColor ?? "white";
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’");

  // Word-wrap ~15 chars/line so a punchy 3-5 word title renders large.
  const raw = args.uppercase === false ? args.title.trim() : args.title.toUpperCase().trim();
  const words = raw.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 15 && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);

  // Scale font to line count; bigger = punchier.
  const size = lines.length >= 4 ? 64 : lines.length === 3 ? 80 : lines.length === 2 ? 96 : 110;
  const lineH = Math.round(size * 1.12);
  const block = lines.length * lineH;

  // Stack lines centered vertically around y=0.66h (sits in the lower-mid third).
  const draws: string[] = lines.map((ln, i) => {
    const y = `h*0.66-${Math.round(block / 2)}+${i * lineH}`;
    return (
      `drawtext=fontfile=${font}:text='${esc(ln)}':fontcolor=${color}:fontsize=${size}:` +
      `borderw=7:bordercolor=black:shadowcolor=black@0.9:shadowx=5:shadowy=5:x=(w-text_w)/2:y=${y}`
    );
  });
  if (args.subtitle) {
    draws.push(
      `drawtext=fontfile=${font}:text='${esc(args.subtitle.toUpperCase())}':fontcolor=white@0.9:fontsize=30:` +
        `borderw=2:bordercolor=black:shadowcolor=black@0.9:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.92`,
    );
  }

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

/** "#C8862E" → colorchannelmixer coeffs that tint WHITE → that color. */
function hexToMixer(hex: string): string {
  const h = hex.replace(/^#|^0x/i, "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return `rr=${r.toFixed(3)}:gg=${g.toFixed(3)}:bb=${b.toFixed(3)}`;
}

/**
 * "Option B" stoic-style thumbnail: a cinematic bust base + a left dark gradient
 * scrim (text contrast) + an amber PAINTERLY BRUSH SWASH behind the punch line
 * + a bold serif title in the clear left half + a bulleted accent tagline +
 * channel name + corner badge. The brush is a baked white-on-black asset, keyed
 * to alpha and tinted to the accent. Composition keeps all text off the subject.
 */
export async function thumbnailDesign(args: {
  basePath: string;
  outJpg: string;
  /** White-on-black brush swash PNG (src/assets/thumb_brush_swash.png). */
  brushPath: string;
  title: string;
  tagline?: string;
  channel?: string;
  badge?: string;
  /** Accent hex for the swash + tagline + badge (def amber). */
  accentHex?: string;
  font?: "serif" | "sans";
  /** Mirror the base so the subject sits on the RIGHT (text always on the left). */
  flipBase?: boolean;
  /**
   * Hard cap (px, in the 1280-wide canvas) on the title block width. Set this to
   * the measured clear gap (subject left edge − margin) so the title can NEVER
   * reach the statue/face. Defaults to 600; clamped to [240, 760].
   */
  maxTextW?: number;
}): Promise<{ outJpg: string; textRightPx: number; fits: boolean }> {
  const font = CLOUD_FONTS[args.font ?? "serif"] ?? CLOUD_FONTS.serif;
  const accent = args.accentHex ?? "#C8862E";
  const accentMix = hexToMixer(accent);
  const accentDraw = `0x${accent.replace(/^#|^0x/i, "")}`;
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’");

  // wrap uppercase title to the clear LEFT half (~13 chars/line)
  const words = args.title.toUpperCase().trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 10 && cur) {
      lines.push(cur.trim());
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  const n = lines.length;
  const X = 60;
  // HARD CONSTRAINT: the title must stay in the LEFT zone (never reach the
  // right-side statue). MAXW is the measured clear gap when supplied; shrink the
  // font so the widest line fits it.
  const MAXW = Math.max(240, Math.min(760, args.maxTextW ?? 600));
  const GLYPH = 0.6; // ~uppercase bold advance / fontsize
  const maxChars = Math.max(1, ...lines.map((l) => l.length));
  let size = n >= 4 ? 60 : n === 3 ? 74 : 98;
  const fitSize = Math.floor(MAXW / (maxChars * GLYPH));
  size = Math.max(46, Math.min(size, fitSize));
  // If even the 46px floor overflows the gap, the title CANNOT fit without
  // touching the subject — report it so the caller regenerates a wider base.
  const fits = fitSize >= 46;
  const textRightPx = X + Math.round(maxChars * size * GLYPH);
  const lineH = Math.round(size * 1.12);
  const lastTop = 452;
  const topY = (i: number) => lastTop - (n - 1 - i) * lineH;
  const hotIdx = n - 1;
  const wordW = (s: string) => Math.round(s.length * size * GLYPH);

  // swash behind the punch (last) line
  const hw = Math.min(MAXW, wordW(lines[hotIdx]) + 60);
  const hh = size + 36;
  const hx = X - 24;
  const hy = topY(hotIdx) - 14;

  const parts: string[] = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720${args.flipBase ? ",hflip" : ""}[bg]`,
    `[1:v]format=rgba[scrim]`,
    `[bg][scrim]overlay=0:0[b1]`,
    `[2:v]format=rgba,lumakey=threshold=0.10:tolerance=0.12,colorchannelmixer=${accentMix}[brush]`,
    `[brush]scale=${hw}:${hh}[swash]`,
    `[b1][swash]overlay=${hx}:${hy}[b2]`,
  ];
  const draws: string[] = lines.map((ln, i) =>
    `drawtext=fontfile=${font}:text='${esc(ln)}':fontcolor=white:fontsize=${size}:` +
    `borderw=8:bordercolor=black:shadowcolor=black@0.9:shadowx=5:shadowy=6:x=${X}:y=${topY(i)}`,
  );
  if (args.tagline) {
    draws.push(
      `drawtext=fontfile=${font}:text='${esc(args.tagline.toUpperCase())}':fontcolor=${accentDraw}:fontsize=28:` +
        `borderw=2:bordercolor=black:shadowcolor=black@0.85:shadowx=2:shadowy=2:x=${X}:y=${lastTop + size + 20}`,
    );
  }
  if (args.channel) {
    draws.push(
      `drawtext=fontfile=${font}:text='${esc(args.channel)}':fontcolor=white@0.92:fontsize=27:` +
        `borderw=2:bordercolor=black:shadowcolor=black@0.85:shadowx=2:shadowy=2:x=w-text_w-34:y=672`,
    );
  }
  if (args.badge) {
    draws.push(`drawbox=x=iw-112:y=22:w=82:h=42:color=${accentDraw}@0.95:t=fill`);
    draws.push(
      `drawtext=fontfile=${font}:text='${esc(args.badge)}':fontcolor=white:fontsize=25:` +
        `x=w-112+(82-text_w)/2:y=22+(42-text_h)/2`,
    );
  }
  parts.push(`[b2]${draws.join(",")}[vout]`);

  await run(FFMPEG, [
    "-y",
    "-i",
    args.basePath,
    "-f",
    "lavfi",
    "-i",
    "gradients=s=1280x720:c0=0x000000FA:c1=0x00000000:x0=0:y0=360:x1=760:y1=360",
    "-i",
    args.brushPath,
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[vout]",
    "-frames:v",
    "1",
    "-update",
    "1",
    "-q:v",
    "2",
    args.outJpg,
  ]);
  return { outJpg: args.outJpg, textRightPx, fits };
}

/**
 * thumbnailDesign + the DETERMINISTIC overlap guard in one call (shared by the
 * render pipeline AND the week-ahead planner so both get identical protection).
 * Measures the subject's left edge, caps the title to the clear gap, composes,
 * then reports whether the title sits CLEAR of the subject. Caller regenerates a
 * wider base when `clear` is false.
 */
export async function guardedThumbnailDesign(
  args: Omit<Parameters<typeof thumbnailDesign>[0], "maxTextW">,
): Promise<{ outJpg: string; fits: boolean; clear: boolean; textRightPx: number; subjectLeftPx: number }> {
  const X = 60;
  const MARGIN = 44;
  const frac = await subjectLeftEdgeFrac(args.basePath, { flip: args.flipBase });
  // If the subject can't be located, assume a conservative edge so text stays narrow.
  const subjectLeftPx = frac >= 1 ? 660 : Math.round(frac * 1280);
  const maxTextW = subjectLeftPx - X - MARGIN;
  const d = await thumbnailDesign({ ...args, maxTextW });
  const clear = d.fits && d.textRightPx <= subjectLeftPx - MARGIN;
  return { outJpg: d.outJpg, fits: d.fits, clear, textRightPx: d.textRightPx, subjectLeftPx };
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
