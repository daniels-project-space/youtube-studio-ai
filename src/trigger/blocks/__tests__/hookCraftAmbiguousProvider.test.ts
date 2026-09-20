/**
 * The pipeline-level `hook_craft` block is distinct from lib/Hookcraft, and
 * must preserve an ambiguous paid planner result for the task retry policy.
 * This exercises the registered block through the real runner; only the
 * provider transport is controlled.
 */
import assert from "node:assert/strict";
import Module from "node:module";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";

async function main(): Promise<void> {
  const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (name, ...args) {
    if (name === "@/lib/storage") return {
      getObjectBytes: async () => { throw Object.assign(new Error("fixture missing checkpoint"), {
        name: "NoSuchKey", $metadata: { httpStatusCode: 404 },
      }); },
    };
    return originalLoad.call(this, name, ...args);
  };
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  let providerCalls = 0;
  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    const { registerAllBlocks } = await import("@/engine/blocks");
    registerAllBlocks();
    globalThis.fetch = async (url) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      providerCalls++;
      throw new TypeError("fixture connection closed after request dispatch");
    };

    const result = await runPipeline(
      validatePipeline([{ block: "hook_craft", params: {} }], ["narrationText"]),
      {
        ownerId: "owner-hook-recovery-test",
        channelId: "channel-hook-recovery-test",
        runId: "run-hook-recovery-test",
        keyPrefix: "owners/owner-hook-recovery-test/",
        budgetUsd: 1,
        defaultRetries: 2,
        seedStore: {
          narrationText: "A factory inspection found a cracked valve before the pressure reached its limit. The crew traced the warning through the overnight logs and stopped the line before anyone was hurt.",
        },
        sink: { async upsert() {} },
      },
    );

    assert.equal(result.ok, false, "an ambiguous provider outcome must fail the block, not substitute the narration's first line");
    assert.equal(providerCalls, 1, "the ambiguous planner outcome must not be replayed automatically");
    assert.equal(Object.hasOwn(result.store, "hook"), false, "no fallback hook may be persisted after an ambiguous outcome");
    assert.ok(result.error, "the runner must retain an error for task recovery");
    assert.match(result.error ?? "", /generation may already have consumed provider work/);
    assert.ok(result.error.includes("openRouter"), "the retained execution error must name the provider boundary");
    console.log("HOOK_CRAFT AMBIGUOUS PROVIDER PASS — no fallback, no replay, execution recovery receives the provider ambiguity");
  } finally {
    loader._load = originalLoad;
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
