import assert from "node:assert/strict";
import test from "node:test";
import {
  isQuizSubjectId,
  parseQuizSubjectMemoryKey,
  quizSubjectIdsUsedByOtherRuns,
  quizSubjectMemoryKey,
} from "@/lib/quizSubjectMemory";

test("QuizYear subject memory is canonical, retry-safe, and channel-history scoped", () => {
  const current = quizSubjectMemoryKey({ runId: "run-current", subjectId: "Q42" });
  const prior = quizSubjectMemoryKey({ runId: "run-prior", subjectId: "Q1" });

  assert.deepEqual(parseQuizSubjectMemoryKey(current), { runId: "run-current", subjectId: "Q42" });
  assert.deepEqual(
    quizSubjectIdsUsedByOtherRuns([current, prior, prior, "quiz-topic/v1/run-prior/space/1"], "run-current"),
    ["Q1"],
  );
  assert.equal(isQuizSubjectId("Q0"), false);
  assert.equal(isQuizSubjectId("Q1/unsafe"), false);
  assert.throws(() => quizSubjectMemoryKey({ runId: "run", subjectId: "not-a-qid" }));
});
