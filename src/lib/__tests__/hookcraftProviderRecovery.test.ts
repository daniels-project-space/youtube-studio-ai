/**
 * Hookcraft is independently runnable. Its judge may degrade to a visible
 * lint-only result after a known failure, but it must not hide a provider
 * response whose billing/completion state is ambiguous.
 */
process.env.OPENROUTER_API_KEY = "test-key-for-hookcraft-provider-recovery";

import assert from "node:assert/strict";
import Module from "node:module";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";

const hook = "Chernobyl's ignored safety test failed in 1986.";
const opening = "At 1:23 a.m., engineers disabled the alarm in Reactor Four. Within minutes, a routine check became the decision that sent the roof into the sky. The surviving logs show who saw the warning first, why the shutdown came too late, and how one ignored test changed the night.";

let judgeMode: "known_failure" | "unknown" = "known_failure";
let generatorCalls = 0;
let judgeCalls = 0;

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function patched(
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (!request.endsWith("/creativeText")) return resolved;
  return {
    ...resolved,
    hasCreativeTextKey: () => true,
    creativeTextJsonPro: async () => {
      generatorCalls++;
      return { candidates: [{ device: "result_first", hook, opening, loop: "Why the ignored test changed the night." }] };
    },
    creativeTextJson: async () => {
      judgeCalls++;
      if (judgeMode === "unknown") {
        throw new OpenRouterGenerationOutcomeUnknownError("judge connection closed after dispatch", { status: 503 });
      }
      throw new Error("judge temporarily unavailable before dispatch");
    },
  };
} as never;

async function main(): Promise<void> {
  try {
    const { craftHook } = await import("@/lib/hookcraft");
    const args = {
      topic: "Chernobyl's ignored safety test",
      title: "Chernobyl's Ignored Safety Test",
      sourceGrounding: "Chernobyl's ignored safety test failed in 1986. Engineers disabled the alarm in Reactor Four at 1:23 a.m.",
      log: () => {},
    };

    const knownFailure = await craftHook(args);
    assert.equal(knownFailure.verdict.judged, false, "a known judge failure may remain a truthful lint-only result");
    assert.equal(judgeCalls, 1, "the known failure must not buy an automatic judge replay");

    judgeMode = "unknown";
    await assert.rejects(
      () => craftHook(args),
      (error: unknown) => error instanceof OpenRouterGenerationOutcomeUnknownError && error.outcome === "unknown",
      "an ambiguous judge outcome must propagate to execution recovery instead of becoming lint-only success",
    );
    assert.equal(judgeCalls, 2, "the ambiguous judge outcome must not be automatically replayed");
    assert.equal(generatorCalls, 2, "each independently requested hook reaches exactly one generation call");
    console.log("HOOKCRAFT PROVIDER RECOVERY PASS — known and ambiguous judge failures remain distinct");
  } finally {
    (Module as unknown as { _load: typeof originalLoad })._load = originalLoad;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
