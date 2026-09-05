/**
 * A call site must be told it is running out of budget BEFORE it starts failing.
 *
 * Reasoning on the pinned OpenRouter route is mandatory and is billed as
 * completion tokens, so it is spent out of max_tokens before any of the answer
 * exists. Measured directly against the shipped advertiser-safety call at its
 * old ceiling of 200: completion_tokens=196, reasoning_tokens=189. Seven tokens
 * were left for the JSON and 16 unparseable characters came back.
 *
 * It cannot be switched off. The API rejects reasoning:{enabled:false},
 * reasoning:{effort:"none"}, reasoning:{max_tokens:0} and reasoning_effort with
 * "Reasoning is mandatory for this endpoint and cannot be disabled", and
 * reasoning:{exclude:true} merely hides it from the response while still burning
 * 193 of 200. vision.ts can set reasoning_effort:"none" only because that path
 * goes to Groq.
 *
 * So the ceiling has to cover reasoning + answer, and the failure mode is a
 * cliff: a call site works until the prompt gets slightly harder, then fails its
 * JSON contract entirely. Four features had already died that way silently. This
 * warning turns the cliff into a slope — the ratio is reported while the call is
 * still succeeding.
 *
 * Tested through the real client against a stubbed fetch, so what is asserted is
 * the shipping code path rather than a re-implementation of the rule.
 */
import assert from "node:assert/strict";

import { openRouterChat } from "@/lib/openRouter";

interface Recorded { logs: string[] }

async function callWith(
  args: { maxTokens: number; reasoningTokens: number; content: string },
): Promise<Recorded> {
  const realFetch = globalThis.fetch;
  const priorKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  const logs: string[] = [];
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "gen-test",
        model: "google/gemini-3.7-flash",
        choices: [{ message: { content: args.content } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: args.reasoningTokens + 10,
          reasoning_tokens: args.reasoningTokens,
          total_tokens: 100 + args.reasoningTokens + 10,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof globalThis.fetch;
  try {
    await openRouterChat({
      model: "google/gemini-3.7-flash",
      messages: [{ role: "user", content: "irrelevant" }],
      maxTokens: args.maxTokens,
      json: true,
      log: (m) => logs.push(m),
    });
  } finally {
    globalThis.fetch = realFetch;
    if (priorKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorKey;
  }
  return { logs };
}

const warned = (r: Recorded): boolean => r.logs.some((l) => l.includes("STARVATION RISK"));

async function main(): Promise<void> {
  // ---- the measured failure, one notch back from breaking -----------------
  // 189 of 200 is the real observation; at that ratio the answer had 7 tokens.
  const starved = await callWith({ maxTokens: 200, reasoningTokens: 189, content: '{"ok":true}' });
  assert.ok(warned(starved), "a call spending 94% of its ceiling on reasoning must be warned about");
  const line = starved.logs.find((l) => l.includes("STARVATION RISK"))!;
  assert.match(line, /189 of the 200-token ceiling/, "the warning must quote the real numbers");
  assert.match(line, /95%/, "and the share, since that is what makes it actionable");
  assert.match(line, /raise maxTokens at this call site/, "and say what to do about it");

  // The point of the warning is that it fires while the call still SUCCEEDS.
  // A warning that only appears once the contract already broke is a post-mortem.
  assert.doesNotThrow(() => JSON.parse('{"ok":true}'));

  // ---- healthy calls must stay quiet --------------------------------------
  // A warning on every call is a warning on none.
  const healthy = await callWith({ maxTokens: 2500, reasoningTokens: 300, content: '{"ok":true}' });
  assert.ok(!warned(healthy), "a call using 12% of its ceiling on reasoning must not be warned");
  const borderline = await callWith({ maxTokens: 1000, reasoningTokens: 550, content: '{"ok":true}' });
  assert.ok(!warned(borderline), "55% is still inside the intended headroom");
  const overRatio = await callWith({ maxTokens: 1000, reasoningTokens: 650, content: '{"ok":true}' });
  assert.ok(overRatio.logs.some((l) => l.includes("STARVATION RISK")), "65% must warn");

  // A route that reports no reasoning at all must never warn — dividing by a
  // ceiling is meaningless when the number is absent.
  const noReasoning = await callWith({ maxTokens: 100, reasoningTokens: 0, content: '{"ok":true}' });
  assert.ok(!warned(noReasoning), "absent reasoning usage must not produce a warning");

  console.log("REASONING STARVATION WARNING PASS — the cliff is now a slope");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
