import assert from "node:assert/strict";

import {
  FORMAT_ADVISOR_MIN_CONFIDENCE,
  adviseFormatSelection,
  type AdviseFormatSelectionArgs,
} from "@/engine/creative/formatAdvisor";
import { rankFormatCandidates, recommendFormatDeterministically } from "@/engine/creative/selectFormat";
import type { RankedFormatCandidate } from "@/engine/creative/selectFormat";

function openRouterResponse(verdict: unknown) {
  return new Response(
    JSON.stringify({
      id: "or-format-advisor-test",
      model: "google/gemini-3.7-flash",
      choices: [{ message: { content: JSON.stringify(verdict) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const tiedPool: RankedFormatCandidate[] = [
  { family: "narrated_stock", score: 2, matchedSignals: ["deep dive"] },
  { family: "whiteboard", score: 2, matchedSignals: ["how does"] },
  { family: "comic", score: 1, matchedSignals: [] },
];

const baseArgs: AdviseFormatSelectionArgs = {
  candidates: tiedPool,
  selectionInput: { concept: "A deep dive explaining how the mechanism works" },
};

async function main(): Promise<void> {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = global.fetch;
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.ANTHROPIC_API_KEY = "retired-direct-key";

    // ------------------------------------------------------------------
    // 0. Zero behavior change to the deterministic engine: this module is
    // never wired into selectFormat()/recommendFormatDeterministically(),
    // and the deterministic outputs used to build the test pool above are
    // themselves still exactly what the unmodified engine produces.
    // ------------------------------------------------------------------
    const deterministic = recommendFormatDeterministically({ concept: "Hand-drawn whiteboard explainer for a science mechanism" });
    assert.equal(deterministic.family, "whiteboard");
    assert.equal(deterministic.fallback, true);

    // ------------------------------------------------------------------
    // 1. A validated advisory pick is applied, and it is always a member
    // of the supplied candidate pool — never invented.
    // ------------------------------------------------------------------
    let calls = 0;
    global.fetch = (async (_input: unknown, init?: RequestInit) => {
      calls += 1;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, "google/gemini-3.7-flash");
      assert.match(request.messages.at(-1).content, /FORMAT_CANDIDATES/);
      return openRouterResponse({ family: "whiteboard", confidence: 0.82, reasoning: "The concept is a mechanism explainer." });
    }) as typeof fetch;

    const applied = await adviseFormatSelection(baseArgs);
    assert.equal(calls, 1);
    assert.equal(applied.advisorApplied, true);
    assert.equal(applied.family, "whiteboard");
    assert.equal(applied.confidence, 0.82);
    assert.equal(tiedPool.some((c) => c.family === applied.family), true, "advisory pick must be a member of the candidate set");

    // ------------------------------------------------------------------
    // 2. An out-of-set pick (never in the supplied pool) must fall back to
    // the deterministic top candidate rather than being honored.
    // ------------------------------------------------------------------
    global.fetch = (async () =>
      openRouterResponse({ family: "cinematic", confidence: 0.95, reasoning: "Hallucinated, out-of-pool pick." })) as typeof fetch;
    const outOfSet = await adviseFormatSelection(baseArgs);
    assert.equal(outOfSet.advisorApplied, false);
    assert.equal(outOfSet.family, tiedPool[0]!.family);
    assert.match(outOfSet.fallbackReason ?? "", /not a member of the supplied candidate pool/);

    // ------------------------------------------------------------------
    // 3. Below-confidence-floor picks fall back even when `family` is
    // valid and in-set.
    // ------------------------------------------------------------------
    global.fetch = (async () =>
      openRouterResponse({
        family: "whiteboard",
        confidence: FORMAT_ADVISOR_MIN_CONFIDENCE - 0.1,
        reasoning: "Not confident enough.",
      })) as typeof fetch;
    const lowConfidence = await adviseFormatSelection(baseArgs);
    assert.equal(lowConfidence.advisorApplied, false);
    assert.equal(lowConfidence.family, tiedPool[0]!.family);
    assert.match(lowConfidence.fallbackReason ?? "", /below the .* floor/);

    // ------------------------------------------------------------------
    // 4. A malformed/incomplete provider response falls back rather than
    // guessing.
    // ------------------------------------------------------------------
    global.fetch = (async () => openRouterResponse({ family: "whiteboard" })) as typeof fetch;
    const malformed = await adviseFormatSelection(baseArgs);
    assert.equal(malformed.advisorApplied, false);
    assert.equal(malformed.family, tiedPool[0]!.family);
    assert.match(malformed.fallbackReason ?? "", /malformed or incomplete/);

    // ------------------------------------------------------------------
    // 5. A provider/network failure falls back instead of throwing.
    // ------------------------------------------------------------------
    global.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "upstream outage" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const providerFailure = await adviseFormatSelection(baseArgs);
    assert.equal(providerFailure.advisorApplied, false);
    assert.equal(providerFailure.family, tiedPool[0]!.family);
    assert.match(providerFailure.fallbackReason ?? "", /provider call failed/);

    // ------------------------------------------------------------------
    // 6. Missing provider key must fall back WITHOUT ever calling a
    // provider.
    // ------------------------------------------------------------------
    delete process.env.OPENROUTER_API_KEY;
    let unexpectedCall = false;
    global.fetch = (async () => {
      unexpectedCall = true;
      throw new Error("missing permitted key must not call a provider");
    }) as typeof fetch;
    const noKey = await adviseFormatSelection(baseArgs);
    assert.equal(noKey.advisorApplied, false);
    assert.equal(noKey.family, tiedPool[0]!.family);
    assert.match(noKey.fallbackReason ?? "", /no permitted provider is configured/);
    assert.equal(unexpectedCall, false);

    // ------------------------------------------------------------------
    // 7. Fewer than two candidates must fall back WITHOUT calling a
    // provider, even with a valid key configured.
    // ------------------------------------------------------------------
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    let singleCandidateCall = false;
    global.fetch = (async () => {
      singleCandidateCall = true;
      throw new Error("single-candidate pool must not call a provider");
    }) as typeof fetch;
    const singleCandidate = await adviseFormatSelection({
      ...baseArgs,
      candidates: [tiedPool[0]!],
    });
    assert.equal(singleCandidate.advisorApplied, false);
    assert.equal(singleCandidate.family, tiedPool[0]!.family);
    assert.match(singleCandidate.fallbackReason ?? "", /fewer than two candidates/);
    assert.equal(singleCandidateCall, false);

    // ------------------------------------------------------------------
    // 8. No candidates at all is handled without throwing.
    // ------------------------------------------------------------------
    const noCandidates = await adviseFormatSelection({ ...baseArgs, candidates: [] });
    assert.equal(noCandidates.advisorApplied, false);
    assert.equal(noCandidates.family, "narrated_stock");

    // ------------------------------------------------------------------
    // 9. Real deterministic ranking output can be fed straight in (integration
    // smoke — proves the module's shape matches what rankFormatCandidates()
    // actually returns).
    // ------------------------------------------------------------------
    const realRanked = rankFormatCandidates({ concept: "evidence-led archival documentary short" });
    global.fetch = (async () =>
      openRouterResponse({
        family: realRanked[0]!.family,
        confidence: 0.9,
        reasoning: "Matches the strongest deterministic signal.",
      })) as typeof fetch;
    const realResult = await adviseFormatSelection({ candidates: realRanked, selectionInput: { concept: "evidence-led archival documentary short" } });
    assert.equal(realResult.advisorApplied, true);
    assert.equal(realResult.family, realRanked[0]!.family);

    console.log("format advisor tests passed");
  } finally {
    global.fetch = originalFetch;
    if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
  }
}

void main();
