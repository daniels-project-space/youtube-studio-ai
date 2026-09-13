import assert from "node:assert/strict";
import { completePipelineForPolicy } from "@/engine/pipelineCompiler";
import { complianceCheck, originalityGate } from "@/trigger/blocks/complianceBlocks";
import type { StageContext } from "@/engine/types";

function context(params: Record<string, unknown>, store: Record<string, unknown>): StageContext {
  return {
    ownerId: "owner-compliance-availability",
    channelId: "channel-compliance-availability",
    runId: "run-compliance-availability",
    keyPrefix: "owners/owner-compliance-availability/",
    params,
    store,
    budgetUsd: 1,
    log: () => {},
  };
}

async function main(): Promise<void> {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  try {
    delete process.env.OPENROUTER_API_KEY;

    await assert.rejects(
      () => complianceCheck.run(context({ qualityProfile: "production" }, { topic: "A realistic reconstruction of a living politician" })),
      /production topic classifier requires the configured OpenRouter creative-text provider/,
      "a production route must not relabel an unscanned topic as a clean classifier result",
    );
    await assert.rejects(
      () => originalityGate.run(context({ qualityProfile: "production" }, { narrationText: "A dangerous unreviewed line." })),
      /production spoken-line safety scan requires the configured OpenRouter creative-text provider/,
      "a production route must stop before lexical persistence when narration safety is unavailable",
    );

    const draft = await complianceCheck.run(context({ qualityProfile: "draft" }, { topic: "A low-stakes draft outline" }));
    assert.deepEqual(
      draft,
      { disclosureRequired: false, sensitiveTopic: false, complianceNote: "" },
      "an explicitly draft-only diagnostic remains observable without claiming a production scan",
    );

    const source = [
      { block: "topic_select" },
      { block: "originality_gate", params: { qualityProfile: "draft" } },
      { block: "compliance_check", params: { qualityProfile: "draft" } },
    ];
    const production = completePipelineForPolicy(source).entries;
    const productionGuardProfiles = production
      .filter((entry) => entry.block === "originality_gate" || entry.block === "compliance_check")
      .map((entry) => entry.params?.["qualityProfile"]);
    assert.deepEqual(productionGuardProfiles, ["production", "production"], "production normalisation overrides stale draft guard settings");

    const draftPipeline = completePipelineForPolicy(source, { generationProfile: "draft" }).entries;
    const draftGuardProfiles = draftPipeline
      .filter((entry) => entry.block === "originality_gate" || entry.block === "compliance_check")
      .map((entry) => entry.params?.["qualityProfile"]);
    assert.deepEqual(draftGuardProfiles, ["draft", "draft"], "a draft probe is explicitly marked rather than inferred from a missing key");

    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    let providerCalls = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions", "compliance must stay on the canonical provider boundary");
      const body = JSON.parse(String(init?.body));
      providerCalls++;
      const prompt = String(body.messages.at(-1)?.content ?? "");
      const malformed = prompt.startsWith("Classify a faceless")
        ? { sensitive: false, depictsRealPeopleRealistically: false }
        : { violation: "false", category: "", reason: "" };
      return Response.json({
        id: `fixture-malformed-compliance-${providerCalls}`,
        model: body.model,
        choices: [{ message: { content: JSON.stringify(malformed) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, cost: 0.001 },
      });
    };
    await assert.rejects(
      () => complianceCheck.run(context({ qualityProfile: "production" }, { topic: "Malformed classifier contract fixture" })),
      /production topic classifier is unavailable.*incomplete verdict/,
      "a malformed topic verdict must not default both safety flags to false in production",
    );
    await assert.rejects(
      () => originalityGate.run(context({ qualityProfile: "production" }, { narrationText: "Malformed spoken-line classifier contract fixture." })),
      /production spoken-line safety scan is unavailable.*invalid violation flag/,
      "a malformed spoken-line verdict must not become a clean narration scan",
    );
    assert.equal(providerCalls, 4, "each malformed production classifier result gets one deliberate schema retry, never an unbounded replay");

    let ambiguousCalls = 0;
    globalThis.fetch = async () => {
      ambiguousCalls++;
      throw new TypeError("fixture connection closed after request dispatch");
    };
    await assert.rejects(
      () => complianceCheck.run(context({ qualityProfile: "production" }, { topic: "Ambiguous topic classifier contract fixture" })),
      /production topic classifier is unavailable.*generation may already have consumed provider work/,
      "an ambiguous post-dispatch classifier outcome must fail production without a blind replay",
    );
    assert.equal(ambiguousCalls, 1, "an ambiguous provider outcome is never retried automatically");

    console.log("COMPLIANCE PRODUCTION AVAILABILITY PASS — compiled production guards fail closed; draft diagnostics remain explicit");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
