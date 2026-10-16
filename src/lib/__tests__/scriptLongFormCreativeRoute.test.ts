import assert from "node:assert/strict";
import { assertScriptLanguagePolicy, synthScript } from "@/lib/scriptGen";
import type { CraftedHook } from "@/lib/hookcraft";
import { OPENROUTER_MODELS } from "@/lib/openRouter";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";

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
  let prompt = "";
  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      calls++;
      prompt = String(body.messages.at(-1)?.content);
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

    const brief = createChannelProgramBrief({
      family: "documentary_collage_short",
      nicheKey: "history",
      locale: "en",
      concept: "Evidence-led short documentaries that show how historic decisions changed ordinary lives.",
      audience: "Curious adults who want clear evidence without academic jargon.",
      sampleTopics: ["How a bridge changed the town", "What a court record reveals about daily life"],
    });
    const route = channelProgramRouteRunSeed({
      route: resolveChannelProgramRoute(brief),
      programBrief: brief,
    });
    const voiceDNA = {
      pacing: "Let each idea arrive slowly; leave room between discoveries.",
      voiceProfile: "ACOUSTIC_ONLY_TEST_PROFILE low-register timbre and age-specific breath texture.",
    };
    await assert.rejects(
      synthScript({ topic: "The bridge's warm final stone", maxSeconds: 421, programRoute: route }),
      /route-bound production script requires its frozen channel persona/u,
      "route-bound writing must fail before any creative-text spend when the frozen channel voice is missing",
    );
    assert.equal(calls, 0, "missing route voice is rejected before any model call");

    const script = await synthScript({
      topic: "The bridge's warm final stone",
      persona: "Patient, evidence-led historical storytelling for curious adults.",
      maxSeconds: 421,
      programRoute: route,
      sentenceGapSec: 0.85,
      ttsSpeed: 0.94,
      precraftedHook: crafted,
      narrative: voiceDNA,
      channelVoice: {
        positioning: "Patient source-led stories about overlooked evidence in ordinary places.",
        vibe: "Curious, humane, and quietly exact.",
        worksInSpace: ["Let a physical detail reveal the larger historical mechanism."],
        avoidInSpace: ["Do not turn uncertainty into a mystery cliffhanger."],
      },
    });
    assert.equal(calls, 1, "a sufficient one-shot must not buy continuation or chunked calls");
    assert.match(prompt, /WRITE IN THIS CHANNEL'S LOCKED NARRATIVE REGISTER/);
    assert.match(prompt, /channel-aware principles, not a universal style template/);
    assert.match(prompt, /Calm, sleep, and meditation formats may begin gently/);
    assert.match(prompt, /use a re-engagement beat only when the channel or sealed route calls for one/);
    assert.doesNotMatch(prompt, /this is non-negotiable|average UNDER 15 words|insert a deliberate pattern break/,
      "retention principles must not overrule the authored channel's pacing and arousal level");
    assert.match(prompt, /authored contract defines the channel voice and outranks generic voice archetype or style guidance/);
    assert.match(prompt, /Intended audience: Curious adults who want clear evidence without academic jargon\./);
    assert.match(prompt, /Creator-declared topic priorities \(in order\): 1\. How a bridge changed the town; 2\. What a court record reveals about daily life/);
    assert.match(prompt, /pacing: Let each idea arrive slowly; leave room between discoveries\./,
      "a pacing-only identity must shape generation just as it shapes the channel critic");
    assert.doesNotMatch(prompt, /ACOUSTIC_ONLY_TEST_PROFILE|timbre and age-specific breath texture/,
      "acoustic casting stays with the narration module and must not steer script prose");
    for (const guidance of [
      "Patient source-led stories about overlooked evidence in ordinary places.",
      "Curious, humane, and quietly exact.",
      "Let a physical detail reveal the larger historical mechanism.",
      "Do not turn uncertainty into a mystery cliffhanger.",
    ]) {
      assert.ok(prompt.includes(guidance), `script-generation prompt must preserve authored channel identity: ${guidance}`);
    }
    assert.equal(script.sections.length, 3);
    assert.ok(script.narrationText.includes("evidence400"));
    const words = script.narrationText.split(/\s+/).filter(Boolean).length;
    const effectiveWps = 1 / (1 / ((Number(process.env.NARRATION_WPS) || 3.1) * 0.94) + 0.85 / 14);
    assert.equal(script.estDurationSec, Math.round(words / effectiveWps),
      "long-form duration must include the actual sentence pauses and narration speed");
    await synthScript({ topic: "The bridge's warm final stone", maxSeconds: 421, precraftedHook: crafted });
    assert.equal(calls, 2);
    assert.doesNotMatch(prompt, /FROZEN CHANNEL CREATIVE IDENTITY/,
      "legacy generation without a versioned identity projection keeps its prior prompt contract");
    assert.throws(
      () => assertScriptLanguagePolicy(script, ["evidence400"], "long-form script"),
      /long-form script violates channel language policy: evidence400/,
      "the shared policy admission helper must reject prohibited narration before any caller persists it",
    );
    assert.equal(calls, 2, "deterministic policy admission must not make another provider call");
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
