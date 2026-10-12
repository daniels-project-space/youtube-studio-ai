import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { assertStudioEngineH3Media } from "@/engine/studioEngineH3Media";
import { inspectStudioEngineH3Media } from "../studioEngineH3Media";

const execute = promisify(execFile);

test("physical H3 inspection measures native frames and rejects incompatible video", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-h3-test-"));
  const scratchBefore = (await readdir(tmpdir())).filter(name => name.startsWith("studio-engine-h3-media-"));
  const fixture = async (name: string, size: string, fps: number, frames: number) => {
    const path = join(directory, `${name}.mp4`);
    await execute(process.env.FFMPEG_BIN ?? "ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
      `testsrc2=size=${size}:rate=${fps}`, "-frames:v", String(frames), "-an",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p", path],
    { timeout: 60_000, maxBuffer: 1024 * 1024 });
    return readFile(path);
  };
  try {
    const exact = await inspectStudioEngineH3Media(await fixture("exact", "1280x736", 24, 120));
    assert.equal(exact.durationSec, 5);
    assert.equal(exact.frames, 120);
    const native = await inspectStudioEngineH3Media(await fixture("native", "1280x736", 24, 124));
    assert.equal(native.durationSec, 124 / 24);
    await assert.rejects(inspectStudioEngineH3Media(await fixture("geometry", "640x368", 24, 120)), /admitted video contract/);
    await assert.rejects(inspectStudioEngineH3Media(await fixture("rate", "1280x736", 30, 150)), /admitted video contract/);
    await assert.rejects(inspectStudioEngineH3Media(await fixture("short", "1280x736", 24, 48)), /admitted video contract/);
    await assert.rejects(inspectStudioEngineH3Media(new Uint8Array(2048).fill(9)));
    assert.throws(() => assertStudioEngineH3Media({ ...exact, sha256: "a".repeat(64) }, exact.sha256, 5), /admitted video contract/);
    assert.throws(() => assertStudioEngineH3Media(exact, exact.sha256, 124 / 24), /admitted video contract/);
    assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith("studio-engine-h3-media-")).sort(), scratchBefore.sort(),
      "all media scratch is removed on success and failure");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
