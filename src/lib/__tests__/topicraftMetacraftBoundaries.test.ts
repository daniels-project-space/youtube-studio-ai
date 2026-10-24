import assert from "node:assert/strict";
import Module from "node:module";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";

const bet = {
  topic: "The bridge inspector whose warning arrived too late",
  angle: "A forgotten notebook reconstructs the final decision",
  betType: "hub" as const,
  provisionalTitle: "The Warning Everyone Ignored Before the Bridge Fell",
  thumbnailMoment: "An inspector holds an open notebook beside a cracked bridge support",
  hookPromise: "The notebook shows when the disaster became unavoidable",
  evidence: "identity: forensic infrastructure failures",
};
let malformed: unknown;
let generationCalls = 0;
let judgeCalls = 0;
let packageResponse: unknown;
let failAt = "";
let competingTopics = false;
const unknownOutcome = new OpenRouterGenerationOutcomeUnknownError("fixture unknown outcome", { status: 200 });
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (!request.endsWith("/creativeText")) return resolved;
  const generate = async ({ prompt }: { prompt: string }) => {
    if (prompt.includes("description + tags")) return packageResponse;
    if (prompt.includes("Score each 1-10 on ALL FOUR")) {
      judgeCalls++;
      if (failAt === "judge") throw unknownOutcome;
      for (const field of [bet.angle, bet.hookPromise, bet.thumbnailMoment, "forensic observer", "historical decisions"]) {
        assert.ok(prompt.includes(field), `Topic judge must see ${field}`);
      }
      if (competingTopics) {
        assert.ok(prompt.includes("A bridge inspector whose warning arrived too late"), "similar promises must both reach judgment");
        return { rankings: [
          { idx: 0, demand: 5, freshness: 8, fit: 8, packageability: 8 },
          { idx: 1, demand: 9, freshness: 8, fit: 8, packageability: 8 },
        ] };
      }
      return { rankings: [{ idx: 0, demand: 8, freshness: 8, fit: 8, packageability: 8 }] };
    }
    if (prompt.startsWith("You are a YouTube CTR strategist")) {
      judgeCalls++;
      return { rankings: [{ idx: 0, clickScore: 8, direct: 8, identityFit: 8,
        viewerMotivation: 8, grounding: "supported", reason: "Taxes fund the teachers and maintenance." }] };
    }
    generationCalls++;
    if (failAt === "generator") throw unknownOutcome;
    if (generationCalls === 1) return malformed;
    return prompt.includes("content BETS") ? { bets: [bet] }
      : { candidates: [{ frame: "mechanism", title: "Taxes Fund Public Schools" }] };
  };
  return { ...resolved, hasCreativeTextKey: () => true, creativeTextJson: generate, creativeTextJsonPro: generate };
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  assert.match(String(input), /^https:\/\/suggestqueries\.google\.com\//);
  return Response.json(["", []]);
};

async function main() {
  const { craftTopics, lintBet } = await import("../topicraft");
  const { craftMetadata } = await import("../metacraft");
  const topicArgs = { count: 1, persona: "forensic observer", topicPool: ["historical decisions"],
    outliers: [], providerSemanticDedupe: false };
  const metaArgs = { topic: "Taxes and public schools", competitorTitles: [],
    narrationText: "Taxes fund public schools. School tax money goes to teachers and maintenance." };

  for (const response of [null, { bets: {} }, { bets: [null] }, { bets: [{ ...bet, hookPromise: {} }] },
    { bets: [{ ...bet, betType: "invented" }] }]) {
    malformed = response;
    generationCalls = judgeCalls = 0;
    const result = await craftTopics(topicArgs);
    assert.equal(result.bets[0].topic, bet.topic);
    assert.equal(generationCalls, 2, "malformed topic slate receives exactly one repair");
    assert.equal(judgeCalls, 1, "only repaired topics reach the judge");
  }

  packageResponse = { description: "Taxes support teachers and maintenance.", tagsCsv: "taxes,schools,teachers,education,funding" };
  competingTopics = true;
  const stronger = { ...bet, topic: "A bridge inspector whose warning arrived too late" };
  malformed = { bets: [bet, stronger] };
  generationCalls = judgeCalls = 0;
  const selected = await craftTopics(topicArgs);
  assert.equal(selected.bets[0].topic, stronger.topic, "an early rejected near-duplicate cannot suppress the admitted promise");
  assert.equal(generationCalls, 1);
  assert.equal(judgeCalls, 1);
  competingTopics = false;

  for (const response of [null, { candidates: {} }, { candidates: [null] },
    { candidates: [{ frame: "mechanism", title: {} }] }]) {
    malformed = response;
    generationCalls = judgeCalls = 0;
    const result = await craftMetadata(metaArgs);
    assert.equal(result.title, "Taxes Fund Public Schools");
    assert.equal(result.titleDecision.attempts, 2);
    assert.equal(generationCalls, 2);
    assert.equal(judgeCalls, 1);
  }

  malformed = { candidates: [{ frame: "mechanism", title: "Taxes Fund Public Schools" }] };
  for (const response of [{ description: {}, tagsCsv: "a,b,c,d,e" },
    { description: "Valid description", tagsCsv: "Taxes,taxes,TAXES,schools,teachers" }]) {
    packageResponse = response;
    generationCalls = judgeCalls = 0;
    const result = await craftMetadata(metaArgs);
    assert.equal(result.packageFallback, true, "malformed or duplicate-only packages degrade visibly");
    assert.ok(!result.description.includes("[object Object]"));
    assert.equal(result.judged, true, "package failure preserves the admitted title");
    assert.equal(generationCalls, 1);
    assert.equal(judgeCalls, 1);
  }

  malformed = { bets: [bet] };
  for (const qualityProfile of ["production", "draft"] as const) {
    for (const stage of ["generator", "judge"]) {
      failAt = stage;
      generationCalls = judgeCalls = 0;
      await assert.rejects(() => craftTopics({ ...topicArgs, qualityProfile }), (error) => error === unknownOutcome);
      assert.equal(generationCalls, 1, "unknown spend outcome cannot trigger a second slate");
      assert.equal(judgeCalls, stage === "judge" ? 1 : 0);
    }
  }
  failAt = "";
  const lint = lintBet({ ...bet, hookPromise: "forbidden promise" }, {
    evidence: { outliers: [], trends: [], suggests: [], competitors: [] }, identityGiven: true,
    bannedWords: ["forbidden"], avoidNorm: new Set(), avoidTokens: [], keptTokens: [],
  });
  assert.ok(lint.issues.some((issue) => issue.includes('banned term "forbidden"')));
  console.log("TOPICRAFT/METACRAFT BOUNDARIES PASS: malformed slate repair, full judge handoff, package fallback, unknown outcomes and hook bans");
}
main().finally(() => { loader._load = originalLoad; globalThis.fetch = originalFetch; })
  .catch((error) => { console.error(error); process.exitCode = 1; });
