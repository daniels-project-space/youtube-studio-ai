import assert from "node:assert/strict";
import {
  automaticReuseKey,
  createAutomaticPreflightReceipt,
  createBulkUndoReceipt,
  resolveBatchConflicts,
} from "@/lib/automaticWorkflow";

const preflight = createAutomaticPreflightReceipt({
  runId: "run-1",
  channelId: "channel-a",
  budgetUsd: 4,
  reservedMaxCostUsd: 3.5,
  paidModules: ["render", "script", "render"],
  resumeBoundaryReady: true,
  reusedDependencies: [
    { kind: "music", key: "r2/music.mp3" },
    { kind: "footage", key: "r2/a.mp4" },
  ],
});
assert.equal(preflight.checks.length, 3);
assert.deepEqual(preflight.paidModules, ["render", "script"]);
assert.deepEqual(preflight.reusedDependencies?.map((entry) => entry.kind), ["footage", "music"]);
assert.throws(() => createAutomaticPreflightReceipt({
  runId: "run-1", channelId: "channel-a", budgetUsd: 1, reservedMaxCostUsd: 2,
  paidModules: [], resumeBoundaryReady: true,
}), /exceeds/);

const portableA = automaticReuseKey({
  ownerId: "owner", moduleId: "image", moduleVersion: "1.0.0", inputHashes: ["b", "a"],
  params: { width: 1280 }, scope: "portable",
});
const portableB = automaticReuseKey({
  ownerId: "owner", moduleId: "image", moduleVersion: "1.0.0", inputHashes: ["a", "b", "a"],
  params: { width: 1280 }, scope: "portable",
});
assert.equal(portableA, portableB, "portable work must deduplicate independent of input order");
assert.notEqual(portableA, automaticReuseKey({
  ownerId: "owner", moduleId: "image", moduleVersion: "1.0.0", inputHashes: ["a", "b"],
  params: { width: 1280 }, scope: "channel", channelId: "channel-b",
}));

const waves = resolveBatchConflicts([
  { id: "a", resourceKey: "gpu-3090", scheduledAt: 2 },
  { id: "b", resourceKey: "gpu-3090", scheduledAt: 1 },
  { id: "c", resourceKey: "gpu-5090", scheduledAt: 1 },
  { id: "d", resourceKey: "gpu-3090", scheduledAt: 3 },
]);
assert.deepEqual(waves.map((wave) => wave.items.map((item) => item.id)), [["b", "c"], ["a"], ["d"]]);
assert.equal(new Set(waves[0]!.resourceKeys).size, waves[0]!.resourceKeys.length);

const undo = createBulkUndoReceipt({
  actionKey: "archive:1",
  runIds: ["run-2", "run-1"],
  previousStates: [{ runId: "run-1", state: "active" }, { runId: "run-2", state: "archived" }],
  nextState: "archived",
});
assert.match(undo.fingerprint, /^[a-f0-9]{64}$/);
console.log("Automatic workflow contracts passed");
