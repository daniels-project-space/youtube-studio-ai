import assert from "node:assert/strict";
import Module from "node:module";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import {
  planWeekPreparedImageKey, planWeekPreparationManifestSha256,
  PLAN_WEEK_PREPARATION_VERSION,
  type PlanWeekPreparationManifest, type PlanWeekPreparedImages,
} from "@/lib/planWeekPreparation";

const manifest: PlanWeekPreparationManifest = {
  version: PLAN_WEEK_PREPARATION_VERSION, ownerId: "owner-images", channelId: "channel-images",
  channelSlug: "archive", batchId: "batch-images", itemId: "item-images", itemKey: "week:0",
  requestKey: "week", frozenAt: 1000,
  plan: { topic: "Archive", title: "Archive", description: "Evidence", sceneSeed: "A map",
    thumbnailKey: "owner/owner-images/plan/image.png", thumbnailSource: "planner_artwork" },
  execution: { pipeline: [{ block: "script_gen" }], moduleConfig: {}, seedStore: {} },
  prompts: { script: "Script", narration: "Narrate", shotlist: "Shots", visual: "Archive" },
};
const bytes = new Uint8Array(512).fill(7);
const items = Array.from({ length: 12 }, (_, index) => ({
  shotId: `shot-${index}`, candidateIndex: 0, stillKey: planWeekPreparedImageKey({ ...manifest, index }),
  byteLength: bytes.byteLength, sha256: sha256BytesHex(bytes),
}));
const stillRenderManifest = {
  version: "1.0.0" as const,
  generation: { contractVersion: "1.0.0" as const, profileId: "production" as const,
    model: "Tongyi-MAI/Z-Image-Turbo", revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
    checkpoint: "Z-Image-Turbo", precision: "bf16" as const, width: 1920, height: 1088, steps: 9, allowFallback: false as const },
  items: items.map(item => ({ shotId: item.shotId, candidateIndex: 0, stillKey: item.stillKey, outputId: item.shotId })),
};
const prepared: PlanWeekPreparedImages = {
  version: "plan-week-prepared-images/v1", manifestSha256: planWeekPreparationManifestSha256(manifest),
  ownerId: manifest.ownerId, channelId: manifest.channelId, batchId: manifest.batchId,
  itemId: manifest.itemId, requestKey: manifest.requestKey, topic: manifest.plan.topic,
  stillRenderManifest, stillRenderManifestSha256: sha256Hex(canonicalJson(stillRenderManifest)), items, createdAt: 2000,
};
let sidecar = prepared;
let started = 0, active = 0, peak = 0, providerCalls = 0;
let failure = false;
const writes: string[] = [];
let dispatches = 0;
let release!: () => void;
let gate = new Promise<void>(resolve => { release = resolve; });
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (name, ...args) {
  if (name === "@/lib/storage") return {
    getObjectBytes: async (key: string, _bucket?: string, options?: { maxBytes: number; timeoutMs: number }) => {
      if (key === "sidecar") return new TextEncoder().encode(JSON.stringify(sidecar));
      assert(items.some(item => item.stillKey === key));
      assert.deepEqual(options, { maxBytes: 512, timeoutMs: 300_000 });
      started++; active++; peak = Math.max(peak, active);
      try {
        if (failure && key === items[0].stillKey) throw new Error("fixture transfer limit");
        await gate;
        return bytes;
      } finally { active--; }
    },
    putObject: async (key: string, value: Uint8Array, options: { ifNoneMatch: string }) => {
      assert.equal(options.ifNoneMatch, "*");
      assert.deepEqual(value, bytes);
      writes.push(key);
    },
  };
  if (name === "@trigger.dev/sdk") return {
    task: (definition: unknown) => definition,
    tasks: { trigger: async () => { dispatches++; return { id: "fixture-h3" }; } },
    idempotencyKeys: { create: async () => "fixture-key" },
  };
  if (name === "@/lib/novitaRenderFarm") return {
    renderImages: async () => { providerCalls++; throw new Error("generation forbidden"); },
  };
  return originalLoad.call(this, name, ...args);
};

async function main() {
  const { verifyStoredSidecar, dispatchPreparedFootage, assertPlanWeekPreparedImagesArgs } = await import("../planWeekPreparedImages");
  let settled = false;
  const success = verifyStoredSidecar("sidecar", manifest).then(value => { settled = true; return value; });
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  assert.equal(started, 4);
  assert.equal(active, 4);
  assert.equal(settled, false);
  release();
  assert.deepEqual(await success, prepared);
  assert.equal(started, 12);
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.deepEqual(writes, []);

  started = 0; peak = 0; settled = false; failure = true;
  gate = new Promise<void>(resolve => { release = resolve; });
  const rejected = verifyStoredSidecar("sidecar", manifest).then(
    () => { throw new Error("expected rejection"); }, error => { settled = true; return error; },
  );
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  assert.equal(started, 4, "failure must stop new transfer admission");
  assert.equal(active, 3);
  assert.equal(settled, false, "started reads must drain before the task can retry");
  release();
  assert.match(String(await rejected), /fixture transfer limit/);
  assert.equal(active, 0);
  assert.equal(started, 4);

  started = 0; failure = false;
  sidecar = structuredClone(prepared);
  sidecar.items[11].byteLength = 50 * 1024 * 1024 + 1;
  await assert.rejects(verifyStoredSidecar("sidecar", manifest));
  assert.equal(started, 0, "the complete receipt must be admitted before media I/O");
  sidecar = structuredClone(prepared);
  sidecar.items[0].sha256 = "0".repeat(64);
  await assert.rejects(verifyStoredSidecar("sidecar", manifest), /integrity check/);
  const { assertPreparedImagesForShots } = await import("../blocks/novitaRenderBlocks");
  const shots = items.map(item => ({ id: item.shotId, candidateCount: 1 }));
  const scope = { ownerId: manifest.ownerId, channelId: manifest.channelId,
    keyPrefix: `owner/${manifest.ownerId}/channel/${manifest.channelSlug}/` };
  started = 0;
  assert.deepEqual(await assertPreparedImagesForShots(shots as never, prepared, scope), stillRenderManifest);
  assert.equal(started, 12);
  for (const invalid of [NaN, 0, 1.5, 50 * 1024 * 1024 + 1]) {
    const bad = structuredClone(prepared);
    bad.items[11].byteLength = invalid;
    started = 0;
    await assert.rejects(assertPreparedImagesForShots(shots as never, bad, scope));
    assert.equal(started, 0, "consumer validates every receipt before reading the first asset");
  }

  const { planWeekPreparationKey } = await import("@/lib/planWeekPreparation");
  const payload = assertPlanWeekPreparedImagesArgs({ ...manifest,
    manifestKey: planWeekPreparationKey(manifest), manifestSha256: prepared.manifestSha256,
    shots: items.map(item => ({ id: item.shotId, prompt: "A detailed archive map", candidateCount: 1 })), maxCostUsd: 5,
  });
  const footageManifest = { ...manifest, execution: { ...manifest.execution, pipeline: [{ block: "gen_footage" }] } };
  started = 0; peak = 0;
  gate = new Promise<void>(resolve => { release = resolve; });
  const copy = dispatchPreparedFootage(footageManifest, payload, prepared);
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  assert.equal(started, 4);
  assert.equal(dispatches, 0, "H3 cannot start before every source frame is retained");
  release();
  assert.equal(await copy, "fixture-h3");
  assert.equal(writes.length, 12);
  assert.equal(peak, 4);
  assert.equal(dispatches, 1);
  started = 0; failure = true;
  await assert.rejects(dispatchPreparedFootage(footageManifest, payload, prepared), /fixture transfer limit/);
  assert.equal(dispatches, 1, "a failed source-frame copy cannot dispatch H3");
  assert.equal(active, 0);
  assert.equal(providerCalls, 0);
  console.log("Prepared image transfer bounds: real sidecar reader, four active transfers, drain-on-failure, exact byte limits, admission and digest rejection passed");
}

void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { loader._load = originalLoad; });
