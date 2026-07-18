import assert from "node:assert/strict";
import test from "node:test";
import { isStaleActiveRun, STALE_RUN_AFTER_MS, staleRunAction } from "../runFreshness";

const NOW = 1_700_000_000_000;

test("finds stale active runs even when they are older than the Doctor reporting window", () => {
  const old = NOW - 4 * 24 * 60 * 60 * 1000;
  assert.equal(isStaleActiveRun({ status: "running", startedAt: old }, NOW), true);
  assert.equal(staleRunAction({ status: "running", startedAt: old }), "fail-running");
});

test("uses Convex creation time for legacy run rows", () => {
  assert.equal(
    isStaleActiveRun({ status: "queued", _creationTime: NOW - STALE_RUN_AFTER_MS - 1 }, NOW),
    true,
  );
  assert.equal(staleRunAction({ status: "queued" }), "triage-queued");
});

test("does not flag recent or terminal runs", () => {
  assert.equal(isStaleActiveRun({ status: "running", startedAt: NOW - STALE_RUN_AFTER_MS }, NOW), false);
  assert.equal(isStaleActiveRun({ status: "failed", startedAt: NOW - 2 * STALE_RUN_AFTER_MS }, NOW), false);
});
