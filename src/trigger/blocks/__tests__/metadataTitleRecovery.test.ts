import assert from "node:assert/strict";
import Module from "node:module";
import type { StageContext } from "@/engine/types";
import { createCheckpointCostScope } from "@/lib/checkpointCostAccounting";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";
import { readTitleReview } from "@/lib/titleReviewPresentation";

process.env.OPENROUTER_API_KEY = "fixture-key";
const honest = "47 Engineers Died in the Bridge Collapse";
const contradicted = "47 Engineers Survived the Bridge Collapse";
const source = "A sourced account. ".repeat(100) + "The bridge collapse killed 47 engineers. No engineers survived.";
const objects = new Map<string, Uint8Array>();
let calls: string[] = [], knownCost = 0, unpriced = 0, hasKey = true, packageFailures = 0;
let unknownPhase = "", readFailure = "", failWrite = "", badUsage = false, unpricedPhase = "", revoked = false;
const notFound = () => Object.assign(new Error("not found"), { name: "NoSuchKey" });
const load = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function(this: unknown, request: string, ...rest: unknown[]) {
  const actual = load.call(this, request, ...rest) as Record<string, unknown>;
  if (request.endsWith("/storage")) return { ...actual,
    getObjectBytes: async (key: string) => { if (readFailure) throw Object.assign(new Error(readFailure), { name: readFailure }); const value = objects.get(key); if (!value) throw notFound(); return value; },
    putObject: async (key: string, bytes: Uint8Array, opts: { ifNoneMatch?: string }) => {
      assert.equal(opts.ifNoneMatch, "*", "all metadata checkpoint writes must be immutable create-only");
      if (key.includes(failWrite) && failWrite) { failWrite = ""; throw new Error("simulated write outage"); }
      if (objects.has(key)) throw Object.assign(new Error("already exists"), { $metadata: { httpStatusCode: 412 } });
      objects.set(key, Uint8Array.from(bytes)); return key;
    },
  };
  if (request.endsWith("/performance")) return { ...actual, loadPerformanceContext: async () => "Frozen real performance fixture" };
  if (request.endsWith("/anthropic")) return { ...actual, hasAnthropicKey: () => hasKey,
    claudeJson: async ({ prompt }: { prompt: string }) => {
      const phase = prompt.startsWith("Write SEVEN") ? "generator" : prompt.startsWith("You are") ? "judge" : prompt.startsWith("Write the YouTube") ? "package" : "comment";
      calls.push(phase); knownCost += 0.01;
      if (badUsage || unpricedPhase === phase) unpriced++;
      if (unknownPhase === phase) throw new OpenRouterGenerationOutcomeUnknownError("lost " + phase + " response");
      if (phase === "generator") return { candidates: [{ frame: "direct_verdict", title: honest }] };
      if (phase === "judge") {
        assert.ok(prompt.includes("No engineers survived."), "actual caller must send narration beyond first800 characters");
        assert.ok(prompt.includes('"kind":"full_narration"'));
        if (revoked) throw new Error("test revoked before judge response");
        return { rankings: [
          { idx: 0, clickScore: 10, direct: 10, identityFit: 9, grounding: "contradicted", reason: "No engineers survived" },
          { idx: 1, clickScore: 9, direct: 9, identityFit: 9, grounding: "supported", reason: "Source explicitly says killed47" },
        ] };
      }
      if (phase === "package") { if (packageFailures-- > 0) return {}; return { title: contradicted, description: "A sourced engineering account.", tagsCsv: "bridge,engineers,collapse,history,design" }; }
      return { comment: "Which engineering decision mattered most?" };
    },
  };
  return actual;
} as never;
// All external evidence is frozen; any accidental live lookup fails the test.
globalThis.fetch = async () => { throw new Error("unexpected network"); };
// Load only after the real provider/storage module seams have been isolated.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { metadataOptimized, finishMetadata, metadataTitleArgsForStage } = require("../intelligenceBlocks") as typeof import("../intelligenceBlocks");
function reset() {
  objects.clear(); calls = []; knownCost = 0; unpriced = 0; hasKey = true; packageFailures = 0;
  unknownPhase = ""; readFailure = ""; failWrite = ""; badUsage = false; unpricedPhase = ""; revoked = false;
}
function context(runId = "run-fixture"): StageContext {
  return {
    ownerId: "owner-fixture", channelId: "channel-fixture", runId, keyPrefix: "fixture/", params: {}, budgetUsd: 1,
    store: { topic: "Bridge collapse", channelName: "Field Notes", narrationText: source, plannedTitle: contradicted, competitors: [] },
    log: () => {}, modelUsageAccounting: () => ({ calls: calls.length, cacheHits: 0, costUsd: knownCost, unpricedCalls: unpriced }),
    assertInlinePaidExecutionLease: async () => {},
  };
}
async function main() {
  reset(); packageFailures = 1;
  const scope = createCheckpointCostScope([], 0);
  const first = await scope.run(() => metadataOptimized.run(context()));
  assert.equal(first.title, honest);
  assert.equal(first.titleAlternate, "");
  assert.ok(first.titleDecision);
  const presented = readTitleReview(first);
  assert.ok(presented && presented.state === "recorded", "actual module output must feed the run inspector");
  assert.equal(presented.selected.title, honest);
  assert.equal(presented.options[0].grounding, "contradicted");
  assert.equal(presented.source, "Full narration");
  assert.ok(String(first.thumbnailDescription).includes(honest));
  assert.deepEqual(calls, ["generator", "judge", "package", "package", "comment"]);
  assert.equal(first.__costUsd, 0.05);
  const manifest = JSON.parse(Buffer.from(objects.get("fixture/runs/run-fixture/metadata-title/v1/manifest.json")!).toString());
  assert.deepEqual(manifest.args, JSON.parse(JSON.stringify({ ...metadataTitleArgsForStage(context()), perfContext: "Frozen real performance fixture" })),
    "actual metadata body and read-only builder freeze byte-equivalent arguments");
  const before = calls.length;
  hasKey = false; knownCost = 0;
  const prior = scope.snapshot();
  const resumedScope = createCheckpointCostScope(prior.receipts, 0.05);
  const resumed = await resumedScope.run(() => metadataOptimized.run(context()));
  assert.equal(resumed.title, honest);
  assert.equal(calls.length, before, "completed durable result makes zero provider calls even after key removed");
  assert.equal(resumedScope.snapshot().alreadyAccountedCostUsd, 0.05, "exact restored receipts dedupe previous paid work");
  assert.equal(finishMetadata(context(), { title: "Field Notes: " + honest, description: "account", tags: ["bridge"], channelName: "Field Notes", nicheIntel: null }).title,
    "Field Notes: " + honest, "package finishing never silently edits an admitted title");

  reset(); hasKey = false;
  await assert.rejects(() => metadataOptimized.run(context()), /OPENROUTER_API_KEY missing/);
  assert.equal(calls.length, 0, "no degraded planned-title success");
  assert.ok(![...objects.keys()].some((key) => key.endsWith("selection.claim.json")), "missing key never claims paid selection");
  for (const phase of ["judge", "package", "comment"]) {
    reset(); unknownPhase = phase;
    await assert.rejects(() => metadataOptimized.run(context()), /lost/);
    const count: number = calls.length; unknownPhase = ""; knownCost = 0;
    await assert.rejects(() => metadataOptimized.run(context()), /RECONCILIATION_REQUIRED/);
    assert.equal(calls.length, count, "unknown " + phase + " outcome never buys replay/fallback");
    if (phase !== "judge") assert.ok([...objects.keys()].some((key) => key.endsWith("selection.outcome.json")), "selected title remains durably available");
  }
  reset(); packageFailures = 2;
  await assert.rejects(() => metadataOptimized.run(context()), /both package attempts/);
  const failedCount = calls.length; knownCost = 0;
  await assert.rejects(() => metadataOptimized.run(context()), /both package attempts/);
  assert.equal(calls.length, failedCount, "package max2 persists across a task restart");

  reset(); failWrite = "package-2.claim.json"; packageFailures = 1;
  await assert.rejects(() => metadataOptimized.run(context()), /write outage/);
  assert.deepEqual(calls, ["generator", "judge", "package"]);
  knownCost = 0;
  const repaired = await metadataOptimized.run(context());
  assert.equal(repaired.title, honest);
  assert.deepEqual(calls, ["generator", "judge", "package", "package", "comment"], "restart uses approved decision and remaining package attempt");

  reset(); failWrite = "selection.outcome.json";
  await assert.rejects(() => metadataOptimized.run(context()), /write outage/);
  const spent = calls.length; knownCost = 0;
  await assert.rejects(() => metadataOptimized.run(context()), /in-flight\/unknown/);
  assert.equal(calls.length, spent, "lost decision persistence is not a fresh paid start");
  for (const failure of ["ServiceUnavailable", "NoSuchBucket", "AccessDenied"]) {
    reset(); readFailure = failure;
    await assert.rejects(() => metadataOptimized.run(context()), new RegExp(failure));
    assert.equal(calls.length, 0);
  }
  reset(); objects.set("fixture/runs/run-fixture/metadata-title/v1/manifest.json", Buffer.from("{invalid"));
  await assert.rejects(() => metadataOptimized.run(context()), /unreadable checkpoint/);
  assert.equal(calls.length, 0);
  reset(); unpriced = 1;
  await assert.rejects(() => metadataOptimized.run(context()), /preexisting unpriced/);
  assert.equal(calls.length, 0);
  reset(); badUsage = true;
  await assert.rejects(() => metadataOptimized.run(context()), /unpriced/);
  assert.deepEqual(calls, ["generator"], "a new unpriced charge stops the next judge dispatch");
  reset(); unpricedPhase = "comment";
  await assert.rejects(() => metadataOptimized.run(context()), /unpriced/);
  const unpricedCount: number = calls.length; knownCost = 0; unpriced = 0; unpricedPhase = "";
  await assert.rejects(() => metadataOptimized.run(context()), /unpriced/);
  assert.equal(calls.length, unpricedCount, "optional comment may not hide an unpriced charge on resume");
  reset(); const decreasing = context();
  decreasing.modelUsageAccounting = () => ({ calls: calls.length, cacheHits: 0, costUsd: calls.length ? 0 : 0.01, unpricedCalls: 0 });
  await assert.rejects(() => metadataOptimized.run(decreasing), /usage counters decreased/);
  assert.deepEqual(calls, ["generator"], "decreased observed accounting blocks the next paid call");
  reset(); const leased = context();
  leased.assertRemoteChildExecutionLease = async () => { if (calls.length >= 1) throw new Error("lease revoked"); };
  await assert.rejects(() => metadataOptimized.run(leased), /lease revoked/);
  assert.deepEqual(calls, ["generator"], "lease rechecked between generator and judge");
  reset();
  const concurrent = await Promise.allSettled([metadataOptimized.run(context()), metadataOptimized.run(context())]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
  assert.deepEqual(calls, ["generator", "judge", "package", "comment"], "atomic claims allow only one concurrent purchaser");
  const key = [...objects.keys()].find((key) => key.endsWith("selection.outcome.json"))!;
  const altered = JSON.parse(Buffer.from(objects.get(key)!).toString());
  altered.cost.id = "a".repeat(64); objects.set(key, Buffer.from(JSON.stringify(altered)));
  const oldCount = calls.length;
  await assert.rejects(() => metadataOptimized.run(context()), /matching paid claim/);
  assert.equal(calls.length, oldCount);
  console.log("Actual metadata block durable recovery contracts passed (in-memory S3 conditional-write fixture, no live providers)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
