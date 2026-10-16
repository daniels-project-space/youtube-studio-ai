/**
 * Hookcraft is independently runnable. Production refuses a known unavailable
 * judge after its bounded retry; an explicit draft preview may retain a
 * visibly lint-only result. Neither path may hide an ambiguous provider
 * response whose billing/completion state is unknown.
 */
process.env.OPENROUTER_API_KEY = "test-key-for-hookcraft-provider-recovery";

import assert from "node:assert/strict";
import Module from "node:module";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";

let hook = "Chernobyl's ignored safety test failed in 1986.";
const opening = "At 1:23 a.m., engineers disabled the alarm in Reactor Four. Within minutes, a routine check became the decision that sent the roof into the sky. The surviving logs show who saw the warning first, why the shutdown came too late, and how one ignored test changed the night.";

let judgeMode: "known_failure" | "unknown" | "pass" = "known_failure";
let generatedHooks: string[] | undefined;
let generatorCalls = 0;
let judgeCalls = 0;
const generationPrompts: string[] = [];
const judgePrompts: string[] = [];

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
    creativeTextJsonPro: async (input: { prompt: string }) => {
      generatorCalls++;
      generationPrompts.push(input.prompt);
      return {
        candidates: (generatedHooks ?? [hook]).map((candidateHook, index) => ({
          device: `result_first_${index + 1}`,
          hook: candidateHook,
          opening,
          loop: "Why the ignored test changed the night.",
        })),
      };
    },
    creativeTextJson: async (input: { prompt: string }) => {
      judgeCalls++;
      judgePrompts.push(input.prompt);
      if (judgeMode === "unknown") {
        throw new OpenRouterGenerationOutcomeUnknownError("judge connection closed after dispatch", { status: 503 });
      }
      if (judgeMode === "pass") {
        return {
          best: 0,
          verdicts: Array.from({ length: generatedHooks?.length ?? 1 }, () => ({
            punch: 9, specificity: 9, curiosity: 9, voiceMatch: 9, promise: 9, honest: true,
          })),
        };
      }
      throw new Error("judge temporarily unavailable before dispatch");
    },
  };
} as never;

async function main(): Promise<void> {
  try {
    const { craftHook } = await import("@/lib/hookcraft");
    const programBrief = createChannelProgramBrief({
      family: "documentary_collage_short",
      nicheKey: "history",
      locale: "en",
      concept: "Evidence-led histories that make overlooked decisions matter to ordinary lives.",
      audience: "Curious adults who want clear evidence without academic jargon.",
      sampleTopics: ["How a bridge changed the town", "What a court record reveals about daily life"],
    });
    const args = {
      topic: "Chernobyl's ignored safety test",
      title: "Chernobyl's Ignored Safety Test",
      programRoute: channelProgramRouteRunSeed({
        route: resolveChannelProgramRoute(programBrief),
        programBrief,
      }),
      sourceGrounding: "Chernobyl's ignored safety test failed in 1986. Engineers disabled the alarm in Reactor Four at 1:23 a.m.",
      narrative: { pacing: "Measured, with a deliberate pause before each reveal." },
      channelVoice: {
        positioning: "Evidence-led histories about overlooked decisions and their human consequences.",
        vibe: "Measured, humane, and exact.",
        worksInSpace: ["Ground the opening in a documented detail before interpreting it."],
        avoidInSpace: ["Never turn an evidence gap into a suspense claim."],
      },
      log: () => {},
    };

    await assert.rejects(
      () => craftHook(args),
      /both attempts failed the gate.*hook judge unavailable/,
      "production must refuse a cold open whose retention judge never returned a valid verdict",
    );
    assert.equal(judgeCalls, 2, "production retries the complete cold-open slate exactly once");
    assert.equal(generatorCalls, 2, "each bounded production attempt creates a fresh candidate slate");
    assert.ok(generationPrompts[0]?.includes("pacing: Measured, with a deliberate pause before each reveal."),
      "channel narrative DNA must shape its cold open as well as the body script and critic");
    for (const guidance of [
      "Intended audience: Curious adults who want clear evidence without academic jargon.",
      "Creator-declared topic priorities (in order): 1. How a bridge changed the town; 2. What a court record reveals about daily life",
      "Evidence-led histories about overlooked decisions and their human consequences.",
      "Measured, humane, and exact.",
      "Ground the opening in a documented detail before interpreting it.",
      "Never turn an evidence gap into a suspense claim.",
    ]) {
      assert.ok(generationPrompts[0]?.includes(guidance), `hookcraft must honor channel identity: ${guidance}`);
      assert.ok(judgePrompts[0]?.includes(guidance), `hook judge must grade against channel identity: ${guidance}`);
    }

    const draftFailure = await craftHook({ ...args, programRoute: undefined, channelVoice: undefined, qualityProfile: "draft" });
    assert.equal(draftFailure.verdict.judged, false, "an explicit draft may retain a truthful lint-only preview");
    assert.equal(draftFailure.verdict.factCheck, "unchecked",
      "numeric source matching must not be presented as full semantic fact verification");
    assert.equal(judgeCalls, 3, "the explicit draft preview makes one judge attempt, not a hidden retry");
    assert.doesNotMatch(generationPrompts[2] ?? "", /FROZEN CHANNEL EDITORIAL IDENTITY/,
      "legacy callers without a Show Bible keep the unconditioned cold-open prompt");
    assert.doesNotMatch(generationPrompts[2] ?? "", /CANONICAL CHANNEL PROGRAM CONTEXT/,
      "legacy callers without a sealed program route keep their previous audience/topic context");

    judgeMode = "pass";
    hook = "Chernobyl's ignored safety test failed in 1987.";
    await assert.rejects(
      () => craftHook(args),
      /numeric claim 1987 is absent from admitted source grounding/u,
      "a judge-approved cold open cannot change a sourced year and pass as grounded",
    );
    assert.equal(judgeCalls, 5, "the mismatched year is checked after a real passing judge verdict and one retry");
    assert.equal(generatorCalls, 5, "the source mismatch receives only Hookcraft's existing single bounded retry");
    hook = "Chernobyl's ignored safety test failed in 1986.";

    generatedHooks = [
      "Chernobyl's ignored safety test failed in 1987.",
      "Chernobyl's ignored safety test failed in 1988.",
      "Chernobyl's ignored safety test failed in 1986.",
    ];
    const laterGroundedCandidate = await craftHook(args);
    assert.equal(laterGroundedCandidate.hook, generatedHooks[2],
      "numeric source checks must cover later judge-ranked candidates, not only the first two");
    assert.equal(generatorCalls, 6, "two rejected numeric candidates do not trigger unnecessary regeneration when a grounded candidate remains");
    generatedHooks = undefined;

    const groundedControl = await craftHook(args);
    assert.equal(groundedControl.verdict.factCheck, "unchecked",
      "matching a sourced year does not upgrade the limited numeric check into a fact-check verdict");
    assert.equal(generatorCalls, 7, "a valid sourced numeric claim passes on the first attempt");

    judgeMode = "unknown";
    await assert.rejects(
      () => craftHook({ ...args, qualityProfile: "draft" }),
      (error: unknown) => error instanceof OpenRouterGenerationOutcomeUnknownError && error.outcome === "unknown",
      "an ambiguous judge outcome must propagate to execution recovery instead of becoming lint-only success",
    );
    assert.equal(judgeCalls, 8, "the ambiguous judge outcome must not be automatically replayed");
    assert.equal(generatorCalls, 8, "each requested hook reaches exactly one generation call per attempt");
    console.log("HOOKCRAFT PROVIDER RECOVERY PASS — production refusal, draft diagnostics, and ambiguity remain distinct");
  } finally {
    (Module as unknown as { _load: typeof originalLoad })._load = originalLoad;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
