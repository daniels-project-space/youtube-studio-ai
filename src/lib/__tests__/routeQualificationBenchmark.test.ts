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
  ROUTE_QUALIFICATION_BENCHMARK_VERSION,
  ROUTE_QUALIFICATION_BENCHMARK_INPUT_V2,
  ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3,
} from "@/lib/routeQualificationBenchmark";
import { issueStudioActionApproval, verifyStudioActionApproval } from "@/lib/studioActionApproval";
import { assertRouteQualificationBenchmarkInvocationBinding } from "@/lib/routeQualificationBenchmarkInvocationBinding";
import { assertCandidateBenchmarkExecutionBinding, candidateBenchmarkExecutionFingerprint } from "@/lib/candidateBenchmarkExecutionBinding";
import { normalizePipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

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
  assert.equal(input.version, ROUTE_QUALIFICATION_BENCHMARK_INPUT_V2);
  const subject = routeQualificationBenchmarkApprovalSubject({
    ownerId: "owner_a",
    channelId: "channel_a",
    runId: "run_a",
    benchmarkInput: input,
    maximumCostUsd: 80,
  });
  assert.match(subject, /^route-qualification-benchmark:[a-f0-9]{64}$/);
  const subjectFor = (benchmarkInput: typeof input) => routeQualificationBenchmarkApprovalSubject({ ownerId: "owner_a", channelId: "channel_a", runId: "run_a", benchmarkInput, maximumCostUsd: 80 });
  const previousKey = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = "disposable-benchmark-test-key";
  try {
    const approval = issueStudioActionApproval({ action: "route-qualification-benchmark", ownerId: "owner_a", subject, actor: "authenticated-operator:owner_a", evidence: "test approval", maxCostUsd: 80 });
    const verify = (benchmarkInput: typeof input) => verifyStudioActionApproval(approval, { action: "route-qualification-benchmark", ownerId: "owner_a", subject: subjectFor(benchmarkInput), maximumCostUsd: 80 });
    assert.equal(verify(input), true);
    assert.equal(verify({ ...input, moduleConfigOverride: { qa_visual: { qaProfile: "other" } } }), false);
    assert.equal(verify({ ...input, invocationContext: { ...input.invocationContext, seedStore: { contentLane: { key: "other" } } } }), false);
    assert.equal(verify({ ...input, invocationContext: { ...input.invocationContext, keyPrefix: "different/" } }), false);
    assert.equal(verify({ ...input, invocationContext: { ...input.invocationContext, madeForKids: true } }), false);
    const legacy = { ...input, version: ROUTE_QUALIFICATION_BENCHMARK_VERSION };
    assertRouteQualificationBenchmarkInput(legacy);
    assert.equal(subjectFor(legacy), subjectFor({ ...legacy, moduleConfigOverride: {} }), "existing v1 signatures retain their original subject contract");
    assert.notEqual(subjectFor(legacy), subject);
  } finally {
    if (previousKey === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
    else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = previousKey;
  }
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
      subject,
    } as never,
  });
  assertRouteQualificationBenchmarkDispatchEnvelope(envelope);
  const snapshot = {
    source: "override",
    budgetUsd: 80,
    keyPrefix: input.invocationContext.keyPrefix,
    workerDeployment: { version: "test" },
    budgetAdmission: {
      kind: "route-qualification-benchmark",
      maximumCostUsd: 80,
      receiptFingerprint: envelope.approvalFingerprint,
      subject,
      pipelineOverrideFingerprint: input.benchmarkPipelineFingerprint,
      dispatchEnvelopeFingerprint: envelope.dispatchEnvelopeFingerprint,
      productionPipelineFingerprint: input.productionPipelineFingerprint,
      preflightReceiptFingerprint: input.preflightReceiptFingerprint,
    },
  } as const;
  const binding = {
    ownerId: "owner_a", channelId: "channel_a", runId: "run_a", envelope,
    storedEnvelopeFingerprint: envelope.dispatchEnvelopeFingerprint,
    snapshot: snapshot as never,
  };
  assert.doesNotThrow(() => assertRouteQualificationBenchmarkInvocationBinding(binding));
  for (const changed of [
    { ...snapshot, budgetUsd: 81 },
    { ...snapshot, source: "channel" },
    { ...snapshot, keyPrefix: "other/" },
    { ...snapshot, workerDeployment: undefined },
    { ...snapshot, budgetAdmission: { ...snapshot.budgetAdmission, subject: "forged" } },
    { ...snapshot, budgetAdmission: { ...snapshot.budgetAdmission, preflightReceiptFingerprint: digest("b") } },
  ]) {
    expectRejected(() => assertRouteQualificationBenchmarkInvocationBinding({ ...binding, snapshot: changed as never }), /not bound/);
  }
  expectRejected(() => assertRouteQualificationBenchmarkInvocationBinding({ ...binding, ownerId: "other" }), /identity mismatch/);
  expectRejected(() => assertRouteQualificationBenchmarkInvocationBinding({ ...binding, storedEnvelopeFingerprint: digest("b") }), /identity mismatch/);
  expectRejected(() => assertRouteQualificationBenchmarkInvocationBinding({ ...binding, envelope: undefined }), /no durable envelope/);
  const legacyInput = { ...input, version: ROUTE_QUALIFICATION_BENCHMARK_VERSION };
  const legacyEnvelope = prepareRouteQualificationBenchmarkDispatchEnvelope({
    ownerId: "owner_a", channelId: "channel_a", runId: "run_a",
    dispatchKey: "route-qualification-benchmark:legacy", input: legacyInput,
    maximumCostUsd: 80, approval: { action: "route-qualification-benchmark", maxCostUsd: 80 } as never,
  });
  assert.doesNotThrow(() => assertRouteQualificationBenchmarkInvocationBinding({
    ...binding, envelope: legacyEnvelope, storedEnvelopeFingerprint: legacyEnvelope.dispatchEnvelopeFingerprint,
    snapshot: {} as never,
  }), "legacy envelopes retain their existing replay behavior");

  const frozenBody = { version: "candidate-benchmark-invocation-input/v2", ownerId: "owner_a", channelId: "channel_a", runId: "run_a", candidate: { candidateId: "candidate_a", fingerprint: digest("c"), baselineFingerprint: digest("d") }, maximumCostUsd: 80, productionPipeline: input.productionPipeline, benchmarkPipeline: input.benchmarkPipeline, moduleConfigOverride: input.moduleConfigOverride };
  const frozenInput = { body: frozenBody, fingerprint: sha256Hex(canonicalJson(frozenBody)) };
  const compiledSnapshot = normalizePipelineInvocationSnapshot({
    version: 1, ownerId: "owner_a", channelId: "channel_a", runId: "run_a", source: "override",
    entries: input.benchmarkPipeline, seedStore: { topic: "approved", enriched: { value: 1 } },
    budgetUsd: 80, keyPrefix: input.invocationContext.keyPrefix, remoteBlocks: [], defaultRetries: 2,
    compilationFingerprint: digest("e"), compilationPolicyId: "fixture", compilationPolicyVersion: "1",
    compilationModules: [], compilationCapabilities: [], reservedMaxCostUsd: 0,
    workerDeployment: { version: "fixture-v1", projectId: "fixture-project", environmentId: "fixture-environment" },
  });
  const candidateInput = { ...input, version: ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3, candidateExecutionBinding: { candidateId: "candidate_a", candidateFingerprint: digest("c"), baselineFingerprint: digest("d"), invocationInputFingerprint: frozenInput.fingerprint, executionFingerprint: candidateBenchmarkExecutionFingerprint(compiledSnapshot) } };
  assertRouteQualificationBenchmarkInput(candidateInput);
  assert.doesNotThrow(() => assertCandidateBenchmarkExecutionBinding({ benchmark: candidateInput, frozenInput, candidateTarget: frozenBody.candidate, snapshot: compiledSnapshot }));
  for (const changed of [
    { ...compiledSnapshot, seedStore: { ...compiledSnapshot.seedStore, enriched: { value: 2 } } },
    { ...compiledSnapshot, entries: [...compiledSnapshot.entries, { block: "other" }] },
    { ...compiledSnapshot, compilationFingerprint: digest("f") },
    { ...compiledSnapshot, workerDeployment: { ...compiledSnapshot.workerDeployment!, version: "other" } },
  ]) expectRejected(() => assertCandidateBenchmarkExecutionBinding({ benchmark: candidateInput, frozenInput, candidateTarget: frozenBody.candidate, snapshot: changed }), /compiled execution or final seeds/);
  expectRejected(() => assertCandidateBenchmarkExecutionBinding({ benchmark: candidateInput, frozenInput: { ...frozenInput, fingerprint: digest("f") }, candidateTarget: frozenBody.candidate, snapshot: compiledSnapshot }), /compiled execution or final seeds/);
  expectRejected(() => assertCandidateBenchmarkExecutionBinding({ benchmark: candidateInput, frozenInput, candidateTarget: { ...frozenBody.candidate, candidateId: "other" }, snapshot: compiledSnapshot }), /compiled execution or final seeds/);
  expectRejected(() => assertRouteQualificationBenchmarkInput({ ...candidateInput, candidateExecutionBinding: { ...candidateInput.candidateExecutionBinding, unexpected: true } }), /binding is invalid/);
  const v3Subject = subjectFor(candidateInput);
  assert.notEqual(v3Subject, subjectFor({ ...candidateInput, candidateExecutionBinding: { ...candidateInput.candidateExecutionBinding, executionFingerprint: digest("f") } }));
  process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = "disposable-benchmark-test-key";
  try {
    const signed = issueStudioActionApproval({ action: "route-qualification-benchmark", ownerId: "owner_a", subject: v3Subject, actor: "authenticated-operator:owner_a", evidence: "test v3", maxCostUsd: 80 });
    assert.equal(verifyStudioActionApproval(signed, { action: "route-qualification-benchmark", ownerId: "owner_a", subject: v3Subject, maximumCostUsd: 80 }), true);
    assert.equal(verifyStudioActionApproval(signed, { action: "route-qualification-benchmark", ownerId: "owner_a", subject: subjectFor({ ...candidateInput, candidateExecutionBinding: { ...candidateInput.candidateExecutionBinding, executionFingerprint: digest("f") } }), maximumCostUsd: 80 }), false);
    const sealed = prepareRouteQualificationBenchmarkDispatchEnvelope({ ownerId: "owner_a", channelId: "channel_a", runId: "run_a", dispatchKey: "route-qualification-benchmark:candidate", input: candidateInput, maximumCostUsd: 80, approval: signed });
    const admitted = normalizePipelineInvocationSnapshot({ ...compiledSnapshot, budgetAdmission: { kind: "route-qualification-benchmark", maximumCostUsd: 80, receiptFingerprint: sealed.approvalFingerprint, subject: v3Subject, pipelineOverrideFingerprint: candidateInput.benchmarkPipelineFingerprint, dispatchEnvelopeFingerprint: sealed.dispatchEnvelopeFingerprint, productionPipelineFingerprint: candidateInput.productionPipelineFingerprint, preflightReceiptFingerprint: candidateInput.preflightReceiptFingerprint } });
    const stored = { ownerId: "owner_a", channelId: "channel_a", runId: "run_a", envelope: sealed, storedEnvelopeFingerprint: sealed.dispatchEnvelopeFingerprint, candidateInvocationInput: frozenInput, candidateTarget: frozenBody.candidate, snapshot: admitted };
    assert.doesNotThrow(() => assertRouteQualificationBenchmarkInvocationBinding(stored));
    expectRejected(() => assertRouteQualificationBenchmarkInvocationBinding({ ...stored, snapshot: { ...admitted, seedStore: { ...admitted.seedStore, enriched: { value: 3 } } } }), /compiled execution or final seeds/);
  } finally {
    if (previousKey === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY; else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = previousKey;
  }
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
