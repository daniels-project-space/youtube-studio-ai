import assert from "node:assert/strict";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { synthShowBible } from "@/engine/creative/showBible";
import type { ShowBible } from "@/engine/creative/types";

const bible: ShowBible = {
  positioning: "A practical field guide to overlooked astronomy for curious beginners.",
  vibe: "Quietly wondrous, precise, and welcoming.",
  iconicMotif: "A brass telescope framed by a hand-drawn orbit.",
  worksInSpace: [
    "Open with a visible sky observation",
    "Use one celestial object per chapter",
    "Pair scale comparisons with familiar distances",
    "Explain uncertainty when measurements vary",
    "Return to the opening observation at the end",
  ],
  avoidInSpace: [
    "Unexplained strings of technical terms",
    "Sensational claims about ordinary events",
    "Decorative star fields behind every shot",
    "Mixing incompatible distance scales",
    "Promising discoveries the episode does not explain",
  ],
  activeCrew: ["director", "cinematographer", "editor", "composer", "critic"],
  directorDoctrine: "Build each episode around one question and resolve it plainly.",
  dpDoctrine: "Use restrained diagrams that clarify the current physical scale.",
  editorDoctrine: "Let each cut follow a change in the explanation, not a music accent.",
  composerDoctrine: "Keep the score low and spacious beneath the spoken explanation.",
  criticDoctrine: "Flag unsupported claims and imagery that obscures the explanation.",
  refreshedAt: 23,
};

const programBrief = createChannelProgramBrief({
  family: "whiteboard",
  nicheKey: "educational",
  subcategory: "how-to-tutorials",
  locale: "en",
  concept: "Explain complex science mechanisms with causal whiteboard stories.",
  audience: "Curious adults who want rigorous visual explanations.",
  sampleTopics: ["How a quantum computer measures a qubit", "Why satellites stay in orbit"],
});

async function main() {
  const originalFetch = globalThis.fetch;
  const priorKey = process.env.OPENROUTER_API_KEY;
  const calls: Array<{ prompt: string; kind: "writer" | "critic" }> = [];
  let writerCalls = 0;
  let criticCalls = 0;
  process.env.OPENROUTER_API_KEY = "synthetic-only-no-provider-access";
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as {
      model?: string;
      messages?: Array<{ content?: string }>;
    };
    const prompt = request.messages?.at(-1)?.content ?? "";
    const critic = prompt.includes("Independently review this channel's Show Bible");
    calls.push({ prompt, kind: critic ? "critic" : "writer" });
    const content = critic
      ? JSON.stringify(++criticCalls === 1
        ? { score: 0.55, issues: ["The first draft's channel persona is too generic."] }
        : { score: 0.94, issues: [] })
      : JSON.stringify((++writerCalls === 1
        ? { ...bible, vibe: "Calm, consistent, broadly accessible, and carefully considered." }
        : bible));
    return Response.json({
      id: `show-bible-${calls.length}`,
      model: request.model ?? "synthetic-test-model",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0.001 },
    });
  };

  try {
    const result = await synthShowBible({
      family: "whiteboard",
      name: "The Chalk Observatory",
      programBrief,
      niche: "astronomy education",
      persona: "A patient science teacher who explains mechanisms without condescension.",
      styleGrammar: "Hand-drawn diagrams revealed in narration order.",
      now: 23,
    });
    assert.equal(result.vibe, bible.vibe, "the reviewed revision, not the generic first draft, is returned");
    assert.deepEqual(calls.map((call) => call.kind), ["writer", "critic", "writer", "critic"]);
    assert.match(calls[1]!.prompt, /patient science teacher/);
    assert.match(calls[1]!.prompt, /Explain complex science mechanisms/);
    assert.match(calls[1]!.prompt, /critic owns evaluation, not generation/);
    assert.match(calls[2]!.prompt, /first draft's channel persona is too generic/);
    assert.equal(writerCalls, 2);
    assert.equal(criticCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorKey;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
