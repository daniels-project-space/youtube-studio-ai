/**
 * The Insert Director gets exactly one deliberate second chance — and only for
 * the failure where a second call is a known purchase rather than a blind one.
 *
 * Measured against the real channel over five real topics, the planner returned
 * text that was not JSON on three of them. The block caught that, logged one
 * line, and returned zero inserts. Nothing downstream could distinguish "this
 * script warranted no inserts" from "the data layer failed", so a channel whose
 * entire identity is its data layer was shipping videos without one, quietly,
 * most of the time.
 *
 * The client refuses to replay these itself and is right to — replaying an
 * ambiguous outcome can buy the same generation twice. The distinction this
 * pins is that "consumed_unusable" is not ambiguous: a complete response
 * arrived and its text was not JSON. The generation ran, it was billed, and the
 * output is unusable. Calling again is a second known purchase of a sub-cent
 * planning call. Every genuinely unknown outcome must still propagate.
 */
import assert from "node:assert/strict";

import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";
import { planWithRetryOnUnusableOutput } from "../insertBlocks";

function unusable(): OpenRouterGenerationOutcomeUnknownError {
  return new OpenRouterGenerationOutcomeUnknownError(
    "successful response text failed the requested JSON contract",
    { status: 200, outcome: "consumed_unusable" },
  );
}
function ambiguous(): OpenRouterGenerationOutcomeUnknownError {
  return new OpenRouterGenerationOutcomeUnknownError("successful response contained no text", { status: 200 });
}

async function main(): Promise<void> {
  // ---- the case that was silently losing the data layer -------------------
  let calls = 0;
  const logs: string[] = [];
  const plan = await planWithRetryOnUnusableOutput(async () => {
    calls++;
    if (calls === 1) throw unusable();
    return { inserts: [{ kind: "big_stat" }] };
  }, (m) => logs.push(m));
  assert.equal(calls, 2, "unusable text must be re-planned exactly once");
  assert.deepEqual(plan, { inserts: [{ kind: "big_stat" }] }, "the retry's plan must be returned");
  assert.ok(
    logs.some((l) => l.includes("re-planning once")),
    "the retry must be logged — a silent second purchase is not accountable",
  );

  // ---- one chance, not a loop ---------------------------------------------
  // A planner failing repeatedly must surface, not bill in a circle.
  calls = 0;
  await assert.rejects(
    () => planWithRetryOnUnusableOutput(async () => { calls++; throw unusable(); }, () => {}),
    (e: unknown) => e instanceof OpenRouterGenerationOutcomeUnknownError,
  );
  assert.equal(calls, 2, "a persistently failing director must be called twice, never more");

  // ---- ambiguity must never be replayed -----------------------------------
  // This is the codebase's standing rule: an outcome that MIGHT have consumed
  // provider work is the caller's to review, not to silently re-buy.
  calls = 0;
  await assert.rejects(
    () => planWithRetryOnUnusableOutput(async () => { calls++; throw ambiguous(); }, () => {}),
    (e: unknown) => e instanceof OpenRouterGenerationOutcomeUnknownError && e.outcome === "unknown",
  );
  assert.equal(calls, 1, "an ambiguous outcome must propagate on the first failure, unreplayed");

  // An ordinary error is not a provider-billing question at all and must pass
  // straight through rather than being quietly retried.
  calls = 0;
  await assert.rejects(
    () => planWithRetryOnUnusableOutput(async () => { calls++; throw new Error("network down"); }, () => {}),
    /network down/,
  );
  assert.equal(calls, 1, "an unrelated error must not trigger a paid retry");

  // ---- the happy path must not cost twice ---------------------------------
  calls = 0;
  await planWithRetryOnUnusableOutput(async () => { calls++; return { inserts: [] }; }, () => {});
  assert.equal(calls, 1, "a successful plan must never be re-purchased");

  // ---- the discriminator must be real, not defaulted ----------------------
  // If every error defaulted to consumed_unusable the ambiguity rule would be
  // silently dead, and this whole test would still pass on the cases above.
  assert.equal(ambiguous().outcome, "unknown", "the default outcome must be the cautious one");
  assert.equal(unusable().outcome, "consumed_unusable");
  assert.equal(unusable().retryable, false, "retryable governs AUTOMATIC replay and stays false for both");

  console.log("INSERT DIRECTOR RETRY PASS — one deliberate re-plan, ambiguity never replayed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
