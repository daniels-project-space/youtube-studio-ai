import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planHeal } from "@/engine/healer";
import { makeConvexSink } from "@/engine/convexSink";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { _clear, registerManifest } from "@/engine/registry";
import { PAID_STAGE_RECONCILIATION_MARKER, runPipeline } from "@/engine/runner";
import { COST_PATCH_KEY, type Block, type RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";
import type { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { checkpointCostReceiptId, observeCheckpointCostReceipt } from "@/lib/checkpointCostAccounting";
import { recordModelUsage } from "@/lib/modelUsage";
import { upsertRunStage } from "../../../convex/runStages";
import {
  beginThumbnailPaidWork,
  openThumbnailCheckpoint,
  saveThumbnailGenerationCheckpoint,
  saveThumbnailQaCheckpoint,
  thumbnailGenerationCheckpointCost,
  thumbnailQaCheckpointCost,
  thumbnailRequestHash,
  type ThumbnailCheckpointIo,
} from "@/lib/thumbnailCheckpoint";

type Row = NonNullable<Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>>[number];

function durableSink(initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [row.block, { ...row }]));
  let rejectSuccessfulWrite = false;
  const sink: RunStageSink = {
    async upsert(args) {
      if (args.status === "ok" && rejectSuccessfulWrite) {
        rejectSuccessfulWrite = false;
        throw new Error("stage result persistence unavailable after child completion");
      }
      const previous = rows.get(args.block) ?? { block: args.block, status: "queued", cost: 0 };
      const patch = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
      rows.set(args.block, { ...previous, ...patch });
    },
    async getResumeState() {
      return [...rows.values()].map((row) => ({ ...row }));
    },
  };
  return { rows, sink, rejectNextSuccessfulWrite: () => { rejectSuccessfulWrite = true; } };
}

const options = {
  ownerId: "owner_healer_cost",
  runId: "run_healer_cost",
  channelId: "channel_healer_cost",
  keyPrefix: "owners/healer-cost/channels/test/",
  budgetUsd: 10,
  defaultRetries: 0,
  rehydrate: async (_block: string, outputs: Record<string, unknown>) => ({ ok: true, outputs }),
};

function register(block: Block, maxCostUsd?: number) {
  registerManifest(manifestFromBlock(block, { capabilities: [], maxCostUsd }));
}

function equalCost(actual: number | undefined, expected: number, message: string) {
  assert.ok(Math.abs((actual ?? Number.NaN) - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
}

async function selectiveHealRetainsAllSpend() {
  _clear();
  let narrationCalls = 0;
  let cardCalls = 0;
  let reviewCalls = 0;
  const blocks: Block[] = [
    {
      id: "healer_paid_narration", consumes: [], produces: ["savedNarration"], paid: true,
      run: async () => ({ savedNarration: `same-artifact-${++narrationCalls}`, [COST_PATCH_KEY]: 0.3 }),
    },
    {
      id: "intro_card", consumes: ["savedNarration"], produces: ["savedCard"], paid: true,
      run: async () => ({ savedCard: `card-${++cardCalls}`, [COST_PATCH_KEY]: 0.2 }),
    },
    {
      id: "healer_review", consumes: ["savedNarration", "savedCard"], produces: ["reviewPassed"],
      run: async () => {
        if (++reviewCalls === 1) throw new Error("intro card unreadable");
        return { reviewPassed: true };
      },
    },
  ];
  for (const block of blocks) register(block, block.id === "intro_card" ? 0.2 : 0.3);
  const pipeline = validatePipeline(blocks.map((block) => ({ block: block.id })));
  const state = durableSink();
  const first = await runPipeline(pipeline, { ...options, sink: state.sink });
  assert.equal(first.ok, false);
  equalCost(first.costTotal, 0.5, "first failed QA retains the accepted narration and card spend");
  const heal = planHeal(first.error ?? "", blocks);
  assert.deepEqual(heal?.rerunBlocks, ["intro_card", "healer_review"]);
  // This is the persisted transition performed atomically by
  // advanceSelfHealGeneration: outputs and cost remain, status is superseded.
  for (const block of heal!.rerunBlocks) state.rows.get(block)!.status = "superseded";

  const refused = await runPipeline(pipeline, { ...options, sink: state.sink, budgetUsd: 0.6 });
  assert.equal(refused.ok, false);
  assert.match(refused.error ?? "", /budget reservation rejected before paid block/);
  equalCost(refused.costTotal, 0.5, "superseding a card does not refund its accepted generation");
  assert.equal(narrationCalls, 1);
  assert.equal(cardCalls, 1, "the over-budget heal makes zero additional provider calls");
  assert.equal(refused.store.savedNarration, "same-artifact-1", "paid upstream output is restored intact");

  const repaired = await runPipeline(pipeline, { ...options, sink: state.sink, budgetUsd: 0.8 });
  assert.equal(repaired.ok, true);
  equalCost(repaired.costTotal, 0.7, "original and replacement card costs both remain in the run total");
  equalCost(state.rows.get("intro_card")?.cost, 0.4, "stage stores cumulative repair cost");
  assert.equal(narrationCalls, 1, "the healer never regenerates valid paid narration");
  assert.equal(cardCalls, 2);
  const resumed = await runPipeline(pipeline, { ...options, sink: state.sink });
  equalCost(resumed.costTotal, 0.7, "another worker resume preserves cumulative repair spend");
  assert.equal(narrationCalls, 1);
  assert.equal(cardCalls, 2);
}

async function failedLocalSpendSurvivesRetry() {
  _clear();
  let attempts = 0;
  const block: Block = {
    id: "healer_partial_provider", consumes: [], produces: ["recoveredArtifact"], paid: true,
    run: async () => {
      if (++attempts === 1) {
        throw Object.assign(new Error("quality rejected after provider response"), { observedCostUsd: 0.15 });
      }
      return { recoveredArtifact: "accepted", [COST_PATCH_KEY]: 0.2 };
    },
  };
  register(block, 0.2);
  const pipeline = validatePipeline([{ block: block.id }]);
  const state = durableSink();
  const failed = await runPipeline(pipeline, { ...options, sink: state.sink });
  equalCost(failed.costTotal, 0.15, "failed paid response is accounted before resume");
  const resumed = await runPipeline(pipeline, { ...options, sink: state.sink });
  assert.equal(resumed.ok, true);
  equalCost(resumed.costTotal, 0.35, "failed and subsequent local execution both count");
  equalCost(state.rows.get(block.id)?.cost, 0.35, "failure cost cannot be overwritten by successful retry");
}

async function remoteReattachmentIsNotAnotherCharge() {
  _clear();
  const block: Block = {
    id: "healer_remote_child", consumes: [], produces: ["remoteArtifact"], paid: true,
    run: async () => { throw new Error("remote block must never execute locally"); },
  };
  register(block, 0.2);
  const pipeline = validatePipeline([{ block: block.id }]);
  const state = durableSink([{ block: block.id, status: "superseded", cost: 0.3 }]);
  let childAttachments = 0;
  const remoteOptions = {
    ...options,
    sink: state.sink,
    budgetUsd: 0.5,
    remoteBlocks: new Set([block.id]),
    runRemoteBlock: async () => {
      childAttachments++;
      equalCost(state.rows.get(block.id)?.costBeforeExecution, 0.3, "pre-heal spend is durable before dispatch");
      return { remoteArtifact: "same-durable-child-result", [COST_PATCH_KEY]: 0.2 };
    },
  };
  state.rejectNextSuccessfulWrite();
  const first = await runPipeline(pipeline, remoteOptions);
  assert.equal(first.ok, false);
  equalCost(first.costTotal, 0.5, "completed child cost is preserved through parent persistence failure");
  equalCost(state.rows.get(block.id)?.cost, 0.5, "failure records cumulative known spend");

  const reattached = await runPipeline(pipeline, remoteOptions);
  assert.equal(reattached.ok, true, "reattachment fits the original budget without reserving the same child twice");
  assert.equal(childAttachments, 2);
  equalCost(reattached.costTotal, 0.5, "same child receipt is not charged twice");
  equalCost(state.rows.get(block.id)?.cost, 0.5, "stage cost also deduplicates the same child receipt");

  // A fresh self-heal must reserve another full generation, even after a
  // prior refusal changed superseded -> failed without dispatching a child.
  state.rows.get(block.id)!.status = "superseded";
  const denied = await runPipeline(pipeline, { ...remoteOptions, budgetUsd: 0.6 });
  assert.equal(denied.ok, false);
  const deniedAgain = await runPipeline(pipeline, { ...remoteOptions, budgetUsd: 0.6 });
  assert.equal(deniedAgain.ok, false, "a pre-dispatch failure cannot masquerade as an already-paid remote attempt");
  assert.equal(childAttachments, 2, "an unaffordable second repair dispatches no child");
}

async function legacyRemoteAndUnknownCharges() {
  _clear();
  const block: Block = {
    id: "healer_legacy_remote", consumes: [], produces: ["remoteArtifact"], paid: true,
    run: async () => { throw new Error("must execute remotely"); },
  };
  register(block, 0.2);
  const pipeline = validatePipeline([{ block: block.id }]);
  let attachments = 0;
  const state = durableSink([{ block: block.id, status: "failed", cost: 0.2 }]);
  const remoteOptions = {
    ...options, sink: state.sink, budgetUsd: 0.2, remoteBlocks: new Set([block.id]),
    runRemoteBlock: async () => { attachments++; return { remoteArtifact: "legacy", [COST_PATCH_KEY]: 0.2 }; },
  };
  const legacy = await runPipeline(pipeline, remoteOptions);
  assert.equal(legacy.ok, true);
  equalCost(legacy.costTotal, 0.2, "legacy rows without a baseline retain their latest child's single cost");
  state.rows.set(block.id, {
    block: block.id, status: "failed", cost: 0.2,
    error: `${PAID_STAGE_RECONCILIATION_MARKER}: provider accepted work; total charge unknown`,
  });
  const blocked = await runPipeline(pipeline, remoteOptions);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error ?? "", new RegExp(PAID_STAGE_RECONCILIATION_MARKER));
  equalCost(blocked.costTotal, 0.2, "known spend survives an unknown additional charge fence");
  assert.equal(attachments, 1, "unknown charges never become an automatic remote retry");
}

async function invalidAccountingStopsBeforeExecution() {
  _clear();
  let calls = 0;
  const block: Block = {
    id: "healer_corrupt_accounting", consumes: [], produces: ["artifact"], paid: true,
    run: async () => { calls++; return { artifact: true }; },
  };
  register(block, 0.2);
  const pipeline = validatePipeline([{ block: block.id }]);
  for (const costs of [{ cost: -1 }, { cost: Number.NaN }, { cost: 0.1, costBeforeExecution: 0.2 }]) {
    const state = durableSink([{ block: block.id, status: "failed", ...costs }]);
    await assert.rejects(runPipeline(pipeline, { ...options, sink: state.sink }), /resume: .*cost/);
  }
  assert.equal(calls, 0, "corrupt prior cost cannot unlock additional paid work");
}

async function productionSinkRoundTrip() {
  const writes: Record<string, unknown>[] = [];
  let reads = 0;
  const row = { block: "remote-render", status: "failed", cost: 0.5, costBeforeExecution: 0.3 };
  const client = {
    mutation: async (_reference: unknown, args: Record<string, unknown>) => { writes.push(args); },
    query: async () => { reads++; return [row]; },
  } as unknown as StudioConvexHttpClient;
  const sink = makeConvexSink(client, options.ownerId, { leaseOwner: "current-worker", executionLeaseToken: 3 });
  await sink.upsert({ ...options, ...row, status: "running" });
  assert.equal(writes[0]?.costBeforeExecution, 0.3, "production Convex mutation receives the pre-execution baseline");
  assert.equal(writes[0]?.cost, 0.5);
  assert.equal(writes[0]?.executionLeaseToken, 3, "cost writes retain the active execution fence");
  const restored = await sink.getResumeState!(options.runId);
  assert.equal(restored[0]?.costBeforeExecution, 0.3, "production resume returns the same baseline");
  assert.equal(reads, 1, "cost accounting uses the existing resume query without another Convex call");
}

async function localCheckpointReceiptsDeduplicateOnlyTheSameCharge() {
  _clear();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "healer-cost-checkpoint-"));
  const objects = new Map<string, Uint8Array>();
  const io: ThumbnailCheckpointIo = {
    async getObjectBytes(key) {
      const value = objects.get(key);
      if (!value) throw Object.assign(new Error("missing checkpoint"), { name: "NoSuchKey" });
      return value;
    },
    async putObject(key, body, options) {
      if (options?.ifNoneMatch && objects.has(key)) throw Object.assign(new Error("existing checkpoint"), { name: "PreconditionFailed" });
      objects.set(key, typeof body === "string" ? Buffer.from(body) : body);
    },
  };
  let requestHash = thumbnailRequestHash({ concept: "same input" });
  let qaRequestHash = thumbnailRequestHash({ rubric: 1 });
  let forcePaidQa = false;
  let generationCalls = 0;
  let qaCalls = 0;
  let worker = 0;
  const block: Block = {
    id: "healer_local_checkpoint", consumes: [], produces: ["savedImage"], paid: true,
    run: async () => {
      const workerDirectory = join(temporaryDirectory, String(++worker));
      await mkdir(workerDirectory);
      const localImagePath = join(workerDirectory, "thumbnail.jpg");
      let session = await openThumbnailCheckpoint({
        checkpointRoot: "owners/cost/channels/c/runs/r/thumbnail-checkpoints",
        requestHash, localImagePath,
      }, io);
      let cost = 0;
      if (session.manifest) {
        cost += thumbnailGenerationCheckpointCost(session);
      } else {
        session = await beginThumbnailPaidWork(session, io);
        generationCalls++;
        await writeFile(localImagePath, Buffer.from("fixed test image bytes"));
        cost += 0.2;
        session = await saveThumbnailGenerationCheckpoint(session, 0.2, undefined, io);
      }
      if (!forcePaidQa && session.manifest?.qa?.requestHash === qaRequestHash) {
        cost += thumbnailQaCheckpointCost(session, qaRequestHash);
      } else {
        qaCalls++;
        cost += 0.03;
        session = await saveThumbnailQaCheckpoint(session, { requestHash: qaRequestHash, costUsd: 0.03, verdict: { accepted: true } }, io);
      }
      return { savedImage: session.imageKey, [COST_PATCH_KEY]: cost };
    },
  };
  register(block, 0.3);
  const pipeline = validatePipeline([{ block: block.id }]);
  const state = durableSink();
  try {
    state.rejectNextSuccessfulWrite();
    const failed = await runPipeline(pipeline, { ...options, sink: state.sink });
    assert.equal(failed.ok, false);
    equalCost(failed.costTotal, 0.23, "first local checkpoint generation and QA charge are retained through persistence failure");
    assert.equal(state.rows.get(block.id)?.checkpointCostReceipts?.length, 2);
    const restored = await runPipeline(pipeline, { ...options, sink: state.sink });
    assert.equal(restored.ok, true);
    equalCost(restored.costTotal, 0.23, "exact generation and QA receipts restored by a fresh worker are not charged twice");
    assert.equal(generationCalls, 1);
    assert.equal(qaCalls, 1);

    state.rows.get(block.id)!.status = "superseded";
    qaRequestHash = thumbnailRequestHash({ rubric: 2 });
    const newQa = await runPipeline(pipeline, { ...options, sink: state.sink });
    equalCost(newQa.costTotal, 0.26, "a changed QA request charges only the new review while reusing the image");
    assert.equal(generationCalls, 1);
    assert.equal(qaCalls, 2);

    state.rows.get(block.id)!.status = "superseded";
    forcePaidQa = true;
    const repeatedInputs = await runPipeline(pipeline, { ...options, sink: state.sink });
    equalCost(repeatedInputs.costTotal, 0.29, "a distinct paid QA receipt still counts when inputs, verdict, and price are identical");
    assert.equal(qaCalls, 3);
    forcePaidQa = false;

    state.rows.get(block.id)!.status = "superseded";
    requestHash = thumbnailRequestHash({ concept: "new image" });
    const newGeneration = await runPipeline(pipeline, { ...options, sink: state.sink });
    equalCost(newGeneration.costTotal, 0.52, "a new generation and its QA are additional paid work even at the same prices");
    assert.equal(generationCalls, 2);
    assert.equal(qaCalls, 4);
    assert.equal(state.rows.get(block.id)?.checkpointCostReceipts?.length, 6);

    // Historical dollars without receipt identities cannot be assigned to a
    // matching-looking cached candidate by amount or input similarity.
    const legacy = durableSink([{ block: block.id, status: "failed", cost: 0.23 }]);
    const ambiguous = await runPipeline(pipeline, { ...options, sink: legacy.sink });
    assert.equal(ambiguous.ok, false);
    assert.match(ambiguous.error ?? "", new RegExp(PAID_STAGE_RECONCILIATION_MARKER));
    assert.equal(generationCalls, 2, "legacy attribution uncertainty cannot trigger another generation");
    assert.equal(qaCalls, 4);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function freshProviderFailureIsNotOffsetByCachedSpend() {
  const receipt = { id: checkpointCostReceiptId("run/checkpoint", "generation-1"), costUsd: 0.2 };
  for (const additionalObservedCostUsd of [0, 0.04]) {
    for (const { scoped, cumulative } of [
      { scoped: false, cumulative: false }, { scoped: false, cumulative: true },
      { scoped: true, cumulative: false }, { scoped: true, cumulative: true },
    ]) {
    _clear();
    const block: Block = {
      id: "healer_mixed_checkpoint_failure", consumes: [], produces: ["artifact"], paid: true,
      run: async () => {
        observeCheckpointCostReceipt(receipt, true);
        // The adapter observed a new $0.10 provider response, but its QA result
        // never reached a checkpoint. These tokens belong to this execution.
        if (scoped) recordModelUsage({ provider: "gemini", model: "gemini-2.5-flash", kind: "vision", inputTokens: 0, outputTokens: 40_000 });
        throw Object.assign(new Error("new QA failed before checkpoint"), {
          observedCostUsd: cumulative ? 0.3 : 0.1,
          observedCostIncludesCheckpointReceipts: cumulative,
          additionalObservedCostUsd,
        });
      },
    };
    register(block, 0.5);
    const state = durableSink([{ block: block.id, status: "failed", cost: 0.2, checkpointCostReceipts: [receipt] }]);
    const failed = await runPipeline(validatePipeline([{ block: block.id }]), { ...options, sink: state.sink });
    assert.equal(failed.ok, false);
    equalCost(failed.costTotal, 0.3 + additionalObservedCostUsd, "old checkpoint credit never erases fresh failed provider usage or supplemental spend");
    equalCost(state.rows.get(block.id)?.cost, failed.costTotal, "fresh failed usage survives another worker retry");
    }
  }
}

async function lateParentWritesCannotEraseChildCharges() {
  const receiptA = { id: checkpointCostReceiptId("child/checkpoint", "first-charge"), costUsd: 0.3 };
  const receiptB = { id: checkpointCostReceiptId("child/checkpoint", "second-charge"), costUsd: 0.2 };
  const run = {
    _id: options.runId, ownerId: options.ownerId, channelId: options.channelId,
    status: "running", leaseOwner: "parent", executionAttempts: 1, leaseExpiresAt: Date.now() + 60_000,
  };
  const stage: Record<string, unknown> = {
    _id: "stage-cost", block: "remote-render", cost: 0.5, costBeforeExecution: 0.3,
    checkpointCostReceipts: [receiptA, receiptB], status: "failed",
  };
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "service", role: "service", owner_id: options.ownerId }) },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => id === options.runId ? run : { _id: options.channelId, ownerId: options.ownerId },
      query: () => ({ withIndex: () => ({ unique: async () => stage }) }),
      patch: async (_id: string, patch: Record<string, unknown>) => { Object.assign(stage, patch); },
    },
  };
  const invoke = (args: Record<string, unknown>) => (upsertRunStage as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  })._handler(ctx, {
    ownerId: options.ownerId, runId: options.runId, block: "remote-render",
    leaseOwner: "parent", executionLeaseToken: 1, status: "failed", ...args,
  });
  await invoke({ cost: 0, costBeforeExecution: 0.3, checkpointCostReceipts: [receiptA], error: "parent summary unavailable" });
  equalCost(stage.cost as number, 0.5, "a stale parent zero-cost write cannot refund a child's already-persisted charge");
  assert.deepEqual(stage.checkpointCostReceipts, [receiptA, receiptB], "a stale parent receipt subset cannot erase child receipts");
  assert.equal(stage.error, "parent summary unavailable", "failure reporting still updates while costs remain monotonic");
  await assert.rejects(invoke({ cost: 0.6, checkpointCostReceipts: [{ ...receiptA, costUsd: 0.1 }] }), /receipt amount changed/);
  equalCost(stage.cost as number, 0.5, "an inconsistent receipt write fails without changing durable cost");
}

async function main() {
  await selectiveHealRetainsAllSpend();
  await failedLocalSpendSurvivesRetry();
  await remoteReattachmentIsNotAnotherCharge();
  await legacyRemoteAndUnknownCharges();
  await invalidAccountingStopsBeforeExecution();
  await productionSinkRoundTrip();
  await localCheckpointReceiptsDeduplicateOnlyTheSameCharge();
  await freshProviderFailureIsNotOffsetByCachedSpend();
  await lateParentWritesCannotEraseChildCharges();
  console.log("HEALER COST RECOVERY PASS — preserved artifacts, cumulative spend, pre-spend refusal, remote receipt deduplication");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
