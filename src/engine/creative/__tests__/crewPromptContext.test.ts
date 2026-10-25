import assert from "node:assert/strict";

import { briefDirector, briefCinematographer, briefEditor, briefComposer } from "@/engine/creative/crew";
import type { ShowBible } from "@/engine/creative/types";

const bible: ShowBible = {
  positioning: "Patient observations of the night sky.",
  vibe: "Quiet and precise.",
  iconicMotif: "A brass telescope.",
  worksInSpace: ["Visible observations"],
  avoidInSpace: ["Unsupported discoveries"],
  activeCrew: ["director", "cinematographer", "editor", "composer"],
  refreshedAt: 1,
};

async function main() {
  const originalFetch = globalThis.fetch;
  const priorKey = process.env.OPENROUTER_API_KEY;
  const prompts: string[] = [];
  process.env.OPENROUTER_API_KEY = "synthetic-only-no-provider-access";
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as {
      model?: string;
      messages: Array<{ role: string; content: string }>;
    };
    prompts.push(request.messages.filter(message => message.role === "user").map(message => message.content).join("\n"));
    return Response.json({
      id: "crew-context-test",
      model: request.model ?? "synthetic-test-model",
      choices: [{ message: { content: JSON.stringify({
        hook: "Look up.", beats: [{ name: "Observe", intentSec: 20, note: "Show Saturn." }],
        footageQueries: ["Saturn rings", "night sky", "brass telescope", "observatory interior", "planet model", "ice particles", "ring shadow", "orbital motion"],
        promptStyle: "Clear astronomical detail.", palette: ["#112233"], motion: "Slow drift.", avoid: ["Fast zooms"],
        sections: [{ name: "Observe", cutsPerMin: 4 }], transitions: "Straight cuts.",
        captionStyle: "Small labels.", overlayRule: "Keep the telescope visible.",
        musicPrompt: "Quiet strings without vocals.", duckDb: -12, bedLufs: -22,
      }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, cost: 0.001 },
    });
  };
  try {
    for (const [role, brief] of Object.entries({ director: briefDirector, cinematographer: briefCinematographer, editor: briefEditor, composer: briefComposer })) {
      for (const [family, targetSeconds] of [["shorts", 20], ["narrated_stock", 90], ["music_loop", 3600]] as const) {
        const result = await brief(bible, {
          topic: "Saturn's rings", family, targetSeconds,
          channelName: "Sky Watch", dnaDigest: "Frozen identity: restrained observation.",
          roleDirectives: "Preserve the telescope motif.",
        });
        assert.ok(result, `${role} returns a usable brief`);
        const prompt = prompts.at(-1)!;
        assert.ok(prompt.includes(`Content family: ${family}.`), `${role} must receive the actual content family`);
        assert.ok(prompt.includes(`Target length: ${targetSeconds} seconds.`), `${role} must receive the exact duration in seconds`);
        assert.ok(prompt.includes("Frozen identity: restrained observation."));
        assert.ok(prompt.includes("Operator role directives: Preserve the telescope motif."));
        assert.ok(prompt.includes("Channel: Sky Watch."));
      }
    }
    console.log("CREW PROMPT CONTEXT PASS: four specialists, short/narrated/music families and exact durations");
  } finally {
    globalThis.fetch = originalFetch;
    if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorKey;
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
