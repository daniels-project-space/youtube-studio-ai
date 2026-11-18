import assert from "node:assert/strict";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { reconcileLegacyPreparedScriptTiming } from "@/lib/legacyPreparedScriptTiming";
import { planWeekPreparationKey, planWeekPreparationManifestSha256, planWeekPreparedScriptKey, type PlanWeekPreparationManifest } from "@/lib/planWeekPreparation";
import { assertPlanWeekPreparedNarrationArgs } from "@/lib/planWeekPreparedNarrationArgs";

function fixture(niche = "history", genre = "documentary", target = 240) {
  const manifest = { version: "plan-week-preparation/inputs-v1", ownerId: "owner", channelId: "channel", channelSlug: "sample",
    batchId: "batch", itemId: "item", itemKey: "week:0", requestKey: "week", frozenAt: 1,
    plan: { topic: "A synthetic story", title: "Synthetic", description: "Synthetic", sceneSeed: "Synthetic", thumbnailKey: "owner/owner/thumb", thumbnailSource: "planner_artwork" },
    execution: { pipeline: [{ block: "script_gen", params: { maxSeconds: target, genre } }], moduleConfig: {}, seedStore: { niche } },
    prompts: { script: "Synthetic brief", narration: "Synthetic", shotlist: "Synthetic", visual: "Synthetic" } } as PlanWeekPreparationManifest;
  const script = { hook: "Begin here.", sections: [{ heading: "Body", narration: "A synthetic line." }], narrationText: "Begin here. A synthetic line.", estDurationSec: 10 };
  const manifestSha256 = planWeekPreparationManifestSha256(manifest);
  const prepared = { version: "plan-week-prepared-script/v1", manifestSha256, ownerId: manifest.ownerId, channelId: manifest.channelId,
    batchId: manifest.batchId, itemId: manifest.itemId, requestKey: manifest.requestKey, topic: manifest.plan.topic,
    script, scriptSha256: sha256Hex(canonicalJson(script)), createdAt: 1 };
  const payload = { ownerId: manifest.ownerId, channelId: manifest.channelId, channelSlug: manifest.channelSlug, batchId: manifest.batchId,
    itemId: manifest.itemId, manifestKey: planWeekPreparationKey(manifest), manifestSha256, maxSeconds: 240, maxCostUsd: 1 };
  const request = { topic: manifest.plan.topic, niche, qualityProfile: "production", maxSeconds: 240,
    endWithSummary: true, voiceTags: false, dataRich: false, sourceAttributionRequired: false,
    weeklyPreparationBrief: manifest.prompts.script,
    openingDeviceIdx: [...manifest.requestKey].reduce((sum, char) => sum + char.charCodeAt(0), 0) };
  const claim = { version: "prepared-generation-dispatch/v1", stage: "script", ownerId: manifest.ownerId, channelId: manifest.channelId,
    batchId: manifest.batchId, itemId: manifest.itemId, manifestSha256, requestSha256: sha256Hex(canonicalJson({ payload, request })), costUsd: null };
  const run = { id: "run_legacy", taskIdentifier: "plan-week-prepared-script", status: "COMPLETED", isTest: false,
    payload: { ...payload, maxSeconds: undefined }, output: { ok: true, reused: false, scriptSha256: prepared.scriptSha256, sidecarKey: planWeekPreparedScriptKey(manifest) } };
  return { manifest, prepared, run, claim, runId: run.id };
}

const standard = fixture();
const hash = standard.prepared.scriptSha256;
assert.equal(reconcileLegacyPreparedScriptTiming(standard).targetSeconds, 240);
assert.equal(standard.prepared.scriptSha256, hash, "reconciliation does not rewrite the script hash");
assert.equal(reconcileLegacyPreparedScriptTiming(fixture("meditation", "meditation")).targetSeconds, 240);
assert.throws(() => reconcileLegacyPreparedScriptTiming(fixture("history", "documentary", 1200)), /conflicts/);
assert.throws(() => reconcileLegacyPreparedScriptTiming(fixture("history", "meditation")), /conflicts/);
for (const run of [
  { ...standard.run, output: { ...standard.run.output, reused: true } },
  { ...standard.run, output: { ...standard.run.output, scriptSha256: "a".repeat(64) } },
  { ...standard.run, isTest: true }, { ...standard.run, status: "FAILED" },
]) assert.throws(() => reconcileLegacyPreparedScriptTiming({ ...standard, run }), /does not bind/);
assert.throws(() => reconcileLegacyPreparedScriptTiming({ ...standard, claim: { ...standard.claim, requestSha256: "b".repeat(64) } }), /does not bind/);
assert.throws(() => reconcileLegacyPreparedScriptTiming({ ...standard, claim: undefined }), /invalid dispatch claim/);
const narrationArgs = assertPlanWeekPreparedNarrationArgs({ ...standard.run.payload, maxCostUsd: 1, legacyScriptRunId: "run_legacy" });
assert.equal(narrationArgs.legacyScriptRunId, "run_legacy");
assert.throws(() => assertPlanWeekPreparedNarrationArgs({ ...standard.run.payload, maxCostUsd: 1, legacyScriptRunId: "../foreign" }), /legacy script run id/);
console.log("Legacy timing requires a matching completed original run, script hash, scoped claim, duration, and genre profile");
