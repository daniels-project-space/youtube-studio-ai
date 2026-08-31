import assert from "node:assert/strict";

import {
  createRouteQualificationBenchmarkInput,
  prepareRouteQualificationBenchmarkDispatchEnvelope,
} from "@/lib/routeQualificationBenchmark";
import { routeQualificationBenchmarkDispatchSchedule } from "@/trigger/routeQualificationBenchmarkDispatcher";

const digest = (seed: string): string =>
  seed.padEnd(64, seed.slice(-1) || "a").slice(0, 64);

const productionPipeline = [
  { block: "topic_select", params: { targetSeconds: 420 } },
  { block: "script_gen", params: { maxSeconds: 420 } },
  { block: "timeline_assemble" },
  { block: "qa_visual", params: { qaProfile: "production" } },
  { block: "upload_draft" },
  { block: "notify" },
  { block: "emit_bundle" },
];

const benchmark = createRouteQualificationBenchmarkInput({
  productionPipeline,
  moduleConfigOverride: { qa_visual: { qaProfile: "production" } },
  invocationContext: {
    keyPrefix: "owner/owner-a/channel/channel-a/",
    seedStore: { contentLane: { key: "cinematic_ai" } },
    madeForKids: false,
  },
  preflightReceiptFingerprint: digest("a"),
});

const envelope = prepareRouteQualificationBenchmarkDispatchEnvelope({
  ownerId: "owner-a",
  channelId: "channel-a",
  runId: "run-a",
  dispatchKey: "route-qualification-benchmark:request-a",
  input: benchmark,
  maximumCostUsd: 80,
  approval: { action: "route-qualification-benchmark", maxCostUsd: 80 } as never,
});

const receipt = {
  ownerId: "owner-a",
  channelId: "channel-a",
  runId: "run-a",
  dispatchKey: "route-qualification-benchmark:request-a",
  approval: { action: "route-qualification-benchmark-request" } as never,
  approvalFingerprint: digest("b"),
  maximumCostUsd: 80,
  attempt: 0,
  envelope,
};

const first = routeQualificationBenchmarkDispatchSchedule(receipt as never);
assert.deepEqual(
  Object.keys(first.payload).sort(),
  [
    "channelId",
    "moduleConfigOverride",
    "pipelineOverride",
    "routeQualificationBenchmark",
    "routeQualificationBenchmarkAdmission",
    "runId",
  ],
  "the task receives only identity plus the sealed benchmark execution envelope",
);
assert.equal(first.payload.channelId, "channel-a");
assert.equal(first.payload.runId, "run-a");
assert.deepEqual(first.payload.pipelineOverride, benchmark.benchmarkPipeline);
assert.deepEqual(first.payload.moduleConfigOverride, benchmark.moduleConfigOverride);
assert.deepEqual(first.payload.routeQualificationBenchmark, benchmark);
assert.equal(
  first.payload.routeQualificationBenchmarkAdmission.dispatchEnvelopeFingerprint,
  envelope.dispatchEnvelopeFingerprint,
);
assert.deepEqual(
  first.payload.pipelineOverride.map((entry) => entry.block),
  ["topic_select", "script_gen", "timeline_assemble", "qa_visual"],
  "a private qualification benchmark cannot carry upload, notification, bundle, or publish work",
);
assert.equal(first.concurrencyKey, "channel-a");
assert.equal(
  first.idempotencySeed,
  `route-qualification-benchmark:${envelope.dispatchEnvelopeFingerprint}:delivery:1`,
);
assert.equal(
  routeQualificationBenchmarkDispatchSchedule(receipt as never).idempotencySeed,
  first.idempotencySeed,
  "the same persisted pending receipt never creates another first Trigger delivery",
);
assert.equal(
  routeQualificationBenchmarkDispatchSchedule(receipt as never, { deliveryAttempt: 2 }).idempotencySeed,
  `route-qualification-benchmark:${envelope.dispatchEnvelopeFingerprint}:delivery:2`,
  "only a bounded recovery changes the Trigger delivery identity",
);
assert.throws(
  () => routeQualificationBenchmarkDispatchSchedule({
    ...receipt,
    envelope: { ...envelope, runId: "run-b" },
  } as never),
  /fingerprint/i,
  "a tampered durable envelope cannot become a run-pipeline task",
);

console.log("Route qualification benchmark dispatcher payload tests passed");
