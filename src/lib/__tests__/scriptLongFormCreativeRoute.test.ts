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
  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      calls++;
      assert.equal(body.model, OPENROUTER_MODELS.creative, "long-form script remains on the pinned Gemini Flash model");
      assert.equal(body.max_tokens, 16_000, "one-shot request must not ask beyond the shared creative-text ceiling");
      assert.match(String(body.messages.at(-1)?.content), /Write a COMPLETE long-form YouTube narration script/, "long script must take the actual one-shot path");
      return Response.json({
        id: "fixture-long-script",
        model: body.model,
        choices: [{ message: { content: JSON.stringify({
          sections: [
            { heading: "Arrival", narration: prose },
            { heading: "Discovery", narration: prose },
            { heading: "Landing", narration: prose },
          ],
          closing_line: "Follow the warm stone to the truth.",
        }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, cost: 0.003 },
      });
    };

    const script = await synthScript({
      topic: "The bridge's warm final stone",
      maxSeconds: 421,
      precraftedHook: crafted,
    });
    assert.equal(calls, 1, "a sufficient one-shot must not buy continuation or chunked calls");
    assert.equal(script.sections.length, 3);
    assert.ok(script.narrationText.includes("evidence400"));
    console.log("SCRIPT LONG-FORM CREATIVE ROUTE PASS — actual one-shot uses the pinned model and truthful 16k ceiling");
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
