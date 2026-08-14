import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { measureNarrationMixCorrelation } from "@/lib/ffmpeg";

const execFile = promisify(execFileCallback);

async function ffmpeg(args: string[]): Promise<void> {
  await execFile("ffmpeg", ["-hide_banner", "-y", ...args], { maxBuffer: 1 << 20 });
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "youtube-narration-mix-"));
  try {
  const narration = join(dir, "narration.wav");
  const mixedMaster = join(dir, "mixed-master.wav");
  const unrelatedMaster = join(dir, "unrelated-master.wav");
  const introMaster = join(dir, "intro-master.wav");
  const goldenMixedMaster = join(dir, "golden-voice-plus-bed.wav");
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:a", "pcm_s16le", narration]);
  await ffmpeg([
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-f", "lavfi", "-i", "sine=frequency=880:duration=4",
    "-filter_complex", "[0:a][1:a]amix=inputs=2:weights=1 1",
    "-c:a", "pcm_s16le", mixedMaster,
  ]);
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=660:duration=4", "-c:a", "pcm_s16le", unrelatedMaster]);
  await ffmpeg([
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1",
    "-i", narration,
    "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
    "-c:a", "pcm_s16le", introMaster,
  ]);

  const present = await measureNarrationMixCorrelation({ narrationPath: narration, masterPath: mixedMaster });
  assert.ok((present.correlation ?? 0) > 0.5, `mixed narration should retain a strong source correlation, got ${present.correlation}`);

  const missing = await measureNarrationMixCorrelation({ narrationPath: narration, masterPath: unrelatedMaster });
  assert.ok((missing.correlation ?? 1) < 0.1, `unrelated master must not look like narration survived, got ${missing.correlation}`);

  const afterIntro = await measureNarrationMixCorrelation({
    narrationPath: narration,
    masterPath: introMaster,
    narrationStartSec: 1,
  });
  assert.ok((afterIntro.correlation ?? 0) > 0.9, `planned intro offset must align source with master, got ${afterIntro.correlation}`);

  // A real project voice asset plus a separate music bed catches codec/channel
  // assumptions that synthetic sine waves cannot. It is still only a signal
  // presence test—not a claim that the golden clip is a released episode.
  const goldenVoice = resolve(process.cwd(), "public/golden/voice/history.mp3");
  const goldenBed = resolve(process.cwd(), "public/golden/quiz/music.mp4");
  await ffmpeg([
    "-i", goldenVoice,
    "-i", goldenBed,
    "-filter_complex", "[0:a][1:a]amix=inputs=2:weights=1 0.45",
    "-shortest",
    "-c:a", "pcm_s16le", goldenMixedMaster,
  ]);
  const goldenMix = await measureNarrationMixCorrelation({ narrationPath: goldenVoice, masterPath: goldenMixedMaster });
  assert.ok((goldenMix.correlation ?? 0) > 0.2, `a real voice mixed with a bed must clear the production audibility floor, got ${goldenMix.correlation}`);

    console.log("narration mix-correlation test passed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
