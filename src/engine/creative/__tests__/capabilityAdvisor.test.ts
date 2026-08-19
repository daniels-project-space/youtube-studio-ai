import assert from "node:assert/strict";

import {
  CAPABILITY_ADVISOR_MIN_CONFIDENCE,
  adviseCreativeCapabilitySelection,
} from "@/engine/creative/capabilityAdvisor";
import {
  resolveCreativeCapabilities,
  validateCreativeCapabilitySelections,
  creativeCapabilitySelection,
} from "@/engine/creative/creativeCapabilityCatalog";

function anthropicResponse(verdict: unknown) {
  return new Response(
    JSON.stringify({
      id: "msg-capability-advisor-test",
      content: [{ type: "text", text: JSON.stringify(verdict) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const dataStoryIntent = {
  concept: "A source-attributed data storytelling channel with animated charts and ranked comparisons",
  niche: "Business history",
  nicheKey: "business-history",
};

const casefileIntent = {
  concept: "A Fern-style true crime investigation with source-bound faceless mannequin reconstructions",
};

const childrenIntent = {
  concept: "An original animated preschool kids show with gentle participation",
};

async function main(): Promise<void> {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const previousModel = process.env.ANTHROPIC_CREATIVE_PRO_MODEL;
  const originalFetch = global.fetch;
  try {
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.ANTHROPIC_CREATIVE_PRO_MODEL = "claude-capability-advisor-test";

    // ------------------------------------------------------------------
    // 0. Zero behavior change to the unmodified catalog: resolveCreativeCapabilities()
    // still returns the same offers it always did.
    // ------------------------------------------------------------------
    const dataOffers = resolveCreativeCapabilities(dataStoryIntent, "narrated_stock");
    assert.equal(dataOffers.some((o) => o.capability === "source_attributed_data_story"), true);

    // ------------------------------------------------------------------
    // 1. Hard gate #1: a private-review-only offer set (casefile_cinematic)
    // must never reach the provider and must never produce a suggestion —
    // it is filtered out before any provider call.
    // ------------------------------------------------------------------
    const casefileOffers = resolveCreativeCapabilities(casefileIntent, "cinematic");
    assert.equal(casefileOffers.every((o) => o.selectionMode === "private_review_only"), true);
    let casefileCallMade = false;
    global.fetch = (async () => {
      casefileCallMade = true;
      throw new Error("private-review-only offer set must never call a provider");
    }) as typeof fetch;
    const casefileResult = await adviseCreativeCapabilitySelection(casefileOffers, { intent: casefileIntent });
    assert.equal(casefileResult.suggestion, undefined);
    assert.match(casefileResult.fallbackReason ?? "", /no explicit-opt-in capability is eligible/);
    assert.equal(casefileCallMade, false);

    // ------------------------------------------------------------------
    // 2. Same hard gate for children_show_bible (private_review_only).
    // ------------------------------------------------------------------
    const childrenOffers = resolveCreativeCapabilities(childrenIntent, "children_learning");
    assert.equal(childrenOffers.every((o) => o.selectionMode === "private_review_only"), true);
    let childrenCallMade = false;
    global.fetch = (async () => {
      childrenCallMade = true;
      throw new Error("private-review-only offer set must never call a provider");
    }) as typeof fetch;
    const childrenResult = await adviseCreativeCapabilitySelection(childrenOffers, { intent: childrenIntent });
    assert.equal(childrenResult.suggestion, undefined);
    assert.equal(childrenCallMade, false);

    // ------------------------------------------------------------------
    // 3. A valid, in-set, high-confidence suggestion for the one eligible
    // explicit_opt_in capability.
    // ------------------------------------------------------------------
    let calls = 0;
    global.fetch = (async (_input: unknown, init?: RequestInit) => {
      calls += 1;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, "claude-capability-advisor-test");
      assert.match(request.messages[0].content, /ELIGIBLE_CAPABILITIES/);
      // Only the explicit_opt_in offer must ever be described to the model.
      assert.doesNotMatch(request.messages[0].content, /casefile_cinematic/);
      return anthropicResponse({
        capability: "source_attributed_data_story",
        worthSuggesting: true,
        confidence: 0.8,
        reasoning: "The concept explicitly asks for chart-led data storytelling.",
      });
    }) as typeof fetch;
    const suggested = await adviseCreativeCapabilitySelection(dataOffers, { intent: dataStoryIntent });
    assert.equal(calls, 1);
    assert(suggested.suggestion, "expected a suggestion");
    assert.equal(suggested.suggestion!.capability, "source_attributed_data_story");
    assert.equal(suggested.suggestion!.confidence, 0.8);

    // The suggestion is never an implicit selection: the operator must still
    // go through the unmodified explicit opt-in flow for it to take effect.
    const validated = validateCreativeCapabilitySelections({
      family: "narrated_stock",
      intent: dataStoryIntent,
      selections: [creativeCapabilitySelection(suggested.suggestion!.capability)],
    });
    assert.equal(validated[0]?.offer.capability, "source_attributed_data_story");

    // ------------------------------------------------------------------
    // 4. Hard gate #2: even when a real capability key comes back, it must
    // be re-checked against the eligible (explicit_opt_in-only) set — a
    // hallucinated private-review pick is rejected exactly like a failure,
    // never substituted in as a "helpful" suggestion.
    // ------------------------------------------------------------------
    global.fetch = (async () =>
      anthropicResponse({
        capability: "casefile_cinematic",
        worthSuggesting: true,
        confidence: 0.99,
        reasoning: "Hallucinated private-review pick that must be rejected.",
      })) as typeof fetch;
    const outOfSet = await adviseCreativeCapabilitySelection(dataOffers, { intent: dataStoryIntent });
    assert.equal(outOfSet.suggestion, undefined);
    assert.match(outOfSet.fallbackReason ?? "", /not an eligible explicit-opt-in capability/);

    // ------------------------------------------------------------------
    // 5. worthSuggesting:false must yield no suggestion.
    // ------------------------------------------------------------------
    global.fetch = (async () =>
      anthropicResponse({
        capability: "source_attributed_data_story",
        worthSuggesting: false,
        confidence: 0.9,
        reasoning: "Not actually a good fit here.",
      })) as typeof fetch;
    const notWorth = await adviseCreativeCapabilitySelection(dataOffers, { intent: dataStoryIntent });
    assert.equal(notWorth.suggestion, undefined);
    assert.match(notWorth.fallbackReason ?? "", /no eligible capability worth suggesting/);

    // ------------------------------------------------------------------
    // 6. Below-confidence-floor must yield no suggestion.
    // ------------------------------------------------------------------
    global.fetch = (async () =>
      anthropicResponse({
        capability: "source_attributed_data_story",
        worthSuggesting: true,
        confidence: CAPABILITY_ADVISOR_MIN_CONFIDENCE - 0.1,
        reasoning: "Not confident enough.",
      })) as typeof fetch;
    const lowConfidence = await adviseCreativeCapabilitySelection(dataOffers, { intent: dataStoryIntent });
    assert.equal(lowConfidence.suggestion, undefined);
    assert.match(lowConfidence.fallbackReason ?? "", /below the .* floor/);

    // ------------------------------------------------------------------
    // 7. Malformed response yields no suggestion.
    // ------------------------------------------------------------------
    global.fetch = (async () => anthropicResponse({ capability: "source_attributed_data_story" })) as typeof fetch;
    const malformed = await adviseCreativeCapabilitySelection(dataOffers, { intent: dataStoryIntent });
    assert.equal(malformed.suggestion, undefined);
    assert.match(malformed.fallbackReason ?? "", /malformed or incomplete/);

    // ------------------------------------------------------------------
    // 8. Provider/network failure yields no suggestion, never throws.
    // ------------------------------------------------------------------
    global.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "upstream outage" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const providerFailure = await adviseCreativeCapabilitySelection(dataOffers, { intent: dataStoryIntent });
    assert.equal(providerFailure.suggestion, undefined);
    assert.match(providerFailure.fallbackReason ?? "", /provider call failed/);

    // ------------------------------------------------------------------
    // 9. Missing provider key yields no suggestion WITHOUT calling a
    // provider.
    // ------------------------------------------------------------------
    delete process.env.ANTHROPIC_API_KEY;
    let unexpectedCall = false;
    global.fetch = (async () => {
      unexpectedCall = true;
      throw new Error("missing permitted key must not call a provider");
    }) as typeof fetch;
    const noKey = await adviseCreativeCapabilitySelection(dataOffers, { intent: dataStoryIntent });
    assert.equal(noKey.suggestion, undefined);
    assert.match(noKey.fallbackReason ?? "", /no permitted provider is configured/);
    assert.equal(unexpectedCall, false);

    console.log("capability advisor tests passed");
  } finally {
    global.fetch = originalFetch;
    if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    if (previousModel === undefined) delete process.env.ANTHROPIC_CREATIVE_PRO_MODEL;
    else process.env.ANTHROPIC_CREATIVE_PRO_MODEL = previousModel;
  }
}

void main();
