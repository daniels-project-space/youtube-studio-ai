import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname } from "node:path";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const originalTimeout = globalThis.setTimeout;
const active = new Set<EventEmitter>();
let mode = "success";
let calls: string[][] = [];
let kills = 0;
const summary = "I: -18 LUFS\nLRA: 2 LU\nPeak: -2 dBFS\nRMS level dB: -20\nDC offset: 0\nPeak count: 1\n";

loader._load = function(id, ...args) {
  const actual = originalLoad.call(this, id, ...args);
  if (id !== "node:child_process") return actual;
  return { ...actual as object, spawn: (_bin: string, argv: string[]) => {
    calls.push(argv);
    const full = argv.includes("-filter_complex");
    const input = argv[argv.indexOf("-i") + 1]!;
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() }) as EventEmitter & {
      stderr: EventEmitter; kill: (signal: string) => boolean;
    };
    active.add(child);
    const close = (code: number | null) => {
      if (!active.delete(child)) return;
      assert.ok(existsSync(input), "shared input must survive until every child closes");
      child.emit("close", code);
    };
    child.kill = signal => {
      assert.equal(signal, "SIGKILL"); kills++;
      queueMicrotask(() => close(null));
      return true;
    };
    queueMicrotask(() => {
      if (mode === "timeout") return;
      if (mode === "overflow") {
        child.stderr.emit("data", Buffer.alloc(1_048_577));
        return;
      }
      if (mode === "spawn-error") {
        child.emit("error", new Error("fixture spawn failure")); close(null); return;
      }
      if (mode === "probe-failure" && !full) {
        if (argv.includes("0.750")) close(1);
        // Remaining probes must reach their shortened test deadline and close
        // before measureNativeMusicQuality can remove the shared directory.
        return;
      }
      child.stderr.emit("data", Buffer.from(full ? summary : "mean_volume: -30 dB\n"));
      close(0);
    });
    return child;
  } };
};
globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms: number, ...args: unknown[]) =>
  originalTimeout(callback, ms === 90_000 ? 5 : ms, ...args)) as typeof setTimeout;

async function main() {
  const load = createRequire(import.meta.url);
  const { measureNativeMusicQuality } = load("@/lib/nativeMusicQuality") as typeof import("@/lib/nativeMusicQuality");
  for (mode of ["success", "timeout", "overflow", "spawn-error", "probe-failure"]) {
    calls = []; kills = 0;
    const operation = measureNativeMusicQuality({ audio: new Uint8Array(44), durationSec: 8 });
    if (mode === "success") {
      const result = await operation;
      assert.equal(result.measurements.integratedLufs, -18);
      assert.equal(calls.length, 6, "one full decode plus the unchanged five spectral probes");
      assert.equal(calls.filter(args => args.includes("-filter_complex")).length, 1);
      assert.equal(kills, 0);
    } else {
      await assert.rejects(operation, mode === "timeout" ? /analysis budget/ : mode === "overflow"
        ? /diagnostic byte limit/ : mode === "spawn-error" ? /fixture spawn failure/ : /exited 1/);
      if (mode === "probe-failure") assert.equal(kills, 4, "all remaining probes were reaped");
    }
    assert.equal(active.size, 0);
    const input = calls[0]![calls[0]!.indexOf("-i") + 1]!;
    assert.equal(existsSync(dirname(input)), false, "temporary directory is removed after reaping");
  }
  console.log("NATIVE MUSIC QA LIFECYCLE PASS: shared decode, bounded time/logs, spawn errors and all sibling probes reaped before cleanup");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad;
  globalThis.setTimeout = originalTimeout;
});
