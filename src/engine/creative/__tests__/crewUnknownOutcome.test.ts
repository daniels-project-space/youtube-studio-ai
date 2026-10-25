import assert from "node:assert/strict";
import { briefDirector, briefCinematographer, briefEditor, briefComposer, briefCritic } from "../crew";
import type { ShowBible } from "../types";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";

const bible: ShowBible = {
  positioning: "An archivist explains invented small machines.", vibe: "Dry and patient.", iconicMotif: "brass lamp",
  worksInSpace: ["observable mechanisms"], avoidInSpace: ["supernatural solutions"],
  activeCrew: ["director", "cinematographer", "editor", "composer", "critic"], refreshedAt: 1,
};
async function main(): Promise<void> {
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENROUTER_API_KEY;
  let calls = 0;
  process.env.OPENROUTER_API_KEY = "fixture-only-no-provider";
  globalThis.fetch = async () => { calls++; return Response.json({ choices: [] }); };
  try {
    for (const brief of [briefDirector, briefCinematographer, briefEditor, briefComposer, briefCritic]) {
      const before = calls;
      await assert.rejects(brief(bible, { topic: "The stopped clock", family: "narrated_stock", targetSeconds: 90 }),
        OpenRouterGenerationOutcomeUnknownError, "uncertain paid work must not become an optional missing brief");
      assert.equal(calls, before + 1, "an uncertain generation is never replayed");
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
  console.log("CREW UNKNOWN OUTCOME PASS - all five specialists preserve terminal uncertain-work errors");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
