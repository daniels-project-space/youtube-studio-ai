import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { synthChannelConcept } from "@/lib/conceptSynth";

const conceptSource = readFileSync(join(process.cwd(), "src/lib/conceptSynth.ts"), "utf8");
assert.match(conceptSource, /from ["']@\/lib\/creativeText["']/);
assert.doesNotMatch(conceptSource, /@\/lib\/anthropic|claudeJson|hasAnthropicKey/);

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
          voiceProfile: {
            editorialLens: "Trace how overlooked infrastructure decisions reshaped ordinary lives and public trust.",
            audienceRelationship: "Address curious adults as thoughtful peers, supplying context without assuming specialist knowledge.",
            delivery: "Use measured, evidence-led sentences, moving from a concrete record detail to its human consequence.",
            boundaries: "Separate documented fact from inference, name uncertainty, and never turn tragedy into spectacle.",
          },
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
    assert.match(concept.persona, /Editorial lens: Trace how overlooked infrastructure decisions/u);
    assert.match(concept.persona, /Audience relationship: Address curious adults as thoughtful peers/u);
    assert.match(concept.persona, /Delivery: Use measured, evidence-led sentences/u);
    assert.match(concept.persona, /Editorial boundaries: Separate documented fact from inference/u);
    assert.equal(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.body));
    assert.equal(body.model, "google/gemini-3.7-flash");
    assert.match(body.messages.at(-1)?.content ?? "", /"requiredCallbacks"/);
    assert.match(body.messages.at(-1)?.content ?? "", /"voiceProfile"/);

    global.fetch = async () => Response.json({
      id: "shallow-concept-test",
      model: "google/gemini-3.7-flash",
      choices: [{ message: { content: JSON.stringify({
        name: "Margin of History",
        niche: "forgotten history",
        voiceProfile: { editorialLens: "Forensic and humane." },
        styleGrammar: "engraved ink, archival paper",
        palette: ["#121212", "#E9DCC5"],
        topicPool: ["A documented story"],
        cadence: "weekly",
        archetypeKey: "documentary",
      }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
    });
    await assert.rejects(
      synthChannelConcept("forgotten infrastructure disasters", undefined),
      /voiceProfile\.editorialLens must contain 24-240 characters/u,
      "a shallow model persona must not silently become the channel's production identity",
    );

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
