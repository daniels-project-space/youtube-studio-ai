import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { composeWithIntro, probe } from "../ffmpeg";

const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
function render(args: string[]) {
  execFileSync(ffmpeg, ["-hide_banner", "-v", "error", "-y", ...args], { timeout: 60000 });
}
function rms(path: string, start: number) {
  const pcm = execFileSync(ffmpeg, ["-v", "error", "-ss", String(start), "-i", path, "-t", "0.5",
    "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { timeout: 60000 });
  assert.equal(pcm.length, 24000 * 4);
  let energy = 0;
  for (let i = 0; i < pcm.length; i += 4) energy += pcm.readFloatLE(i) ** 2;
  return Math.sqrt(energy / (pcm.length / 4));
}

test("actual once composition preserves native ending, pads silence and never repeats", async () => {
  const dir = await mkdtemp(join(tmpdir(), "music-once-"));
  try {
    const picture = join(dir, "picture.mp4"), music = join(dir, "source.wav");
    render(["-f", "lavfi", "-i", "testsrc2=s=160x96:r=30:d=1", "-an", "-c:v", "libx264", picture]);
    render(["-f", "lavfi", "-i", "sine=frequency=233:sample_rate=48000:duration=2", "-ac", "2", "-c:a", "pcm_f32le", music]);
    const args = { loopBodyPath: picture, musicPath: music, introSec: 0, bodySec: 4,
      width: 160, height: 96, audioSampleRateHz: 48000 as const, introMusicVol: 1, timeoutMs: 60000 };
    const once = join(dir, "once.mp4"), repeat = join(dir, "repeat.mp4");
    await composeWithIntro({ ...args, outPath: once, musicPlayback: "once" });
    await composeWithIntro({ ...args, outPath: repeat });
    assert.equal((await probe(once)).durationSec, 4);
    const opening = rms(once, 0.5), ending = rms(once, 1.4), silentTail = rms(once, 3), repeatedTail = rms(repeat, 3);
    assert.ok(opening > 0.04 && ending > 0.04, "source including its ending remains audible");
    assert.ok(silentTail < 0.00001, "music must not restart after source end");
    assert.ok(repeatedTail > 0.04, "legacy repeat is an independently rejecting counterexample");
    await assert.rejects(composeWithIntro({ ...args, bodySec: 1, outPath: join(dir, "trim.mp4"), musicPlayback: "once" }), /refusing to trim/);
    console.log(JSON.stringify({ openingRms: opening, endingRms: ending, silentTailRms: silentTail, legacyRepeatedTailRms: repeatedTail }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
