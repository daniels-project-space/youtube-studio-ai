import assert from "node:assert/strict";

import {
  createRouteQualificationBenchmarkInput,
  prepareRouteQualificationBenchmarkDispatchEnvelope,
  routeQualificationBenchmarkRequestApprovalSubject,
} from "@/lib/routeQualificationBenchmark";
import { dispatchPendingRouteQualificationBenchmarks, routeQualificationBenchmarkDispatchSchedule } from "@/trigger/routeQualificationBenchmarkDispatcher";
import { issueStudioActionApproval, studioActionApprovalFingerprint } from "@/lib/studioActionApproval";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { getFunctionName } from "convex/server";
import { candidateBenchmarkInvocation } from "@/lib/candidateBenchmarkInvocation";
import { freezeChannelInceptionProbeContext } from "@/lib/channelInceptionProbe";

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

assert.throws(() => routeQualificationBenchmarkDispatchSchedule({ ...receipt, candidate: { candidateId: "draft-a", fingerprint: digest("c"), baselineFingerprint: digest("d") } } as never), /worker admission/);

async function candidateDispatchTest() {
  const previous = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = "disposable-dispatch-test-key";
  try {
    const channel = { ownerId: "owner-a", name: "Test channel", slug: "test-channel", family: "music_loop", budget: 10, pipeline: productionPipeline, moduleConfig: {} };
    const baselineFingerprint = channelPipelineWriteFence(channel);
    const content = { version: "duration-draft-candidate/v3", ownerId: "owner-a", channelId: "channel-a", baselineFingerprint, family: "music_loop", requestedSeconds: 180, baselineModuleConfig: {}, moduleConfig: {}, pipeline: productionPipeline, sourceInception: null };
    const candidate = { ...content, _id: "draft-a", status: "untested", fingerprint: sha256Hex(canonicalJson(content)) };
    const target = { candidateId: "draft-a", fingerprint: candidate.fingerprint, baselineFingerprint };
    const subject = routeQualificationBenchmarkRequestApprovalSubject({ ownerId: "owner-a", channelId: "channel-a", runId: "run-a", dispatchKey: receipt.dispatchKey, maximumCostUsd: 80, candidate: target });
    assert.notEqual(subject, routeQualificationBenchmarkRequestApprovalSubject({ ownerId: "owner-a", channelId: "channel-a", runId: "run-a", dispatchKey: receipt.dispatchKey, maximumCostUsd: 80, candidate: { ...target, fingerprint: digest("e") } }));
    const approval = issueStudioActionApproval({ action: "route-qualification-benchmark-request", ownerId: "owner-a", subject, actor: "authenticated-operator:owner-a", evidence: "test", maxCostUsd: 80 });
    const candidateInvocationInput = candidateBenchmarkInvocation({ ownerId: "owner-a", channelId: "channel-a", runId: "run-a", target, channel, candidate, maximumCostUsd: 80 });
    assert.deepEqual(candidateInvocationInput.body.channelSeedIdentity, { name: "Test channel", slug: "test-channel", madeForKids: false });
    const context = freezeChannelInceptionProbeContext({ ownerId: "owner-a", family: "music_loop", channel: channel as never });
    assert.equal(context.seedStore.channelName, candidateInvocationInput.body.channelSeedIdentity?.name);
    assert.equal(context.keyPrefix, `owner/owner-a/channel/${candidateInvocationInput.body.channelSeedIdentity?.slug}/`);
    assert.equal(context.madeForKids, candidateInvocationInput.body.channelSeedIdentity?.madeForKids);
    const legacy = candidateBenchmarkInvocation({ ownerId: "owner-a", channelId: "channel-a", runId: "run-a", target, channel, candidate, maximumCostUsd: 80, version: "candidate-benchmark-invocation-input/v1" });
    assert.equal(legacy.body.version, "candidate-benchmark-invocation-input/v1");
    assert.equal("channelSeedIdentity" in legacy.body, false);
    const pending = { ...receipt, envelope: undefined, candidate: target, candidateInvocationInput, approval, approvalFingerprint: studioActionApprovalFingerprint(approval) };
    const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
    const fake = {
      async query(ref: never) {
        const name = getFunctionName(ref);
        if (name.endsWith(":getPendingForRun")) return pending;
        if (name.endsWith(":getChannel")) return channel;
        if (name.endsWith(":get")) return candidate;
        throw new Error(`Unexpected query ${name}`);
      },
      async mutation(ref: never, args: Record<string, unknown>) { mutations.push({ name: getFunctionName(ref), args }); return {}; },
    };
    const outcome = await dispatchPendingRouteQualificationBenchmarks({ ownerId: "owner-a", convex: fake as never, target: { channelId: "channel-a", runId: "run-a" }, log: () => {} });
    assert.deepEqual(outcome, { pending: 1, triggered: 0 });
    const blocked = mutations.find(item => item.name.endsWith(":recordCandidatePreflightBlocked"));
    assert.ok(blocked, "candidate preflight is retained as blocked");
    const report = blocked.args.report as { binding: { candidateFingerprint: string }; dispatchAuthorized: boolean; receiptIssued: boolean; blockers: string[] };
    assert.equal(report.binding.candidateFingerprint, target.fingerprint);
    assert.equal(report.dispatchAuthorized, false);
    assert.equal(report.receiptIssued, false);
    assert.ok(report.blockers.some(value => /worker release/.test(value)));
    assert.ok(!mutations.some(item => /claimDispatchEnvelope|markQueued/.test(item.name)));
    const altered = { ...pending, candidateInvocationInput: { ...candidateInvocationInput, fingerprint: digest("f") } };
    const withAlteredInput = { ...fake, async query(ref: never) { return getFunctionName(ref).endsWith(":getPendingForRun") ? altered : fake.query(ref); } };
    mutations.length = 0;
    assert.equal((await dispatchPendingRouteQualificationBenchmarks({ ownerId: "owner-a", convex: withAlteredInput as never, target: { channelId: "channel-a", runId: "run-a" }, log: () => {} })).triggered, 0);
    assert.ok(mutations.some(item => /invocation input is unavailable or changed/.test(String(item.args.error))));
    const renamed = { ...fake, async query(ref: never) { return getFunctionName(ref).endsWith(":getChannel") ? { ...channel, name: "Changed" } : fake.query(ref); } };
    mutations.length = 0;
    assert.equal((await dispatchPendingRouteQualificationBenchmarks({ ownerId: "owner-a", convex: renamed as never, target: { channelId: "channel-a", runId: "run-a" }, log: () => {} })).triggered, 0);
    assert.ok(mutations.some(item => /invocation input is unavailable or changed/.test(String(item.args.error))));
    const tampered = { ...pending, candidate: { ...target, fingerprint: digest("e") } };
    const forged = { ...fake, async query(ref: never) { return getFunctionName(ref).endsWith(":getPendingForRun") ? tampered : fake.query(ref); } };
    mutations.length = 0;
    assert.equal((await dispatchPendingRouteQualificationBenchmarks({ ownerId: "owner-a", convex: forged as never, target: { channelId: "channel-a", runId: "run-a" }, log: () => {} })).triggered, 0);
    assert.ok(mutations.some(item => /owner request approval is invalid/.test(String(item.args.error))));
  } finally {
    if (previous === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY; else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = previous;
  }
}

candidateDispatchTest().catch(error => { console.error(error); process.exitCode = 1; });

console.log("Route qualification benchmark dispatcher payload tests passed");
