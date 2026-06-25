/**
 * Assembly OVERLAY smoke render — proves the REAL ffmpeg RenderBackend burns
 * CAPTIONS into a finished video, hermetically (no Remotion, no R2, no network).
 *
 * Captions are pure ffmpeg (libass) → fully hermetic. Quotes/inserts need a
 * Remotion-rendered alpha card, so they are DELIBERATELY excluded here (left to
 * the real-render parity step). This smoke only exercises the caption path of
 * applyOverlays → applyOverlaysAndCaptions / writeCaptionsAss.
 *
 *   1. Synthesize 3 testsrc2 clips + narration + music (same as assembly-smoke).
 *   2. planTimeline() with NO cards (introCardSrc:"", tailSec:1) BUT inject 2
 *      CAPTION overlays (text + start/end inside the runtime).
 *   3. renderTimeline() through createFfmpegBackend (local cache/publish fallback).
 *   4. Assert: valid mp4, duration ≈ projected (±2s), receipt.overlaysApplied >= 2.
 *
 * Run: ./node_modules/.bin/tsx scripts/assembly-smoke-overlays.ts
 */
import { execFile } from "node:child_process";
import { mkdtemp, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planTimeline, ASSEMBLE_DEFAULTS } from "@/lib/assembly/planTimeline";
import { renderTimeline } from "@/lib/assembly/renderTimeline";
import { projectedDurationSec, type Overlay } from "@/lib/assembly/timeline";
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

  const timeline = planTimeline(
    { footageClips: clips, narrationDurationSec: 30, narrationSrc, musicSrc, introCardSrc: "", overlays },
    { ...ASSEMBLE_DEFAULTS, tailSec: 1 },
  );
  const cardCount = timeline.segments.filter((s) => s.kind === "card").length;
  if (cardCount !== 0) throw new Error(`ov-smoke expected 0 cards (hermetic) — got ${cardCount}`);
  if (timeline.overlays.length !== 2) throw new Error(`ov-smoke expected 2 overlays — got ${timeline.overlays.length}`);
  const projected = projectedDurationSec(timeline);
  console.log(`[ov-smoke] plan: ${timeline.segments.length} segments, ${timeline.overlays.length} caption overlay(s), projected ${projected.toFixed(2)}s`);

  const backend = createFfmpegBackend({
    runId: "ov-smoke", keyPrefix: "ov-smoke/", tmpDir: tmp, localFallbackDir: join(tmp, "local-cache"),
  });
  console.log("[ov-smoke] rendering (with caption burn-in)…");
  const receipt = await renderTimeline(timeline, backend);

  const localOut = receipt.videoLocalPath;
  if (!localOut || !existsSync(localOut)) throw new Error(`no output file at ${localOut}`);
  const dur = await probeDuration(localOut);
  const size = (await stat(localOut)).size;
  const delta = Math.abs(dur - projected);

  console.log("\n===== OVERLAY SMOKE RESULT =====");
  console.log(`output:          ${localOut}`);
  console.log(`duration:        ${dur.toFixed(2)}s  (projected ${projected.toFixed(2)}s, Δ ${delta.toFixed(2)}s)`);
  console.log(`file size:       ${(size / 1024).toFixed(1)} KiB`);
  console.log(`overlaysApplied: ${receipt.overlaysApplied}`);
  console.log(`warnings:        ${JSON.stringify(receipt.warnings)}`);

  const pass = delta <= 2 && size > 1024 && receipt.overlaysApplied >= 2;
  console.log(`\n${pass ? "PASS ✅" : "FAIL ❌"} — duration ±2s, file > 1 KiB, ≥2 captions burned`);
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error("[ov-smoke] ERROR:", e);
  process.exit(1);
});
