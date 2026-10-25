import assert from "node:assert/strict";
import { craftHook, lintHook } from "@/lib/hookcraft";

async function main(): Promise<void> {
  const hook = "The unwashed cup can stay beside the sink while you rest here.";
  const opening = "For now, unfinished chores can wait without your attention.";
  assert.equal(lintHook(hook, opening, { gentle: true, skipConcreteness: true, maxColdOpenWords: 31 }).pass, true,
    "a short-video opening must not be forced past its entire cold-open budget");
  assert.equal(lintHook(hook, `${opening} ${opening} ${opening}`, {
    gentle: true, skipConcreteness: true, maxColdOpenWords: 31,
  }).pass, false, "oversize cold opens are rejected before judging");
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "fixture-only-no-provider";
  let calls = 0;
  let malformedFirst = false;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.messages.at(-1)?.content);
    assert.ok(prompt.includes("20 seconds"), "both writer and judge receive the actual final runtime");
    assert.ok(prompt.includes("Do not promise an exact running time for THIS video"));
    if (malformedFirst && calls === 1) return Response.json({ choices: [{ message: { content: "{" } }] });
    const judge = prompt.includes("retention judge");
    const value = judge
      ? { verdicts: [{ punch: 9, specificity: 9, curiosity: 9, voiceMatch: 9, promise: 9, honest: true }], best: 0 }
      : { candidates: [{ device: "you_stakes", hook, opening, loop: "Let the unfinished cup wait." }] };
    if (!judge) assert.ok(prompt.includes("31 spoken words"));
    return Response.json({ id: `hook-duration-${calls}`, model: body.model,
      choices: [{ message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, cost: 0.001 },
    });
  };
  try {
    const result = await craftHook({ topic: "Leaving a chore unfinished", style: "meditation",
      targetSeconds: 20, maxColdOpenWords: 31 });
    assert.equal(calls, 2);
    assert.ok(result.coldOpen.split(/\s+/).length <= 31);
    await assert.rejects(craftHook({ topic: "Invalid duration", targetSeconds: NaN }), /target.*duration/i);
    assert.equal(calls, 2, "invalid timing fails before provider dispatch");
    malformedFirst = true;
    calls = 0;
    const repaired = await craftHook({ topic: "Leaving a chore unfinished", style: "meditation",
      targetSeconds: 20, maxColdOpenWords: 31 });
    assert.equal(calls, 3, "one completed malformed slate, one replacement, and one judge within the existing two-attempt budget");
    assert.ok(repaired.coldOpen.split(/\s+/).length <= 31);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
  console.log("HOOK DURATION BUDGET PASS - shorter openings, bounded total, and runtime-aware promises");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
