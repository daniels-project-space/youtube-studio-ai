import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BASELINE_REVISION, benchmarkSourcePolicy, loadExperiments, prepareExperiment, runBenchmarkCase, sha256, titleCallPhase, verifySource,
  type RecordedHttp,
} from "../../../scripts/title-quality-benchmark";

const manifest = JSON.parse(readFileSync("test-fixtures/title-baseline/manifest.json", "utf8"));
const binding = manifest.cases.find((c: { channelName: string }) => c.channelName === "Chalk & Compound");
const bytes = readFileSync(binding.file);
const packet = prepareExperiment(binding, bytes);
const inputsHash = sha256(JSON.stringify(packet));
const options = { condition: "baseline" as const, mode: "replay" as const, maxCalls: 4, spendCapUsd: 0.75 };
const title = "How Taxation Actually Works";
const alternate = "Why Taxation Is Simpler Than It Looks";
const response = (body: Record<string, unknown>, content: unknown, usage: unknown = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }) => ({
  status: 200,
  rawBody: JSON.stringify({ id: "synthetic-replay-not-provider-evidence", model: body.model,
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage }),
});
const requestPrompt = (body: Record<string, unknown>) => (body.messages as Array<{ content: string }>).at(-1)!.content;
const validTransport = async (body: Record<string, unknown>) => requestPrompt(body).startsWith("Write SEVEN")
  ? response(body, { candidates: [{ frame: "mechanism", title }, { frame: "direct_verdict", title: alternate }] })
  : response(body, { rankings: [{ idx: 0, clickScore: 9, direct: 9 }, { idx: 1, clickScore: 8, direct: 8 }], winner: 0, runnerUp: 1 });

async function main() {
  assert.equal(BASELINE_REVISION, "991b349");
  const cases = loadExperiments();
  assert.equal(cases.length, 8);
  assert.equal(cases.filter((p) => p.coverage.narrationCharacters > 0).length, 5);
  assert.equal(packet.coverage.experimentExcerptCharacters, 2592);
  assert.equal(packet.coverage.productionBaselineCallerExcerptCharacters, 800);
  assert.equal(packet.identityBasis, "current_identity_observed_with_retained_source");
  assert.equal(packet.evidence.suggestions.status, "unavailable");
  assert.equal(packet.args.warmStartTitle, undefined, "old final title is never a warm-start answer key");
  assert.equal(packet.args.coldOpen, undefined, "missing hooks are not inferred from narration");
  assert.equal(packet.args.betTitle, "How Do Taxes Work? A Visual Explanation");
  assert.equal(packet.args.titleFormula, "How To [FINANCIAL CONCEPT] | Chalk & Compound", "source contradiction must not be repaired in the control");
  assert.ok(!JSON.stringify(packet).includes("Taxation Isn't Complex: A Simple Framework"));
  assert.equal(titleCallPhase("Write SEVEN YouTube TITLE candidates, one per useful frame: …"), "candidate");
  assert.equal(titleCallPhase("You are a YouTube CTR strategist judging candidate titles against their actual source and channel identity."), "judge");
  assert.throws(() => titleCallPhase("Please buy a different unrelated generation"), /unrecognized/);
  assert.throws(() => verifySource(binding, Buffer.concat([bytes, Buffer.from(" ")])), /byte length/);
  assert.throws(() => verifySource({ ...binding, channelId: "swapped" }, bytes), /channel binding/);
  assert.throws(() => verifySource({ ...binding, sourceProjectionSha256: "0".repeat(64) }, bytes), /projection/);
  assert.throws(() => verifySource({ ...binding, narration: [{ ...binding.narration[0], sha256: "0".repeat(64) }] }, bytes), /narration digest/);

  const originalFetch = globalThis.fetch;
  let accidentalFetches = 0;
  globalThis.fetch = async () => { accidentalFetches++; throw new Error("offline test reached real network"); };
  try {
    const events: Record<string, unknown>[] = [];
    const result = await runBenchmarkCase(packet, { ...options, testTransport: validTransport, sink: (e) => events.push(e) });
    assert.equal(result.status, "completed", result.error ?? result.hold ?? "unexpected failure");
    assert.equal(result.dispatchedCalls, 2);
    assert.equal(result.liveProviderCalls, 0);
    assert.equal(result.usageBasis, "synthetic_test_transport");
    assert.equal(result.usage.calls, 2);
    assert.ok(result.usage.costUsd > 0);
    assert.equal(result.usage.unpricedCalls, 0);
    assert.equal(result.ancillarySuppressed.length, 2);
    assert.equal((result.decision as { judged: boolean }).judged, true);
    assert.equal((result.decision as { title: string }).title, title,
      "unchanged baseline chooses the ranked lint survivor, not a fixture answer key");
    assert.equal(result.inputSha256, inputsHash);
    assert.equal(sha256(JSON.stringify(packet)), inputsHash, "execution cannot mutate the comparison packet");
    assert.ok(result.codeHashes["src/lib/metacraft.ts"]);
    assert.deepEqual(result.sourcePolicy, benchmarkSourcePolicy("baseline"));
    assert.equal(result.sourcePolicy.anthropicAndOpenRouter, "git_991b349");
    for (const request of result.requests) {
      assert.deepEqual((request.body as Record<string, unknown>).response_format, { type: "json_object" },
        "schema intervention must not alter either original baseline request");
    }
    assert.ok(events.some((e) => e.type === "response"));
    assert.ok(!JSON.stringify(result).includes("tagsCsv"), "synthetic packaging is excluded from measured results");
    assert.ok(!JSON.stringify(events).includes("authorization"), "no credential-bearing headers in receipts");

    const repeat = await runBenchmarkCase(packet, { ...options, condition: "baseline-repeat", replay: result.responses });
    assert.equal(repeat.status, "completed");
    assert.equal(repeat.liveProviderCalls, 0);
    assert.equal(repeat.usageBasis, "replayed_provider_receipt_no_new_spend");
    assert.equal(repeat.inputSha256, result.inputSha256);
    assert.deepEqual(repeat.decision, result.decision);
    assert.deepEqual(repeat.codeHashes, result.codeHashes);

    // Re-execute both immutable live controls through the actual unchanged
    // baseline loader. Strict replay matches every original HTTP body/options;
    // response bytes are evidence, not labels or preferred generated titles.
    for (const condition of ["baseline", "baseline-repeat"] as const) {
      const receipt = readFileSync(`test-fixtures/title-pilot-2026-09/chalk-${condition}.jsonl`, "utf8")
        .trim().split("\n").map((line) => JSON.parse(line))
        .find((event) => event.type === "result").result;
      const replayed = await runBenchmarkCase(packet, { ...options, condition, maxCalls: 2, replay: receipt.responses });
      assert.equal(replayed.status, "completed", replayed.error ?? "immutable baseline replay failed");
      assert.equal(replayed.inputSha256, receipt.inputSha256);
      assert.equal(replayed.codeSha256, receipt.codeSha256, "all actual baseline source/dependency bytes stay unchanged");
      assert.deepEqual(replayed.decision, receipt.decision);
      assert.deepEqual(replayed.responses, receipt.responses);
      assert.equal(replayed.liveProviderCalls, 0);
    }

    const changed = await runBenchmarkCase(packet, { ...options, condition: "current",
      testTransport: async (body) => {
        const prompt = requestPrompt(body);
        if (titleCallPhase(prompt) === "candidate") {
          assert.deepEqual(body.response_format, { type: "json_object" }, "schema opt-in leaves the default generator transport unchanged");
          return validTransport(body);
        }
        const indexes = [...prompt.matchAll(/^(\d+)\. \[/gm)].map((m) => Number(m[1]));
        const format = body.response_format as { type: string; json_schema: { strict: boolean; schema: {
          properties: { rankings: { minItems: number; maxItems: number } };
        } } };
        assert.equal(format.type, "json_schema", "current judge must use the schema-capable current HTTP client");
        assert.equal(format.json_schema.strict, true);
        assert.equal(format.json_schema.schema.properties.rankings.minItems, indexes.length);
        assert.equal(format.json_schema.schema.properties.rankings.maxItems, indexes.length);
        return response(body, { rankings: indexes.map((idx) => ({ idx, clickScore: 9, direct: 9, identityFit: 9,
          grounding: "supported", reason: "Synthetic schema-only transport fixture; not a quality judgment." })) });
      },
    });
    assert.equal(changed.status, "completed", changed.error ?? "changed selector failed");
    assert.equal(changed.inputSha256, result.inputSha256, "before/after must use the identical frozen experiment packet");
    assert.equal(changed.dispatchedCalls, 2);
    assert.equal((result.decision as { feed: unknown[] }).feed.length, 10);
    assert.equal((changed.decision as { feed: unknown[] }).feed.length, 12,
      "same frozen input does not conceal the selectors' different resolved feed coverage");
    assert.equal(changed.ancillarySuppressed.length, 0, "actual title-only selector has no package/comment calls to suppress");
    assert.notEqual(changed.codeHashes["src/lib/metacraft.ts"], result.codeHashes["src/lib/metacraft.ts"]);
    assert.deepEqual(changed.sourcePolicy, benchmarkSourcePolicy("current"));
    assert.equal(changed.sourcePolicy.anthropicAndOpenRouter, "current_working_tree_opt_in_schema");
    for (const path of ["src/lib/anthropic.ts", "src/lib/openRouter.ts"]) {
      assert.equal(changed.codeHashes[path], sha256(readFileSync(path)), "current transport is the actual hashed working source");
      assert.notEqual(changed.codeHashes[path], result.codeHashes[path], "record the deliberate current transport intervention");
    }
    assert.equal(changed.codeHashes["src/lib/modelUsage.ts"], result.codeHashes["src/lib/modelUsage.ts"],
      "schema intervention cannot silently alter accounting");
    assert.deepEqual(changed.attempts.map((a) => a.phase), ["candidate", "judge"]);
    assert.equal((changed.decision as { version: string }).version, "title-decision/v1");

    const corruptResponse: RecordedHttp[] = structuredClone(result.responses);
    corruptResponse[0].rawBody += " ";
    const corruption = await runBenchmarkCase(packet, { ...options, replay: corruptResponse });
    assert.equal(corruption.status, "held");
    assert.equal(corruption.responses.length, 0, "corrupt replay is refused before becoming a response receipt");
    const swappedRequest = structuredClone(result.responses);
    swappedRequest[0].requestSha256 = "0".repeat(64);
    const mismatch = await runBenchmarkCase(packet, { ...options, replay: swappedRequest });
    assert.equal(mismatch.status, "held");

    const malformed = await runBenchmarkCase(packet, { ...options,
      testTransport: async (body) => response(body, "not JSON but already billed"),
    });
    assert.equal(malformed.status, "failed");
    assert.equal(malformed.dispatchedCalls, 2, "baseline's exact two candidate attempts remain visible");
    assert.equal(malformed.usage.calls, 2, "unusable completed generations retain usage");
    assert.ok(malformed.usage.costUsd > 0);

    const partial = await runBenchmarkCase(packet, { ...options,
      testTransport: async (body, index) => index === 0 ? validTransport(body) : { status: 503, rawBody: '{"error":{"message":"upstream unavailable"}}' },
    });
    assert.equal(partial.status, "held");
    assert.equal(partial.dispatchedCalls, 2);
    assert.equal(partial.usage.calls, 2);
    assert.equal(partial.usage.unpricedCalls, 1, "post-dispatch error must not become a free call");
    assert.ok(partial.usage.costUsd > 0, "earlier generation cost survives later failure");
    assert.equal((partial.decision as { judged: boolean }).judged, false,
      "benchmark faithfully records the baseline's unsafe unjudged admission, without treating it as acceptable");

    const missingUsage = await runBenchmarkCase(packet, { ...options,
      testTransport: async (body) => response(body, { candidates: [{ frame: "mechanism", title }] }, null),
    });
    assert.equal(missingUsage.status, "held");
    assert.equal(missingUsage.dispatchedCalls, 1, "unpriced first response blocks the next purchase");
    assert.equal(missingUsage.usage.unpricedCalls, 1);
    const mixedCost = await runBenchmarkCase(packet, { ...options,
      testTransport: async (body, index) => {
        const valid = await validTransport(body);
        const payload = JSON.parse(valid.rawBody);
        payload.usage = index === 0
          ? { prompt_tokens: 100, completion_tokens: 50, cost: 0.05 }
          : { prompt_tokens: 50_000, completion_tokens: 1000 };
        return { status: 200, rawBody: JSON.stringify(payload) };
      },
    });
    assert.equal(mixedCost.status, "completed");
    assert.ok(Math.abs(mixedCost.cost.accountedUsd - 0.09125) < 1e-10,
      "sum per-call conservative charges; aggregate max loses partial reported costs");
    const mixedReasoning = await runBenchmarkCase(packet, { ...options,
      testTransport: async (body, index) => {
        const valid = await validTransport(body);
        const payload = JSON.parse(valid.rawBody);
        payload.usage = index === 0
          ? { prompt_tokens: 100, completion_tokens: 50, cost: 0.05 }
          : { prompt_tokens: 50_000, completion_tokens: 1000, reasoning_tokens: 2000,
            prompt_tokens_details: { cached_tokens: 40_000 } };
        return { status: 200, rawBody: JSON.stringify(payload) };
      },
    });
    assert.ok(Math.abs(mixedReasoning.cost.accountedUsd - 0.07175) < 1e-10,
      "per-call charge reconciliation uses the same reasoning/cache fields as the recorder");
    for (const cost of [-1, null, "NaN"]) {
      const invalidCost = await runBenchmarkCase(packet, { ...options,
        testTransport: async (body) => response(body, { candidates: [{ frame: "mechanism", title }] },
          { prompt_tokens: 100, completion_tokens: 50, cost }),
      });
      assert.equal(invalidCost.status, "held");
      assert.equal(invalidCost.dispatchedCalls, 1, "explicit invalid cost blocks another purchase");
    }
    const noText = await runBenchmarkCase(packet, { ...options,
      testTransport: async (body) => ({ status: 200, rawBody: JSON.stringify({ model: body.model, choices: [],
        usage: { prompt_tokens: 100, completion_tokens: 50 } }) }),
    });
    assert.equal(noText.status, "held");
    assert.equal(noText.dispatchedCalls, 1, "unknown outcomes cannot buy a baseline automatic retry");
    assert.equal(noText.usage.calls, 1);
    const bodyFailure = await runBenchmarkCase(packet, { ...options,
      testTransport: async () => new Response(new ReadableStream({
        start(controller) { controller.error(new Error("synthetic body interrupted after headers")); },
      }), { status: 200 }),
    });
    assert.equal(bodyFailure.status, "held");
    assert.equal(bodyFailure.dispatchedCalls, 1);
    assert.equal(bodyFailure.usage.unpricedCalls, 1, "unreadable response after headers is never priced as free");
    const callLimit = await runBenchmarkCase(packet, { ...options, maxCalls: 1, testTransport: validTransport });
    assert.equal(callLimit.dispatchedCalls, 1);
    assert.equal(callLimit.status, "held");
    const spendLimit = await runBenchmarkCase(packet, { ...options, spendCapUsd: 0.00001, testTransport: validTransport });
    assert.equal(spendLimit.dispatchedCalls, 0);
    assert.equal(spendLimit.status, "held");
    await assert.rejects(runBenchmarkCase(packet, { ...options, maxCalls: Number.NaN }), /maxCalls/);
    await assert.rejects(runBenchmarkCase(packet, { ...options, spendCapUsd: Number.POSITIVE_INFINITY }), /spend cap/);
    assert.equal(accidentalFetches, 0, "all deterministic tests are genuinely network-free");
  } finally { globalThis.fetch = originalFetch; }
  console.log("Title benchmark: frozen source integrity, faithful baseline/repeat, raw replay binding, failures, usage retention and spending holds passed");
}
void main();
