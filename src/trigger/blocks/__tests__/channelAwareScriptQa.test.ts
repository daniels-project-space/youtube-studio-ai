import assert from "node:assert/strict";
import { registerAllBlocks } from "@/engine/blocks";
import { contentLaneForFamily } from "@/engine/contentLane";
import { allManifests, getManifest } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import { createModelUsageScope } from "@/lib/modelUsage";
import type { StageContext } from "@/engine/types";
import { CHANNEL_AWARE_SCRIPT_QA_VERSION } from "../channelAwareScriptQa";
import {
  CHANNEL_AWARE_SCRIPT_GEN_VERSION,
  selectChannelAwareScriptQa,
} from "@/engine/channelAwareScriptQaSelection";

async function main() {
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  const prompts: string[] = [];
  let verdict = { pass: true, issues: [] as string[] };
  const context: StageContext = { ownerId: "critic-owner", channelId: "critic-channel", runId: "critic-run",
    keyPrefix: "owner/critic-owner/", budgetUsd: 20, params: {}, log: () => {},
    store: { channelName: "Quiet Evening", persona: "Listeners winding down without dramatic stimulation.",
      showBible: { positioning: "Quiet guided listening for people ending a demanding day.",
        vibe: "Soft, spacious, and emotionally unforced.",
        iconicMotif: "A brass telescope under a crescent moon.",
        worksInSpace: ["Use sensory anchors from the immediate room."],
        avoidInSpace: ["Avoid suspense hooks that raise arousal."] },
      styleGrammar: "Watercolor lighthouse illustrations with soft green borders.",
      styleDNA: { narrative: { scriptStyle: "Gentle invitations and deliberate repetition.",
        hookStyle: "A quiet arrival rather than suspense.", pacing: "Spacious pauses.",
        delivery: "Reassuring, without force.", voiceProfile: "Acoustic voice timbre is owned by narration." } },
      criticDoctrine: "Never force a suspense hook or an argumentative thesis into guided relaxation.",
      bannedWords: ["forbidden phrase"],
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
    const legacyWriter = getManifest("script_gen")!;
    const selectedWriter = getManifest("script_gen", CHANNEL_AWARE_SCRIPT_GEN_VERSION)!;
    assert.ok(selected); assert.notEqual(selected, legacy);
    assert.ok(selectedWriter); assert.notEqual(selectedWriter, legacyWriter);
    assert.ok(Object.hasOwn(selected.consumes, "showBible"),
      "the channel-aware critic must review the same authored Show Bible as its paired writer");
    assert.equal(Object.hasOwn(selected.optionalConsumes, "showBible"), false,
      "the selected critic cannot silently degrade to shallow channel guidance");
    assert.ok(Object.hasOwn(selectedWriter.consumes, "showBible"),
      "the identity-grounded writer must require the frozen Show Bible artifact");
    assert.equal(Object.hasOwn(selectedWriter.optionalConsumes, "showBible"), false,
      "the selected writer cannot silently degrade to generic writing when channel identity is missing");
    assert.equal(allManifests().includes(selectedWriter), false, "writer identity grounding is opt-in, not a silent legacy migration");
    const beforeInvalidWriterIdentity = prompts.length;
    for (const showBible of [undefined, {}, { positioning: "Only positioning." },
      { positioning: "A distinct channel.", vibe: "Warm and measured.", worksInSpace: ["Use concrete sensory details."] },
      { positioning: "A distinct channel.", vibe: "Warm and measured.", avoidInSpace: ["Avoid dramatic suspense."] },
      { positioning: 42 }]) {
      await assert.rejects(selectedWriter.execute({
        ...context,
        params: {},
        store: { ...context.store, topic: "A test topic", showBible },
      }), /requires an authored Show Bible/);
    }
    assert.equal(prompts.length, beforeInvalidWriterIdentity,
      "missing, thin, or malformed channel identity must be rejected before provider spend");
    assert.equal(allManifests().includes(selected), false, "no silent default migration");
    const invoke = (manifest: typeof legacy, ctx = context) => createModelUsageScope().run(() => manifest.execute(ctx));

    await invoke(legacy);
    const baseline = prompts.at(-1)!;
    assert.match(baseline, /require a genuine, specific POINT OF VIEW/);
    assert.match(baseline, /verify a deliberate MIDPOINT RE-HOOK exists/);
    assert.doesNotMatch(baseline, /Gentle invitations|Never force a suspense hook/,
      "baseline reproduces the dropped channel-specific standards");
    assert.doesNotMatch(baseline, /forbidden phrase|Forbidden channel wording/,
      "legacy prompt remains unchanged though deterministic QA still enforces language policy");
    const selectedOnlyKeys = new Set(["channelName", "contentLane", "criticDoctrine", "styleGrammar", "styleDNA", "showBible"]);
    await invoke(legacy, { ...context, store: new Proxy(context.store, {
      get(target, key) {
        assert.equal(selectedOnlyKeys.has(String(key)), false, `legacy critic must not read selected-only input ${String(key)}`);
        return Reflect.get(target, key);
      },
    }) });
    assert.equal(prompts.at(-1), baseline);

    for (const store of [context.store,
      { ...context.store,
        narrationText: "Notice the support beneath you.\n\nLet the next breath arrive without effort.",
        channelName: "Measured Argument", persona: "Curious adults seeking a reasoned argument.",
        showBible: { positioning: "Evidence-led arguments that test a clear claim against counterexamples.",
          vibe: "Curious, exacting, and fair-minded.",
          worksInSpace: ["State a falsifiable claim before adding context."],
          avoidInSpace: ["Avoid presenting a disputed claim as settled fact."] },
        styleDNA: { narrative: { scriptStyle: "Specific thesis, counterexample, evidence and payoff.",
          pacing: "Build a careful argument.", hookStyle: "A concrete disputed observation.", delivery: "Measured and precise." } },
        criticDoctrine: "Require a clear midpoint challenge to the opening claim.",
        script: { hook: "Notice the support beneath you.",
          sections: [{ narration: "Let the next breath arrive without effort." }],
          narrationText: "Notice the support beneath you.\n\nLet the next breath arrive without effort.",
          hookLoop: "Why did the second seed survive?" } },
      { ...context.store, channelName: "One Clear Minute", persona: "Busy viewers seeking one useful idea.",
        showBible: { positioning: "One practical idea explained for viewers with a minute to spare.",
          vibe: "Direct, warm, and brisk without rushing.",
          worksInSpace: ["Demonstrate the idea with one everyday example."],
          avoidInSpace: ["Avoid setup that consumes the entire short."] },
        styleDNA: { narrative: { scriptStyle: "Compact opening, concrete example and concise payoff.",
          pacing: "Concise without rushing.", hookStyle: "One useful question.", delivery: "Direct and friendly." } },
        criticDoctrine: "Reject setup that consumes the whole short." }]) {
      assert.deepEqual(await invoke(selected, { ...context, store }), { scriptApproved: true });
      const prompt = prompts.at(-1)!;
      for (const key of ["channelName", "persona", "criticDoctrine"] as const) {
        assert.ok(prompt.includes(String(store[key])), `${key} must reach this channel's critic`);
      }
      const showBible = store.showBible as { positioning: string; vibe: string; worksInSpace: string[]; avoidInSpace: string[] };
      for (const field of [showBible.positioning, showBible.vibe, ...showBible.worksInSpace, ...showBible.avoidInSpace]) {
        assert.ok(prompt.includes(field), `frozen Show Bible guidance must reach this channel's critic: ${field}`);
      }
      const narrative = (store.styleDNA as { narrative: Record<string, string> }).narrative;
      for (const field of ["scriptStyle", "hookStyle", "pacing", "delivery"]) {
        assert.ok(prompt.includes(narrative[field]), `${field} must reach the critic from frozen narrative DNA`);
      }
      assert.doesNotMatch(prompt, /Watercolor lighthouse|Acoustic voice timbre/,
        "visual styling and acoustic voice casting must not become prose-quality requirements");
      assert.doesNotMatch(prompt, /brass telescope under a crescent moon/i,
        "the Show Bible's visual motif stays owned by visual modules");
      assert.doesNotMatch(prompt, /require a genuine, specific POINT OF VIEW|verify a deliberate MIDPOINT RE-HOOK exists/);
      assert.match(prompt, /Channel personality cannot waive the sealed route/);
      assert.match(prompt, /forbidden phrase/);
      if (store.script) assert.match(prompt, /Why did the second seed survive/);
    }
    await invoke(legacy);
    assert.equal(prompts.at(-1), baseline, "legacy prompt remains byte-for-byte unchanged after selecting the new revision");
    const beforeBannedText = prompts.length;
    await assert.rejects(invoke(selected, { ...context, store: { ...context.store,
      narrationText: "The forbidden phrase appeared despite the channel policy." } }), /channel-banned wording/);
    assert.equal(prompts.length, beforeBannedText, "deterministic wording policy rejects before critic spend");
    assert.deepEqual(await invoke(selected, { ...context, store: new Proxy({
      narrationText: context.store.narrationText, channelName: "Narrative only", styleDNA: context.store.styleDNA,
      showBible: context.store.showBible,
    }, { get(target, key) {
      assert.notEqual(key, "styleGrammar", "selected critic must not read visual grammar");
      return Reflect.get(target, key);
    } }) }), { scriptApproved: true });
    for (const styleDNA of [{ narrative: "not structured" }, { narrative: { pacing: 42 } }]) {
      const before = prompts.length;
      await assert.rejects(invoke(selected, { ...context, store: { ...context.store, styleDNA } }));
      assert.equal(prompts.length, before, "malformed narrative DNA must fail before buying a review");
    }
    for (const showBible of [
      undefined,
      {},
      { positioning: "Only positioning." },
      { positioning: "A distinct channel.", vibe: "Warm and measured.", worksInSpace: ["Use concrete details."] },
      { positioning: 42 },
      { positioning: "x".repeat(2001) },
      { worksInSpace: Array.from({ length: 11 }, () => "bounded list") },
      { avoidInSpace: ["x".repeat(501)] },
    ]) {
      const before = prompts.length;
      await assert.rejects(invoke(selected, { ...context, store: { ...context.store, showBible } }));
      assert.equal(prompts.length, before, "malformed Show Bible guidance must fail before buying a review");
    }
    const beforeMissingName = prompts.length;
    await assert.rejects(invoke(selected, { ...context, store: {
      narrationText: context.store.narrationText, showBible: context.store.showBible,
    } }), /requires a frozen channel name and authored Show Bible/);
    assert.equal(prompts.length, beforeMissingName, "missing channel name cannot buy a generic substitute review");
    const beforeMissingBible = prompts.length;
    await assert.rejects(invoke(selected, { ...context, store: {
      narrationText: context.store.narrationText, channelName: "Visual only", styleGrammar: "Oil painted cliffs.",
    } }), /requires an authored Show Bible/);
    assert.equal(prompts.length, beforeMissingBible, "visual styling cannot substitute for authored channel identity");

    const entries = [{ block: "qa_script", version: CHANNEL_AWARE_SCRIPT_QA_VERSION }, { block: "narration_tts" }];
    assert.throws(() => validatePipeline(entries, ["narrationText"]), /channelName/);
    assert.throws(() => validatePipeline(entries, ["narrationText", "channelName"]), /showBible/);
    assert.doesNotThrow(() => validatePipeline(entries, ["narrationText", "channelName", "showBible"]));
    const writerEntries = [{ block: "script_gen", version: CHANNEL_AWARE_SCRIPT_GEN_VERSION }];
    assert.throws(() => validatePipeline(writerEntries, ["topic"]), /showBible/);
    assert.doesNotThrow(() => validatePipeline(writerEntries, ["topic", "showBible"]));
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

    const integratedPrompts: string[] = [];
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      const prompt = String(body.messages.at(-1)?.content);
      integratedPrompts.push(prompt);
      let content: unknown;
      if (prompt.includes("You are the cold-open director")) {
        content = { candidates: [{ device: "result_first",
          hook: "Chernobyl's ignored safety test failed in 1986.",
          opening: "At 1:23 a.m., engineers disabled the alarm in Reactor Four. Within minutes, a routine check became the decision that sent the roof into the sky. The surviving logs show who saw the warning first, why the shutdown came too late, and how one ignored test changed the night.",
          loop: "Why did the ignored test change the night?" }] };
      } else if (prompt.includes("You are a brutal YouTube retention judge")) {
        content = { verdicts: [{ punch: 9, specificity: 9, curiosity: 9, voiceMatch: 9,
          promise: 9, honest: true, note: "Grounded and specific." }], best: 0 };
      } else if (prompt.includes("Write a YouTube narration script about:")) {
        content = { sections: [
          { heading: "The warning", narration: "At 1:23 a.m., operators began Reactor Four's safety test. It exposed a shutdown weakness, yet they continued despite poorly understood risks." },
          { heading: "The decision", narration: "This was no single mysterious instant. Design flaws, pressure, and false confidence combined. Records separate what operators knew from later assumptions." },
          { heading: "What changed", narration: "The test changed reactor safety and official risk descriptions. Make danger visible before ordinary procedure turns it catastrophic." },
        ], closing_line: "Warnings matter before the crisis." };
      } else if (prompt.includes("Critique this YouTube narration draft")) {
        content = { pass: true, issues: [] };
      } else if (prompt.includes("Critique this YouTube narration for quality and on-brand voice")) {
        content = { pass: true, issues: [] };
      } else {
        throw new Error(`unexpected integration prompt: ${prompt.slice(0, 120)}`);
      }
      return Response.json({ id: `script-pair-${integratedPrompts.length}`, model: body.model,
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 400, completion_tokens: 150, total_tokens: 550, cost: 0.003 } });
    };
    const integrationLane = contentLaneForFamily("narrated_stock")!;
    const integrationBible = {
      positioning: "Evidence-led histories about overlooked decisions and their human consequences.",
      vibe: "Measured, humane, and exact.",
      worksInSpace: ["Ground the opening in a documented detail before interpreting it."],
      avoidInSpace: ["Never turn an evidence gap into a suspense claim."],
    };
    const integrationPipeline = selectChannelAwareScriptQa([
      { block: "script_gen", params: { maxSeconds: 35, qualityProfile: "production" } },
      { block: "qa_script" },
    ]);
    assert.deepEqual(integrationPipeline.map(({ block, version }) => ({ block, version })), [
      { block: "script_gen", version: CHANNEL_AWARE_SCRIPT_GEN_VERSION },
      { block: "qa_script", version: CHANNEL_AWARE_SCRIPT_QA_VERSION },
    ], "fresh routes must receive the compatible writer/critic pair automatically");
    const integrationGraph = validatePipeline(integrationPipeline, ["topic", "showBible", "channelName"]);
    const integrated = await runPipeline(integrationGraph, {
      ownerId: "writer-integration-owner", channelId: "writer-integration-channel",
      runId: "writer-integration-run", keyPrefix: "owner/writer-integration/", budgetUsd: 20,
      defaultRetries: 1,
      seedStore: {
        topic: "Chernobyl's ignored safety test", channelName: "Inked Histories",
        persona: integrationBible.positioning, showBible: integrationBible,
        styleDNA: { narrative: { scriptStyle: "Evidence first, interpretation second.",
          hookStyle: "Lead with a documented decision.", pacing: "Measured, with room for each reveal.",
          delivery: "Calm, humane, and precise." } },
        criticDoctrine: "Reject invented claims and melodramatic certainty.",
        contentLane: integrationLane, bannedWords: [],
      },
      sink: { async upsert() {} },
    });
    assert.equal(integrated.ok, true, integrated.error);
    assert.equal(integratedPrompts.length, 5,
      "the integrated writer and critic should make one hook generation, one hook review, one body generation, and two script reviews");
    for (const prompt of [integratedPrompts[0], integratedPrompts[1], integratedPrompts[2],
      integratedPrompts[3], integratedPrompts[4]]) {
      assert.ok(prompt.includes(integrationBible.positioning));
      assert.ok(prompt.includes(integrationBible.vibe));
      assert.ok(prompt.includes(integrationBible.worksInSpace[0]));
      assert.ok(prompt.includes(integrationBible.avoidInSpace[0]));
    }
    assert.ok(integratedPrompts[2]?.includes("Evidence first, interpretation second."),
      "the selected writer must receive this channel's narrative Style DNA");
    assert.ok(integratedPrompts[4]?.includes("The test changed reactor safety and official risk descriptions"),
      "the selected critic must review the actual narration emitted by its paired writer");
    console.log("CHANNEL-AWARE SCRIPT PAIR PASS: three channel briefs, unchanged legacy behavior, pre-spend refusal, and successful selected-writer→selected-critic runner handoff; provider responses synthetic");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
