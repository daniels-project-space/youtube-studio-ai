import assert from "node:assert/strict";
import { createScriptGenBlock } from "../narratedBlocks";
import { parseScriptCritique } from "@/engine/scriptQualityGate";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";
import { classifyExecutionError } from "@/engine/executionErrors";
import type { StageContext } from "@/engine/types";
import type { Script } from "@/lib/scriptGen";

const firstHook = "Mara found a locked sluice behind the 1923 workshop clock.";
const secondHook = "Mara noticed a brass lever beneath the 1923 clock face.";
const opening = "The village ledger described a channel that once carried water beneath the workshop. Its handle was missing, but the wheel still turned. Mara compared the brass marks with the river map. One small lever would explain why the stream had stopped.";
const repairIssue = "Replace the ominous hook with ordinary evidence.";

async function main(): Promise<void> {
  assert.equal(parseScriptCritique({ pass: false, issues: [repairIssue], repairTarget: "cold_open" }).repairTarget, "cold_open");
  assert.throws(() => parseScriptCritique({ pass: false, issues: [repairIssue], repairTarget: "audio" }), /malformed script critique/);
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "fixture-only-no-provider";
  try {
    for (const target of ["body", "cold_open", "both", "unknown"] as const) {
      const prompts: { phase: string; prompt: string }[] = [];
      let generated = 0, judged = 0, written = 0, reviewed = 0;
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const prompt = String(body.messages.at(-1)?.content);
        let value: unknown, phase: string;
        if (prompt.includes("You are the cold-open director")) {
          generated++; phase = "hook";
          if (generated === 2) assert.ok(prompt.includes(repairIssue), "Hookcraft receives the full-script critic's repair feedback");
          value = { candidates: [{ device: "cold_open_scene", hook: generated === 1 ? firstHook : secondHook,
            opening, loop: "Explain how Mara frees the river." }] };
        } else if (prompt.includes("You are a brutal YouTube retention judge")) {
          judged++; phase = "hook-review";
          if (judged === 2) assert.ok(prompt.includes(repairIssue), "the independent hook reviewer verifies the requested repair");
          value = { verdicts: [{ punch: 9, specificity: 9, curiosity: 9, voiceMatch: 9, promise: 9, honest: true }], best: 0 };
        } else if (prompt.includes("Write a YouTube narration script about:")) {
          written++; phase = "body";
          value = { sections: [{ heading: "The river", narration: Array.from({ length: 130 }, (_, i) => `detail${i}`).join(" ") }],
            closing_line: "Small clues kept the river moving." };
        } else if (prompt.startsWith("Critique this YouTube narration draft")) {
          reviewed++; phase = "script-review";
          assert.ok(prompt.includes("FIXED COLD OPEN"), "the critic must see which text the body writer cannot change");
          if (target === "unknown") return Response.json({ error: { message: "service unavailable" } }, { status: 503 });
          value = reviewed === 1 ? { pass: false, issues: [repairIssue], repairTarget: target } : { pass: true, issues: [] };
        } else throw new Error(`unexpected request: ${prompt.slice(0, 100)}`);
        prompts.push({ phase, prompt });
        return Response.json({ id: `repair-${prompts.length}`, model: body.model,
          choices: [{ message: { content: JSON.stringify(value) } }],
          usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, cost: 0.001 } });
      };
      const ctx: StageContext = { ownerId: "repair-owner", channelId: "repair-channel", runId: `repair-${target}`,
        keyPrefix: "proof/", budgetUsd: 1, params: { maxSeconds: 75 }, log: () => {},
        store: { topic: "Mara and the 1923 workshop clock", niche: "original fantasy fiction",
          persona: "Patient stories grounded in ordinary clues." } };
      if (target === "unknown") {
        let failure: unknown;
        try { await createScriptGenBlock().run(ctx); } catch (error) { failure = error; }
        assert.ok(failure instanceof OpenRouterGenerationOutcomeUnknownError);
        assert.equal(classifyExecutionError(failure).retryable, false);
        assert.equal(generated, 1); assert.equal(written, 1); assert.equal(reviewed, 1);
        continue;
      }
      const patch = await createScriptGenBlock().run(ctx);
      const expectedHooks = target === "body" ? 1 : 2;
      assert.equal(generated, expectedHooks, `${target}: regenerate only the rejected module's work`);
      assert.equal(judged, expectedHooks, "every replacement hook still passes Hookcraft's own review");
      assert.equal(written, 2); assert.equal(reviewed, 2, "the existing two-draft cap is preserved");
      assert.equal((patch.script as Script).hook, target === "body" ? `${firstHook}\n\n${opening}` : `${secondHook}\n\n${opening}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
  console.log("SCRIPT COLD OPEN REPAIR PASS - typed feedback reaches the owning module; body-only repairs reuse approved hooks");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
