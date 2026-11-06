import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type { Block, StageContext } from "@/engine/types";
import { createImageUsageScope, recordImageUsage } from "@/lib/imageUsage";
import { classifyExecutionError } from "@/engine/executionErrors";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
let renders = 0, reviews = 0, motions = 0, assets = 0;
const storedOutputs = new Map<string, Uint8Array>();
let replies: unknown[] = [];
const prompts: string[] = [];
const ctx = {
  ownerId: "fixture", channelId: "fixture", runId: "fixture", keyPrefix: "fixture",
  budgetUsd: 10, stageBudgetUsd: 10, params: {}, log: () => {},
  store: {
    scenes: [{ fluxPrompt: "A lighthouse desk overlooking the sea", klingMotionPrompt: "Subtle waves outside the window" }],
    styleDNA: { recurringSubject: "A lighthouse keeper's desk", setting: "A coastal lighthouse" },
  },
} as StageContext;
function reset(values: unknown[]) {
  replies = values; renders = 0; reviews = 0; motions = 0; assets = 0; prompts.length = 0;
}
async function main() {
  process.env.R2_BUCKET ??= "youtube-fixture-bucket";
  loader._load = function(id, ...args) {
    const actual = originalLoad.call(this, id, ...args);
    if (id === "@/lib/hyperYoutubeStageClient") return { ...actual as object,
      configuredHyperYoutubeStageClient: () => ({ binding: async () => ({ outputBucket: process.env.R2_BUCKET }) }) };
    if (id === "@/lib/hyperYoutubeStill") return { ...actual as object, renderHyperYoutubeStill: async (value: { scope: { prompt: string } }) => {
      renders++; prompts.push(value.scope.prompt);
      recordImageUsage({ provider: "fixture", model: "ernie-image-turbo", route: "hrs-fixture", images: 1, costUsd: 0.01 });
      const bytes = Buffer.from("fixture-native-still");
      return { bytes, jobId: `hrs-fixture-${renders}`, projectId: "fixture-project", generation: 1,
        idempotencyKey: `hrs-key-${renders}`, output: { bucket: process.env.R2_BUCKET!, key: `projects/youtube/still-${renders}.png`,
          sha256: "a".repeat(64), bytes: bytes.length, contentType: "image/png" } };
    } };
    if (id === "@/lib/hyperYoutubeStillComposition") return { ...actual as object,
      composeHyperYoutubeStill16x9: async () => Buffer.from("fixture-composite") };
    if (id === "@/lib/storage") return { ...actual as object,
      putObject: async (key: string, bytes: Uint8Array) => { storedOutputs.set(key, Buffer.from(bytes)); },
      getObjectBytes: async (key: string) => storedOutputs.get(key) ?? Buffer.from("fixture-missing"),
      publicUrl: (key: string) => `https://fixture.invalid/${key}` };
    if (id === "@/lib/novitaMedia") return { ...actual as object, renderNovitaImage: async (args: { prompt: string }) => {
      renders++; prompts.push(args.prompt);
      recordImageUsage({ provider: "fixture", model: "fixture", route: "fixture", images: 1, costUsd: 0.01 });
      return { url: "https://fixture.invalid/still.png", key: `still-${renders}`, jobId: `job-${renders}`, model: "fixture", costUsd: 0.01 };
    } };
    if (id === "@/lib/files") return { ...actual as object,
      makeRunTempDir: async () => "/tmp/keyframe-fixture", downloadTo: async (_url: string, path: string) => path };
    if (id === "./blockContext") return { ...actual as object, recordAsset: async () => { assets++; } };
    if (id === "@/lib/vision") return { ...actual as object, hasNonGoogleVisionKey: () => true,
      visionLocal: async (args: { prompt: string }) => {
        if (args.prompt.includes("art director")) {
          reviews++;
          assert.match(args.prompt, /A coastal lighthouse/);
          const value = replies.shift();
          if (value instanceof Error) throw value;
          return JSON.stringify(value);
        }
        motions++;
        return JSON.stringify({ motion: "Small waves move outside the lighthouse window." });
      } };
    return actual;
  };
  try {
    const block: Block = createRequire(import.meta.url)("../lofiBlocks").keyframes;
    reset([{ score: 0.6, issues: ["Missing the sea"] }, { score: 0.7, issues: ["Still no sea"] }]);
    const costs = createImageUsageScope();
    await assert.rejects(() => costs.run(() => block.run(ctx)), (error: unknown) => {
      assert.match(String(error), /keyframes:.*rejected/);
      assert.equal(classifyExecutionError(error).retryable, false);
      return true;
    });
    assert.equal(renders, 2); assert.equal(reviews, 2); assert.equal(motions, 0); assert.equal(assets, 0);
    assert.equal(costs.snapshot().costUsd, 0.02, "rejected images retain their known charge");
    assert.match(prompts[1], /Missing the sea/);

    for (const verdict of [
      { score: "1", issues: [] }, { score: 999, issues: [] }, { score: -1, issues: [] },
      { score: 1 }, { score: 1, issues: [42] }, { score: 1, issues: [""] },
      { score: 1, issues: ["x".repeat(501)] }, null, [],
      new Error("network timeout"),
    ]) {
      reset([verdict]);
      await assert.rejects(() => block.run(ctx), (error: unknown) => {
        assert.match(String(error), /independent art-direction review failed/);
        assert.equal(classifyExecutionError(error).retryable, false);
        return true;
      });
      assert.equal(renders, 1); assert.equal(motions, 0); assert.equal(assets, 0);
    }
    for (const verdicts of [
      [{ score: 0.8, issues: [] }],
      [{ score: 0.7, issues: ["Missing sea"] }, { score: 0.9, issues: [] }],
    ]) {
      const count = verdicts.length;
      reset(verdicts);
      const patch = await block.run(ctx);
      assert.equal(patch.f1Key, `fixture/runs/fixture/lofi-keyframe/hrs-fixture-${count}-1.png`);
      assert.equal(motions, 1); assert.equal(assets, 1); assert.equal(renders, count);
    }
    reset([{ score: 0.6, issues: ["Missing sea"] }, { score: 0.7, issues: ["Missing sea"] }]);
    assert.equal((await block.run({ ...ctx, params: { qaProfile: "draft" } })).f1Key,
      "fixture/runs/fixture/lofi-keyframe/hrs-fixture-2-1.png");
    console.log("Keyframe admission passed: actual block rejects failed/malformed production reviews before asset admission or motion; accepted and explicit draft paths preserved; transport synthetic.");
  } finally { loader._load = originalLoad; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
