import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { MINIMAX_H3_PROFILE } from "@/lib/minimaxH3";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
let mode: "recover" | "outage" | "forbidden" | "frozen-provider" | "seam" = "recover";
let renders = 0, uploads = 0, encodes = 0, buffered = 0, finishes = 0;
const expectedTakes = 2 * Math.ceil(15 / (MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps));
const uploadPaths: string[] = [];
const storageFailure = () => Object.assign(new Error("storage unavailable"), { status: mode === "forbidden" ? 403 : 503 });
async function upload(key: string, path: string) {
  uploads++; uploadPaths.push(path);
  if (mode === "outage" || mode === "forbidden" || (mode === "recover" && uploads === 1)) throw storageFailure();
  return key;
}
async function main() {
  loader._load = function(id, ...args) {
    const actual = originalLoad.call(this, id, ...args);
    if (id === "@/lib/minimaxH3") return { ...actual as object,
      minimaxH3Readiness: () => ({ admitted: true, blockers: [] }),
      renderMiniMaxH3: async () => {
        renders++;
        if (mode === "frozen-provider" && renders === 2) throw Object.freeze(Object.assign(new Error("provider failed"), {
          observedCostUsd: 0.07, additionalObservedCostUsd: 0.01, retryable: false,
        }));
        return { receipt: { jobId: `fixture-${renders}`, runtime: { runtimeId: "fixture", costUsd: 0.02 } }, outputBytes: new Uint8Array([1]) };
      } };
    if (id === "@/lib/storage" || id === "./storage") return { ...actual as object,
      getObjectBytes: async () => new Uint8Array([1, 2, 3]), putObjectFromFile: upload,
      putObject: async (key: string) => { buffered++; return upload(key, "buffer"); } };
    if (id === "@/lib/files") return { ...actual as object, makeRunTempDir: async () => "/tmp/loop-persistence-fixture",
      writeBytes: async (path: string) => path, readBytes: async () => new Uint8Array([1]) };
    if (id === "node:child_process") return { ...actual as object,
      execFile: (_bin: string, args: string[], _options: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
        assert.ok(args.some(arg => arg.includes("flags=lanczos"))); finishes++; callback(null, "", "");
      } };
    if (id === "./blockContext") return { ...actual as object, recordAsset: async () => {} };
    if (id === "@/lib/ffmpeg") return { ...actual as object,
      seamlessLoopUnit: async (_input: string, output: string) => output,
      composeVideoSequenceUnit: async (value: { outPath: string }) => { encodes++; return value.outPath; },
      composeLoopSourceUnit: async (value: { outPath: string }) => { encodes++; return value.outPath; },
      measureVideoBoundaryDiff: async () => mode === "seam" ? 1 : 0,
      measureLoopSeamDiff: async () => 0 };
    return actual;
  };
  try {
    const require = createRequire(import.meta.url);
    const { registerAllBlocks } = require("@/engine/blocks");
    const { validatePipeline } = require("@/engine/validate");
    const { runPipeline } = require("@/engine/runner");
    registerAllBlocks();
    const graph = validatePipeline([{ block: "loop_clips" }], ["f1Key", "topic", "scenes"]);
    for (const scenario of ["recover", "outage", "forbidden", "frozen-provider", "seam"] as const) {
      mode = scenario; renders = uploads = encodes = buffered = 0; uploadPaths.length = 0;
      const result = await runPipeline(graph, { ownerId: "fixture-owner", channelId: "fixture-channel", runId: `fixture-${scenario}`,
        keyPrefix: "fixture/", budgetUsd: 10, defaultRetries: 1,
        seedStore: { f1Key: "fixture/accepted-still", topic: "A quiet room",
          scenes: [{ fluxPrompt: "A quiet room", klingMotionPrompt: "Only distant water ripples gently", durationSec: 15 }] },
        sink: { async upsert() {}, async upsertArtifacts() {} } });
      assert.equal(renders, scenario === "frozen-provider" ? 2 : expectedTakes,
        `${scenario}: storage and finishing failures must never restart paid video generation`);
      assert.ok(Math.abs(result.costTotal - (scenario === "frozen-provider" ? 0.1 : expectedTakes * 0.02)) < 1e-9,
        `${scenario}: retain every observed charge, including frozen provider errors`);
      assert.equal(buffered, 0, "finished video must stream from disk, not allocate a whole-file buffer");
      if (scenario === "recover") {
        assert.equal(result.ok, true, result.error); assert.equal(uploads, 2); assert.equal(encodes, 3);
        assert.equal(new Set(uploadPaths).size, 1, "storage retries reopen the same completed render");
        assert.equal(result.store.loopSourceDurationSec, 30);
      } else {
        assert.equal(result.ok, false);
        assert.equal(uploads, scenario === "outage" ? 3 : scenario === "forbidden" ? 1 : 0);
      }
    }
    mode = "recover"; renders = uploads = encodes = buffered = finishes = 0; uploadPaths.length = 0;
    const finishing = validatePipeline([{ block: "upscale", params: { targetResolution: "1080p" } }], ["loopRawUrl", "loopRawKey"]);
    const finished = await runPipeline(finishing, { ownerId: "fixture-owner", channelId: "fixture-channel", runId: "fixture-upscale",
      keyPrefix: "fixture/", budgetUsd: 10, defaultRetries: 1,
      seedStore: { loopRawUrl: "/fixture/completed-source.mp4", loopRawKey: "fixture/completed-source.mp4" },
      sink: { async upsert() {}, async upsertArtifacts() {} } });
    assert.equal(finished.ok, true, finished.error); assert.equal(finished.store.loopUnitResolution, "1080p");
    assert.equal(finishes, 1, "storage recovery must not repeat deterministic upscale encoding");
    assert.equal(uploads, 2); assert.equal(renders, 0); assert.equal(buffered, 0);
    console.log("LOOP OUTPUT PERSISTENCE PASS: actual runner recovers transient storage without repeated generation/encoding; persistent/403/seam failures retain cost; frozen provider receipts preserved. Media/storage transports synthetic.");
  } finally { loader._load = originalLoad; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
