/**
 * A sealed evidence record must not misstate its own origin.
 *
 * The package-to-opening plan freezes the promise before the paid thumbnail
 * boundary, and every anchor carries a `source` naming where its text came
 * from. That label is not decoration: packageToOpeningOpeningCriterion quotes
 * it straight into the instruction handed to the final-master visual reviewer
 * ("the planned opening promise from ${source}"), and a human auditing a
 * supervised release reads it to understand what was actually promised.
 *
 * The labels used to be hard-coded with only the VALUE falling back:
 *
 *   declaredPromise: { source: "script_hook_loop", value: hookLoop ?? hook }
 *   plannedOpening:  { source: "script_cold_open", value: hook ?? hookLoop }
 *
 * so a script with a cold open but no loop sealed a "script_hook_loop" anchor
 * holding the cold open, and a script with only a loop produced a criterion
 * telling the reviewer the text came from a cold open that does not exist.
 * Both anchors then carried the SAME fingerprint under two different stated
 * origins — the record contradicted itself and still hashed cleanly, because a
 * fingerprint proves a payload was not edited, never that it was true.
 */
import assert from "node:assert/strict";

import {
  assertPackageToOpeningPlanBinding,
  createPackageToOpeningPlan,
  packageToOpeningOmissionReasonFor,
  packageToOpeningOpeningCriterion,
} from "@/engine/packageToOpening";

const base = {
  title: "Why the Snipers at Hacksaw Ridge Kept Missing Desmond Doss",
  thumbnailDescription:
    "A lone unarmed medic silhouetted on a smoke-filled ridge, lowering a wounded soldier by rope at dusk; " +
    "the promise is survival without a weapon.",
  topic: "Desmond Doss at Hacksaw Ridge",
};

const sourceOfCriterion = (criterion: string): string | undefined =>
  /promise from ([a-z_]+):/.exec(criterion)?.[1];

function main(): void {
  // ---- both present: the two anchors are genuinely different things --------
  const both = createPackageToOpeningPlan({
    ...base,
    script: { hook: "A rifle jammed every time it was aimed at him.", hookLoop: "How does an unarmed man win a battle?" },
  });
  assert.equal(both.declaredPromiseAnchor.source, "script_hook_loop");
  assert.equal(both.plannedOpeningAnchor.source, "script_cold_open");
  assert.notEqual(
    both.declaredPromiseAnchor.fingerprint,
    both.plannedOpeningAnchor.fingerprint,
    "with both present the promise and the opening are different text and must hash differently",
  );

  // ---- only a cold open ---------------------------------------------------
  const hookOnly = createPackageToOpeningPlan({
    ...base,
    script: { hook: "A rifle jammed every time it was aimed at him." },
  });
  assert.equal(
    hookOnly.declaredPromiseAnchor.source,
    "script_cold_open",
    "with no hook loop the declared promise came from the cold open and must say so",
  );
  assert.equal(hookOnly.plannedOpeningAnchor.source, "script_cold_open");
  assert.equal(
    hookOnly.declaredPromiseAnchor.fingerprint,
    hookOnly.plannedOpeningAnchor.fingerprint,
    "both anchors hold the same text here, so the same fingerprint is correct — " +
      "what was wrong was claiming two different origins for it",
  );

  // ---- only a loop --------------------------------------------------------
  const loopOnly = createPackageToOpeningPlan({
    ...base,
    script: { hookLoop: "How does an unarmed man win a battle?" },
  });
  assert.equal(loopOnly.declaredPromiseAnchor.source, "script_hook_loop");
  assert.equal(
    loopOnly.plannedOpeningAnchor.source,
    "script_hook_loop",
    "with no cold open the planned opening came from the hook loop and must say so",
  );

  // The label reaches the reviewer verbatim, which is why it has to be true.
  const criterion = packageToOpeningOpeningCriterion({
    plan: loopOnly,
    topic: base.topic,
    script: { hookLoop: "How does an unarmed man win a battle?" },
  });
  assert.equal(
    sourceOfCriterion(criterion.criterion),
    "script_hook_loop",
    "the reviewer must be told the real origin of the text it is asked to verify",
  );
  assert.ok(
    criterion.criterion.includes("How does an unarmed man win a battle?"),
    "the criterion must quote the actual anchor text",
  );

  // ---- the non-script fallbacks are unchanged -----------------------------
  const topicOnly = createPackageToOpeningPlan({ ...base });
  assert.equal(topicOnly.declaredPromiseAnchor.source, "topic_declaration");
  assert.equal(topicOnly.plannedOpeningAnchor.source, "topic_declaration");

  const quiz = createPackageToOpeningPlan({ ...base, quizPlan: { topic: "Which year did it happen?" } });
  assert.equal(quiz.declaredPromiseAnchor.source, "quiz_topic");
  assert.equal(quiz.plannedOpeningAnchor.source, "quiz_topic");

  // ---- a plan still seals ------------------------------------------------
  // Relabelling must not break the fingerprint contract itself.
  for (const plan of [both, hookOnly, loopOnly, topicOnly, quiz]) {
    assert.match(plan.planFingerprint, /^[a-f0-9]{64}$/, "every plan must still seal");
  }

  // ---- an omission must name the real reason ------------------------------
  // Driven by the message the binding ACTUALLY throws, not by a message written
  // here to match the classifier — otherwise this only tests a regex against
  // itself.
  // assert.fail() inside the try would be caught by this same catch and then
  // classified as if it were the binding's own message, so the "it did not
  // throw" case is carried out of the block explicitly instead.
  let driftMessage: string | undefined;
  try {
    assertPackageToOpeningPlanBinding({
      ...base,
      title: "A COMPLETELY DIFFERENT TITLE THAT WAS NEVER SOLD",
      plan: both,
      script: { hook: "A rifle jammed every time it was aimed at him.", hookLoop: "How does an unarmed man win a battle?" },
    });
  } catch (error) {
    driftMessage = error instanceof Error ? error.message : String(error);
  }
  assert.ok(
    driftMessage !== undefined,
    "a title that was never sold must break the sealed binding — if this passes silently, " +
      "the package promise is not actually bound to anything",
  );
  assert.equal(
    packageToOpeningOmissionReasonFor(driftMessage),
    "package_binding_drifted",
    `a caught package drift must be recorded as drift, not as an unavailable binding (message: "${driftMessage}")`,
  );

  // The other two situations must keep their own labels.
  assert.equal(
    packageToOpeningOmissionReasonFor("no durable opening frame within the opening window"),
    "opening_review_frame_unavailable",
  );
  assert.equal(
    packageToOpeningOmissionReasonFor("something else went wrong entirely"),
    "package_binding_unavailable",
    "an unrecognised failure must fall back to the cautious label, never to drift",
  );

  console.log("PACKAGE-TO-OPENING PROVENANCE PASS — anchors name their real origin");
}

main();
