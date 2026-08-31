import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { manifestFromBlock, type ModuleManifest } from "@/engine/moduleManifest";
import type { Block, PipelineEntry } from "@/engine/types";
import type { ResolvedPipeline } from "@/engine/validate";
import {
  admitFrozenRemoteChildStage,
} from "@/lib/remoteChildBudgetAdmission";
import {
  assertRenderBlockInvocation,
} from "@/lib/renderBlockAdmission";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import {
  assertPipelineInvocationCompilation,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";

function paidBlock(id: string): Block {
  return {
    id,
    consumes: [],
    produces: [],
    paid: true,
    run: async () => ({}),
  };
}

function paidManifest(id: string, maxCostUsd?: number): ModuleManifest {
  return manifestFromBlock(paidBlock(id), {
    capabilities: [],
    certification: "contract",
    certificationEvidence: "test",
    providerProfiles: [{
      id: `${id}-provider`,
      provider: "test-provider",
      quality: "production",
      allowFallback: false,
    }],
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
  });
}

function resolved(entries: PipelineEntry[], manifests: ModuleManifest[]): ResolvedPipeline {
  return {
    entries,
    manifests,
    blocks: manifests.map((manifest) => manifest.block),
    producedKeys: [],
  };
}

const entryA = { block: "remote-paid-a", params: {} };
const entryB = { block: "remote-paid-b", params: {} };

assert.throws(
  () => admitFrozenRemoteChildStage({
    resolved: resolved([entryA], [paidManifest(entryA.block)]),
    blockId: entryA.block,
    store: {},
    budgetUsd: 10,
    completedStages: [],
  }),
  /no finite absolute cost envelope/,
  "a remote paid child refuses a missing per-stage envelope instead of falling back to the aggregate budget",
);

assert.throws(
  () => admitFrozenRemoteChildStage({
    resolved: resolved(
      [entryA, entryB],
      [paidManifest(entryA.block, 3), paidManifest(entryB.block, 4)],
    ),
    blockId: entryA.block,
    store: {},
    budgetUsd: 6,
    completedStages: [],
  }),
  /budget reservation rejected before paid block/,
  "a child reserves its exact stage plus all still-pending frozen paid envelopes before block work",
);

const rehydratedManifest = manifestFromBlock(paidBlock("remote-paid-rehydrated"), {
  capabilities: [],
  certification: "contract",
  certificationEvidence: "test",
  providerProfiles: [{
    id: "rehydrated-provider",
    provider: "test-provider",
    quality: "production",
    allowFallback: false,
  }],
  maxCostUsd: 8,
  maxCostUsdFor: (_params, context) =>
    context?.store?.["frozenRenderPlan"] === "two-workers" ? 2 : 8,
});
const rehydratedAdmission = admitFrozenRemoteChildStage({
  resolved: resolved(
    [{ block: "remote-paid-rehydrated", params: {} }],
    [rehydratedManifest],
  ),
  blockId: "remote-paid-rehydrated",
  store: { frozenRenderPlan: "two-workers" },
  budgetUsd: 2,
  completedStages: [],
});
assert.equal(
  rehydratedAdmission.stageBudgetUsd,
  2,
  "the remote child derives its exact stage envelope from rehydrated frozen inputs",
);

const snapshot = {
  version: 1,
  ownerId: "owner-frozen",
  runId: "run-frozen",
  channelId: "channel-frozen",
  source: "channel",
  entries: [{ block: "timeline_assemble", params: { quality: "production" } }],
  seedStore: { channelName: "Frozen" },
  budgetUsd: 10,
  keyPrefix: "owners/owner-frozen/channels/frozen/",
  remoteBlocks: ["timeline_assemble"],
  defaultRetries: 1,
  compilationFingerprint: "a".repeat(64),
  compilationPolicyId: "production-contract",
  compilationPolicyVersion: "1.0.0",
  compilationModules: [],
  compilationCapabilities: [],
  reservedMaxCostUsd: 1,
} satisfies PipelineInvocationSnapshot;

assert.throws(
  () => assertRenderBlockInvocation({
    blockId: "timeline_assemble",
    run: {
      _id: snapshot.runId,
      ownerId: snapshot.ownerId,
      channelId: snapshot.channelId,
      status: "running",
      pipelineInvocationSnapshot: snapshot,
      pipelineInvocationSha256: "b".repeat(64),
    },
    runId: snapshot.runId,
    ownerId: snapshot.ownerId,
    channelId: snapshot.channelId,
    input: {
      keyPrefix: snapshot.keyPrefix,
      budgetUsd: snapshot.budgetUsd,
      params: snapshot.entries[0]!.params ?? {},
      seedStore: snapshot.seedStore,
    },
  }),
  /snapshot hash mismatch/,
  "a forged frozen child snapshot is rejected before route reconstruction or block work",
);

assert.equal(pipelineInvocationSha256(snapshot).length, 64);
assert.throws(
  () => assertPipelineInvocationCompilation(snapshot, {
    fingerprint: "b".repeat(64),
    policyId: snapshot.compilationPolicyId,
    policyVersion: snapshot.compilationPolicyVersion,
  }),
  /fingerprint drift/,
  "a current module/policy compilation that drifts from the signed child snapshot is rejected",
);

const childRunner = readFileSync(
  resolve(process.cwd(), "src/trigger/renderBlockRunner.ts"),
  "utf8",
);
const invocationGate = childRunner.indexOf("assertRenderBlockInvocation({");
const frozenRouteGate = childRunner.indexOf("reconstructFrozenRemoteChildPipeline(frozenInvocation)");
const envelopeGate = childRunner.indexOf("admitFrozenRemoteChildStage({");
const providerBlockWork = childRunner.indexOf("await block.run(ctx)");
assert.ok(
  invocationGate >= 0 && frozenRouteGate > invocationGate && envelopeGate > frozenRouteGate && providerBlockWork > envelopeGate,
  "forged/drifted snapshots and missing/insufficient envelopes fail before the remote block can start provider work",
);

console.log("remote child frozen budget admission tests passed");
