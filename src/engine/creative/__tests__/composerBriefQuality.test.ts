import assert from "node:assert/strict";

import { briefComposer, type CrewContext } from "@/engine/creative/crew";
import type { ShowBible } from "@/engine/creative/types";

const bible: ShowBible = {
  positioning: "A field guide to overlooked astronomy for curious beginners.",
  vibe: "Quietly wondrous, precise, and welcoming.",
  iconicMotif: "A brass telescope framed by a hand-drawn orbit.",
  worksInSpace: ["Visible sky observations"],
  avoidInSpace: ["Unsupported discoveries"],
  activeCrew: ["composer"],
  composerDoctrine: "Keep the bed gentle enough for spoken explanations.",
  refreshedAt: 1,
};

const context: CrewContext = {
  topic: "Why Saturn's rings stay visible",
  family: "narrated_stock",
  targetSeconds: 90,
};

async function main() {
  const originalFetch = globalThis.fetch;
  const priorKey = process.env.OPENROUTER_API_KEY;
  let output: Record<string, unknown> = {
    musicPrompt: "Soft celesta and warm strings, slow pulse, no vocals.",
    duckDb: -12,
    bedLufs: -22,
    voiceFx: "telephone",
  };
  process.env.OPENROUTER_API_KEY = "synthetic-only-no-provider-access";
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { model?: string };
    return Response.json({
      id: "composer-brief-test",
      model: request.model ?? "synthetic-test-model",
      choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0.001 },
    });
  };

  try {
    assert.equal(await briefComposer(bible, context), undefined,
      "unsupported voice effects must fail the brief instead of silently disappearing");

    output = {
      musicPrompt: "Soft celesta and warm strings, slow pulse, no vocals.",
      duckDb: -12,
      bedLufs: -22,
      voiceFx: "radio",
    };
    const result = await briefComposer(bible, context);
    assert.equal(result?.audio.voiceFx, "radio");
    assert.match(result?.musicPrompt ?? "", /celesta/u);
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
