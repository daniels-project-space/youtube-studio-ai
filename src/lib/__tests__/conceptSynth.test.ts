import assert from "node:assert/strict";

import { synthChannelConcept } from "@/lib/conceptSynth";

async function main(): Promise<void> {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;
  const requests: RequestInit[] = [];
  try {
    process.env.OPENROUTER_API_KEY = "concept-test-key";
    global.fetch = async (_input, init) => {
      requests.push(init ?? {});
      return Response.json({
        id: "concept-test",
        model: "google/gemini-3.7-flash",
        choices: [{ message: { content: JSON.stringify({
          name: "Margin of History",
          niche: "forgotten history",
          persona: "Forensic and humane.",
          styleGrammar: "engraved ink, archival paper",
          palette: ["#121212", "#E9DCC5", "#A3412D"],
          topicPool: ["The warning hidden in a bridge inspector's notebook"],
          bannedWords: ["shocking"],
          requiredCallbacks: ["  Evidence   in the margins ", "human cost", "HUMAN COST"],
          cadence: "weekly",
          archetypeKey: "documentary",
        }) } }],
        usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
      });
    };

    const concept = await synthChannelConcept("forgotten infrastructure disasters", undefined);
    assert.deepEqual(
      concept.requiredCallbacks,
      ["Evidence in the margins", "human cost"],
      "inception must persist normalized, channel-specific callback motifs from the creative route",
    );
    assert.equal(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.body));
    assert.equal(body.model, "google/gemini-3.7-flash");
    assert.match(body.messages.at(-1)?.content ?? "", /"requiredCallbacks"/);

    delete process.env.OPENROUTER_API_KEY;
    const logs: string[] = [];
    const fallback = await synthChannelConcept("quiet engineering stories", undefined, (message) => logs.push(message));
    assert.deepEqual(fallback.requiredCallbacks, [], "offline fallback must remain a valid callback contract");
    assert.ok(logs.some((message) => message.includes("no OpenRouter key")));
    assert.ok(logs.every((message) => !message.includes("no Anthropic key")));
  } finally {
    global.fetch = originalFetch;
    if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
  }
  console.log("Channel concept recurring-callback production verified through pinned OpenRouter routing");
}

void main();
