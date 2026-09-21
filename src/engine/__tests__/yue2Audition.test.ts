import assert from "node:assert/strict";
import { test } from "node:test";
import { YUE2_AUDITION_CHECKS, validateYuE2Audition, type YuE2AuditionSubmission } from "../yue2Audition";
const evidence = { candidateSha256: "a".repeat(64), sectionIds: ["opening", "ending"], technicallyBlocked: false, contextRetained: true };
const completeSubmission: YuE2AuditionSubmission = { candidateSha256: evidence.candidateSha256, verdict: "promising", listenedEntireSource: true,
  checks: Object.fromEntries(YUE2_AUDITION_CHECKS.map(key => [key, "pass"])) as YuE2AuditionSubmission["checks"],
  sections: evidence.sectionIds.map(id => ({ id, judgment: "pass", notes: "The intended restrained texture is audible." })), notes: "Whole source heard; personality and ending are consistent." };
for (const verdict of ["promising", "approved_for_assembly"] as const) test(`${verdict} requires a complete human judgment, never production approval`, () => {
  const submission = { ...completeSubmission, verdict };
  assert.deepEqual(validateYuE2Audition(submission, evidence), submission);
  for (const patch of [{ technicallyBlocked: true }, { contextRetained: false }, { candidateSha256: "b".repeat(64) }]) {
    assert.throws(() => validateYuE2Audition(submission, { ...evidence, ...patch }));
  }
  for (const patch of [{ listenedEntireSource: false }, { sections: submission.sections.slice(1) },
    { sections: [...submission.sections].reverse() }, { productionApproved: true }, { notes: " " }]) {
    assert.throws(() => validateYuE2Audition({ ...submission, ...patch }, evidence));
  }
  for (const key of YUE2_AUDITION_CHECKS) {
    for (const value of ["unreviewed", "fail"]) {
      assert.throws(() => validateYuE2Audition({ ...submission, checks: { ...submission.checks, [key]: value } }, evidence));
    }
  }
  assert.throws(() => validateYuE2Audition({ ...submission, sections: submission.sections.map(section => ({ ...section, notes: "" })) }, evidence));
});
test("honest incomplete and negative reviews can be retained for blocked candidates", () => {
  for (const verdict of ["needs_work", "rejected"]) {
    const draft = { ...completeSubmission, verdict, listenedEntireSource: false,
      checks: Object.fromEntries(YUE2_AUDITION_CHECKS.map(key => [key, "unreviewed"])) };
    assert.equal(validateYuE2Audition(draft, { ...evidence, technicallyBlocked: true, contextRetained: false }).verdict, verdict);
  }
});
