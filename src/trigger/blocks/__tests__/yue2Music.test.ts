import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";

const retained = JSON.parse(readFileSync("test-fixtures/music-composer/seaside-after/gpu-material.json", "utf8"));
const arrangement = retained.request.acceptedArrangement, load = createRequire(__filename);
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown }, original = loader._load;
let sourceCalls = 0, authorityCalls = 0, missingLegacy = false, failNative = false;
const nativeMaterial = { ...retained, candidate: { ...retained.candidate, version: "studio-yue2-engine-candidate/v1",
  jobId: "a".repeat(32), headroom: undefined, usage: { gpuSeconds: 50, costUsd: .02, complete: true } },
  listeningAudioKey: `owner/${arrangement.ownerId}/runs/${arrangement.runId}/music/yue2-engine/audio-native-${retained.candidate.audioSha256}.wav` };
loader._load = function (id, ...args) {
  if (id === "@/lib/bootstrap") return { bootstrapSecrets: async () => undefined };
  if (id === "@/lib/yue2EngineSource") return { executeYuE2EngineSource: async (accepted: unknown, params: unknown, options: { authorize: () => Promise<void> }) => {
    sourceCalls++; assert.deepEqual(accepted, arrangement); assert.equal((params as { renderer: string }).renderer, "render-engine");
    await options.authorize();
    if (failNative) throw Object.assign(new Error("confidential provider diagnostic"), { additionalObservedCostUsd: .03 });
    return structuredClone(nativeMaterial);
  } };
  if (id === "@/lib/yue2DurableEvaluation") return {
    readDurableYuE2Candidate: async () => missingLegacy ? null : structuredClone(retained),
    executeDurableYuE2Evaluation: async () => assert.fail("retired source must never admit generation"),
  };
  return original.call(this, id, ...args);
};
async function main() {
  const previous = process.env.RENDER_MANAGEMENT_API_KEY; process.env.RENDER_MANAGEMENT_API_KEY = "a".repeat(64);
  try {
    const { createYuE2MusicManifest, createLegacyYuE2MusicManifest } = load("../yue2Music") as typeof import("../yue2Music");
    const current = createYuE2MusicManifest(), legacy = createLegacyYuE2MusicManifest();
    const context: StageContext = { ownerId: arrangement.ownerId, channelId: arrangement.channelId, runId: arrangement.runId,
      keyPrefix: `owner/${arrangement.ownerId}/`, budgetUsd: 1, stageBudgetUsd: 1,
      params: { renderer: "render-engine", seed: 42, personalCreatorAcknowledged: true, maxCostUsd: 1, maxExecutionSeconds: 600 },
      store: { topic: arrangement.topic, acceptedMusicArrangement: arrangement }, log: () => {},
      assertInlinePaidExecutionLease: async () => { authorityCalls++; } };
    assert.equal(current.version, "4.0.0-yue2-engine-candidate");
    assert.deepEqual(Object.keys(current.produces), ["yue2MusicCandidate", "musicKey"]);
    for (const patch of [{ ownerId: "foreign" }, { channelId: "foreign" }, { runId: "foreign" },
      { budgetUsd: 0 }, { stageBudgetUsd: undefined }, { stageBudgetUsd: .5 }, { assertInlinePaidExecutionLease: undefined }]) {
      await assert.rejects(current.execute({ ...context, ...patch } as StageContext));
    }
    assert.equal(sourceCalls, 0, "invalid scope/budget cannot contact Engine");
    const output = await current.execute(context);
    assert.equal(sourceCalls, 1); assert.equal(authorityCalls, 1);
    assert.equal(output[COST_PATCH_KEY], .02);
    assert.equal(output.musicKey, nativeMaterial.listeningAudioKey, "only the Engine route exports its private retained audio key to the declared mux owner");
    const candidate = output.yue2MusicCandidate as { version: string; costBasis: string; providerInvoiceVerified: boolean; productionApproved: boolean };
    assert.equal(candidate.version, "shared-yue2-music-candidate/v2"); assert.equal(candidate.costBasis, "engine-reported-usage");
    assert.equal(candidate.providerInvoiceVerified, false); assert.equal(candidate.productionApproved, false);
    failNative = true;
    await assert.rejects(current.execute(context), error => {
      assert.equal((error as { additionalObservedCostUsd: number }).additionalObservedCostUsd, .03);
      assert.ok(!String(error).includes("confidential")); return /PAID_STAGE_RECONCILIATION_REQUIRED/.test(String(error));
    });
    const policy = { schema_version: 1, provider: "openrelay", allocation_basis: "supervised_dispatch_wall_time", rate_source: "operator_configured",
      rate_reference: "historical fixture policy", runtime_id: "fixture", hourly_rate_usd_micros: 180000,
      max_execution_seconds: 600, termination_grace_seconds: 10, reserved_allocation_usd_micros: 30500 };
    const historical = { ...context, params: { seed: 42, personalCreatorAcknowledged: true, maxCostUsd: .04, executionPolicy: policy } };
    const restored = await legacy.execute(historical);
    assert.equal((restored.yue2MusicCandidate as { version: string }).version, "shared-yue2-music-candidate/v1");
    assert.equal("musicKey" in restored, false, "historical candidate restoration never creates a new audio handoff");
    const before = sourceCalls; missingLegacy = true;
    await assert.rejects(legacy.execute(historical), /legacy generation is retired/);
    assert.equal(sourceCalls, before, "historical restoration never becomes a new Engine request");
  } finally {
    loader._load = original;
    if (previous === undefined) delete process.env.RENDER_MANAGEMENT_API_KEY; else process.env.RENDER_MANAGEMENT_API_KEY = previous;
  }
  console.log("shared music Engine ownership/budget/accounting and read-only legacy handoff passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
