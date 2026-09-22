import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { mock } from "node:test";
import { canonicalJson } from "../canonicalJson";
import { sha256Hex } from "../sha256";
import type { PlanWeekPreparationManifest } from "../planWeekPreparation";

const manifest: PlanWeekPreparationManifest = {
  version: "plan-week-preparation/inputs-v1", ownerId: "owner", channelId: "channel", channelSlug: "archive",
  batchId: "week", itemId: "episode", itemKey: "week:0", requestKey: "week", frozenAt: 1,
  plan: { topic: "Archive", title: "Archive", description: "History", sceneSeed: "Map", thumbnailKey: "owner/art.png", thumbnailSource: "planner_artwork" },
  execution: { pipeline: [{ block: "script_gen" }], moduleConfig: {}, seedStore: {} },
  prompts: { script: "Source", narration: "Voice", visual: "Map", shotlist: "Shot" },
};
const objects = new Map<string, Uint8Array>();
let mode: "ok" | "put-failure" | "lost-response" | "read-failure" | "changed" | "late" = "ok";
let completeLate: () => void = () => {};
let admitted = 0;
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch;
loader._load = function(id, ...args) {
  if (id === "@/lib/storage") return {
    putObject: async (key: string, bytes: Uint8Array, options: { ifNoneMatch: string }) => {
      assert.equal(options.ifNoneMatch, "*");
      if (objects.has(key)) throw Object.assign(new Error("conflict"), { $metadata: { httpStatusCode: 412 } });
      if (mode === "put-failure") throw new Error("denied");
      if (mode === "late") return new Promise<string>(resolve => {
        completeLate = () => { objects.set(key, bytes); resolve(key); };
      });
      objects.set(key, bytes);
      if (mode === "lost-response") throw new Error("connection lost after commit");
      return key;
    },
    getObjectBytes: async (key: string, _bucket: unknown, options: { maxBytes: number; timeoutMs: number }) => {
      const bytes = objects.get(key)!;
      assert.equal(options.maxBytes, bytes.byteLength); assert.equal(options.timeoutMs, 30_000);
      if (mode === "read-failure") throw new Error("read unavailable");
      return mode === "changed" ? Buffer.alloc(bytes.byteLength) : bytes;
    },
  };
  return originalLoad.call(this, id, ...args);
};
globalThis.fetch = async () => { throw new Error("external network forbidden"); };

async function main() {
  const { claimPreparedGeneration } = createRequire(import.meta.url)("../preparedGenerationClaim") as typeof import("../preparedGenerationClaim");
  const request = { prompt: "Keep the complete source", maxCostUsd: 2 };
  const attempt = () => claimPreparedGeneration("script", manifest, request).then(() => { admitted++; });
  const race = await Promise.allSettled(Array.from({ length: 32 }, attempt));
  assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(admitted, 1); assert.equal(objects.size, 1);
  const receipt = JSON.parse(Buffer.from([...objects.values()][0]).toString());
  assert.equal(receipt.requestSha256, sha256Hex(canonicalJson(request))); assert.equal(receipt.costUsd, null);
  await assert.rejects(() => claimPreparedGeneration("script", manifest, { ...request, maxCostUsd: 50 }), /RECONCILIATION_REQUIRED/);
  for (const stage of ["scriptReview", "narration", "music", "images"] as const) await claimPreparedGeneration(stage, manifest, request);
  assert.equal(objects.size, 5, "each stage owns a separate claim, without input-dependent bypass keys");

  for (const failure of ["put-failure", "lost-response", "read-failure", "changed"] as const) {
    objects.clear(); mode = failure;
    await assert.rejects(attempt, error => error instanceof Error && error.name === "AbortTaskRunError" && /RECONCILIATION_REQUIRED/.test(error.message));
    assert.equal(admitted, 1);
    if (failure !== "put-failure") {
      mode = "ok";
      await assert.rejects(attempt, /RECONCILIATION_REQUIRED/);
      assert.equal(admitted, 1, "persisted uncertain work never expires into a new purchase");
    }
  }
  objects.clear(); mode = "late";
  mock.timers.enable({ apis: ["setTimeout"] });
  const pending = attempt();
  const rejected = assert.rejects(pending, /RECONCILIATION_REQUIRED/);
  mock.timers.tick(30_000);
  await rejected;
  completeLate(); await Promise.resolve();
  mock.timers.reset(); mode = "ok";
  assert.equal(objects.size, 1); assert.equal(admitted, 1);
  await assert.rejects(attempt, /RECONCILIATION_REQUIRED/);
  assert.equal(admitted, 1, "late write acknowledgement cannot admit work after the waiter timed out");
  console.log("PREPARED GENERATION CLAIM PASS: 32 contenders admit one; five stages; changed requests, lost writes, failed readback, and late commit remain held");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  mock.timers.reset(); loader._load = originalLoad; globalThis.fetch = originalFetch;
});
