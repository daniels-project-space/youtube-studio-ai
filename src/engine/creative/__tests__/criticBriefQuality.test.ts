import assert from "node:assert/strict";

import { briefCritic, type CrewContext } from "@/engine/creative/crew";
import type { ShowBible } from "@/engine/creative/types";

const bible: ShowBible = {
  positioning: "A field guide to overlooked astronomy for curious beginners.",
  vibe: "Quietly wondrous, precise, and welcoming.",
  iconicMotif: "A brass telescope framed by a hand-drawn orbit.",
  worksInSpace: ["Visible sky observations"],
  avoidInSpace: ["Unsupported discoveries"],
  activeCrew: ["critic"],
  criticDoctrine: "Block unsupported claims and imagery that hides the explanation.",
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
  let output = {
    assertions: [{
      id: "visual-readability",
      description: "Keep the rings visually distinct from the planet.",
      check: "vision",
      severity: "warn",
    }],
  };
  process.env.OPENROUTER_API_KEY = "synthetic-only-no-provider-access";
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { model?: string };
    return Response.json({
      id: "critic-brief-test",
      model: request.model ?? "synthetic-test-model",
      choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0.001 },
    });
  };

  try {
    assert.equal(await briefCritic(bible, context), undefined,
      "a review made solely of warnings cannot qualify as a blocking quality gate");

    output = {
      assertions: [
        {
          id: "visual-readability",
          description: "Keep the rings visually distinct from the planet.",
          check: "vision",
          severity: "warn",
        },
        {
          id: "claim-grounding",
          description: "Every factual astronomy claim must be supported by the reviewed narration sources.",
          check: "vision",
          severity: "block",
        },
      ],
    };
    const result = await briefCritic(bible, context);
    assert.equal(result?.assertions.length, 2);
    assert.ok(result?.assertions.some((assertion) => assertion.severity === "block"));
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
