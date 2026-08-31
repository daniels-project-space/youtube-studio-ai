import assert from "node:assert/strict";
import { _clear, register } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import type { Block, ResumeRehydrationRequest, RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";

const base = {
  ownerId: "resume-demand-owner",
  runId: "resume-demand-run",
  channelId: "resume-demand-channel",
  keyPrefix: "owners/resume-demand/",
  budgetUsd: 10,
  log: () => {},
};

function sinkWithCompleted(
  completed: Array<{ block: string; outputs: Record<string, unknown>; cost?: number }>,
  writes: Array<{ block: string; status: string; error?: string }> = [],
): RunStageSink {
  return {
    async upsert(args) {
      writes.push({ block: args.block, status: args.status, error: args.error });
    },
    async getCompleted() {
      return completed;
    },
  };
}

async function parentResumeRequestsOnlyLaterLocalInputs(): Promise<void> {
  let cachedRuns = 0;
  let localRuns = 0;
  const cached: Block = {
    id: "resume_demand_cached",
    consumes: [],
    produces: ["localNeededPath", "localNeededKey", "remoteOnlyPath", "remoteOnlyKey"],
    paid: true,
    run: async () => {
      cachedRuns += 1;
      return {};
    },
  };
  const local: Block = {
    id: "resume_demand_local",
    consumes: ["localNeededPath"],
    produces: ["localConsumerResult"],
    run: async (ctx) => {
      localRuns += 1;
      assert.equal(ctx.store["localNeededPath"], "/tmp/restored-local.mp4");
      return { localConsumerResult: "ran" };
    },
  };
  const remote: Block = {
    id: "resume_demand_remote",
    consumes: ["remoteOnlyPath"],
    produces: ["remoteConsumerResult"],
    run: async () => {
      throw new Error("remote block must dispatch instead of running inline");
    },
  };
  _clear();
  register(cached);
  register(local);
  register(remote);

  const requests = new Map<string, ResumeRehydrationRequest | undefined>();
  const result = await runPipeline(
    validatePipeline([{ block: cached.id }, { block: local.id }, { block: remote.id }]),
    {
      ...base,
      sink: sinkWithCompleted([{
        block: cached.id,
        cost: 0.4,
        outputs: {
          localNeededPath: "/missing/local.mp4",
          localNeededKey: "owners/test/local.mp4",
          remoteOnlyPath: "/missing/remote.mp4",
          remoteOnlyKey: "owners/test/remote.mp4",
        },
      }]),
      rehydrate: async (block, outputs, request) => {
        requests.set(block, request);
        return {
          ok: true,
          outputs: {
            ...outputs,
            ...(block === cached.id ? { localNeededPath: "/tmp/restored-local.mp4" } : {}),
          },
        };
      },
      remoteBlocks: new Set([remote.id]),
      runRemoteBlock: async (blockId) => {
        assert.equal(blockId, remote.id);
        return { remoteConsumerResult: "dispatched" };
      },
    },
  );

  assert.equal(result.ok, true, "a cached stage resumes into its later local consumer");
  assert.equal(cachedRuns, 0, "the completed paid producer is never replayed");
  assert.equal(localRuns, 1, "the local downstream consumer still runs");
  const requested = requests.get(cached.id)?.neededOutputKeys;
  assert.deepEqual(
    [...(requested ?? [])].sort(),
    ["localNeededPath"],
    "parent resume materialises only the later local consumer input, never a remote-child input",
  );
}

async function parentResumeWithNoFutureLocalConsumerRequestsNoMedia(): Promise<void> {
  let cachedRuns = 0;
  const cached: Block = {
    id: "resume_demand_terminal",
    consumes: [],
    produces: ["terminalVideoLocalPath", "terminalVideoKey"],
    paid: true,
    run: async () => {
      cachedRuns += 1;
      return {};
    },
  };
  _clear();
  register(cached);
  let request: ResumeRehydrationRequest | undefined;
  const result = await runPipeline(validatePipeline([{ block: cached.id }]), {
    ...base,
    sink: sinkWithCompleted([{
      block: cached.id,
      cost: 0.4,
      outputs: {
        terminalVideoLocalPath: "/missing/terminal.mp4",
        terminalVideoKey: "owners/test/terminal.mp4",
      },
    }]),
    rehydrate: async (_block, outputs, received) => {
      request = received;
      return { ok: true, outputs };
    },
  });
  assert.equal(result.ok, true, "a completed terminal stage can resume without a worker-local consumer");
  assert.equal(cachedRuns, 0, "terminal paid work remains a no-respend restore");
  assert.deepEqual([...((request?.neededOutputKeys) ?? [])], [], "terminal media has no worker-local fetch demand");
}

async function cachedLocalFallbackRehydratesItsDeclaredInputOnDemand(): Promise<void> {
  let sourceRuns = 0;
  let fallbackRuns = 0;
  const source: Block = {
    id: "resume_demand_fallback_source",
    consumes: [],
    produces: ["fallbackInputLocalPath", "fallbackInputKey"],
    paid: true,
    run: async () => {
      sourceRuns += 1;
      return {};
    },
  };
  const fallback: Block = {
    id: "resume_demand_fallback_target",
    consumes: ["fallbackInputLocalPath"],
    produces: ["fallbackResult"],
    run: async (ctx) => {
      fallbackRuns += 1;
      assert.equal(ctx.store["fallbackInputLocalPath"], "/tmp/lazily-rehydrated-input.mp4");
      return { fallbackResult: "recovered" };
    },
  };
  _clear();
  register(source);
  register(fallback);
  const sourceRequests: string[][] = [];
  const result = await runPipeline(
    validatePipeline([{ block: source.id }, { block: fallback.id }]),
    {
      ...base,
      sink: sinkWithCompleted([
        {
          block: source.id,
          cost: 0.4,
          outputs: {
            fallbackInputLocalPath: "/missing/cached-source.mp4",
            fallbackInputKey: "owners/test/cached-source.mp4",
          },
        },
        { block: fallback.id, outputs: { fallbackResult: "stale" } },
      ]),
      rehydrate: async (block, outputs, request) => {
        if (block === fallback.id) return { ok: false, outputs };
        const requested = [...(request?.neededOutputKeys ?? [])].sort();
        sourceRequests.push(requested);
        if (requested.includes("fallbackInputLocalPath")) {
          return {
            ok: true,
            outputs: { ...outputs, fallbackInputLocalPath: "/tmp/lazily-rehydrated-input.mp4" },
          };
        }
        return { ok: true, outputs };
      },
    },
  );
  assert.equal(result.ok, true, "an unpaid cached fallback receives its declared upstream input before execution");
  assert.equal(sourceRuns, 0, "the paid cached source is never replayed");
  assert.equal(fallbackRuns, 1, "the unpaid target runs after targeted input restoration");
  assert.deepEqual(
    sourceRequests,
    [[], ["fallbackInputLocalPath"]],
    "the source is HEAD-only during normal resume, then streamed only when the fallback actually needs it",
  );
}

async function cachedLocalFallbackFailsClosedWhenItsInputCannotBeRestored(): Promise<void> {
  let fallbackRuns = 0;
  const source: Block = {
    id: "resume_demand_fallback_missing_source",
    consumes: [],
    produces: ["missingFallbackInputLocalPath", "missingFallbackInputKey"],
    paid: true,
    run: async () => {
      throw new Error("paid cached source must not replay");
    },
  };
  const fallback: Block = {
    id: "resume_demand_fallback_missing_target",
    consumes: ["missingFallbackInputLocalPath"],
    produces: ["fallbackResult"],
    run: async () => {
      fallbackRuns += 1;
      return { fallbackResult: "must-not-run" };
    },
  };
  _clear();
  register(source);
  register(fallback);
  const writes: Array<{ block: string; status: string; error?: string }> = [];
  const result = await runPipeline(
    validatePipeline([{ block: source.id }, { block: fallback.id }]),
    {
      ...base,
      sink: sinkWithCompleted([
        {
          block: source.id,
          cost: 0.4,
          outputs: {
            missingFallbackInputLocalPath: "/missing/cached-source.mp4",
            missingFallbackInputKey: "owners/test/cached-source.mp4",
          },
        },
        { block: fallback.id, outputs: { fallbackResult: "stale" } },
      ], writes),
      rehydrate: async (block, outputs, request) => {
        if (block === fallback.id) return { ok: false, outputs };
        if (request?.neededOutputKeys?.has("missingFallbackInputLocalPath")) {
          return { ok: false, outputs };
        }
        return { ok: true, outputs };
      },
    },
  );
  assert.equal(result.ok, false, "a missing lazy input fails the fallback rather than running with a stale path");
  assert.equal(fallbackRuns, 0, "the fallback block never runs after failed targeted restoration");
  assert.ok(
    writes.some((write) =>
      write.block === fallback.id &&
      write.status === "failed" &&
      write.error?.includes("CACHED_INPUT_REHYDRATION_REQUIRED"),
    ),
    "the failed targeted restore leaves an explicit reconciliation fence",
  );
}

async function missingNeededArtifactStillFencesPaidReplay(): Promise<void> {
  let cachedRuns = 0;
  let consumerRuns = 0;
  const cached: Block = {
    id: "resume_demand_missing_paid",
    consumes: [],
    produces: ["neededMasterLocalPath", "neededMasterKey"],
    paid: true,
    run: async () => {
      cachedRuns += 1;
      return {};
    },
  };
  const consumer: Block = {
    id: "resume_demand_missing_consumer",
    consumes: ["neededMasterLocalPath"],
    produces: ["consumerResult"],
    run: async () => {
      consumerRuns += 1;
      return { consumerResult: "must-not-run" };
    },
  };
  _clear();
  register(cached);
  register(consumer);
  const writes: Array<{ block: string; status: string; error?: string }> = [];
  const result = await runPipeline(
    validatePipeline([{ block: cached.id }, { block: consumer.id }]),
    {
      ...base,
      sink: sinkWithCompleted([{
        block: cached.id,
        cost: 0.4,
        outputs: {
          neededMasterLocalPath: "/missing/deleted.mp4",
          neededMasterKey: "owners/test/deleted.mp4",
        },
      }], writes),
      rehydrate: async (_block, outputs) => ({ ok: false, outputs }),
    },
  );
  assert.equal(result.ok, false, "a missing required artifact fails the resumed run");
  assert.equal(cachedRuns, 0, "the completed paid producer cannot be bought again");
  assert.equal(consumerRuns, 0, "no downstream consumer runs with a missing master");
  assert.ok(
    writes.some((write) =>
      write.block === cached.id &&
      write.status === "failed" &&
      write.error?.includes("PAID_STAGE_RECONCILIATION_REQUIRED"),
    ),
    "a missing needed paid artifact retains the actionable reconciliation fence",
  );
}

async function main(): Promise<void> {
  await parentResumeRequestsOnlyLaterLocalInputs();
  await parentResumeWithNoFutureLocalConsumerRequestsNoMedia();
  await cachedLocalFallbackRehydratesItsDeclaredInputOnDemand();
  await cachedLocalFallbackFailsClosedWhenItsInputCannotBeRestored();
  await missingNeededArtifactStillFencesPaidReplay();
  console.log("resumeDemandPlanning: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
