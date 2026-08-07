import assert from "node:assert/strict";

import { _clear, register } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import type { Block, RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";
import {
  createImageUsageScope,
  recordImageUsage,
} from "@/lib/imageUsage";
import { priceModelUsage, recordModelUsage } from "@/lib/modelUsage";

function sinkRows(): { sink: RunStageSink; costs: number[] } {
  const costs: number[] = [];
  return {
    costs,
    sink: {
      async upsert(args) {
        if (args.cost !== undefined) costs.push(args.cost);
      },
    },
  };
}

async function concurrentScopesStayIsolated(): Promise<void> {
  const first = createImageUsageScope();
  const second = createImageUsageScope();

  await Promise.all([
    first.run(async () => {
      await Promise.resolve();
      recordImageUsage({
        provider: "fal",
        model: "fal-ai/flux/schnell",
        route: "schnell",
        images: 1,
        width: 1024,
        height: 576,
        costUsd: 0.001769472,
      });
      await new Promise((resolve) => setImmediate(resolve));
    }),
    second.run(async () => {
      recordImageUsage({
        provider: "fal",
        model: "fal-ai/flux-pro/kontext",
        route: "kontext",
        images: 1,
        width: 1024,
        height: 1024,
        costUsd: 0.04,
      });
      await Promise.resolve();
    }),
  ]);

  assert.equal(first.snapshot().calls, 1);
  assert.equal(first.snapshot().costUsd, 0.001769472);
  assert.equal(first.snapshot().records[0].route, "schnell");
  assert.equal(second.snapshot().calls, 1);
  assert.equal(second.snapshot().costUsd, 0.04);
  assert.equal(second.snapshot().records[0].route, "kontext");
}

async function runnerAccountsSuccessAndFailure(): Promise<void> {
  const exactCost = 0.02359296;
  _clear();
  const successBlock: Block = {
    id: "image_usage_success_test",
    consumes: [],
    produces: ["x"],
    run: async (ctx) => {
      recordImageUsage({
        provider: "fal",
        model: "fal-ai/flux-pro/v1.1",
        route: "flux-pro-v1.1",
        images: 1,
        width: 1024,
        height: 576,
        costUsd: exactCost,
      });
      assert.equal(ctx.imageUsageAccounting?.().costUsd, exactCost);
      return { x: "ok" };
    },
  };
  register(successBlock);
  const successSink = sinkRows();
  const success = await runPipeline(
    validatePipeline([{ block: successBlock.id }]),
    {
      ownerId: "owner",
      runId: "image-success",
      channelId: "channel",
      keyPrefix: "test/",
      budgetUsd: 1,
      sink: successSink.sink,
    },
  );
  assert.equal(success.ok, true);
  assert.equal(success.costTotal, exactCost);
  assert.ok(successSink.costs.includes(exactCost));

  _clear();
  const failureBlock: Block = {
    id: "image_usage_failure_test",
    consumes: [],
    produces: ["x"],
    run: async () => {
      recordImageUsage({
        provider: "fal",
        model: "fal-ai/flux-pro/v1.1",
        route: "flux-pro-v1.1",
        images: 1,
        width: 1024,
        height: 576,
        costUsd: exactCost,
      });
      throw Object.assign(new Error("transport failed after paid image"), {
        retryable: false,
        // Deliberately lower than the scope to prove the runner never loses
        // other paid image responses when reconciling adapter error metadata.
        observedCostUsd: 0.001,
      });
    },
  };
  register(failureBlock);
  const failureSink = sinkRows();
  const failure = await runPipeline(
    validatePipeline([{ block: failureBlock.id }]),
    {
      ownerId: "owner",
      runId: "image-failure",
      channelId: "channel",
      keyPrefix: "test/",
      budgetUsd: 1,
      sink: failureSink.sink,
    },
  );
  assert.equal(failure.ok, false);
  assert.equal(failure.costTotal, exactCost);
  assert.ok(failureSink.costs.includes(exactCost));

  _clear();
  const modelRecord = {
    provider: "gemini" as const,
    model: "gemini-2.5-flash",
    kind: "text" as const,
    inputTokens: 1_000,
    outputTokens: 200,
  };
  const modelCost = priceModelUsage(modelRecord).costUsd;
  assert.notEqual(modelCost, undefined);
  let attempts = 0;
  const supplementalFailure: Block = {
    id: "supplemental_paid_failure_test",
    consumes: [],
    produces: ["x"],
    run: async () => {
      attempts++;
      recordModelUsage(modelRecord);
      recordImageUsage({
        provider: "fal",
        model: "fal-ai/flux-pro/v1.1",
        route: "flux-pro-v1.1",
        images: 1,
        width: 1024,
        height: 576,
        costUsd: exactCost,
      });
      throw Object.assign(new Error("R2 failed after accepted i2v clips"), {
        // Even incorrectly marked retryable provider errors cannot make the
        // runner buy accepted work a second time.
        retryable: true,
        additionalObservedCostUsd: 0.45,
      });
    },
  };
  register(supplementalFailure);
  const supplementalSink = sinkRows();
  const supplemental = await runPipeline(
    validatePipeline([{ block: supplementalFailure.id }]),
    {
      ownerId: "owner",
      runId: "supplemental-failure",
      channelId: "channel",
      keyPrefix: "test/",
      budgetUsd: 1,
      defaultRetries: 2,
      sink: supplementalSink.sink,
    },
  );
  const exactSupplementalCost = exactCost + (modelCost ?? 0) + 0.45;
  assert.equal(supplemental.ok, false);
  assert.equal(supplemental.costTotal, exactSupplementalCost);
  assert.ok(supplementalSink.costs.includes(exactSupplementalCost));
  assert.equal(attempts, 1, "accepted paid work must stop whole-block retries");
  _clear();
}

void Promise.all([
  concurrentScopesStayIsolated(),
  runnerAccountsSuccessAndFailure(),
]).then(() => {
  console.log("IMAGE USAGE ACCOUNTING PASS: concurrent async scopes remain isolated");
});
