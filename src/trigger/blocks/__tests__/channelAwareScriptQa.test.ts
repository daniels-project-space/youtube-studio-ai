import assert from "node:assert/strict";
import { registerAllBlocks } from "@/engine/blocks";
import { allManifests, getManifest } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import { createModelUsageScope } from "@/lib/modelUsage";
import type { StageContext } from "@/engine/types";
import { CHANNEL_AWARE_SCRIPT_QA_VERSION } from "../channelAwareScriptQa";

async function main() {
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  const prompts: string[] = [];
  let verdict = { pass: true, issues: [] as string[] };
  const context: StageContext = { ownerId: "critic-owner", channelId: "critic-channel", runId: "critic-run",
    keyPrefix: "owner/critic-owner/", budgetUsd: 20, params: {}, log: () => {},
    store: { channelName: "Quiet Evening", persona: "Listeners winding down without dramatic stimulation.",
      styleGrammar: "Gentle invitations, spacious pauses and deliberate repetition.",
      criticDoctrine: "Never force a suspense hook or an argumentative thesis into guided relaxation.",
      narrationText: "Notice the support beneath you. Let the next breath arrive without effort." } };
  try {
    process.env.OPENROUTER_API_KEY = "synthetic-only-no-provider-access";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 2500); assert.equal(body.temperature, 0.3);
      prompts.push(body.messages.at(-1).content);
      return Response.json({ id: `channel-critic-${prompts.length}`, model: body.model,
        choices: [{ message: { content: JSON.stringify(verdict) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.003 } });
    };
    registerAllBlocks();
    const legacy = getManifest("qa_script")!, selected = getManifest("qa_script", CHANNEL_AWARE_SCRIPT_QA_VERSION)!;
    assert.ok(selected); assert.notEqual(selected, legacy);
    assert.equal(allManifests().includes(selected), false, "no silent default migration");
    const invoke = (manifest: typeof legacy, ctx = context) => createModelUsageScope().run(() => manifest.execute(ctx));

    await invoke(legacy);
    const baseline = prompts.at(-1)!;
    assert.match(baseline, /require a genuine, specific POINT OF VIEW/);
    assert.match(baseline, /verify a deliberate MIDPOINT RE-HOOK exists/);
    assert.doesNotMatch(baseline, /Gentle invitations|Never force a suspense hook/,
      "baseline reproduces the dropped channel-specific standards");
    const selectedOnlyKeys = new Set(["channelName", "contentLane", "criticDoctrine", "styleGrammar"]);
    await invoke(legacy, { ...context, store: new Proxy(context.store, {
      get(target, key) {
        assert.equal(selectedOnlyKeys.has(String(key)), false, `legacy critic must not read selected-only input ${String(key)}`);
        return Reflect.get(target, key);
      },
    }) });
    assert.equal(prompts.at(-1), baseline);

    for (const store of [context.store,
      { ...context.store, channelName: "Measured Argument", persona: "Curious adults seeking a reasoned argument.",
        styleGrammar: "Specific thesis, counterexample, evidence and payoff.", criticDoctrine: "Require a clear midpoint challenge to the opening claim.",
        script: { hookLoop: "Why did the second seed survive?" } },
      { ...context.store, channelName: "One Clear Minute", persona: "Busy viewers seeking one useful idea.",
        styleGrammar: "Compact opening, concrete example and concise payoff.", criticDoctrine: "Reject setup that consumes the whole short." }]) {
      assert.deepEqual(await invoke(selected, { ...context, store }), { scriptApproved: true });
      const prompt = prompts.at(-1)!;
      for (const key of ["channelName", "persona", "styleGrammar", "criticDoctrine"] as const) {
        assert.ok(prompt.includes(String(store[key])), `${key} must reach this channel's critic`);
      }
      assert.doesNotMatch(prompt, /require a genuine, specific POINT OF VIEW|verify a deliberate MIDPOINT RE-HOOK exists/);
      assert.match(prompt, /Channel personality cannot waive the sealed route/);
      if (store.script) assert.match(prompt, /Why did the second seed survive/);
    }
    await invoke(legacy);
    assert.equal(prompts.at(-1), baseline, "legacy prompt remains byte-for-byte unchanged after selecting the new revision");
    for (const store of [{ narrationText: context.store.narrationText },
      { narrationText: context.store.narrationText, channelName: "Unnamed personality" }]) {
      const before = prompts.length;
      await assert.rejects(invoke(selected, { ...context, store }), /requires frozen channel name and authored personality/);
      assert.equal(prompts.length, before, "missing channel context cannot buy a generic substitute review");
    }

    const entries = [{ block: "qa_script", version: CHANNEL_AWARE_SCRIPT_QA_VERSION }, { block: "narration_tts" }];
    assert.throws(() => validatePipeline(entries, ["narrationText"]), /channelName/);
    const graph = validatePipeline(entries, Object.keys(context.store));
    verdict = { pass: false, issues: ["The narration contradicts the channel's quiet delivery."] };
    const stages: string[] = [], before = prompts.length;
    const result = await runPipeline(graph, { ownerId: context.ownerId, channelId: context.channelId,
      runId: context.runId, keyPrefix: context.keyPrefix, budgetUsd: 20, defaultRetries: 2,
      seedStore: context.store, sink: { async upsert(row) { stages.push(row.block); } } });
    assert.equal(result.ok, false); assert.match(result.error ?? "", /quiet delivery/);
    assert.equal(stages.includes("narration_tts"), false);
    assert.equal(prompts.length, before + 1, "failed verdict cannot cause a blind critic retry");
    assert.ok(result.costTotal > 0, "rejected fixture verdict remains accounted");
    console.log("CHANNEL-AWARE SCRIPT QA PASS: three distinct channel briefs, strict version selection, unchanged legacy prompt, context refusal and real runner rejection before TTS; critic transport synthetic");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
