import assert from "node:assert/strict";

import { briefEditor, type CrewContext } from "@/engine/creative/crew";
import type { ShowBible } from "@/engine/creative/types";

const bible: ShowBible = {
  positioning: "A field guide to overlooked astronomy for curious beginners.",
  vibe: "Quietly wondrous, precise, and welcoming.",
  iconicMotif: "A brass telescope framed by a hand-drawn orbit.",
  worksInSpace: ["Visible sky observations"],
  avoidInSpace: ["Unsupported discoveries"],
  activeCrew: ["editor"],
  editorDoctrine: "Let each cut follow a change in the explanation, not a music accent.",
  refreshedAt: 1,
};

const context: CrewContext = {
  topic: "Why Saturn's rings stay visible",
  family: "narrated_stock",
  targetSeconds: 90,
};

const validBrief = {
  sections: [
    { name: "Opening observation", cutsPerMin: 4 },
    { name: "Scale explanation", cutsPerMin: 6 },
  ],
  transitions: "Cut when the explanation changes scale.",
  captionStyle: "Single-line captions with restrained emphasis.",
  overlayRule: "Use quote cards only for source language shown on screen.",
};

async function main() {
  const originalFetch = globalThis.fetch;
  const priorKey = process.env.OPENROUTER_API_KEY;
  let output: typeof validBrief = structuredClone(validBrief);
  process.env.OPENROUTER_API_KEY = "synthetic-only-no-provider-access";
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { model?: string };
    return Response.json({
      id: "editor-brief-test",
      model: request.model ?? "synthetic-test-model",
      choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0.001 },
    });
  };

  try {
    output = { ...validBrief, sections: [] };
    assert.equal(await briefEditor(bible, context), undefined,
      "transitions and captions cannot substitute for a per-section cut plan");

    output = { ...validBrief, sections: [{ name: "Opening", cutsPerMin: 0 }] };
    assert.equal(await briefEditor(bible, context), undefined,
      "zero cadence must not be silently admitted as an editorial cut plan");

    for (const cutsPerMin of [1.99, 12.01]) {
      output = { ...validBrief, sections: [{ name: "Opening", cutsPerMin }] };
      assert.equal(await briefEditor(bible, context), undefined,
        "cadence outside the documented 2-12 range must be rejected");
    }

    output = { ...validBrief, sections: [{ name: "Opening", cutsPerMin: 4 }, { name: " opening ", cutsPerMin: 5 }] };
    assert.equal(await briefEditor(bible, context), undefined,
      "duplicate section names cannot masquerade as distinct pacing guidance");

    for (const incomplete of [
      { ...validBrief, transitions: " " },
      { ...validBrief, captionStyle: " " },
      { ...validBrief, overlayRule: " " },
      { ...validBrief, sections: [{ name: " ", cutsPerMin: 4 }] },
    ]) {
      output = incomplete;
      assert.equal(await briefEditor(bible, context), undefined,
        "all role-owned cut-sheet fields must be present and meaningful");
    }

    output = structuredClone(validBrief);
    assert.deepEqual(await briefEditor(bible, context), validBrief,
      "a complete, in-range cut sheet remains admissible");
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
