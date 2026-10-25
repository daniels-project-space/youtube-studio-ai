import assert from "node:assert/strict";
import { synthScript } from "@/lib/scriptGen";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";
import type { CraftedHook } from "@/lib/hookcraft";

const prose = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
const coldOpen = prose(60);
const crafted = { hook: coldOpen, opening: "", coldOpen, loop: "Leave the unfinished chore alone.", device: "you_stakes" } as CraftedHook;
const req = {
  topic: "Leaving a chore unfinished", channelName: "A Little Room", persona: "Warm, permissive and secular.",
  maxSeconds: 90, style: "meditation", precraftedHook: crafted,
  narrative: { scriptStyle: "Offer choices, never commands.", pacing: "Unhurried." },
  sourceGrounding: "No medical or therapeutic promises.",
};

async function main(): Promise<void> {
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "fixture-only-no-provider";
  let calls = 0;
  let mode: "fits" | "rewrite" | "empty" | "still-long" | "unknown" = "fits";
  const prompts: string[] = [];
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.messages.at(-1)?.content);
    prompts.push(prompt);
    if (mode === "unknown" && calls === 2) throw new TypeError("connection lost after dispatch");
    const words = calls === 1 ? mode === "fits" ? 219 : 370 : mode === "still-long" ? 370 : 210;
    return Response.json({
      id: `duration-${calls}`, model: body.model,
      choices: [{ message: { content: JSON.stringify({
        sections: mode === "empty" && calls === 2 ? [] : [{ heading: "Rest", narration: prose(words) }],
        closing_line: "The unfinished chores can wait while you rest.",
      }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, cost: 0.001 },
    });
  };
  try {
    const fits = await synthScript(req);
    assert.equal(calls, 1);
    assert.match(prompts[0]!, /cold open.*60 words/i);
    assert.match(prompts[0]!, /219 words/);
    assert.ok(prompts[0]!.includes("frozen channel narrative and director's accepted structure outrank the generic arc"));
    assert.ok(prompts[0]!.includes("use invitations rather than commands"));
    assert.ok(prompts[0]!.includes("do not state this video's exact running time before audio is measured"));
    assert.equal(fits.estDurationSec, 90);

    mode = "rewrite"; calls = 0; prompts.length = 0;
    const revised = await synthScript(req);
    assert.equal(calls, 2, "only the oversized body is rewritten; the approved hook is not purchased again");
    assert.equal(revised.hook, coldOpen);
    assert.equal(revised.crafted, crafted);
    assert.ok(prompts[1]!.includes("Do not promise this video's exact runtime before audio is measured"));
    assert.ok(revised.estDurationSec <= 104 && revised.estDurationSec >= 72);
    for (const context of [req.persona, req.narrative.scriptStyle, req.sourceGrounding, coldOpen, crafted.loop]) {
      assert.ok(prompts[1]!.includes(context), `body revision preserves the admitted context: ${context}`);
    }
    for (const failure of ["empty", "still-long", "unknown"] as const) {
      mode = failure; calls = 0;
      await assert.rejects(synthScript(req), failure === "unknown"
        ? OpenRouterGenerationOutcomeUnknownError : /duration|word budget|no usable/i);
      assert.equal(calls, 2, "failed correction cannot start another paid rewrite");
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
  console.log("SCRIPT DURATION BUDGET PASS - cold open counted once, bounded body correction, no uncertain replay");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
