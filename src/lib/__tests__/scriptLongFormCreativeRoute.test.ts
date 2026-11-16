import assert from "node:assert/strict";
import { synthScript } from "@/lib/scriptGen";
import type { CraftedHook } from "@/lib/hookcraft";
import { OPENROUTER_MODELS } from "@/lib/openRouter";

const prose = Array.from({ length: 400 }, (_, index) => `evidence${index + 1}`).join(" ");
const crafted = {
  hook: "The old bridge held one secret beneath its final stone.",
  opening: "At dawn, Mara found the final stone warm despite the winter river beneath it.",
  coldOpen: "The old bridge held one secret beneath its final stone. At dawn, Mara found the final stone warm despite the winter river beneath it.",
  device: "cold_open_scene",
  loop: "Explain why the final stone stayed warm and what it revealed about the bridge.",
  verdict: { punch: 9, specificity: 9, curiosity: 9, voiceMatch: 9, promise: 9, honest: true, judged: true, factCheck: "unchecked" },
} as unknown as CraftedHook;

async function main(): Promise<void> {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENROUTER_API_KEY;
  let calls = 0;
  let omitDiscovery = false;
  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      calls++;
      assert.equal(body.model, OPENROUTER_MODELS.creative, "long-form script remains on the pinned Gemini Flash model");
      const prompt = String(body.messages.at(-1)?.content);
      if (prompt.includes("Write a COMPLETE long-form YouTube narration script")) {
        assert.equal(body.max_tokens, 16_000, "one-shot request must not ask beyond the shared creative-text ceiling");
        assert.match(prompt, /Beat 1: Arrival — orient after the approved cold open/);
        assert.match(prompt, /Beat 2: Discovery — establish the bridge evidence/);
        assert.match(prompt, /Beat 3: Landing — pay off the opening question/);
        assert.match(prompt, /include a section with each beat name as its heading/);
        return Response.json({
          id: "fixture-long-script",
          model: body.model,
          choices: [{ message: { content: JSON.stringify({
            sections: [
              { heading: "Arrival", narration: prose },
              { heading: omitDiscovery ? "Interlude" : "Discovery", narration: prose },
              { heading: "Landing", narration: prose },
            ],
            closing_line: "Follow the warm stone to the truth.",
          }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, cost: 0.003 },
        });
      }
      if (prompt.startsWith("For a long video about")) {
        return Response.json({ id: "fixture-closing-line", model: body.model,
          choices: [{ message: { content: JSON.stringify({ closing_line: "Follow the warm stone to the truth." }) } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, cost: 0.001 } });
      }
      if (prompt.startsWith("You are writing ONE section of a long narrated video")) {
        return Response.json({ id: "fixture-beat-section", model: body.model,
          choices: [{ message: { content: JSON.stringify({ narration: prose }) } }],
          usage: { prompt_tokens: 40, completion_tokens: 40, total_tokens: 80, cost: 0.001 } });
      }
      assert.fail(`unexpected long-form writer request: ${prompt.slice(0, 100)}`);
    };

    const script = await synthScript({
      topic: "The bridge's warm final stone",
      maxSeconds: 421,
      precraftedHook: crafted,
      structure: { beats: [
        { name: "Arrival", note: "orient after the approved cold open" },
        { name: "Discovery", note: "establish the bridge evidence" },
        { name: "Landing", note: "pay off the opening question" },
      ] },
    });
    assert.equal(calls, 1, "a sufficient one-shot must not buy continuation or chunked calls");
    assert.equal(script.sections.length, 3);
    assert.ok(script.narrationText.includes("evidence400"));
    assert.deepEqual(script.sections.map((section) => section.heading), ["Arrival", "Discovery", "Landing"]);

    omitDiscovery = true;
    calls = 0;
    const recovered = await synthScript({
      topic: "The bridge's warm final stone",
      maxSeconds: 421,
      precraftedHook: crafted,
      structure: { beats: [
        { name: "Arrival", note: "orient after the approved cold open" },
        { name: "Discovery", note: "establish the bridge evidence" },
        { name: "Landing", note: "pay off the opening question" },
      ] },
    });
    assert.ok(calls > 1, "a one-shot that omits a Director beat must not be accepted");
    assert.deepEqual(recovered.sections.map((section) => section.heading), ["Arrival", "Discovery", "Landing"]);
    console.log("SCRIPT LONG-FORM STRUCTURE PASS — one-shot honors ordered beats; invalid one-shot falls back to exact Director beats");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
