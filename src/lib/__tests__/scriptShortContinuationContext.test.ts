import assert from "node:assert/strict";
import { synthScript } from "@/lib/scriptGen";
import type { CraftedHook } from "@/lib/hookcraft";

const crafted = {
  hook: "The warm stone kept Mara from trusting the winter map.",
  opening: "She compared the river mark with the parish ledger.",
  coldOpen: "The warm stone kept Mara from trusting the winter map. She compared the river mark with the parish ledger.",
  device: "cold_open_scene",
  loop: "Explain what the altered river mark reveals about the old bridge.",
  verdict: { punch: 9, specificity: 9, curiosity: 9, voiceMatch: 9, promise: 9, honest: true, judged: true, factCheck: "unchecked" },
} as unknown as CraftedHook;

const initialNarration = "The surveyor's first mark followed the summer bank, not the winter flood line.";
const finalNarration = "Mara kept the ledger open because one date still challenged her first conclusion.";
const continuationNarration = Array.from({ length: 80 }, (_, index) => `continuation${index + 1}`).join(" ");

async function runScenario(endWithSummary: boolean): Promise<void> {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENROUTER_API_KEY;
  let calls = 0;
  const prompts: string[] = [];
  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { messages?: { content?: unknown }[] };
      prompts.push(String(request.messages?.at(-1)?.content ?? ""));
      calls += 1;
      const content = calls === 1
        ? JSON.stringify({
            sections: [
              { heading: "Evidence", narration: initialNarration },
              { heading: endWithSummary ? "In Summary" : "Last Discovery", narration: finalNarration },
            ],
            closing_line: "The river kept its own record.",
          })
        : JSON.stringify({ sections: [{ heading: "Continuation", narration: continuationNarration }] });
      return Response.json({
        id: `short-script-${calls}`,
        model: "fixture-model",
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 120, total_tokens: 220, cost: 0.001 },
      });
    };

    const script = await synthScript({
      topic: "The bridge's winter mark",
      persona: "Patient, humane historical storytelling grounded in ordinary evidence.",
      narrative: { scriptStyle: "Source-led, curious, and quietly exact.", pacing: "Let each discovery breathe." },
      maxSeconds: 30,
      ttsSpeed: 0.94,
      endWithSummary,
      precraftedHook: crafted,
      structure: { beats: [{ name: "Compare records", note: "Keep the date contradiction central." }] },
      series: {
        name: "The River Ledger",
        episode: 2,
        total: 5,
        previousSummary: "Episode one traced Mara's map through the flood archive.",
        nextSeed: "Compare the winter ledger with the parish register.",
      },
      playbook: {
        hookRules: ["Open on a physical detail with evidential meaning."],
        openingDevices: [{ name: "Contradictory detail", when: "A source challenges a first impression.", template: "<DETAIL> contradicts <EXPECTED>" }],
        retentionDevices: ["Resolve one question before opening the next."],
        voiceRules: ["Use patient, humane phrasing; avoid sensational certainty."],
        avoid: ["Do not turn uncertainty into a cliffhanger."],
        studied: [],
        distilledAt: 1,
      },
    });

    assert.equal(calls, 2, "a short first draft should use exactly one bounded continuation");
    const words = script.narrationText.split(/\s+/).filter(Boolean).length;
    assert.equal(script.estDurationSec, Math.round(words / ((Number(process.env.NARRATION_WPS) || 3.1) * 0.94)),
      "short-form duration must use the same voice speed as its word budget");
    const continuationPrompt = prompts[1]!;
    for (const evidence of [
      crafted.coldOpen,
      initialNarration,
      finalNarration,
      "Episode one traced Mara's map through the flood archive.",
      "Compare the winter ledger with the parish register.",
      "Use patient, humane phrasing; avoid sensational certainty.",
      "Keep the date contradiction central.",
      "Source-led, curious, and quietly exact.",
    ]) {
      assert.ok(continuationPrompt.includes(evidence), `continuation must retain frozen context: ${evidence}`);
    }

    const headings = script.sections.map((section) => section.heading);
    assert.deepEqual(
      headings,
      endWithSummary
        ? ["Evidence", "Continuation", "In Summary"]
        : ["Evidence", "Last Discovery", "Continuation"],
      "new material must preserve the original ending policy and section order",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
}

async function main(): Promise<void> {
  await runScenario(false);
  await runScenario(true);
  console.log("SCRIPT SHORT CONTINUATION PASS — carries frozen context and preserves summary ordering");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
