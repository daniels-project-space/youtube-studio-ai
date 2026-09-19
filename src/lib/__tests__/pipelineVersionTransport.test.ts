import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import schema from "../../../convex/schema";
import { createChannel, updateChannel, updatePipelineIfCurrent } from "../../../convex/channels";
import { comparablePipeline } from "@/engine/channelPipelineComparable";
import { buildChannelProfile, parseFrozenChannelProfile, PipelineEntrySchema } from "@/engine/channelProfile";
import type { PipelineEntry } from "@/engine/types";
import { channelPublishConfiguration } from "@/lib/channelPublishPolicy";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import {
  normalizePipelineInvocationSnapshot,
  pipelineInvocationSnapshotsEqual,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { buildRouteQualificationBenchmarkPipeline } from "@/lib/routeQualificationBenchmark";
import { stableJson } from "@/lib/publishingPolicy";

const legacy: PipelineEntry = { block: "music", params: { provider: "suno" } };
const pinned: PipelineEntry = { ...legacy, version: "2.0.0" };

function frozen(entry: PipelineEntry): PipelineInvocationSnapshot {
  return {
    version: 1, ownerId: "owner-test", runId: "run-test", channelId: "channel-test",
    source: "channel", entries: [entry], seedStore: {}, budgetUsd: 10,
    keyPrefix: "owner/test/", remoteBlocks: [], defaultRetries: 0,
    compilationFingerprint: "a".repeat(64), compilationPolicyId: "test",
    compilationPolicyVersion: "1", compilationModules: [],
    compilationCapabilities: [], reservedMaxCostUsd: 0,
  };
}

function profileAndSnapshots(): void {
  assert.deepEqual(PipelineEntrySchema.parse(legacy), legacy);
  assert.deepEqual(PipelineEntrySchema.parse(pinned), pinned);
  assert.throws(() => PipelineEntrySchema.parse({ ...legacy, version: 2 }));
  const profile = buildChannelProfile({
    row: { _id: "channel-test", name: "Test", slug: "test", status: "paused", template: "C", budget: 10, identity: {} },
    archetype: "lofi-ambient", pipeline: [pinned],
  });
  assert.deepEqual(parseFrozenChannelProfile(JSON.parse(JSON.stringify(profile)))?.pipeline, [pinned]);
  assert.deepEqual(normalizePipelineInvocationSnapshot(frozen(legacy)).entries, [legacy]);
  const snapshot = normalizePipelineInvocationSnapshot(frozen(pinned));
  assert.deepEqual(snapshot.entries, [pinned]);
  assert.deepEqual(normalizePipelineInvocationSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  assert.equal(pipelineInvocationSnapshotsEqual(frozen(legacy), frozen(pinned)), false);
  assert.notEqual(pipelineInvocationSha256(frozen(legacy)), pipelineInvocationSha256(frozen(pinned)));
  assert.notEqual(pipelineInvocationSha256(frozen(pinned)), pipelineInvocationSha256(frozen({ ...pinned, version: "3.0.0" })));
  for (const version of [null, 2, "", "   "]) {
    assert.throws(() => PipelineEntrySchema.parse({ ...legacy, version }));
    assert.throws(() => normalizePipelineInvocationSnapshot(frozen({ ...legacy, version } as unknown as PipelineEntry)), /version/);
  }
  for (const version of [" 1.0.0", "1.0.0 ", "\t1.0.0", "1.0.0\n"]) {
    assert.equal(PipelineEntrySchema.parse({ ...legacy, version }).version, version);
    assert.equal(normalizePipelineInvocationSnapshot(frozen({ ...legacy, version })).entries[0].version, version,
      "transport must never trim an invalid exact selector into an installed version");
  }
}

type ValidatorJson = {
  type: string;
  value?: Record<string, { fieldType: ValidatorJson; optional: boolean }>;
};

function convexValidators(): void {
  const pipelineFields = [
    (schema.tables.channels.validator as unknown as { json: ValidatorJson }).json.value!.pipeline,
    ...[createChannel, updateChannel, updatePipelineIfCurrent].map((mutation) => {
      const definition = mutation as unknown as { exportArgs: () => string };
      return (JSON.parse(definition.exportArgs()) as ValidatorJson).value!.pipeline;
    }),
    (JSON.parse((updatePipelineIfCurrent as unknown as { exportArgs: () => string }).exportArgs()) as ValidatorJson).value!.expectedPipeline,
  ];
  for (const pipeline of pipelineFields) {
    const element = (pipeline.fieldType as unknown as { value: ValidatorJson }).value;
    assert.deepEqual(element.value!.version, { fieldType: { type: "string" }, optional: true });
    assert.deepEqual(element.value!.block, { fieldType: { type: "string" }, optional: false });
  }
}

async function persistenceComparison(): Promise<void> {
  assert.equal(comparablePipeline([legacy]), '[{"block":"music","params":{"provider":"suno"}}]');
  assert.notEqual(comparablePipeline([legacy]), comparablePipeline([pinned]));
  assert.notEqual(comparablePipeline([pinned]), comparablePipeline([{ ...pinned, version: "3.0.0" }]));
  let writes = 0;
  const result = await (updatePipelineIfCurrent as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<{ state: string }>;
  })._handler({
    auth: { getUserIdentity: async () => ({ subject: "trigger-service", role: "service", owner_id: "owner-test" }) },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async () => ({ _id: "channel-test", ownerId: "owner-test", pipeline: [pinned] }),
      patch: async () => { writes++; },
    },
  }, {
    ownerId: "owner-test", channelId: "channel-test", expectedPipeline: [legacy], pipeline: [legacy],
  });
  assert.equal(result.state, "conflict", "a concurrent version pin must invalidate stale pipeline CAS");
  assert.equal(writes, 0);
}

function benchmarkAndPublishing(): void {
  const pipeline = [pinned, { block: "qa_visual", version: "2.0.0" }, { block: "upload_draft" }];
  assert.deepEqual(buildRouteQualificationBenchmarkPipeline(pipeline), pipeline.slice(0, 2));
  assert.deepEqual(pipeline[0], pinned, "benchmark cloning must leave source pins intact");
  const upload = { block: "upload_draft", params: { publishMode: "public" } };
  const oldFingerprint = createHash("sha256").update(stableJson({
    schema: "channel-publish-configuration/v1", externalBlocks: [upload],
  })).digest("hex");
  assert.equal(channelPublishConfiguration([upload]).fingerprint, oldFingerprint);
  assert.notEqual(channelPublishConfiguration([{ ...upload, version: "2.0.0" }]).fingerprint, oldFingerprint);
  assert.notEqual(channelPublishConfiguration([{ ...upload, version: "2.0.0" }]).fingerprint,
    channelPublishConfiguration([{ ...upload, version: "3.0.0" }]).fingerprint);
  assert.throws(() => channelPublishConfiguration([{ ...upload, version: 2 }]), /invalid version/);
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("transport test must not call a provider"); };
  try {
    profileAndSnapshots();
    convexValidators();
    await persistenceComparison();
    benchmarkAndPublishing();
    console.log("PIPELINE VERSION TRANSPORT PASS: profiles, Convex validators, snapshots, CAS, benchmark, publish fingerprints");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
