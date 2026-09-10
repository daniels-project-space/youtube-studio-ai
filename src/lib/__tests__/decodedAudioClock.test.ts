import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeDecodedAudioSamples } from "../ffmpeg";

/** The decoded clock is deliberately exercised with real FFmpeg media, not a mocked probe. */
const root = mkdtempSync(join(tmpdir(), "ysa-decoded-audio-clock-"));
function makeMp3(name: string, durationSec: string): string {
  const path = join(root, name);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${durationSec}`,
    "-c:a", "libmp3lame", "-ar", "44100", "-b:a", "128k", path]);
  return path;
}

async function main() {
  try {
    const one = await probeDecodedAudioSamples(makeMp3("one.mp3", "1.0"));
    const fractional = await probeDecodedAudioSamples(makeMp3("fractional.mp3", "0.75"));
    assert.deepEqual({ sampleRate: one.sampleRate, sampleCount: one.sampleCount, hasAudio: one.hasAudio }, { sampleRate: 44100, sampleCount: 44100, hasAudio: true });
    assert.equal(fractional.sampleRate, 44100);
    assert.equal(fractional.sampleCount, 33075, "decoded samples must preserve the source timeline, independent of MP3 container padding");
    assert.equal(one.durationSec, one.sampleCount / one.sampleRate);
    assert.equal(fractional.durationSec, fractional.sampleCount / fractional.sampleRate);
    console.log(JSON.stringify({ decodedAudioClock: "PASS", one, fractional, providerCalls: 0 }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
