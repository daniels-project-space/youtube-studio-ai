import assert from "node:assert/strict";
import { createQaScriptBlock } from "../narratedBlocks";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";
import { ExecutionError, classifyExecutionError } from "@/engine/executionErrors";
import type { StageContext } from "@/engine/types";

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "fixture-only-no-provider";
  let calls = 0;
  const ctx: StageContext = { ownerId: "qa-owner", channelId: "qa-channel", runId: "qa-run",
    keyPrefix: "proof/", budgetUsd: 0, params: {}, log: () => {},
    store: { narrationText: "The quiet room asks nothing of you." } };
  globalThis.fetch = async () => { calls++; return Response.json({ error: { message: "service unavailable" } }, { status: 503 }); };
  try {
    let failure: unknown;
    try { await createQaScriptBlock().run(ctx); } catch (error) { failure = error; }
    assert.ok(failure instanceof OpenRouterGenerationOutcomeUnknownError,
      "QA must retain the provider's uncertain paid outcome, not replace it with an untyped error");
    assert.equal(calls, 1);
    assert.equal(classifyExecutionError(failure).retryable, false,
      "the outer runner must not reinterpret an uncertain paid HTTP 503 as permission to replay");

    const denial = new ExecutionError("temporary budget reservation unavailable", {
      code: "INLINE_PAID_EXECUTION_LEASE_REQUIRED", retryable: false,
    });
    await assert.rejects(createQaScriptBlock(undefined, async () => { throw denial; }).run(ctx),
      error => error === denial, "caller-owned admission codes and retry metadata must survive QA unchanged");
    assert.equal(calls, 1, "admission denial cannot dispatch a provider request");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
  console.log("SCRIPT QA FAILURE METADATA PASS - uncertain work and admission denial remain terminal");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
