import assert from "node:assert/strict";
import {
  assertRenderBlockAdmission,
  assertRenderBlockInvocation,
} from "@/lib/renderBlockAdmission";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import type { PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";

const snapshot = {
  version: 1,
  ownerId: "owner-1",
  runId: "run-1",
  channelId: "channel-1",
  source: "channel",
  entries: [{ block: "timeline_assemble", params: { quality: "production" } }],
  seedStore: { channelName: "Frozen channel" },
  budgetUsd: 8,
  keyPrefix: "owners/owner-1/channels/frozen/",
  remoteBlocks: ["timeline_assemble"],
  defaultRetries: 2,
  compilationFingerprint: "a".repeat(64),
  compilationPolicyId: "production",
  compilationPolicyVersion: "1",
  compilationModules: [],
  compilationCapabilities: [],
  reservedMaxCostUsd: 4,
} satisfies PipelineInvocationSnapshot;

const run = {
  _id: "run-1",
  ownerId: "owner-1",
  channelId: "channel-1",
  status: "running",
  pipelineInvocationSnapshot: snapshot,
  pipelineInvocationSha256: pipelineInvocationSha256(snapshot),
};
const channel = { _id: "channel-1", ownerId: "owner-1" };
const valid = {
  blockId: "timeline_assemble",
  run,
  channel,
  runId: "run-1",
  ownerId: "owner-1",
  channelId: "channel-1",
};

assert.doesNotThrow(() => assertRenderBlockAdmission(valid));
const frozenInvocation = {
  blockId: "timeline_assemble",
  run,
  runId: "run-1",
  ownerId: "owner-1",
  channelId: "channel-1",
  input: {
    keyPrefix: snapshot.keyPrefix,
    budgetUsd: snapshot.budgetUsd,
    params: snapshot.entries[0].params ?? {},
    seedStore: snapshot.seedStore,
  },
};
assert.doesNotThrow(() => assertRenderBlockInvocation(frozenInvocation));
assert.throws(
  () => assertRenderBlockAdmission({ ...valid, blockId: "upload_draft" }),
  /refuses non-render module/,
);
assert.throws(
  () => assertRenderBlockAdmission({ ...valid, run: { ...run, ownerId: "owner-2" } }),
  /ownership\/channel mismatch/,
);
assert.throws(
  () => assertRenderBlockAdmission({ ...valid, run: { ...run, channelId: "channel-2" } }),
  /ownership\/channel mismatch/,
);
assert.throws(
  () => assertRenderBlockAdmission({ ...valid, run: { ...run, status: "queued" } }),
  /requires a running parent run/,
);
assert.throws(
  () => assertRenderBlockAdmission({ ...valid, run: { ...run, status: "ok" } }),
  /requires a running parent run/,
);
assert.throws(
  () => assertRenderBlockAdmission({ ...valid, channel: null }),
  /not found/,
);
assert.throws(
  () => assertRenderBlockInvocation({
    ...frozenInvocation,
    input: { ...frozenInvocation.input, budgetUsd: 99 },
  }),
  /storage\/budget differs/,
);
assert.throws(
  () => assertRenderBlockInvocation({
    ...frozenInvocation,
    input: { ...frozenInvocation.input, keyPrefix: "owners/owner-1/channels/live-edit/" },
  }),
  /storage\/budget differs/,
);
assert.throws(
  () => assertRenderBlockInvocation({
    ...frozenInvocation,
    input: { ...frozenInvocation.input, params: { quality: "draft" } },
  }),
  /params differ/,
);
assert.throws(
  () => assertRenderBlockInvocation({
    ...frozenInvocation,
    input: { ...frozenInvocation.input, seedStore: { channelName: "Live edit" } },
  }),
  /seed store differs/,
);
assert.throws(
  () => assertRenderBlockInvocation({
    ...frozenInvocation,
    run: { ...run, pipelineInvocationSha256: "b".repeat(64) },
  }),
  /hash mismatch/,
);

console.log("render-block admission tests passed");
