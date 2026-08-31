import assert from "node:assert/strict";

import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import {
  frozenRunPipelinePresentation,
} from "@/lib/runPipelinePresentation";
import type { PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";

const snapshot: PipelineInvocationSnapshot = {
  version: 1,
  ownerId: "owner-a",
  runId: "run-a",
  channelId: "channel-a",
  source: "override",
  entries: [
    { block: "topic_select", params: { model: "sealed-model" } },
    { block: "script_gen", params: { tone: "reserved" } },
    { block: "qa_visual" },
  ],
  seedStore: {
    privatePrompt: "This must never ship to the browser progress view.",
  },
  budgetUsd: 18,
  keyPrefix: "owner/owner-a/private-run/",
  remoteBlocks: [],
  defaultRetries: 1,
  compilationFingerprint: "a".repeat(64),
  compilationPolicyId: "production-contract",
  compilationPolicyVersion: "1",
  compilationModules: [],
  compilationCapabilities: [],
  reservedMaxCostUsd: 18,
};

const presentation = frozenRunPipelinePresentation({
  snapshot,
  sha256: pipelineInvocationSha256(snapshot),
});

assert.deepEqual(presentation, {
  source: "override",
  entries: [
    { block: "topic_select" },
    { block: "script_gen" },
    { block: "qa_visual" },
  ],
});
assert.doesNotMatch(JSON.stringify(presentation), /privatePrompt|sealed-model|reserved|owner\/owner-a/);
assert.equal(
  frozenRunPipelinePresentation({ snapshot, sha256: "b".repeat(64) }),
  undefined,
  "a mismatched snapshot hash must never become an apparently frozen browser plan",
);
assert.equal(frozenRunPipelinePresentation({ snapshot }), undefined);
assert.equal(frozenRunPipelinePresentation({ snapshot: { entries: [] }, sha256: "a".repeat(64) }), undefined);

console.log("frozen run pipeline presentation tests passed");
