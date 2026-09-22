import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { measureAudio } from "../ffmpeg";

const exec = promisify(execFile);
const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
test("summary-only full-audio meter equals the former scan including a changed late programme", async () => {
  const directory = await mkdtemp(join(tmpdir(), "audio-meter-parity-"));
  try {
    for (const lateGain of [0.1, 0.8]) {
      const source = join(directory, `gain-${lateGain}.wav`);
      await exec(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=317:sample_rate=48000:duration=12",
        "-af", `volume='if(lt(t,6),0.1,${lateGain})':eval=frame`, "-ac", "2", "-c:a", "pcm_f32le", source], { timeout: 30000 });
      const legacy = await exec(ffmpeg, ["-nostats", "-i", source, "-map", "a:0", "-filter:a", "ebur128", "-f", "null", "-"], { timeout: 30000 });
      const expected = Number([...legacy.stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/gu)].at(-1)?.[1]);
      const meter = await measureAudio(source, { windowStartSec: 7, windowDurSec: 3 });
      assert.equal(meter.integratedLufs, expected);
      const window = await exec(ffmpeg, ["-nostats", "-ss", "7.00", "-t", "3.00", "-i", source,
        "-map", "a:0", "-filter:a", "volumedetect", "-f", "null", "-"], { timeout: 30000 });
      assert.equal(meter.windowMeanDb, Number(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/u.exec(window.stderr)?.[1]));
      if (lateGain === 0.1) assert.ok(expected < -40);
      else assert.ok(expected > -30, "the full scan must include the loud second half, not only the quiet opening");
      const quiet = await exec(ffmpeg, ["-hide_banner", "-loglevel", "info", "-nostats", "-i", source,
        "-map", "a:0", "-filter:a", "ebur128=framelog=verbose", "-f", "null", "-"], { timeout: 30000 });
      assert.ok(quiet.stderr.length < legacy.stderr.length / 5, "frame logging must be suppressed, not buffered then discarded");
    }
    assert.deepEqual(await measureAudio(join(directory, "missing.wav")), { integratedLufs: null, windowMeanDb: null });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
