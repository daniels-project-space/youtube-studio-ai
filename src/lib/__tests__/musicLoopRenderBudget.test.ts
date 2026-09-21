import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { mock, test } from "node:test";

test("music-loop passes share a bounded deadline without changing encoding quality", async () => {
  const directory = await mkdtemp(join(tmpdir(), "music-loop-budget-"));
  let now = 0;
  let elapsed: number[] = [];
  const deadlines: number[] = [];
  const commands: string[][] = [];
  const originalSetTimeout = globalThis.setTimeout;
  mock.method(performance, "now", () => now);
  mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => {
    deadlines.push(delay);
    return originalSetTimeout(callback, 10_000);
  });
  mock.method(childProcess, "spawn", (_bin: string, args: string[]) => {
    commands.push(args);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true,
    });
    process.nextTick(() => {
      now += elapsed.shift() ?? 0;
      child.emit("close", 0);
    });
    return child;
  });
  syncBuiltinESMExports();
  try {
    const { composeMusicLoopDeblur, MUSIC_LOOP_RENDER_TIMEOUT_MS } = await import("../ffmpeg");
    const base = { loopUnitPath: "visual.mp4", musicPath: "loop.wav", outPath: join(directory, "out.mp4"), durationSec: 28800 };
    elapsed = [100, 500, 0];
    await composeMusicLoopDeblur({ ...base, timeoutMs: 1000 });
    assert.deepEqual(deadlines, [1000, 900, 400]);
    assert.equal(commands.length, 3);
    for (const args of commands.slice(0, 2)) {
      assert.equal(args[args.indexOf("-crf") + 1], "20");
      assert.equal(args[args.indexOf("-preset") + 1], "veryfast");
    }
    const mux = commands[2];
    assert.equal(mux[mux.indexOf("-b:a") + 1], "384k");
    assert.equal(mux[mux.indexOf("-c:v") + 1], "copy");
    assert.equal(mux[mux.indexOf("-t") + 1], "28800");

    deadlines.length = 0; commands.length = 0;
    elapsed = [1000];
    await assert.rejects(composeMusicLoopDeblur({ ...base, timeoutMs: 1000 }), /exhausted.*total budget/);
    assert.equal(commands.length, 1, "no second pass after the shared deadline expires");

    deadlines.length = 0; commands.length = 0;
    elapsed = [200_000, 200_000, 0];
    await composeMusicLoopDeblur(base);
    assert.equal(MUSIC_LOOP_RENDER_TIMEOUT_MS, 3_600_000);
    assert.deepEqual(deadlines, [3_600_000, 3_400_000, 3_200_000]);

    deadlines.length = 0; commands.length = 0;
    elapsed = [];
    await composeMusicLoopDeblur({ ...base, durationSec: 10, timeoutMs: 1000 });
    assert.deepEqual(deadlines, [1000], "short single-pass renders use the same budget contract");
    commands.length = 0;
    for (const timeoutMs of [0, -1, NaN, Infinity, 0.5, 3_600_001]) {
      await assert.rejects(composeMusicLoopDeblur({ ...base, timeoutMs }), /render budget must/);
    }
    assert.equal(commands.length, 0, "invalid budgets cannot start FFmpeg");
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    await rm(directory, { recursive: true, force: true });
  }
});
