/**
 * Assembly smoke render — proves the REAL ffmpeg RenderBackend emits a valid
 * video, hermetically (no Remotion, no R2, no network).
 *
 *   1. Synthesize local assets with ffmpeg: 3 distinct testsrc2 clips (~10s),
 *      one narration (sine, ~30s), one music bed (sine, ~40s).
 *   2. planTimeline() with NO intro card (introCardSrc:"") and tailSec:1 (<2 ⇒
 *      NO outro card) so the plan has ZERO cards — exercises buildBody +
 *      composeIntro + publish on pure ffmpeg, never touching Remotion/Chromium.
 *   3. renderTimeline() through createFfmpegBackend with a LOCAL cache/publish
 *      fallback (the backend auto-detects missing R2_* env and writes to disk).
 *   4. Probe the output, assert duration ≈ projectedDurationSec(timeline) (±2s),
 *      print duration + file size + the Receipt.
 *
 * Run: ./node_modules/.bin/tsx scripts/assembly-smoke.ts
 */
import { execFile } from "node:child_process";
import { mkdtemp, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planTimeline, ASSEMBLE_DEFAULTS } from "@/lib/assembly/planTimeline";
import { renderTimeline } from "@/lib/assembly/renderTimeline";
import { projectedDurationSec } from "@/lib/assembly/timeline";
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

/** A distinct ~`sec`s testsrc2 clip (different `rate`/`size` so clips differ). */
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

/** A ~`sec`s tone (stands in for narration / music). */
async function makeAudio(out: string, sec: number, freq: number): Promise<string> {
  await sh(FFMPEG, [
    "-y", "-f", "lavfi", "-i", `sine=frequency=${freq}:sample_rate=44100:duration=${sec}`,
    "-t", String(sec), "-c:a", "aac", "-b:a", "128k", out,
  ]);
  return out;
}

async function main() {
  const tmp = await mkdtemp(join(tmpdir(), "assembly-smoke-"));
  console.log(`[smoke] tmp dir: ${tmp}`);
  const hasR2 = Boolean(process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT);
  console.log(`[smoke] R2 env present: ${hasR2} → ${hasR2 ? "publishing to R2" : "LOCAL fallback (hermetic)"}`);

  // 1. synthetic assets
  console.log("[smoke] generating synthetic assets…");
  const clips = await Promise.all([
    makeClip(join(tmp, "clip1.mp4"), 10, 1),
    makeClip(join(tmp, "clip2.mp4"), 10, 2),
    makeClip(join(tmp, "clip3.mp4"), 10, 3),
  ]);
  const narrationSrc = await makeAudio(join(tmp, "narration.m4a"), 30, 220);
  const musicSrc = await makeAudio(join(tmp, "music.m4a"), 40, 110);

  // 2. plan: no intro card (introCardSrc ""), tailSec 1 (<2 ⇒ no outro card)
  const timeline = planTimeline(
    {
      footageClips: clips,
      narrationDurationSec: 30,
      narrationSrc,
      musicSrc,
      introCardSrc: "",
      overlays: [],
    },
    { ...ASSEMBLE_DEFAULTS, tailSec: 1 },
  );
  const cardCount = timeline.segments.filter((s) => s.kind === "card").length;
  const clipCount = timeline.segments.filter((s) => s.kind !== "card").length;
  console.log(`[smoke] plan: ${timeline.segments.length} segments (${clipCount} clips, ${cardCount} cards), ` +
    `format ${timeline.format.w}x${timeline.format.h}@${timeline.format.fps}`);
  if (cardCount !== 0) throw new Error(`smoke expected 0 cards (hermetic, no Remotion) — got ${cardCount}`);
  const projected = projectedDurationSec(timeline);
  console.log(`[smoke] projected duration: ${projected.toFixed(2)}s`);

  // 3. render through the real ffmpeg backend (local cache/publish fallback)
  const backend = createFfmpegBackend({
    runId: "smoke",
    keyPrefix: "smoke/",
    tmpDir: tmp,
    localFallbackDir: join(tmp, "local-cache"),
  });
  console.log("[smoke] rendering…");
  const receipt = await renderTimeline(timeline, backend);

  // 4. probe + assert
  const localOut = receipt.videoLocalPath;
  if (!localOut || !existsSync(localOut)) throw new Error(`no output file at ${localOut}`);
  const dur = await probeDuration(localOut);
  const size = (await stat(localOut)).size;
  const delta = Math.abs(dur - projected);

  console.log("\n===== SMOKE RESULT =====");
  console.log(`output:    ${localOut}`);
  console.log(`videoKey:  ${receipt.videoKey}`);
  console.log(`duration:  ${dur.toFixed(2)}s  (projected ${projected.toFixed(2)}s, Δ ${delta.toFixed(2)}s)`);
  console.log(`file size: ${(size / 1024).toFixed(1)} KiB`);
  console.log(`receipt:   ${JSON.stringify(receipt, null, 2)}`);

  const pass = delta <= 2 && size > 1024;
  console.log(`\n${pass ? "PASS ✅" : "FAIL ❌"} — duration within ±2s and file > 1 KiB`);
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error("[smoke] ERROR:", e);
  process.exit(1);
});
