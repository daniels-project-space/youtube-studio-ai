import assert from "node:assert/strict";
import { synthScript } from "@/lib/scriptGen";
import type { CraftedHook } from "@/lib/hookcraft";
import { OPENROUTER_MODELS } from "@/lib/openRouter";

const prose = `${Array.from({ length: 400 }, (_, index) => `evidence${index + 1}`).join(" ")} The final evidence settles...`;
const shortProse = `${Array.from({ length: 500 }, (_, index) => `rest${index + 1}`).join(" ")} The river keeps moving…`;
const landingProse = `${Array.from({ length: 80 }, (_, index) => `settle${index + 1}`).join(" ")} Let the last thought rest....`;
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
  const previousRate = process.env.NARRATION_WPS;
  let calls = 0;
  let omitDiscovery = false;
  let quietListening = false;
  let shortMode = false;
  let quietFallbackMode = false;
  let quoteCalls = 0;
  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    delete process.env.NARRATION_WPS;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      calls++;
      assert.equal(body.model, OPENROUTER_MODELS.creative, "long-form script remains on the pinned Gemini Flash model");
      const prompt = String(body.messages.at(-1)?.content);
      if (shortMode) {
        assert.match(prompt, /QUIET-LISTENING CRAFT/);
        assert.doesNotMatch(prompt, /RETENTION CRAFT/);
        assert.match(prompt, /gentle, low-pressure journey for quiet listening/);
        assert.match(prompt, /Each beat must add a different observation/);
        assert.match(prompt, /body, breath, emotion, and environment observations optional/);
        assert.match(prompt, /repeated ellipses to imitate those rests/);
        assert.doesNotMatch(prompt, /End with a FINAL section/);
        assert.doesNotMatch(prompt, /THE QUOTE: the episode's lesson/);
        return Response.json({ id: "fixture-quiet-short", model: body.model,
          choices: [{ message: { content: JSON.stringify({
            sections: [{ heading: "Settling", narration: shortProse }],
            closing_line: "Rest with the quiet.",
          }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, cost: 0.003 } });
      }
      if (quietFallbackMode && prompt.startsWith("Write a gentle final landing")) {
        assert.match(prompt, /Do not force a recap\./);
        assert.match(prompt, /Do not add a moral, CTA, cliffhanger/);
        assert.match(prompt, /Each beat must add a different observation/);
        assert.match(prompt, /body, breath, emotion, and environment observations optional/);
        assert.doesNotMatch(prompt, /THE QUOTE of the episode/);
        return Response.json({ id: "fixture-quiet-landing", model: body.model,
          choices: [{ message: { content: JSON.stringify({
            narration: landingProse,
            closing_line: "Rest with the quiet.",
          }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, cost: 0.003 } });
      }
      if (prompt.includes("Write a COMPLETE long-form YouTube narration script")) {
        assert.equal(body.max_tokens, 16_000, "one-shot request must not ask beyond the shared creative-text ceiling");
        assert.match(prompt, /Beat 1: Arrival/);
        assert.match(prompt, /Beat 2: Discovery/);
        assert.match(prompt, /Beat 3: Landing/);
        assert.match(prompt, /include a section with each beat name as its heading/);
        if (quietListening) {
          assert.match(prompt, /QUIET-LISTENING CRAFT/);
          assert.doesNotMatch(prompt, /RETENTION CRAFT/);
          assert.match(prompt, /gentle, low-pressure journey for quiet listening/);
          assert.match(prompt, /Each beat must add a different observation/);
          assert.match(prompt, /body, breath, emotion, and environment observations optional/);
          assert.match(prompt, /Do not force an integration exercise, moral, recap/);
        } else {
          assert.match(prompt, /Beat 1: Arrival — orient after the approved cold open/);
          assert.match(prompt, /Beat 2: Discovery — establish the bridge evidence/);
          assert.match(prompt, /Beat 3: Landing — pay off the opening question/);
          assert.match(prompt, /RETENTION CRAFT/);
          assert.match(prompt, /STORY JOURNEY, not an essay outline/);
        }
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
        quoteCalls++;
        return Response.json({ id: "fixture-closing-line", model: body.model,
          choices: [{ message: { content: JSON.stringify({ closing_line: "Follow the warm stone to the truth." }) } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, cost: 0.001 } });
      }
      if (prompt.startsWith("You are writing ONE section of a long narrated video")) {
        if (quietListening) {
          assert.match(prompt, /QUIET-LISTENING CRAFT/);
          assert.doesNotMatch(prompt, /RETENTION CRAFT/);
          assert.match(prompt, /Each beat must add a different observation/);
        }
        return Response.json({ id: "fixture-beat-section", model: body.model,
          choices: [{ message: { content: JSON.stringify({ narration: prose }) } }],
          usage: { prompt_tokens: 40, completion_tokens: 40, total_tokens: 80, cost: 0.001 } });
      }
      assert.fail(`unexpected long-form writer request: ${prompt.slice(0, 100)}`);
    };

    process.env.NARRATION_WPS = "3.1";
    await assert.rejects(synthScript({ topic: "Fixture", precraftedHook: crafted }), /outside.*contract/);
    assert.equal(calls, 0, "incompatible production override fails before creative calls");
    delete process.env.NARRATION_WPS;
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
    assert.ok(script.narrationText.includes("settles..."), "standard narration keeps intentional ellipses unchanged");
    assert.deepEqual(script.sections.map((section) => section.heading), ["Arrival", "Discovery", "Landing"]);
    const standardEstimate = script.estDurationSec;

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
    const standardQuoteCalls = quoteCalls;

    omitDiscovery = false;
    quietListening = true;
    calls = 0;
    const quietLong = await synthScript({
      topic: "The bridge's warm final stone",
      niche: "meditation",
      style: "meditation",
      maxSeconds: 421,
      ttsSpeed: 0.85,
      sentenceGapSec: 0.5,
      precraftedHook: crafted,
      structure: { beats: [
        { name: "Arrival", note: "orient after the calm opening" },
        { name: "Discovery", note: "notice the bridge evidence" },
        { name: "Landing", note: "settle the opening image" },
      ] },
    });
    assert.equal(calls, 1, "a sufficient quiet-listening one-shot remains one model call");
    assert.doesNotMatch(quietLong.narrationText, /(?:\.{2,}|…+)/u, "quiet-listening one-shot removes unplanned ellipses");
    assert.ok(quietLong.estDurationSec > standardEstimate, "the estimate must account for slower TTS and sentence air");

    omitDiscovery = true;
    quietFallbackMode = true;
    calls = 0;
    const quietFallback = await synthScript({
      topic: "The bridge's warm final stone",
      niche: "meditation",
      style: "meditation",
      maxSeconds: 421,
      precraftedHook: crafted,
      structure: { beats: [
        { name: "Arrival", note: "orient after the calm opening" },
        { name: "Discovery", note: "notice the bridge evidence" },
        { name: "Landing", note: "settle the opening image" },
      ] },
    });
    assert.equal(calls, 5, "quiet fallback uses one failed one-shot, three beat sections, and one combined landing");
    assert.equal(quoteCalls, standardQuoteCalls, "quiet fallback must not buy a separate lesson-quote request");
    assert.equal(quietFallback.closingLine, "Rest with the quiet.");
    assert.doesNotMatch(quietFallback.narrationText, /(?:\.{2,}|…+)/u, "quiet fallback sections and landing remove unplanned ellipses");

    shortMode = true;
    omitDiscovery = false;
    calls = 0;
    const quietShort = await synthScript({
      topic: "A quiet minute beside the river",
      niche: "meditation",
      style: "meditation",
      maxSeconds: 180,
      precraftedHook: crafted,
    });
    assert.equal(calls, 1, "a sufficient quiet short-form script must not buy a top-up call");
    assert.equal(quietShort.closingLine, "Rest with the quiet.");
    assert.doesNotMatch(quietShort.narrationText, /(?:\.{2,}|…+)/u, "quiet short-form narration removes unplanned ellipses");
    console.log("SCRIPTGEN PASS — standard retention craft remains intact; quiet-listening rules and paced duration are honored on short and long paths");
  } finally {
    if (previousRate === undefined) delete process.env.NARRATION_WPS;
    else process.env.NARRATION_WPS = previousRate;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
