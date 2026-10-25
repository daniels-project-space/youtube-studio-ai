import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { synthChannelConcept } from "@/lib/conceptSynth";

const conceptSource = readFileSync(join(process.cwd(), "src/lib/conceptSynth.ts"), "utf8");
assert.match(conceptSource, /from ["']@\/lib\/creativeText["']/);
assert.doesNotMatch(conceptSource, /@\/lib\/anthropic|claudeJson|hasAnthropicKey/);

function conceptResponse(
  topicPool: string[],
  overrides: { palette?: string[]; requiredCallbacks?: string[]; archetypeKey?: string } = {},
): Response {
  return Response.json({
    id: "concept-test",
    model: "google/gemini-3.7-flash",
    choices: [{ message: { content: JSON.stringify({
      name: "Margin of History",
      niche: "forgotten history",
      persona: "Forensic and humane.",
      styleGrammar: "engraved ink, archival paper",
      palette: overrides.palette ?? ["#121212", "#E9DCC5", "#A3412D"],
      topicPool,
      bannedWords: ["shocking"],
      requiredCallbacks: overrides.requiredCallbacks ?? ["  Evidence   in the margins ", "human cost", "HUMAN COST"],
      cadence: "weekly",
      archetypeKey: overrides.archetypeKey ?? "narrated-essay",
    }) } }],
    usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
  });
}

async function main(): Promise<void> {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;
  const requests: RequestInit[] = [];
  const completeTopicPool = [
    "The warning hidden in a bridge inspector's notebook",
    "The engineer who predicted the dam failure",
    "The redacted report that concealed a structural flaw",
    "How one missing rivet changed the rail crossing",
    "The town that rebuilt after its floodwall failed",
    "Why an ignored load test doomed a suspension bridge",
  ];
  try {
    process.env.OPENROUTER_API_KEY = "concept-test-key";
    global.fetch = async (_input, init) => {
      requests.push(init ?? {});
      return requests.length === 1
        ? conceptResponse(
          ["The warning hidden in a bridge inspector's notebook"],
          {
            palette: ["#121212", "not-a-color"],
            requiredCallbacks: ["justice", "subscribe for more", "Evidence in the margins"],
            archetypeKey: "unknown-voice",
          },
        )
        : conceptResponse(completeTopicPool);
    };

    const concept = await synthChannelConcept("forgotten infrastructure disasters", undefined);
    assert.deepEqual(
      concept.requiredCallbacks,
      ["Evidence in the margins", "human cost"],
      "inception must persist normalized, channel-specific callback motifs from the creative route",
    );
    assert.deepEqual(concept.topicPool, completeTopicPool, "the concept must return a complete, distinct topic territory");
    assert.deepEqual(concept.palette, ["#121212", "#E9DCC5", "#A3412D"], "the repair must restore the palette contract");
    assert.equal(concept.archetypeKey, "narrated-essay", "the concept must not silently coerce an invalid archetype to lofi");
    assert.equal(requests.length, 2, "an underfilled topic pool gets one bounded repair request");
    const body = JSON.parse(String(requests[0]?.body));
    assert.equal(body.model, "google/gemini-3.7-flash");
    assert.match(body.messages.at(-1)?.content ?? "", /"requiredCallbacks"/);
    const repairBody = JSON.parse(String(requests[1]?.body));
    assert.match(repairBody.messages.at(-1)?.content ?? "", /at least 6 unique concrete video topic ideas/i);
    assert.match(repairBody.messages.at(-1)?.content ?? "", /at least 3 valid unique hex colors/i);
    assert.match(repairBody.messages.at(-1)?.content ?? "", /2-5 word identity motifs and no generic calls to action/i);
    assert.match(repairBody.messages.at(-1)?.content ?? "", /allowed archetypeKey/i);

    const healthyStart = requests.length;
    await synthChannelConcept("a complete topic territory", undefined);
    assert.equal(requests.length - healthyStart, 1, "a complete first slate must keep the normal path to one request");

    let invalidRepairCalls = 0;
    global.fetch = async () => {
      invalidRepairCalls++;
      return conceptResponse(completeTopicPool, { archetypeKey: "unknown-voice" });
    };
    await assert.rejects(
      () => synthChannelConcept("a channel with an underfilled topic territory", undefined),
      /invalid archetypeKey after repair/,
      "an unsupported archetype must not be silently returned as a lofi concept",
    );
    assert.equal(invalidRepairCalls, 2, "the failed concept attempt is bounded to one repair");

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
