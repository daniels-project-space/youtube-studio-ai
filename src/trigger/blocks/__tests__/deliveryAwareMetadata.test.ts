import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { DELIVERY_METADATA_VERSION } from "@/lib/metadataDelivery";
import { titleDecisionFingerprint } from "@/lib/titleDecisionFingerprint";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch;
const prompts: string[] = [];
let title = "Quiet coastal music for focus (2 hours)", configured = true;
async function main() {
  loader._load = function(id, ...args) {
    const actual = originalLoad.call(this, id, ...args);
    if (id.endsWith("/performance")) return { ...actual as object, loadPerformanceContext: async () => "" };
    if (id.endsWith("/convexHttpClient")) return { ...actual as object, convex: () => ({ query: async () => ({ estimatedViews: 0, source: "fixture" }) }) };
    if (id.endsWith("/creativeText")) return { ...actual as object, hasCreativeTextKey: () => configured,
      creativeTextJson: async ({ prompt }: { prompt: string }) => {
        prompts.push(prompt);
        if (prompt.includes("pinned comment")) return { comment: "Which setting suits your focus?" };
        if (prompt.includes("description + tags")) return { description: "Quiet coastal music for focus.", tagsCsv: "coast,focus,music,quiet,calm" };
        if (prompt.startsWith("You are a YouTube CTR strategist")) return { rankings: [{ idx: 0,
          clickScore: 9, direct: 9, identityFit: 9, viewerMotivation: 9, grounding: "supported", reason: "Synthetic judge, not musical qualification." }], winner: 0, runnerUp: 0 };
        return { candidates: [{ frame: "mood", title }] };
      } };
    return actual;
  };
  globalThis.fetch = async url => {
    assert.match(String(url), /^https:\/\/suggestqueries\.google\.com\//);
    return Response.json(["", []]);
  };
  try {
    const require = createRequire(import.meta.url);
    const { registerAllBlocks } = require("@/engine/blocks");
    const { getManifest } = require("@/engine/registry");
    const { validatePipeline } = require("@/engine/validate");
    const { runPipeline } = require("@/engine/runner");
    const { designPipeline, designPipelineCore } = require("@/engine/designer");
    registerAllBlocks();
    const { enforceLengthContract } = require("@/engine/designerCore");
    const pinned = enforceLengthContract([
      { block: "metadata", version: DELIVERY_METADATA_VERSION, params: { targetDurationSec: 30 } },
    ], 7200, "music_loop");
    assert.equal(pinned.pipeline[0].params.targetDurationSec, 7200,
      "explicit metadata configuration must obey the final-video duration owner");
    for (const family of ["music_loop", "sleep", "narrated_stock", "shorts"]) {
      const design = designPipeline({ family, nicheKey: family === "music_loop" ? "lofi" : "motivation" });
      const metadata = design.pipeline.find((entry: { block: string }) => entry.block === "metadata");
      assert.notEqual(metadata.version, DELIVERY_METADATA_VERSION, "new metadata remains opt-in until preview and weekly admission are qualified");
      assert.doesNotThrow(() => designPipelineCore({ family, nicheKey: "lofi" }, { validateRuntimeRegistry: false }));
    }
    const ctx = { ownerId: "owner-fixture", channelId: "channel-fixture", runId: "run-fixture", keyPrefix: "fixture/",
      params: { targetDurationSec: 7200 }, budgetUsd: 10, assertInlinePaidExecutionLease: async () => {}, log: () => {},
      store: { topic: "Quiet coastal music for focus", channelName: "Coastal Desk", family: "music_loop", niche: "lofi",
        persona: "Patient, restrained music", competitors: [], musicDurationSec: 30, loopSourceDurationSec: 30 } };
    const current = getManifest("metadata", DELIVERY_METADATA_VERSION);
    const graph = validatePipeline([{ block: "metadata", version: DELIVERY_METADATA_VERSION, params: ctx.params }], Object.keys(ctx.store));
    const result = await runPipeline(graph, { ...ctx, seedStore: ctx.store, sink: { async upsert() {}, async upsertArtifacts() {} } });
    assert.equal(result.ok, true, result.error); assert.equal(result.store.title, title);
    assert.equal(prompts.length, 4);
    for (const prompt of prompts) {
      const context = JSON.parse(prompt.split("VIDEO CONTEXT JSON:\n")[1].split("\nEND VIDEO CONTEXT")[0]);
      assert.deepEqual(context.delivery, { basis: "planned", durationSec: 7200 });
      assert.deepEqual(context.source, { kind: "topic_only", text: "" }, "delivery timing must not be represented as spoken source");
    }
    const decision = result.store.titleDecision;
    assert.deepEqual(decision.delivery, { basis: "planned", durationSec: 7200 });
    assert.equal(decision.fingerprint, titleDecisionFingerprint(decision));
    assert.notEqual(decision.fingerprint, titleDecisionFingerprint({ ...decision, delivery: { basis: "measured", durationSec: 7200 } }));
    prompts.length = 0; title = "Quiet coastal music for focus (1 hour)";
    const measured = await current.execute({ ...ctx, store: { ...ctx.store, videoDurationSec: 3600 } });
    assert.equal(measured.title, title); assert.deepEqual(measured.titleDecision.delivery, { basis: "measured", durationSec: 3600 });
    prompts.length = 0; title = "Quiet coastal music for focus (3 hours)";
    await assert.rejects(() => current.execute(ctx), /duration claim/);
    assert.equal(prompts.filter(prompt => prompt.startsWith("You are a YouTube CTR strategist")).length, 0,
      "wrong runtime must not purchase a semantic judge or package");
    for (const altered of [{ ...ctx, params: {} }, { ...ctx, params: { targetDurationSec: "7200" } },
      { ...ctx, store: { ...ctx.store, videoDurationSec: NaN } }]) {
      prompts.length = 0; await assert.rejects(() => current.execute(altered)); assert.equal(prompts.length, 0);
    }
    configured = false; prompts.length = 0;
    await assert.rejects(() => current.execute(ctx), /requires its configured title reviewer/);
    assert.equal(prompts.length, 0);
    const legacy = await getManifest("metadata").execute(ctx);
    assert.equal(legacy.titleDecision, null, "legacy degraded behavior is unchanged");
    console.log("DELIVERY METADATA PASS: actual creator and runner, four creative consumers, planned/measured separation, short-source isolation, duration refusal before judge, sealed receipt and legacy parity; providers synthetic.");
  } finally { loader._load = originalLoad; globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
