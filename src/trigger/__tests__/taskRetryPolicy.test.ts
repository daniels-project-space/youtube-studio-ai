import assert from "node:assert/strict";
import { test } from "node:test";
import { AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ExecutionError } from "@/engine/executionErrors";
import { taskErrorForRetryPolicy, throwForTaskRetryPolicy } from "../taskRetryPolicy";

test("unknown failures do not acquire retries at the Trigger boundary", () => {
  for (const error of [new Error("unclassified provider result"), { message: "unrecognized response", code: "NEW_CODE" }, null]) {
    const result = taskErrorForRetryPolicy(error);
    assert.equal(result.classification.kind, "unknown");
    assert.equal(result.classification.retryable, false);
    assert.ok(result.error instanceof AbortTaskRunError);
    assert.equal(result.error.message, result.classification.message);
    assert.throws(() => throwForTaskRetryPolicy(error), AbortTaskRunError);
  }
});

test("concrete transient failures retain the original recovery metadata", () => {
  for (const error of [
    new ExecutionError("provider overloaded", { status: 503, retryAfterMs: 5000 }),
    new ExecutionError("lease held", { retryable: true, retryScope: "durable_task", retryAfterMs: 300_000 }),
    Object.assign(new Error("connection interrupted"), { code: "ECONNRESET" }),
  ]) {
    const result = taskErrorForRetryPolicy(error);
    assert.equal(result.classification.retryable, true);
    assert.equal(result.error, error);
    assert.throws(() => throwForTaskRetryPolicy(error), value => value === error);
  }
});

test("authorization, explicit reconciliation and exhausted retries stay terminal", () => {
  for (const error of [
    new ExecutionError("provider rejected", { status: 403 }),
    new ExecutionError("reconcile accepted output", { retryable: false, status: 503 }),
    new Error("provider failed after 3 attempts: HTTP 503"),
  ]) {
    const result = taskErrorForRetryPolicy(error);
    assert.equal(result.classification.retryable, false);
    assert.ok(result.error instanceof AbortTaskRunError);
  }
});
