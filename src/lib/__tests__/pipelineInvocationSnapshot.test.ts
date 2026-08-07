import assert from "node:assert/strict";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import {
  assertPipelineInvocationCompilation,
  decidePipelineInvocationClaim,
  normalizePipelineInvocationSnapshot,
  pipelineInvocationSnapshotsEqual,
  snapshotParamsByBlock,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";

function snapshot(
  overrides: Partial<PipelineInvocationSnapshot> = {},
): PipelineInvocationSnapshot {
  return {
    version: 1,
    ownerId: "owner-a",
    runId: "run-a",
    channelId: "channel-a",
    source: "bundle-reuse",
    entries: [
      { block: "topic_select", params: { model: "pinned-model" } },
      {
        block: "upload_draft",
        params: {
          publishMode: "scheduled",
          approvedForPublish: true,
          madeForKids: true,
        },
      },
      { block: "notify" },
      { block: "cleanup" },
    ],
    seedStore: {
      channelName: "Frozen name",
      planItemId: "plan-a",
      plannedTopic: "Frozen topic",
      plannedTitle: "Frozen title",
      plannedThumbnailKey: "owner/owner-a/plans/thumb.jpg",
      scheduledPublishAt: 1_786_018_500_000,
      reuseLanguage: "fr",
      reuseTopic: "Frozen topic",
      reuseScript: { hook: "Frozen hook" },
      reuseFootageKeys: ["owner/owner-a/group/base/clip_0.mp4"],
      reuseMusicKey: "owner/owner-a/group/base/music.mp3",
    },
    budgetUsd: 12.5,
    keyPrefix: "owner/owner-a/channel/frozen-slug/",
    remoteBlocks: ["timeline_assemble"],
    defaultRetries: 2,
    compilationFingerprint: "b".repeat(64),
    compilationPolicyId: "production-contract",
    compilationPolicyVersion: "2",
    compilationModules: [
      { id: "topic_select", version: "1.0.0" },
      { id: "upload_draft", version: "1.0.0" },
    ],
    compilationCapabilities: ["publish.youtube"],
    reservedMaxCostUsd: 9.25,
    ...overrides,
  };
}

const frozen = normalizePipelineInvocationSnapshot(snapshot());
assert.equal(frozen.entries[1].params?.["madeForKids"], true);
assert.equal(frozen.seedStore["reuseLanguage"], "fr");
assert.equal(frozen.keyPrefix, "owner/owner-a/channel/frozen-slug/");
assert.equal(frozen.budgetUsd, 12.5);
assert.equal(frozen.defaultRetries, 2);
assert.deepEqual(frozen.remoteBlocks, ["timeline_assemble"]);
assert.deepEqual(snapshotParamsByBlock(frozen.entries)["upload_draft"], {
  publishMode: "scheduled",
  approvedForPublish: true,
  madeForKids: true,
});

const hash = pipelineInvocationSha256(frozen);
assert.match(hash, /^[a-f0-9]{64}$/);
const reordered = snapshot({
  seedStore: {
    reuseMusicKey: "owner/owner-a/group/base/music.mp3",
    reuseFootageKeys: ["owner/owner-a/group/base/clip_0.mp4"],
    reuseScript: { hook: "Frozen hook" },
    reuseTopic: "Frozen topic",
    reuseLanguage: "fr",
    scheduledPublishAt: 1_786_018_500_000,
    plannedThumbnailKey: "owner/owner-a/plans/thumb.jpg",
    plannedTitle: "Frozen title",
    plannedTopic: "Frozen topic",
    planItemId: "plan-a",
    channelName: "Frozen name",
  },
});
assert.equal(pipelineInvocationSha256(reordered), hash);
assert.equal(pipelineInvocationSnapshotsEqual(frozen, reordered), true);

assert.doesNotThrow(() =>
  assertPipelineInvocationCompilation(frozen, {
    fingerprint: frozen.compilationFingerprint,
    policyId: frozen.compilationPolicyId,
    policyVersion: frozen.compilationPolicyVersion,
  }),
);
assert.throws(
  () => assertPipelineInvocationCompilation(frozen, {
    fingerprint: "c".repeat(64),
    policyId: frozen.compilationPolicyId,
    policyVersion: frozen.compilationPolicyVersion,
  }),
  /fingerprint drift/,
);

const baseClaim = {
  run: {
    ownerId: frozen.ownerId,
    channelId: frozen.channelId,
    runId: frozen.runId,
    status: "running",
    hasExecutionHistory: false,
  },
  ownerId: frozen.ownerId,
  channelId: frozen.channelId,
  runId: frozen.runId,
  snapshot: frozen,
  sha256: hash,
};
assert.equal(decidePipelineInvocationClaim(baseClaim).kind, "new");
assert.equal(decidePipelineInvocationClaim({
  ...baseClaim,
  run: { ...baseClaim.run, snapshot: frozen, sha256: hash },
}).kind, "reused");
assert.throws(
  () => decidePipelineInvocationClaim({
    ...baseClaim,
    run: { ...baseClaim.run, snapshot: frozen },
  }),
  /snapshot\/hash pair is incomplete/,
);
assert.throws(
  () => decidePipelineInvocationClaim({
    ...baseClaim,
    run: { ...baseClaim.run, sha256: hash },
  }),
  /snapshot\/hash pair is incomplete/,
);

for (const changed of [
  snapshot({ budgetUsd: 13 }),
  snapshot({ keyPrefix: "owner/owner-a/channel/changed/" }),
  snapshot({ seedStore: { ...frozen.seedStore, channelName: "Changed" } }),
  snapshot({ entries: frozen.entries.map((entry, index) =>
    index === 0 ? { ...entry, params: { model: "changed" } } : entry) }),
  snapshot({ compilationFingerprint: "c".repeat(64) }),
]) {
  assert.throws(
    () => decidePipelineInvocationClaim({
      ...baseClaim,
      snapshot: changed,
      run: { ...baseClaim.run, snapshot: frozen, sha256: hash },
    }),
    /immutable/,
  );
}
assert.throws(
  () => decidePipelineInvocationClaim({
    ...baseClaim,
    run: { ...baseClaim.run, status: "ok" },
  }),
  /terminal run status/,
);
assert.throws(
  () => decidePipelineInvocationClaim({
    ...baseClaim,
    run: { ...baseClaim.run, status: "failed", hasExecutionHistory: true },
  }),
  /legacy run requires manual recovery/,
);
assert.throws(
  () => normalizePipelineInvocationSnapshot(snapshot({ remoteBlocks: ["unknown"] })),
  /remote block routing/,
);
assert.throws(
  () => normalizePipelineInvocationSnapshot(snapshot({
    seedStore: { huge: "x".repeat(760_000) },
  })),
  /exceeds 750000 bytes/,
);
assert.throws(
  () => normalizePipelineInvocationSnapshot(snapshot({
    seedStore: { bad: BigInt(1) },
  })),
  /not JSON-safe/,
);

console.log("pipeline invocation snapshot tests passed");
