import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mock, test } from "node:test";
import { assertVisualReviewCoveragePossible, reviewRender, VisualReviewFailure } from "../visualReview";

test("necessary coverage bound includes focus capacity and the existing final tolerance", () => {
  assert.doesNotThrow(() => assertVisualReviewCoveragePossible(600, 48));
  assert.doesNotThrow(() => assertVisualReviewCoveragePossible(3600, 48));
  assert.throws(() => assertVisualReviewCoveragePossible(28800, 72), /at least 319 distinct frames/);
  assert.throws(() => assertVisualReviewCoveragePossible(28800, 108), /permits at most 108/);
  assert.doesNotThrow(() => assertVisualReviewCoveragePossible(28800, 319));
  assert.doesNotThrow(() => assertVisualReviewCoveragePossible(90 * 73 + 0.5, 72));
  for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => assertVisualReviewCoveragePossible(duration, 48));
});

test("actual required reviewer rejects impossible long-form coverage before decode or model calls", async () => {
  let modelCalls = 0;
  const spawn = mock.method(childProcess, "spawn", () => { throw new Error("decoder must not start for impossible coverage"); });
  try {
    await assert.rejects(reviewRender("/not-opened.mp4", 28800, { title: "Long loop" }, {
      runId: "coverage-admission-fixture", required: true, maxFrames: 72, maxFocusFrames: 36,
      requireCompleteFocusCoverage: true, completeFocusFrames: [0, 5, 10].map(tSec => ({ tSec })),
      reviewer: async () => { modelCalls++; throw new Error("review must not be purchased"); },
    }), error => {
      assert.ok(error instanceof VisualReviewFailure);
      assert.equal(error.retryable, false);
      assert.match(error.message, /permits at most 111/);
      return true;
    });
    assert.equal(modelCalls, 0); assert.equal(spawn.mock.calls.length, 0);
  } finally { spawn.mock.restore(); }
});
