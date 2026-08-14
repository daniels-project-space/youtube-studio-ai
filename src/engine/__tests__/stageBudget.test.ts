import assert from "node:assert/strict";
import { runPipeline } from "@/engine/runner";
import { _clear, register } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import type { Block, RunStageSink } from "@/engine/types";
import { PRICE } from "@/engine/pricing";

function sink(): RunStageSink {
  return { async upsert() {} };
}

async function runnerSuppliesTheCompilerStageReservation(): Promise<void> {
  _clear();
  let seenStageBudget: number | undefined;
  let seenRunBudget: number | undefined;
  // `keyframes` has a real production contract: two bounded direct image
  // workers. Replacing its implementation keeps this test provider-free while
  // exercising the exact same compiler reservation path as a live module.
  const probe: Block = {
    id: "keyframes",
    consumes: [],
    produces: ["f1Key"],
    paid: true,
    run: async (ctx) => {
      seenStageBudget = ctx.stageBudgetUsd;
      seenRunBudget = ctx.budgetUsd;
      return { f1Key: "owner/test/keyframe.png" };
    },
  };
  register(probe);

  const result = await runPipeline(validatePipeline([{ block: probe.id }]), {
    ownerId: "owner",
    runId: "stage-budget",
    channelId: "channel",
    keyPrefix: "owner/test/",
    budgetUsd: 99,
    sink: sink(),
  });

  assert.equal(result.ok, true);
  assert.equal(seenRunBudget, 99);
  assert.equal(seenStageBudget, 2 * PRICE.novitaImageMaxUsd);
  _clear();
}

void runnerSuppliesTheCompilerStageReservation().then(() => {
  console.log("stage budget test passed");
});
