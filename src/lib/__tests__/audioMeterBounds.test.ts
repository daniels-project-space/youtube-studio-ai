import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import { PassThrough } from "node:stream";
import { test } from "node:test";

test("audio meters reject incomplete, failed and oversized output and await overflow process closure", async () => {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  const summary = "Summary:\nIntegrated loudness:\n I: -18.0 LUFS\nTrue peak:\n Peak: -4.0 dBFS\n";
  let output = summary, status = 0, killed = 0, closed = 0, stdoutFlood = false;
  const commands: string[][] = [];
  loader._load = (id, ...rest) => {
    if (id !== "node:child_process") return originalLoad.call(loader, id, ...rest);
    return { spawn: (_bin: string, args: string[]) => {
      commands.push(args);
      let stopping = false;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(),
        kill: (signal: string) => {
          assert.equal(signal, "SIGKILL"); killed++; stopping = true;
          setImmediate(() => { closed++; child.emit("close", null, signal); });
          return true;
        },
      });
      queueMicrotask(() => {
        if (stdoutFlood) child.stdout.write("x".repeat(64 * 1024 + 1));
        child.stderr.write(args.includes("volumedetect") ? "mean_volume: -22.1 dB\n" : output);
        if (!stopping) { closed++; child.emit("close", status); }
      });
      return child;
    } };
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { measureAudio, masterAudioTransparentGain } = require("../ffmpeg") as typeof import("../ffmpeg");
    assert.deepEqual(await measureAudio("master.mp4", { windowStartSec: 0.5, windowDurSec: 3 }),
      { integratedLufs: -18, windowMeanDb: -22.1 });
    assert.equal(commands.length, 2);
    assert.ok(commands[0].includes("ebur128=framelog=verbose"));
    assert.ok(commands.every(args => args.includes("info") && args.includes("-nostats")));
    for (const malformed of ["I: -18.0 LUFS", "Summary:\nIntegrated loudness:\nI: NaN LUFS",
      summary + "Summary:\nIntegrated loudness:\nI: broken LUFS"]) {
      output = malformed;
      assert.equal((await measureAudio("master.mp4")).integratedLufs, null);
    }
    output = summary; status = 1;
    assert.equal((await measureAudio("master.mp4")).integratedLufs, null);
    status = 0;
    for (const flood of [false, true]) {
      stdoutFlood = flood;
      output = flood ? summary : "x".repeat(64 * 1024 + 1) + summary;
      const before = closed;
      assert.equal((await measureAudio("master.mp4")).integratedLufs, null);
      assert.equal(closed, before + 1, "overflow child must close before the meter returns");
    }
    assert.equal(killed, 2);
    stdoutFlood = false; output = "x".repeat(64 * 1024 + 1) + summary;
    const before = commands.length;
    await assert.rejects(masterAudioTransparentGain("source.wav", "master.mp3", { lufs: -18 }), /output exceeded/);
    assert.equal(commands.length, before + 1, "unavailable source meter must never start an encode");
  } finally { loader._load = originalLoad; }
});
