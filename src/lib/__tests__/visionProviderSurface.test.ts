/**
 * The vision surface must not offer controls it does not have.
 *
 * vision.ts carried two complete provider implementations, groqVision and
 * falVision, that nothing called: the dispatch loop filters the chain to
 * `p === "openrouter"` and then invokes openRouterVision unconditionally. Even
 * the env override could not reach them, and GROQ_VISION_MODEL had already been
 * defaulted to the literal string "legacy-groq-vision-disabled".
 *
 * Dead code is cheap. What it was holding up was not:
 *
 *   reasoningEffort           read ONLY inside those two functions. Its one
 *                             remaining effect was partitioning the verdict
 *                             cache, so a caller setting "none" changed the
 *                             cache key and nothing else.
 *   maxAttemptsPerProvider    same — read only there.
 *
 * and cinematicQaEvidenceContract, on the final-master budget receipt, was
 * setting BOTH, with a doc describing "one Groq attempt then one fal fallback"
 * — providers that no longer existed. It read as a deliberately constrained,
 * reasoning-free review. It was neither.
 *
 * The A/B evidence behind reasoningEffort is preserved in vision.ts as evidence
 * rather than as a control, because it is still true and still relevant: gate
 * judgement measured strictly better without reasoning. What changed is that the
 * OpenRouter route makes reasoning mandatory, so the lever is gone and only the
 * budget remains.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(process.cwd(), "src/lib/vision.ts"), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const CONTRACT = readFileSync(join(process.cwd(), "src/lib/cinematicQaEvidenceContract.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function main(): void {
  // ---- the unreachable providers are gone ---------------------------------
  assert.ok(!/function groqVision\b/.test(CODE), "the unreachable Groq vision provider must be gone");
  assert.ok(!/function falVision\b/.test(CODE), "the unreachable fal vision provider must be gone");
  assert.ok(!/api\.groq\.com/.test(CODE), "no call should remain to a provider the chain cannot select");
  assert.ok(
    !/GROQ_VISION_MODEL|GROQ_MAX_IMAGES|GROQ_MAX_COMPLETION_TOKENS/.test(CODE),
    "constants that only those providers used must go with them",
  );

  // ---- and so are the options only they read ------------------------------
  assert.ok(
    !/reasoningEffort/.test(CODE),
    "reasoningEffort must not be offered: the live route refuses to disable reasoning, " +
      "so accepting the option would promise a control that does not exist",
  );
  assert.ok(!/VisionReasoningEffort/.test(CODE), "its type must go too");
  assert.ok(
    !/maxAttemptsPerProvider/.test(CODE),
    "maxAttemptsPerProvider was read only inside the removed providers",
  );
  assert.ok(
    !/reasoningEffort|maxAttemptsPerProvider/.test(CONTRACT),
    "the final-master QA reviewer must stop setting options that do nothing",
  );

  // ---- what must survive ---------------------------------------------------
  // The live path, and the option that still has an effect.
  assert.match(CODE, /function openRouterVision\(/, "the live provider must remain");
  assert.match(CODE, /providers\?: readonly VisionProvider\[\]/, "provider restriction still narrows the chain");
  assert.match(CONTRACT, /providers: \["openrouter"\]/, "and the reviewer still declares its provider");

  // The budget is now the only defence against a starved gate, so it must not
  // have been quietly trimmed while the surrounding code was deleted.
  const ceiling = Number(/VISION_GATE_MAX_TOKENS = ([0-9_]+)/.exec(CODE)?.[1]?.replace(/_/g, "") ?? "0");
  assert.equal(ceiling, 8192, "the vision gate budget must be intact — reasoning cannot be disabled on this route");

  // ---- the evidence must not be deleted with the code ---------------------
  // A measured A/B is worth more than the function that used to act on it.
  assert.match(SOURCE, /accuracy vs label\s+49\/60/, "the reasoning A/B evidence must be preserved");
  assert.match(
    SOURCE,
    /Reasoning is mandatory for this endpoint/,
    "and the reason the control is gone must be recorded, so nobody re-adds the option",
  );

  console.log("VISION PROVIDER SURFACE PASS — no controls offered that the route does not have");
}

main();
