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
  preset?: string;
}): Promise<string> {
  const { clipPaths, targetSec, tmpDir } = args;
  if (clipPaths.length === 0) throw new FfmpegError("assembleBeatBody: no clips");
  const W = args.width ?? 1920;
  const H = args.height ?? 1080;
  const fps = args.fps ?? 30;
  const maxSeg = args.maxSegSec ?? 10;

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
    segLen = Math.min(segLen, dur); // never exceed the clip's real length
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
  // Per-clip reuse counter: when the pool wraps, each reuse takes a DIFFERENT
  // window of the clip instead of re-cutting the identical opening (visible
  // duplicate segments — the defect the beat body already guards against).
  const useCount = new Map<number, number>();
  const cut = async (input: string, dur: number, ssSec = 0) => {
    const sf = join(args.tmpDir, `sbody_${sj++}.mp4`);
    await run(FFMPEG, [
      "-y", ...(ssSec > 0.01 ? ["-ss", ssSec.toFixed(3)] : []), "-i", input,
      "-t", dur.toFixed(3), "-vf", scalePad, "-an",
      "-c:v", "libx264", "-preset", args.preset ?? "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", sf,
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
        await cut(clip, seg, Math.min(ss, head));
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
 * Bold title overlay for the real-scene thumbnail path (a styled headline over
 * the run's own keyframe still), with a strong outline (and optional drop
 * shadow) so it stays legible at small size. Pure ffmpeg, $0. Auto-wraps to
 * ~14 chars/line so ≤8-word titles fit.
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
