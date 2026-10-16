import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionError } from "@/engine/executionErrors";
import { assertRenderEngineYuE2DispatchEnabled, terminalRenderEngineYuE2Error } from "../yue2MusicEngine";

const stage = {
  jobId: "a".repeat(32),
  state: "awaiting-final-qualification",
  manifestSha256: "b".repeat(64),
  dispatchEnabled: false,
  output: {
    bucket: "youtube-studio-renders",
    key: "projects/youtube-studio-render/jobs/job-a/audio.wav",
    receiptKey: "projects/youtube-studio-render/jobs/job-a/yue2.receipt.json",
  },
} as const;

test("unqualified YuE2 staging raises a terminal hold containing the preserved Engine job ID", () => {
  let error: unknown;
  try {
    assertRenderEngineYuE2DispatchEnabled(stage);
  } catch (caught) {
    error = caught;
  }

  assert.ok(error instanceof ExecutionError);
  assert.equal(error.code, "RENDER_ENGINE_YUE2_FINAL_QUALIFICATION_PENDING");
  assert.equal(error.retryable, false);
  assert.match(error.message, new RegExp(stage.jobId));
  assert.match(error.message, /retry the identical request/);
});

test("qualified YuE2 jobs continue to the normal durable status path", () => {
  assert.doesNotThrow(() => assertRenderEngineYuE2DispatchEnabled({ ...stage, state: "queued", dispatchEnabled: true }));
});

test("a contradictory disabled state is not mislabeled as a qualification hold", () => {
  assert.throws(() => assertRenderEngineYuE2DispatchEnabled({ ...stage, state: "failed" }), /dispatch disabled in unexpected state failed/);
});

test("terminal YuE2 failures retain only a complete, in-budget allocation debit", () => {
  const status = {
    status: "failed",
    allocationUsage: {
      complete: true, costBasis: "engine-reservation-debit", providerInvoiceVerified: false,
      costUsd: 0.031, gpuSeconds: 620,
    },
  };
  const error = terminalRenderEngineYuE2Error(status, 0.04) as Error & { additionalObservedCostUsd?: number };
  assert.match(error.message, /job failed/);
  assert.equal(error.additionalObservedCostUsd, 0.031);
  assert.equal(terminalRenderEngineYuE2Error({ status: "running" }, 0.04), undefined);

  const unresolved = terminalRenderEngineYuE2Error({ status: "cancelled", allocationUsage: { costUsd: 0.02 } }, 0.04) as Error & { additionalObservedCostUsd?: number };
  assert.match(unresolved.message, /job cancelled/);
  assert.equal(unresolved.additionalObservedCostUsd, undefined);
});
