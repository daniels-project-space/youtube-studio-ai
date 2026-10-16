import assert from "node:assert/strict";

import { briefCinematographer, type CrewContext } from "@/engine/creative/crew";
import type { ShowBible } from "@/engine/creative/types";

const bible: ShowBible = {
  positioning: "A field guide to overlooked astronomy for curious beginners.",
  vibe: "Quietly wondrous, precise, and welcoming.",
  iconicMotif: "A brass telescope framed by a hand-drawn orbit.",
  worksInSpace: ["Visible sky observations"],
  avoidInSpace: ["Unsupported discoveries"],
  activeCrew: ["cinematographer"],
  dpDoctrine: "Use clear scale cues and restrained, purposeful camera motion.",
  refreshedAt: 1,
};

const context: CrewContext = {
  topic: "Why Saturn's rings stay visible",
  family: "narrated_stock",
  targetSeconds: 90,
};

const validQueries = [
  "Saturn rings closeup",
  "planet orbit model",
  "ice particles orbit",
  "telescope night sky",
  "ring plane crossing",
  "Saturn shadow movement",
  "astronomy observatory interior",
  "gas giant comparison scale",
];

const validBrief = {
  footageQueries: validQueries,
  promptStyle: "Quiet observatory lighting with clear scale cues.",
  palette: ["#17243A", "#C5A779"],
  motion: "Slow lateral drift with stable framing.",
  avoid: ["Rapid zooms", "Unlabeled scale comparisons"],
};

async function main() {
  const originalFetch = globalThis.fetch;
  const priorKey = process.env.OPENROUTER_API_KEY;
  let output: typeof validBrief = structuredClone(validBrief);
  process.env.OPENROUTER_API_KEY = "synthetic-only-no-provider-access";
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { model?: string };
    return Response.json({
      id: "cinematographer-brief-test",
      model: request.model ?? "synthetic-test-model",
      choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0.001 },
    });
  };

  try {
    output = { ...validBrief, footageQueries: [] };
    assert.equal(await briefCinematographer(bible, context), undefined,
      "a style clause alone must not pass as a complete visual brief");

    output = { ...validBrief, footageQueries: validQueries.slice(0, 7) };
    assert.equal(await briefCinematographer(bible, context), undefined,
      "fewer than eight concrete search terms must be rejected");

    output = { ...validBrief, footageQueries: [...validQueries.slice(0, 7), "Saturn"] };
    assert.equal(await briefCinematographer(bible, context), undefined,
      "one-word terms cannot satisfy the stock-search query minimum");

    output = { ...validBrief, footageQueries: [...validQueries.slice(0, 7), validQueries[0]!] };
    assert.equal(await briefCinematographer(bible, context), undefined,
      "duplicate search terms cannot satisfy the distinct query minimum");

    for (const incomplete of [
      { ...validBrief, promptStyle: " " },
      { ...validBrief, palette: ["navy"] },
      { ...validBrief, motion: " " },
      { ...validBrief, avoid: [] },
    ]) {
      output = incomplete;
      assert.equal(await briefCinematographer(bible, context), undefined,
        "each requested visual field is required for admission");
    }

    output = { ...validBrief, footageQueries: [...validQueries, "distant galaxy wide frame"] };
    const result = await briefCinematographer(bible, context);
    assert.equal(result?.footageQueries.length, 9);
    assert.deepEqual(result?.palette, validBrief.palette);
    assert.equal(result?.motion, validBrief.motion);
    assert.deepEqual(result?.avoid, validBrief.avoid);
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
