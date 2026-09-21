import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import { PassThrough } from "node:stream";

async function main() {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  let source = "I: -22.0 LUFS\nPeak: -12.0 dBFS";
  let encoded = "I: -18.0 LUFS\nPeak: -7.9 dBFS";
  const commands: string[][] = [];
  loader._load = (id, ...rest) => {
    if (id !== "node:child_process") return originalLoad.call(loader, id, ...rest);
    return { spawn: (_bin: string, args: string[]) => {
      commands.push(args);
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {},
      });
      queueMicrotask(() => {
        if (args.includes("ebur128=peak=true")) {
          child.stderr.write(args.includes("source.wav") ? source : encoded);
        }
        child.emit("close", 0);
      });
      return child;
    } };
  };
  try {
    // Load after installing the process boundary, as in the shared-score tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { masterAudioTransparentGain } = require("../ffmpeg") as typeof import("../ffmpeg");
    const master = () => masterAudioTransparentGain("source.wav", "master.mp3", { lufs: -18, truePeakMaxDbtp: -1 });
    assert.equal(await master(), "master.mp3");
    assert.equal(commands.length, 3, "source meter, fixed gain encode, final meter: no extra process");
    assert.equal(commands.filter((args) => args.includes("ebur128=peak=true")).length, 2);
    assert.ok(commands[1].includes("volume=4.000dB"));
    assert.ok(!commands.flat().some((arg) => /loudnorm|alimiter|acompressor/.test(arg)));

    for (const measurement of [
      "I: -18.0 LUFS\nPeak: -0.7 dBFS", // Correct loudness but codec overshoot.
      "I: -18.0 LUFS", // Missing true-peak proof must not count as success.
      "I: -18.0 LUFS\nPeak: -inf dBFS",
    ]) {
      encoded = measurement;
      commands.length = 0;
      await assert.rejects(master(), /encoded true peak/);
      assert.equal(commands.length, 3, "failed output is not re-encoded or dynamically limited");
    }
    for (const measurement of ["I: -15.0 LUFS\nPeak: -7.0 dBFS", "Peak: -7.0 dBFS"]) {
      encoded = measurement;
      await assert.rejects(master(), /verification missed/);
    }
    source = "I: -22.0 LUFS\nPeak: -3.0 dBFS";
    commands.length = 0;
    await assert.rejects(master(), /cannot reach/);
    assert.equal(commands.length, 1, "impossible source rejected before encoding");
    commands.length = 0;
    for (const opts of [{ lufs: NaN }, { lufs: -18, truePeakMaxDbtp: Infinity }]) {
      await assert.rejects(masterAudioTransparentGain("source.wav", "master.mp3", opts), /finite/);
    }
    assert.equal(commands.length, 0, "invalid controls rejected before starting FFmpeg");
    console.log("TRANSPARENT MASTER ADMISSION PASS: encoded peaks, missing meters and impossible targets rejected without extra passes");
  } finally { loader._load = originalLoad; }
}

void main();
