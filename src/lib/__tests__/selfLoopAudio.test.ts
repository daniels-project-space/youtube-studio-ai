/**
 * Regression guard for selfLoopAudio().
 *
 * The single-pass filtergraph this replaced fed `acrossfade` from two `atrim`
 * branches of the SAME decoded input. That graph starves — acrossfade must
 * drain its first input to EOF before emitting anything — so ffmpeg wrote a
 * ~1KB header-only mp3 with ZERO audio frames AND STILL EXITED 0. Nothing threw,
 * the function logged success, and the caller reassigned its good ~2.5MB mix to
 * the corrupt path, which then flowed into assembly and R2 for every real lofi
 * channel.
 *
 * These tests therefore assert the OUTPUT, not the exit code: real byte size,
 * decode-accurate duration, and actual audio energy, at several durations.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { MusicError, selfLoopAudio } from "@/lib/music";

const execFileP = promisify(execFile);
const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

/** Synthesize a sine-wave mp3 of the given length. */
async function synth(path: string, seconds: number): Promise<void> {
  await execFileP(FFMPEG, [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-c:a", "libmp3lame", "-b:a", "320k", "-ar", "44100",
    path,
  ]);
}

/** Decode-accurate duration (never trusts the mp3 bitrate estimate). */
async function trueDuration(path: string): Promise<number> {
  const { stdout } = await execFileP(
    FFMPEG,
    ["-v", "error", "-stats_period", "5", "-i", path, "-f", "null", "-", "-progress", "pipe:1"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  let seconds = 0;
  for (const m of String(stdout).matchAll(/^out_time_us=(\d+)$/gm)) {
    seconds = Math.max(seconds, Number(m[1]) / 1_000_000);
  }
  return seconds;
}

/** Peak/mean volume in dB — proves the file carries real audio, not silence. */
async function volume(path: string): Promise<{ mean: number; max: number }> {
  const { stderr } = await execFileP(
    FFMPEG,
    ["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr)?.[1];
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr)?.[1];
  assert.ok(mean && max, `volumedetect produced no levels for ${path}`);
  return { mean: Number(mean), max: Number(max) };
}

/**
 * Decode to raw mono f32 and compare the loop wrap-around step (last sample →
 * first sample) against the file's own p99 adjacent-sample step. A seamless
 * loop keeps the two in the same order of magnitude.
 */
async function seamContinuity(path: string): Promise<{ seamDelta: number; p99Delta: number }> {
  const { stdout } = await execFileP(
    FFMPEG,
    ["-v", "error", "-i", path, "-ac", "1", "-ar", "44100", "-f", "f32le", "pipe:1"],
    { maxBuffer: 512 * 1024 * 1024, encoding: "buffer" },
  );
  const buf = stdout as unknown as Buffer;
  const n = Math.floor(buf.length / 4);
  assert.ok(n > 44100, `seamContinuity: ${path} decoded to only ${n} samples`);
  const deltas: number[] = [];
  let prev = buf.readFloatLE(0);
  const first = prev;
  for (let i = 1; i < n; i++) {
    const cur = buf.readFloatLE(i * 4);
    deltas.push(Math.abs(cur - prev));
    prev = cur;
  }
  deltas.sort((a, b) => a - b);
  return {
    seamDelta: Math.abs(first - prev), // prev is now the last sample
    p99Delta: deltas[Math.floor(deltas.length * 0.99)],
  };
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "selfloop-test-"));
  try {
    const fade = 2; // default crossfadeSec

    // ---- the corruption regression, at every duration the bug was seen at ----
    for (const seconds of [10, 30, 60, 100]) {
      const inPath = join(dir, `in${seconds}.mp3`);
      const outPath = join(dir, `out${seconds}.mp3`);
      await synth(inPath, seconds);

      const returned = await selfLoopAudio(inPath, outPath);
      assert.equal(returned, outPath, `${seconds}s: should fold, not pass through`);

      // 1. NOT the ~1KB header-only mux the old graph produced.
      const bytes = (await stat(outPath)).size;
      assert.ok(
        bytes > 16 * 1024,
        `${seconds}s: output is ${bytes}B — corrupt/empty mux regression`,
      );

      // 2. Duration is D - fade (the acrossfade contract), decode-measured.
      const inSec = await trueDuration(inPath);
      const outSec = await trueDuration(outPath);
      const expected = inSec - fade;
      assert.ok(
        Math.abs(outSec - expected) <= Math.max(0.5, expected * 0.02),
        `${seconds}s: output ${outSec.toFixed(2)}s != expected ${expected.toFixed(2)}s ` +
          `(crossfade seam would have a gap or overlap)`,
      );

      // 3. Byte size tracks the duration at 320kbps (~40KB/s) — a file that is
      //    long but silent/zero-filled would fail this.
      assert.ok(
        bytes > outSec * 20_000,
        `${seconds}s: ${bytes}B is too small for ${outSec.toFixed(1)}s of 320k audio`,
      );

      // 4. Real audio energy, not digital silence.
      const { mean, max } = await volume(outPath);
      assert.ok(max > -40, `${seconds}s: max_volume ${max}dB — output is effectively silent`);
      assert.ok(mean > -60, `${seconds}s: mean_volume ${mean}dB — output is effectively silent`);

      // 5. THE POINT OF THE WHOLE FUNCTION: on `-stream_loop` the last sample is
      //    followed by the first, so the wrap-around delta must be no larger
      //    than an ordinary adjacent-sample step. Slicing the compressed mp3
      //    instead of the decoded WAV puts this at ~11x (an audible click).
      const { seamDelta, p99Delta } = await seamContinuity(outPath);
      assert.ok(
        seamDelta <= p99Delta * 3,
        `${seconds}s: loop seam delta ${seamDelta.toFixed(6)} vs p99 adjacent ` +
          `${p99Delta.toFixed(6)} — discontinuity at the loop point`,
      );
    }

    // ---- an unprovable short track must fail closed ----
    const shortIn = join(dir, "short.mp3");
    await synth(shortIn, 5); // 5s < fade*4 = 8s
    await assert.rejects(
      selfLoopAudio(shortIn, join(dir, "short-out.mp3")),
      (e: unknown) =>
        e instanceof MusicError && /too short to establish seamless loop continuity/i.test(e.message),
      "sub-4x-fade tracks must not become hard-spliced loop beds",
    );

    // ---- an unreadable input must THROW, never return a path ----
    const bogus = join(dir, "bogus.mp3");
    await writeFile(bogus, Buffer.from("not audio at all"));
    await assert.rejects(
      selfLoopAudio(bogus, join(dir, "bogus-out.mp3")),
      (e: unknown) => e instanceof MusicError,
      "unreadable input must raise MusicError instead of returning a bad path",
    );

    // ---- a missing input must THROW ----
    await assert.rejects(
      selfLoopAudio(join(dir, "does-not-exist.mp3"), join(dir, "missing-out.mp3")),
      (e: unknown) => e instanceof MusicError,
      "missing input must raise MusicError",
    );

    console.log("selfLoopAudio.test.ts: all assertions passed");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
