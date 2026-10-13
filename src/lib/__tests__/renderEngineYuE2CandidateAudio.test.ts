import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { decodeRenderEngineYuE2Flac, inspectRenderEngineYuE2Flac } from "@/lib/renderEngineYuE2Candidate";
import { probeYuE2NativeWav } from "@/lib/yue2NativeAudio";

const execFileP = promisify(execFile);

test("verified Engine FLAC decodes to exact-frame native float WAV", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-yue2-audio-test-"));
  const flacPath = join(directory, "source.flac"), wavPath = join(directory, "decoded.wav");
  try {
    await execFileP(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-nostdin", "-y", "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-ac", "2", "-c:a", "flac", "-sample_fmt", "s32",
      "-bits_per_raw_sample", "24", flacPath], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const flac = new Uint8Array(await readFile(flacPath));
    const frames = inspectRenderEngineYuE2Flac(flac, 2);
    assert.equal(frames, 48_000);
    const wav = await decodeRenderEngineYuE2Flac(flac, frames);
    await writeFile(wavPath, wav, { mode: 0o600 });
    await probeYuE2NativeWav(wavPath, { frames }, wav.byteLength);
    await assert.rejects(Promise.resolve().then(() => inspectRenderEngineYuE2Flac(flac, 0.5)), /outside the pinned/);
    await assert.rejects(Promise.resolve().then(() => inspectRenderEngineYuE2Flac(new Uint8Array([1, 2, 3]), 1)), /not bounded FLAC/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
