import assert from "node:assert/strict";
import Module from "node:module";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";

const missing = () => Object.assign(new Error("fixture missing checkpoint"), {
  name: "NoSuchKey", $metadata: { httpStatusCode: 404 },
});

async function main(): Promise<void> {
  const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  let responseIndex = 0;
  let producerCalls = 0;
  const responses: unknown[] = [];
  const producerPrompts: string[] = [];
  loader._load = function (name, ...args) {
    if (name === "@/lib/storage") return {
      getObjectBytes: async () => { throw missing(); },
      putObject: async () => {},
    };
    return originalLoad.call(this, name, ...args);
  };

  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    const { registerAllBlocks } = await import("@/engine/blocks");
    registerAllBlocks();
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      const prompt = body.messages.at(-1).content;
      const value = prompt.startsWith("Write ONE scroll-stopping hook line")
        ? (producerPrompts.push(prompt), {
          hook: producerCalls++ === 0
            ? "The cracked valve saved every worker from a deadly explosion"
            : "A cracked valve warning stopped the factory before pressure became dangerous",
        })
        : prompt.startsWith("Judge ONE hook line")
          ? responses[responseIndex++]
          : assert.fail(`unexpected Hookcraft request: ${String(prompt).slice(0, 100)}`);
      return Response.json({
        id: `fixture-hook-${responseIndex}`,
        model: body.model,
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, cost: 0.003 },
      });
    };

    for (const [label, malformed] of [
      ["out-of-range score", { pass: true, score: 9, issues: [] }],
      ["missing score", { pass: true, issues: [] }],
      ["missing pass", { score: 1, issues: [] }],
      ["malformed issues", { pass: true, score: 1, issues: ["   "] }],
      ["too many issues", { pass: true, score: 1, issues: Array(5).fill("vague promise") }],
      ["overlong issue", { pass: false, score: 0.2, issues: ["x".repeat(141)] }],
    ] as const) {
      responseIndex = 0;
      responses.splice(0, responses.length, malformed);
      const result = await runPipeline(
        validatePipeline([{ block: "hook_craft", params: {} }], ["narrationText"]),
        {
          ownerId: "owner-hook-critique-contract-test",
          channelId: "channel-hook-critique-contract-test",
          runId: `run-hook-critique-contract-${label.replaceAll(" ", "-")}`,
          keyPrefix: "owners/owner-hook-critique-contract-test/",
          budgetUsd: 1,
          defaultRetries: 2,
          seedStore: {
            narrationText: "A factory inspection found a cracked valve before pressure reached its limit. The crew stopped the line before anyone was hurt.",
          },
          sink: { async upsert() {} },
        },
      );
      assert.equal(result.ok, false, `${label}: malformed verdict must not approve a hook`);
      assert.match(result.error ?? "", /independent hook critic unavailable.*malformed hook critique/);
      assert.equal(responseIndex, 1, "reject the verdict without another paid generation or critic call");
      assert.equal(Object.hasOwn(result.store, "hook"), false, "malformed evidence never persists a hook");
    }

    const repairIssue = "The narration does not establish that every worker was saved from an explosion.";
    responseIndex = 0;
    producerCalls = 0;
    producerPrompts.length = 0;
    responses.splice(0, responses.length,
      { pass: true, score: 0.96, issues: [repairIssue] },
      { pass: true, score: 0.9, issues: [] },
    );
    const repaired = await runPipeline(
      validatePipeline([{ block: "hook_craft", params: {} }], ["narrationText"]),
      {
        ownerId: "owner-hook-critique-contract-test",
        channelId: "channel-hook-critique-contract-test",
        runId: "run-hook-critique-contradictory-pass",
        keyPrefix: "owners/owner-hook-critique-contract-test/",
        budgetUsd: 1,
        defaultRetries: 2,
        seedStore: {
          narrationText: "A factory inspection found a cracked valve before pressure reached its limit. The crew stopped the line before anyone was hurt.",
        },
        sink: { async upsert() {} },
      },
    );
    assert.equal(repaired.ok, true, "a clean repaired hook is admitted");
    assert.equal(responseIndex, 2, "a passing verdict with defects must be retried once");
    assert.ok(
      producerPrompts[1]?.includes(repairIssue),
      "the contradictory verdict's defect must inform the repaired draft",
    );
    assert.equal(
      repaired.store.hook,
      "A cracked valve warning stopped the factory before pressure became dangerous",
      "the clean retry, not the higher-scoring defective hook, becomes the stage output",
    );

    console.log("HOOK_CRAFT CRITIQUE CONTRACT PASS: malformed verdicts rejected and contradictory passing defects repaired");
  } finally {
    loader._load = originalLoad;
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
