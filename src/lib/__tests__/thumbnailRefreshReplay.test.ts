import assert from "node:assert/strict";

import { createPackageToOpeningPlan } from "@/engine/packageToOpening";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import type { PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import { assessThumbnailRefreshReplay } from "@/lib/thumbnailRefreshReplay";

const ownerId = "owner-thumb-refresh";
const channelId = "channel-thumb-refresh";
const runId = "run-thumb-refresh";
const topic = "Why small fees compound into a large retirement drag";
const title = "The Small Fee That Quietly Eats Your Retirement";
const thumbnailDescription =
  "A clean whiteboard split comparison shows two equal retirement portfolios, with a tiny fee wedge visibly widening into a large twenty-year gap. Bold label: SMALL FEE, BIG COST.";
const route = { id: "narrated-stock/foundation/v1", fingerprint: "route-fingerprint" };
const contentLane = { key: "narrated_stock", primaryRenderer: "assemble" };
const script = { hook: "A one percent fee can cost far more than it looks like.", hookLoop: "See the compounding drag." };

function input(overrides: Partial<Parameters<typeof assessThumbnailRefreshReplay>[0]> = {}) {
  const packageToOpeningPlan = createPackageToOpeningPlan({
    title,
    thumbnailDescription,
    topic,
    route,
    script,
    family: "narrated_stock",
    contentLane,
  });
  const pipelineInvocationSnapshot: PipelineInvocationSnapshot = {
    version: 1,
    ownerId,
    channelId,
    runId,
    source: "channel",
    entries: [
      { block: "topic_select" },
      { block: "script_gen" },
      { block: "metadata" },
      { block: "package_to_opening_plan" },
      { block: "thumbnail_gen" },
    ],
    seedStore: {
      family: "narrated_stock",
      contentLane,
      channelProgramRoute: route,
      styleDNA: { thumbnail: { composition: "two-state comparison" } },
    },
    budgetUsd: 10,
    keyPrefix: "owner/owner-thumb-refresh/channels/test/",
    remoteBlocks: [],
    defaultRetries: 1,
    compilationFingerprint: "a".repeat(64),
    compilationPolicyId: "golden-production",
    compilationPolicyVersion: "1",
    compilationModules: [],
    compilationCapabilities: ["package.thumbnail"],
    reservedMaxCostUsd: 10,
  };
  return {
    ownerId,
    channelId,
    runId,
    pipelineInvocationSnapshot,
    pipelineInvocationSha256: pipelineInvocationSha256(pipelineInvocationSnapshot),
    stages: [
      { block: "topic_select", outputs: { topic } },
      { block: "script_gen", outputs: { script } },
      { block: "metadata", outputs: { title, thumbnailDescription } },
      { block: "package_to_opening_plan", outputs: { packageToOpeningPlan } },
    ],
    ...overrides,
  };
}

const ready = assessThumbnailRefreshReplay(input());
assert.equal(ready.status, "ready_for_thumbnail_only");
if (ready.status === "ready_for_thumbnail_only") {
  assert.equal(ready.material.title, title);
  assert.equal(ready.material.packageToOpeningPlan.planFingerprint.length, 64);
  assert.equal(ready.material.replayFingerprint.length, 64);
}

const styleDriftSnapshot: PipelineInvocationSnapshot = {
    version: 1,
    ownerId,
    channelId,
    runId,
    source: "channel",
    entries: [
      { block: "topic_select" },
      { block: "script_gen" },
      { block: "metadata" },
      { block: "package_to_opening_plan" },
      { block: "thumbnail_gen" },
    ],
    seedStore: {
      family: "narrated_stock",
      contentLane,
      channelProgramRoute: route,
    },
    budgetUsd: 10,
    keyPrefix: "owner/owner-thumb-refresh/channels/test/",
    remoteBlocks: [],
    defaultRetries: 1,
    compilationFingerprint: "a".repeat(64),
    compilationPolicyId: "golden-production",
    compilationPolicyVersion: "1",
    compilationModules: [],
    compilationCapabilities: ["package.thumbnail"],
    reservedMaxCostUsd: 10,
};
const styleDrift = assessThumbnailRefreshReplay(input({
  pipelineInvocationSnapshot: styleDriftSnapshot,
  pipelineInvocationSha256: pipelineInvocationSha256(styleDriftSnapshot),
}));
assert.equal(styleDrift.status, "requires_private_successor");
if (styleDrift.status === "requires_private_successor") {
  assert.ok(styleDrift.missing.includes("frozen Style DNA"));
}

const corruptInvocation = input();
const corruptSnapshot = structuredClone(corruptInvocation.pipelineInvocationSnapshot) as PipelineInvocationSnapshot;
corruptSnapshot.seedStore.styleDNA = { thumbnail: { composition: "unapproved current style" } };
const corrupted = assessThumbnailRefreshReplay({
  ...corruptInvocation,
  pipelineInvocationSnapshot: corruptSnapshot,
});
assert.equal(corrupted.status, "requires_private_successor");
if (corrupted.status === "requires_private_successor") {
  assert.ok(corrupted.missing.includes("hash-verified frozen pipeline invocation"));
}

const tamperedPlan = assessThumbnailRefreshReplay(input({
  stages: [
    { block: "topic_select", outputs: { topic } },
    { block: "script_gen", outputs: { script } },
    { block: "metadata", outputs: { title, thumbnailDescription: `${thumbnailDescription} altered` } },
    {
      block: "package_to_opening_plan",
      outputs: {
        packageToOpeningPlan: createPackageToOpeningPlan({
          title,
          thumbnailDescription,
          topic,
          route,
          script,
          family: "narrated_stock",
          contentLane,
        }),
      },
    },
  ],
}));
assert.equal(tamperedPlan.status, "requires_private_successor");
if (tamperedPlan.status === "requires_private_successor") {
  assert.deepEqual(tamperedPlan.missing, ["package-to-opening binding that matches retained run inputs"]);
}

console.log("thumbnail refresh replay: PASS");
