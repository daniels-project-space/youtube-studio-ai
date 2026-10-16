import assert from "node:assert/strict";

import { briefDirector, type CrewContext } from "@/engine/creative/crew";
import type { ShowBible } from "@/engine/creative/types";

const bible: ShowBible = {
  positioning: "A field guide to overlooked astronomy for curious beginners.",
  vibe: "Quietly wondrous, precise, and welcoming.",
  iconicMotif: "A brass telescope framed by a hand-drawn orbit.",
  worksInSpace: ["Visible sky observations"],
  avoidInSpace: ["Unsupported discoveries"],
  activeCrew: ["director"],
  directorDoctrine: "Build each episode around one question and resolve it plainly.",
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
  let output = { hook: "Look closely at Saturn.", beats: [] as Array<{ name: string; intentSec: number; note: string }> };
  process.env.OPENROUTER_API_KEY = "synthetic-only-no-provider-access";
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { model?: string };
    return Response.json({
      id: "director-brief-test",
      model: request.model ?? "synthetic-test-model",
      choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0.001 },
    });
  };

  try {
    assert.equal(await briefDirector(bible, context), undefined,
      "a hook-only response must not count as a completed director structure");

    output = {
      hook: "Look closely at Saturn.",
      beats: [{ name: "", intentSec: 15, note: "Introduce the rings." }],
    };
    assert.equal(await briefDirector(bible, context), undefined,
      "a beat without a title must be rejected rather than silently filtered");

    output = {
      hook: "Look closely at Saturn.",
      beats: [{ name: "The shadow", intentSec: 0, note: "Show the ring-plane crossing." }],
    };
    assert.equal(await briefDirector(bible, context), undefined,
      "a non-positive duration must not be silently rewritten to one second");

    output = {
      hook: "Look closely at Saturn.",
      beats: [{ name: "The shadow", intentSec: 15, note: "Show the ring-plane crossing." }],
    };
    assert.deepEqual(await briefDirector(bible, context), {
      hook: "Look closely at Saturn.",
      beats: [{ name: "The shadow", intentSec: 15, note: "Show the ring-plane crossing." }],
    }, "a complete beat with positive timing and intent remains admissible");
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
