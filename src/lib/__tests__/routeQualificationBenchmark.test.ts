import assert from "node:assert/strict";

import {
  assertRouteQualificationBenchmarkAdmission,
  assertRouteQualificationBenchmarkDispatchEnvelope,
  assertRouteQualificationBenchmarkInput,
  buildRouteQualificationBenchmarkPipeline,
  createRouteQualificationBenchmarkInput,
  prepareRouteQualificationBenchmarkDispatchEnvelope,
  routeQualificationBenchmarkApprovalSubject,
  routeQualificationBenchmarkRequestApprovalSubject,
} from "@/lib/routeQualificationBenchmark";

const digest = (seed: string): string =>
  seed.padEnd(64, seed.slice(-1) || "a").slice(0, 64);

function expectRejected(fn: () => void, pattern: RegExp): void {
  assert.throws(fn, pattern);
}

function main(): void {
  const productionPipeline = [
    { block: "topic_select", params: { targetSeconds: 420 } },
    { block: "script_gen", params: { maxSeconds: 420 } },
    { block: "timeline_assemble" },
    { block: "qa_visual", params: { qaProfile: "production" } },
    { block: "upload_draft" },
    { block: "notify" },
    { block: "emit_bundle" },
  ];
  const benchmarkPipeline = buildRouteQualificationBenchmarkPipeline(productionPipeline);
  assert.deepEqual(
    benchmarkPipeline.map((entry) => entry.block),
    ["topic_select", "script_gen", "timeline_assemble", "qa_visual"],
    "a benchmark retains the exact creative/master/QA chain and removes delivery only",
  );

  const input = createRouteQualificationBenchmarkInput({
    productionPipeline,
    moduleConfigOverride: { qa_visual: { qaProfile: "production" } },
    invocationContext: {
      keyPrefix: "owner/a/channel/b/",
      seedStore: { contentLane: { key: "cinematic_ai" } },
      madeForKids: false,
    },
    preflightReceiptFingerprint: digest("a"),
  });
  assertRouteQualificationBenchmarkInput(input);
  const subject = routeQualificationBenchmarkApprovalSubject({
    ownerId: "owner_a",
    channelId: "channel_a",
    runId: "run_a",
    benchmarkInput: input,
    maximumCostUsd: 80,
  });
  assert.match(subject, /^route-qualification-benchmark:[a-f0-9]{64}$/);
  assert.match(
    routeQualificationBenchmarkRequestApprovalSubject({
      ownerId: "owner_a",
      channelId: "channel_a",
      runId: "run_a",
      dispatchKey: "route-qualification-benchmark:request_a",
      maximumCostUsd: 80,
    }),
    /^route-qualification-benchmark-request:[a-f0-9]{64}$/,
    "owner confirmation is bound to the durable shell before a full pipeline is derived",
  );

  const envelope = prepareRouteQualificationBenchmarkDispatchEnvelope({
    ownerId: "owner_a",
    channelId: "channel_a",
    runId: "run_a",
    dispatchKey: "route-qualification-benchmark:request_a",
    input,
    maximumCostUsd: 80,
    approval: {
      action: "route-qualification-benchmark",
      maxCostUsd: 80,
    } as never,
  });
  assertRouteQualificationBenchmarkDispatchEnvelope(envelope);
  expectRejected(() => assertRouteQualificationBenchmarkDispatchEnvelope({
    ...envelope,
    runId: "run_b",
  }), /fingerprint/i);

  expectRejected(() => assertRouteQualificationBenchmarkInput({
    ...input,
    benchmarkPipeline: input.benchmarkPipeline.map((entry) =>
      entry.block === "script_gen" ? { ...entry, params: { maxSeconds: 60 } } : entry,
    ),
  }), /exact production pipeline/i);

  expectRejected(() => assertRouteQualificationBenchmarkInput({
    ...input,
    benchmarkPipeline: [...input.benchmarkPipeline, { block: "upload_draft" }],
  }), /exact production pipeline/i);

  expectRejected(() => assertRouteQualificationBenchmarkAdmission({
    benchmark: input,
    maximumCostUsd: 80,
    approval: { action: "channel-inception-probe" },
  }), /admission is invalid/i);

  console.log("ROUTE QUALIFICATION BENCHMARK TESTS PASS");
}

main();
