import assert from "node:assert/strict";

import { craftTopics, type TopicBet } from "@/lib/topicraft";

const genericBet: TopicBet = {
  topic: "The bridge inspector whose warning arrived one day too late",
  angle: "A forgotten notebook reconstructs the final decision",
  betType: "hub",
  provisionalTitle: "The Warning Everyone Ignored Before the Bridge Fell",
  thumbnailMoment: "An inspector holds an open notebook beside a visibly cracked bridge support",
  hookPromise: "The notebook shows exactly when the disaster became unavoidable",
  evidence: "identity: forensic infrastructure failures",
};

const callbackBet: TopicBet = {
  topic: "The families erased from the official bridge inquiry",
  angle: "The human cost survives only as evidence in the margins",
  betType: "hub",
  provisionalTitle: "The Families the Official Bridge Inquiry Left Behind",
  thumbnailMoment: "A family photograph rests beneath a redacted bridge inquiry report",
  hookPromise: "Evidence in the margins restores the human cost the report erased",
  evidence: "identity: forensic infrastructure failures",
};

async function main(): Promise<void> {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;
  const prompts: string[] = [];
  let generatorCalls = 0;
  try {
    process.env.OPENROUTER_API_KEY = "topicraft-callback-test-key";
    global.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const prompt = String(body.messages?.at(-1)?.content ?? "");
      prompts.push(prompt);
      const isJudge = prompt.includes("Score each 1-10 on ALL FOUR");
      const content = isJudge
        ? { rankings: [{ idx: 0, demand: 9, freshness: 9, fit: 9, packageability: 9 }] }
        : { bets: [generatorCalls++ === 0 ? genericBet : callbackBet] };
      return Response.json({
        id: `topicraft-callback-${prompts.length}`,
        model: "google/gemini-3.7-flash",
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
      });
    };

    const result = await craftTopics({
      channelName: "Margin of History",
      persona: "Forensic and humane infrastructure history",
      requiredCallbacks: ["human cost", "evidence in the margins"],
      count: 1,
      outliers: [],
      providerSemanticDedupe: false,
    });

    assert.equal(generatorCalls, 2, "a judged but identity-incomplete first slate must trigger the feedback retry");
    assert.equal(result.bets[0]?.topic, callbackBet.topic, "only the callback-complete judged portfolio may ship");
    assert.equal(result.bench[0]?.topic, genericBet.topic, "the generic judged bet remains available only on the bench");
    assert.ok(
      prompts.some((prompt) => prompt.includes("required callbacks missing from judged portfolio")),
      "the retry must tell the generator which deterministic identity gate failed",
    );
  } finally {
    global.fetch = originalFetch;
    if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
  }
  console.log("Topicraft retries a judged generic slate and ships only callback-complete channel identity");
}

void main();
