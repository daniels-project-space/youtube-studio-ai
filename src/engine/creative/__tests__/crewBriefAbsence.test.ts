/**
 * A video that shipped without its crew briefs must not look like one that had
 * them.
 *
 * crew.ts asks five roles — director, DP, editor, composer, critic — for a brief
 * each, and every one of them catches a failure and returns undefined. That is
 * the right degradation: a video without a DP brief still renders. But the log
 * only echoed the provider error, so a run that shipped with no structure, no
 * visual specs, no cut plan, no music arc and no review spec read exactly like a
 * run that had all five.
 *
 * It mattered because the failures were likely. Every one of these calls runs on
 * the reasoning route with a zod schema containing arrays, at ceilings between
 * 700 and 1200, and an agentJson list was measured failing at 500 and passing at
 * 1000. They are now at 2500.
 *
 * The ceiling audit reported ZERO findings here before, and was wrong: it only
 * inspected schemas written inline, and every call in this file passes one by
 * reference (`schema: cutSchema`). It now resolves the identifier first. An
 * audit's clean bill of health is worth exactly as much as the cases it can see.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CREW = readFileSync(join(process.cwd(), "src/engine/creative/crew.ts"), "utf8");
const CODE = CREW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ROLES = ["director", "dp", "editor", "composer", "critic"] as const;

function main(): void {
  // ---- every role must name what the video is missing ---------------------
  for (const role of ROLES) {
    assert.match(
      CREW,
      new RegExp(`crew/${role}: BRIEF UNAVAILABLE`),
      `crew/${role} must say the brief is gone, not merely echo the provider error`,
    );
  }
  // The message must say what was lost, not just that something was.
  for (const what of ["structure/beats", "visual specs", "cut plan", "music arc", "review spec"]) {
    assert.ok(CREW.includes(what), `the absence log must name what is missing: ${what}`);
  }
  assert.equal(
    (CODE.match(/BRIEF UNAVAILABLE/g) ?? []).length,
    ROLES.length,
    "all five roles must be covered — one silent role is the whole defect again",
  );

  // ---- degrading to undefined is still correct ----------------------------
  // This was a visibility fix, not a behaviour change. If it had started
  // throwing, a provider blip would fail whole videos.
  // Each absence log must be followed by a DEGRADATION, not a throw. Counting
  // bare `return undefined` in the file was too loose — other functions have
  // them, so removing one from a crew role still left the count above the
  // threshold and the assertion passed while the behaviour had changed.
  for (const role of ROLES) {
    const at = CODE.indexOf(`crew/${role}: BRIEF UNAVAILABLE`);
    assert.ok(at > 0, `crew/${role} absence log must be present in code, not only in a comment`);
    const following = CODE.slice(at, at + 260);
    assert.match(
      following,
      /return undefined;/,
      `crew/${role} must degrade after logging — a provider blip must not fail whole videos`,
    );
    assert.ok(
      !/throw\s/.test(following.split("return undefined;")[0]),
      `crew/${role} must not throw where it used to degrade`,
    );
  }

  // ---- and the ceilings that made it likely -------------------------------
  const ceilings = Array.from(CODE.matchAll(/maxTokens:\s*([0-9_]+)/g))
    .map((m) => Number(m[1].replace(/_/g, "")));
  assert.ok(ceilings.length >= 5, "all five crew calls must still be present");
  const tooLow = ceilings.filter((c) => c < 2000);
  assert.deepEqual(
    tooLow,
    [],
    `crew calls at ${tooLow.join(", ")} tokens ask for a zod schema containing arrays on a ` +
      `reasoning route, where a list was measured failing at 500 and passing at 1000`,
  );

  console.log("CREW BRIEF ABSENCE PASS — a missing brief announces itself");
}

main();
