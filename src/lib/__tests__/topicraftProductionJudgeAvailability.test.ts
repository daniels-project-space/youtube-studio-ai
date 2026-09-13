import assert from "node:assert/strict";
import { craftTopics, type TopicBet } from "@/lib/topicraft";

const candidate: TopicBet = {
  topic: "The bridge inspector whose warning arrived one day too late",
  angle: "A forgotten notebook reconstructs the final decision",
  betType: "hub",
  provisionalTitle: "The Warning Everyone Ignored Before the Bridge Fell",
  thumbnailMoment: "An inspector holds an open notebook beside a visibly cracked bridge support",
  hookPromise: "The notebook shows exactly when the disaster became unavoidable",
  evidence: "identity: forensic infrastructure failures",
};

async function main(): Promise<void> {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = globalThis.fetch;
  let generationCalls = 0;
  let judgeCalls = 0;
  try {
    process.env.OPENROUTER_API_KEY = "topicraft-production-availability-fixture";
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const prompt = String(body.messages?.at(-1)?.content ?? "");
      if (prompt.includes("Score each 1-10 on ALL FOUR")) {
        judgeCalls++;
        throw new Error("fixture topic judge unavailable");
      }
      generationCalls++;
      return Response.json({
        id: `topicraft-production-generator-${generationCalls}`,
        model: body.model,
        choices: [{ message: { content: JSON.stringify({ bets: [candidate] }) } }],
        usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
      });
    };

    await assert.rejects(
      () => craftTopics({
        channelName: "Margin of History",
        persona: "Forensic infrastructure history",
        count: 1,
        outliers: [],
        providerSemanticDedupe: false,
      }),
      /both attempts failed the gate.*topic judge unavailable/,
      "production Topicraft must not accept unscored lint-only bets",
    );
    assert.equal(generationCalls, 2, "production receives one bounded regenerated slate after a judge outage");
    assert.equal(judgeCalls, 2, "each of the two bounded slates receives exactly one unavailable-judge attempt");

    generationCalls = 0;
    judgeCalls = 0;
    const draft = await craftTopics({
      channelName: "Margin of History",
      persona: "Forensic infrastructure history",
      count: 1,
      outliers: [],
      providerSemanticDedupe: false,
      qualityProfile: "draft",
    });
    assert.equal(draft.ungated, true, "only an explicit draft preview may retain a visible ungraded slate");
    assert.equal(draft.bets.length, 1);
    assert.equal(generationCalls, 1, "draft diagnostics retain their first structurally valid slate");
    assert.equal(judgeCalls, 1);
    console.log("TOPICRAFT PRODUCTION JUDGE AVAILABILITY PASS — production refuses unscored bets; explicit draft remains diagnostic");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
