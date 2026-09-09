import assert from "node:assert/strict";
import { qaScript } from "../narratedBlocks";
import { createModelUsageScope } from "@/lib/modelUsage";
import { registerAllBlocks } from "@/engine/blocks";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import type { StageContext } from "@/engine/types";

async function main(): Promise<void> {
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.OPENROUTER_API_KEY;
  let response: unknown = {};
  let calls = 0;
  const context: StageContext = {
    ownerId: "owner-critique-test", channelId: "channel-critique-test", runId: "run-critique-test",
    keyPrefix: "owners/owner-critique-test/", budgetUsd: 1, params: {},
    store: { narrationText: "The first seed failed in dry soil. Why did the second survive? Its roots reached the water below." },
    log: () => {},
  };
  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions", "no other provider, storage or database traffic");
      calls += 1;
      const body = JSON.parse(String(init?.body));
      assert.match(body.messages.at(-1).content, /^Critique this YouTube narration for quality/);
      assert.equal(body.max_tokens, 2500, "critic token budget unchanged");
      assert.equal(body.temperature, 0.3, "critic temperature unchanged");
      return Response.json({ id: `fixture-critique-${calls}`, model: body.model,
        choices: [{ message: { content: JSON.stringify(response) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.003 } });
    };
    const invalid: Array<[string, unknown]> = [
      ["empty object", {}], ["missing verdict", { issues: [] }],
      ["null verdict", { pass: null, issues: [] }], ["string verdict", { pass: "false", issues: [] }],
      ["numeric verdict", { pass: 1, issues: [] }], ["missing issues", { pass: true }],
      ["string issues", { pass: true, issues: "weak structure" }],
      ["non-string issue", { pass: true, issues: [123] }],
      ["empty issue", { pass: true, issues: ["   "] }],
      ["too many issues", { pass: true, issues: Array(6).fill("weak structure") }],
      ["unbounded issue", { pass: true, issues: ["x".repeat(141)] }],
      ["unexpected schema", { pass: true, issues: [], accepted: false }],
      ["array verdict", []], ["null response", null],
    ];
    for (const [label, value] of invalid) {
      response = value;
      const before = calls, scope = createModelUsageScope();
      await assert.rejects(() => scope.run(() => qaScript.run(context)), /qa_script FAILED: independent narrative critic unavailable/, label);
      assert.equal(calls, before + 1, `${label}: no blind critic retry`);
      assert.equal(scope.snapshot().calls, 1, `${label}: consumed response remains accounted`);
      assert.ok(scope.snapshot().costUsd > 0, `${label}: fixture charge is not erased on rejection`);
    }
    for (const issues of [[], ["The opening promise is not paid off."]]) {
      response = { pass: false, issues };
      await assert.rejects(() => createModelUsageScope().run(() => qaScript.run(context)), /narration failed craft-quality critique/);
    }
    response = { pass: true, issues: [] };
    assert.deepEqual(await createModelUsageScope().run(() => qaScript.run(context)), { scriptApproved: true });

    // Real runner must stop before entering the existing paid narration block.
    registerAllBlocks();
    response = {};
    const stages: Array<{ block: string; status: string }> = [];
    const before = calls;
    const result = await runPipeline(validatePipeline([{ block: "qa_script" }, { block: "narration_tts" }], ["narrationText"]), {
      ownerId: context.ownerId, channelId: context.channelId, runId: context.runId,
      keyPrefix: context.keyPrefix, budgetUsd: 1, defaultRetries: 0, seedStore: context.store,
      sink: { async upsert(row) { stages.push({ block: row.block, status: row.status }); } },
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /qa_script FAILED: independent narrative critic unavailable.*malformed script critique/, "the intended response gate stopped the runner");
    assert.ok(result.costTotal > 0, "the failed runner still accounts for the consumed fixture critic response");
    assert.equal(Object.hasOwn(result.store, "scriptApproved"), false);
    assert.equal(stages.some((stage) => stage.block === "narration_tts"), false, "paid TTS was never entered");
    assert.equal(calls, before + 1);
    console.log(`script critic response PASS: ${invalid.length} malformed responses rejected; valid pass/fail preserved; actual runner stops before TTS`);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
