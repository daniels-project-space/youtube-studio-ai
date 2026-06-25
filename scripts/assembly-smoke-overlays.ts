/**
 * Assembly APPLY smoke render — proves the REAL ffmpeg RenderBackend actually
 * APPLIES the carried knobs (not just declares them), hermetically (no Remotion,
 * no R2, no network):
 *   • targetLufs   → a real loudnorm normalize pass runs after compose
 *   • captionStyle → restyles the caption ASS (and "none" suppresses the burn)
 *   • transitions  → dip_to_black branches to a fade-to-black (not an xfade)
 *
 * Captions are pure ffmpeg (libass) → fully hermetic. Quotes/inserts need a
 * Remotion-rendered alpha card, so they are DELIBERATELY excluded here (left to
 * the real-render parity step). This smoke exercises the caption path of
 * applyOverlays → applyOverlaysAndCaptions, the loudnorm path, and the style map.
 *
 *   1. Synthesize 3 testsrc2 clips + narration + music (same as assembly-smoke).
 *   2. planTimeline() with NO cards (introCardSrc:"", tailSec:1) BUT inject 2
 *      CAPTION overlays, then attach audio.targetLufs:-16 + renderHints.captionStyle:"bold".
 *   3. renderTimeline() through an INSTRUMENTED createFfmpegBackend wrapper that
 *      records whether normalizeLoudness + applyOverlays actually ran.
 *   4. Assert: valid mp4, duration ≈ projected (±2s), overlaysApplied>=2, loudnorm
 *      ran (audio re-encoded to aac + method invoked), caption pass ran, and that
 *      two caption styles produce DIFFERENT ASS (bold vs minimal).
 *
 * Run: ./node_modules/.bin/tsx scripts/assembly-smoke-overlays.ts
 */
import { execFile } from "node:child_process";
import { mkdtemp, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planTimeline, ASSEMBLE_DEFAULTS } from "@/lib/assembly/planTimeline";
import { renderTimeline, type RenderBackend } from "@/lib/assembly/renderTimeline";
import { projectedDurationSec, type Overlay, type Timeline } from "@/lib/assembly/timeline";
import { createFfmpegBackend } from "@/lib/assembly/ffmpegBackend";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN ?? "ffprobe";

function sh(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 32 * 1024 * 1024 }, (err, _o, stderr) =>
      err ? reject(new Error(`${bin} failed: ${(stderr || "").slice(-400)}`)) : resolve(),
    );
  });
}

async function probeDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
      (err, stdout) => (err ? reject(err) : resolve(Number((stdout || "").trim()))),
    );
  });
}

/** Probe the audio codec of a file (loudnorm pass re-encodes audio → aac). */
async function probeAudioCodec(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      FFPROBE,
      ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", path],
      (err, stdout) => (err ? reject(err) : resolve((stdout || "").trim())),
    );
  });
}

async function makeClip(out: string, sec: number, variant: number): Promise<string> {
  await sh(FFMPEG, [
    "-y", "-f", "lavfi",
    "-i", `testsrc2=size=1280x720:rate=30:duration=${sec}`,
    "-vf", `hue=h=${variant * 80}:s=1,drawtext=text='CLIP ${variant}':fontcolor=white:fontsize=64:x=(w-tw)/2:y=(h-th)/2`,
    "-t", String(sec), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-an",
    out,
  ]);
  return out;
}

async function makeAudio(out: string, sec: number, freq: number): Promise<string> {
  await sh(FFMPEG, [
    "-y", "-f", "lavfi", "-i", `sine=frequency=${freq}:sample_rate=44100:duration=${sec}`,
    "-t", String(sec), "-c:a", "aac", "-b:a", "128k", out,
  ]);
  return out;
}

async function main() {
  const tmp = await mkdtemp(join(tmpdir(), "assembly-smoke-ov-"));
  console.log(`[ov-smoke] tmp dir: ${tmp}`);
  const hasR2 = Boolean(process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT);
  console.log(`[ov-smoke] R2 env present: ${hasR2} → ${hasR2 ? "publishing to R2" : "LOCAL fallback (hermetic)"}`);

  console.log("[ov-smoke] generating synthetic assets…");
  const clips = await Promise.all([
    makeClip(join(tmp, "clip1.mp4"), 10, 1),
    makeClip(join(tmp, "clip2.mp4"), 10, 2),
    makeClip(join(tmp, "clip3.mp4"), 10, 3),
  ]);
  const narrationSrc = await makeAudio(join(tmp, "narration.m4a"), 30, 220);
  const musicSrc = await makeAudio(join(tmp, "music.m4a"), 40, 110);

  // 2 CAPTION overlays — text + windows inside the 31s runtime (introSec 0 + body 30 + tail 1).
  const overlays: Overlay[] = [
    { kind: "caption", startSec: 3, endSec: 8, text: "Captions are pure ffmpeg" },
    { kind: "caption", startSec: 12, endSec: 18, text: "Hermetically burned via libass" },
  ];

  const planned = planTimeline(
    { footageClips: clips, narrationDurationSec: 30, narrationSrc, musicSrc, introCardSrc: "", overlays },
    { ...ASSEMBLE_DEFAULTS, tailSec: 1 },
  );
  // Attach the two knobs under test: a YouTube-ish loudness target + a BOLD caption style.
  const timeline: Timeline = {
    ...planned,
    audio: { ...planned.audio, targetLufs: -16 },
    renderHints: { ...(planned.renderHints ?? {}), captionStyle: "bold" },
  };
  const cardCount = timeline.segments.filter((s) => s.kind === "card").length;
  if (cardCount !== 0) throw new Error(`ov-smoke expected 0 cards (hermetic) — got ${cardCount}`);
  if (timeline.overlays.length !== 2) throw new Error(`ov-smoke expected 2 overlays — got ${timeline.overlays.length}`);
  if (timeline.audio.targetLufs !== -16) throw new Error(`ov-smoke targetLufs not threaded — got ${timeline.audio.targetLufs}`);
  if (timeline.renderHints?.captionStyle !== "bold") throw new Error(`ov-smoke captionStyle not threaded`);
  const projected = projectedDurationSec(timeline);
  console.log(`[ov-smoke] plan: ${timeline.segments.length} segments, ${timeline.overlays.length} caption overlay(s), targetLufs ${timeline.audio.targetLufs}, captionStyle ${timeline.renderHints?.captionStyle}, projected ${projected.toFixed(2)}s`);

  // INSTRUMENT the real backend so we can prove the carried knobs actually invoked
  // their methods (not just that the pipeline produced *a* file).
  const real = createFfmpegBackend({
    runId: "ov-smoke", keyPrefix: "ov-smoke/", tmpDir: tmp, localFallbackDir: join(tmp, "local-cache"),
  });
  const ran = { loudnorm: false, overlays: false, loudnormLufs: NaN, captionStyle: "" as string | undefined };
  const backend: RenderBackend = {
    ...real,
    async applyOverlays(base, ovs, fmt, o) {
      ran.overlays = true;
      ran.captionStyle = o?.captionStyle;
      return real.applyOverlays(base, ovs, fmt, o);
    },
    async normalizeLoudness(p, lufs) {
      ran.loudnorm = true;
      ran.loudnormLufs = lufs;
      return real.normalizeLoudness!(p, lufs);
    },
  };

  console.log("[ov-smoke] rendering (caption burn-in + loudnorm)…");
  const receipt = await renderTimeline(timeline, backend);

  const localOut = receipt.videoLocalPath;
  if (!localOut || !existsSync(localOut)) throw new Error(`no output file at ${localOut}`);
  const dur = await probeDuration(localOut);
  const size = (await stat(localOut)).size;
  const delta = Math.abs(dur - projected);
  // loudnorm re-encodes audio to aac — a probe-level fingerprint the pass actually ran.
  const acodec = await probeAudioCodec(localOut);

  // Prove ≥2 caption styles produce DIFFERENT output: render two styled ASS files
  // (bold vs minimal) over the SAME cues and diff their content. Different font
  // size / outline / weight ⇒ different ffmpeg input ⇒ different render.
  const boldBackend = createFfmpegBackend({ runId: "ov-style-bold", keyPrefix: "s1/", tmpDir: tmp, localFallbackDir: join(tmp, "lc1") });
  const minBackend = createFfmpegBackend({ runId: "ov-style-min", keyPrefix: "s2/", tmpDir: tmp, localFallbackDir: join(tmp, "lc2") });
  // Run applyOverlays for each style on the (already composed+loudnormed) output;
  // then read back the two captions_*.ass files the styled writer emitted.
  await boldBackend.applyOverlays(localOut, timeline.overlays, timeline.format, { captionStyle: "bold" });
  await minBackend.applyOverlays(localOut, timeline.overlays, timeline.format, { captionStyle: "minimal" });
  const boldAss = await readFile(join(tmp, "captions_bold.ass"), "utf8").catch(() => "");
  const minAss = await readFile(join(tmp, "captions_minimal.ass"), "utf8").catch(() => "");
  const styleLine = (ass: string) => (ass.split("\n").find((l) => l.startsWith("Style:")) ?? "");
  const boldStyle = styleLine(boldAss);
  const minStyle = styleLine(minAss);
  // Strong proof: the V4+ Style line itself (font size / weight / outline) must
  // differ — not just incidental whole-file bytes.
  const stylesDiffer = boldStyle.length > 0 && minStyle.length > 0 && boldStyle !== minStyle;

  console.log("\n===== APPLY SMOKE RESULT =====");
  console.log(`output:           ${localOut}`);
  console.log(`duration:         ${dur.toFixed(2)}s  (projected ${projected.toFixed(2)}s, Δ ${delta.toFixed(2)}s)`);
  console.log(`file size:        ${(size / 1024).toFixed(1)} KiB`);
  console.log(`audio codec:      ${acodec}  (loudnorm pass re-encodes → aac)`);
  console.log(`overlaysApplied:  ${receipt.overlaysApplied}`);
  console.log(`loudnorm ran:     ${ran.loudnorm} (target ${ran.loudnormLufs} LUFS)`);
  console.log(`overlay ran:      ${ran.overlays} (captionStyle=${ran.captionStyle})`);
  console.log(`styles differ:    ${stylesDiffer}`);
  console.log(`  bold Style:     ${boldStyle}`);
  console.log(`  minimal Style:  ${minStyle}`);

  // ---- dip_to_black ≠ crossfade proof ----
  // Compose the SAME inputs twice through the real backend's composeIntro: once as
  // crossfade, once as dip_to_black. With no intro card the only divergence is the
  // dedicated dip post-pass (fade down/up to black) → the two files MUST differ,
  // proving the transition TYPE actually branches (not just the seconds).
  const tBackend = createFfmpegBackend({ runId: "ov-trans", keyPrefix: "t/", tmpDir: tmp, localFallbackDir: join(tmp, "lct") });
  const composeArgs = {
    bodyPath: clips[0], musicSrc, introSec: 0, bodySec: 8, tailSec: 1,
    fadeOutSec: 0, audioFadeOutSec: 0, introMusicVol: 0.5, bodyMusicVol: 0.12,
    musicDuckRampSec: 3, crossfadeSec: 0.8, fmt: timeline.format,
  };
  const xfadePath = await tBackend.composeIntro({ ...composeArgs, transition: "crossfade" });
  const dipPath = await tBackend.composeIntro({ ...composeArgs, transition: "dip_to_black" });
  const [xfSize, dipSize] = [(await stat(xfadePath)).size, (await stat(dipPath)).size];
  // The dip pass re-encodes with extra fade filters; the resulting bytes differ.
  const transitionBranches = xfadePath !== dipPath && xfSize > 1024 && dipSize > 1024 && xfSize !== dipSize;
  console.log(`transition branch:${transitionBranches} (xfade ${(xfSize / 1024).toFixed(1)}KiB vs dip ${(dipSize / 1024).toFixed(1)}KiB)`);
  console.log(`warnings:         ${JSON.stringify(receipt.warnings)}`);

  const checks = {
    durationOk: delta <= 2,
    fileOk: size > 1024,
    captionsBurned: receipt.overlaysApplied >= 2,
    loudnormRan: ran.loudnorm && ran.loudnormLufs === -16,
    loudnormFingerprint: acodec === "aac",
    overlayRan: ran.overlays && ran.captionStyle === "bold",
    stylesDiffer,
    transitionBranches,
  };
  const pass = Object.values(checks).every(Boolean);
  console.log(`\nchecks: ${JSON.stringify(checks)}`);
  console.log(`${pass ? "PASS ✅" : "FAIL ❌"} — valid+right-length output, ≥2 captions burned, loudnorm ran (-16 LUFS, aac), bold caption pass ran, styles differ`);
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error("[ov-smoke] ERROR:", e);
  process.exit(1);
});
