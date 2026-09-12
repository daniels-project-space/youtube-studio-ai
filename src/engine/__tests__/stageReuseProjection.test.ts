import assert from "node:assert/strict";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { registerManifest } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import { stageInvocationHash } from "@/engine/stageReuse";
import { StageReuseReceiptSchema } from "@/engine/stageReuseContract";
import type { BlockPatch, RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";
import {
  assertFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificateReference,
  finalMasterReleaseCertificateKey,
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  visualReviewReleaseReceiptKey,
  VISUAL_REVIEW_RELEASE_RECEIPT_VERSION,
} from "@/lib/finalMasterReleaseCertificate";
import { persistQaVisualStageOutputs } from "@/trigger/blocks/narratedBlocks";

// Real runner, projection, certificate contracts, and artifact lineage. The
// persistence/rehydration boundary and media evidence below are controlled
// fixtures: this test performs no provider, upload, media encode, or native QA.
const scope = {
  ownerId: "projection-owner", channelId: "projection-channel",
  keyPrefix: "owners/projection-owner/channels/projection-channel/", runId: "projection-run",
};
const runPrefix = scope.keyPrefix + "runs/" + scope.runId + "/";
const frameKey = runPrefix + "visual-review/frames/f1.jpg";
const releaseFingerprint = "c".repeat(64);
const certificate = createFinalMasterReleaseCertificate({
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: runPrefix + "master.mp4", sha256: "a".repeat(64), byteLength: 4096, durationSec: 2,
  },
  visualReview: {
    evidenceManifestKey: runPrefix + "visual-review/manifest.json",
    evidenceFrameKeys: [frameKey],
    evidenceFrameArtifacts: [{
      id: "frame-1", tSec: 1, r2Key: frameKey, contentSha256: "d".repeat(64), byteLength: 256,
    }],
    receiptKey: visualReviewReleaseReceiptKey(scope.keyPrefix, scope.runId, releaseFingerprint),
    reviewFingerprint: "controlled-schema-fixture-not-native-qa",
    reviewReceiptVersion: VISUAL_REVIEW_RELEASE_RECEIPT_VERSION,
    reviewReceiptFingerprint: "b".repeat(64),
    releaseReceiptFingerprint: releaseFingerprint,
  },
});
const certificateKey = finalMasterReleaseCertificateKey(
  scope.keyPrefix, scope.runId, certificate.certificateFingerprint,
);
const reference = createFinalMasterReleaseCertificateReference({
  ...scope, certificateKey, certificate,
});
const fullPatch = {
  finalMasterReleaseCertificateKey: certificateKey,
  finalMasterReleaseCertificateReference: reference,
  finalMasterReleaseCertificate: certificate,
};
const key = "finalMasterReleaseCertificate";
type StageRow = Parameters<RunStageSink["upsert"]>[0];
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let sequence = 0;

function scenario(durableAware = true) {
  const id = ++sequence;
  const rows = new Map<string, StageRow>();
  const artifactWrites: NonNullable<Parameters<NonNullable<RunStageSink["upsertArtifacts"]>>[0]>[] = [];
  const calls = { producer: 0, consumer: 0, durableLoads: 0 };
  const producer = manifestFromBlock({
    id: "qa_projection_producer_" + id,
    consumes: [], produces: ["finalMasterReleaseCertificateKey", "finalMasterReleaseCertificateReference"],
    persistStageOutputs: persistQaVisualStageOutputs,
    run: async () => { calls.producer++; return structuredClone(fullPatch); },
  }, { optionalProduces: [key], capabilities: ["test.projection"], certification: "contract" });
  const consumer = manifestFromBlock({
    id: "qa_projection_consumer_" + id,
    consumes: ["finalMasterReleaseCertificateKey", "finalMasterReleaseCertificateReference"],
    produces: ["projectionResult"],
    run: async (ctx) => {
      calls.consumer++;
      // Synthetic durable consumer, intentionally exercising the same required
      // key + optional-inline contract as upload/cleanup. No publishing occurs.
      assert.equal(ctx.store.finalMasterReleaseCertificateKey, certificateKey);
      let candidate = ctx.store.finalMasterReleaseCertificate;
      if (candidate === undefined) { calls.durableLoads++; candidate = jsonCopy(certificate); }
      const checked = assertFinalMasterReleaseCertificate(candidate);
      assert.deepEqual(createFinalMasterReleaseCertificateReference({
        ...scope, certificateKey, certificate: checked,
      }), ctx.store.finalMasterReleaseCertificateReference);
      return { projectionResult: checked.certificateFingerprint };
    },
  }, {
    optionalConsumes: [key],
    ...(durableAware ? { deferredConsumes: [key] } : {}),
    capabilities: ["test.projection_consumer"],
    certification: "contract",
  });
  registerManifest(producer);
  registerManifest(consumer);
  const pipeline = validatePipeline([{ block: producer.id }, { block: consumer.id }]);
  const sink: RunStageSink = {
    upsert: async (update) => {
      rows.set(update.block, jsonCopy({ ...rows.get(update.block), ...update }));
    },
    getResumeState: async () => jsonCopy([...rows.values()]),
    upsertArtifacts: async (write) => { artifactWrites.push(jsonCopy(write)); },
  };
  const run = () => runPipeline(pipeline, {
    ...scope, sink, budgetUsd: 0, defaultRetries: 0,
    rehydrate: async (_block, outputs) => ({ ok: true, outputs }),
  });
  return { rows, artifactWrites, calls, producer, consumer, run };
}

async function main() {
  const same = scenario();
  const first = await same.run();
  assert.equal(first.ok, true, first.error);
  const producerRow = same.rows.get(same.producer.id)!;
  assert(!Object.hasOwn(producerRow.outputs as object, key), "actual QA stage projection omits the full certificate");
  assert.deepEqual((producerRow.outputs as BlockPatch).finalMasterReleaseCertificateReference, reference);
  const producerReceipt = StageReuseReceiptSchema.parse(producerRow.reuseReceipt);
  const fullRef = producerReceipt.outputRefs.find((ref) => ref.key === key)!;
  assert(fullRef, "the runner retains the real produced full-certificate artifact reference");
  assert(same.artifactWrites.some((write) => write.artifacts.some(({ artifact }) =>
    artifact.artifactId === fullRef.artifactId && artifact.key === key)));
  assert.deepEqual(first.store.finalMasterReleaseCertificate, certificate);
  const second = await same.run();
  assert.equal(second.ok, true, second.error);
  assert.equal(second.store.projectionResult, first.store.projectionResult);
  assert.deepEqual(same.calls, { producer: 1, consumer: 1, durableLoads: 0 });
  assert.deepEqual(same.rows.get(same.producer.id)!.outputs, producerRow.outputs);
  console.log("PASS actual QA projection: completed downstream resumes from the same produced artifact without rerunning either block");

  const unfinished = scenario();
  const original = await unfinished.run();
  assert.equal(original.ok, true, original.error);
  unfinished.rows.delete(unfinished.consumer.id);
  const resumed = await unfinished.run();
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(resumed.store.projectionResult, original.store.projectionResult);
  assert.deepEqual(unfinished.calls, { producer: 1, consumer: 2, durableLoads: 1 });
  console.log("PASS unfinished durable-aware downstream loads the exact projected certificate and preserves its output");

  const unaware = scenario(false);
  const unawareFirst = await unaware.run();
  assert.equal(unawareFirst.ok, true, unawareFirst.error);
  const unawareCached = await unaware.run();
  assert.equal(unawareCached.ok, true, unawareCached.error);
  assert.deepEqual(unaware.calls, { producer: 1, consumer: 1, durableLoads: 0 });
  unaware.rows.delete(unaware.consumer.id);
  const refused = await unaware.run();
  assert.equal(refused.ok, false);
  assert.equal(refused.failedBlock, unaware.consumer.id);
  assert.match(refused.error!, /STAGE_REUSE_RECONCILIATION_REQUIRED.*cannot execute with deferred input/);
  assert.deepEqual(unaware.calls, { producer: 1, consumer: 1, durableLoads: 0 },
    "missing durable-loader declaration must stop before executing the new consumer");
  console.log("PASS non-aware consumer can reuse completed output but cannot execute with a silently absent optional input");

  const invocation = {
    ...scope, manifest: same.consumer, params: {},
    store: fullPatch,
    inputRefs: Object.fromEntries(producerReceipt.outputRefs.map((ref) => [ref.key, ref])),
    inputIdentities: Object.fromEntries(producerReceipt.outputIdentities.map((identity) => [identity.key, identity])),
  };
  const fullHash = stageInvocationHash(invocation);
  assert.equal(stageInvocationHash({
    ...invocation, store: persistQaVisualStageOutputs(fullPatch),
  }), fullHash, "only the sealed producer omission preserves the full input identity");
  const tampered = structuredClone(fullPatch);
  tampered.finalMasterReleaseCertificate.visualReview.evidenceFrameArtifacts![0]!.byteLength++;
  assert.equal(tampered.finalMasterReleaseCertificate.certificateFingerprint, certificate.certificateFingerprint);
  assert.throws(() => stageInvocationHash({ ...invocation, store: tampered }), /changed from its accepted producer output/);
  console.log("PASS present inline bytes/fields cannot change behind the same artifact reference or certificate fingerprint");

  const changedReference = structuredClone(fullPatch);
  changedReference.finalMasterReleaseCertificateReference.finalMaster.sha256 = "f".repeat(64);
  assert.throws(() => stageInvocationHash({ ...invocation, store: changedReference }), /changed from its accepted producer output/);
  console.log("PASS a changed compact reference also rejects unchanged identity strings");

  const mutationRows = new Map<string, StageRow>();
  let mutationCalls = 0;
  const mutationProducer = manifestFromBlock({
    id: "projection_mutation_producer", consumes: [], produces: ["immutableInput"],
    run: async () => ({ immutableInput: { value: 1 } }),
  }, { capabilities: ["test.mutation_producer"] });
  const mutatingConsumer = manifestFromBlock({
    id: "projection_mutating_consumer", consumes: ["immutableInput"], produces: ["mutationResult"],
    run: async (ctx) => {
      mutationCalls++;
      (ctx.store.immutableInput as { value: number }).value++;
      return { mutationResult: true };
    },
  }, { capabilities: ["test.mutation_consumer"] });
  registerManifest(mutationProducer);
  registerManifest(mutatingConsumer);
  const mutationPipeline = validatePipeline([{ block: mutationProducer.id }, { block: mutatingConsumer.id }]);
  const mutationSink: RunStageSink = {
    upsert: async (update) => { mutationRows.set(update.block, jsonCopy({ ...mutationRows.get(update.block), ...update })); },
    getResumeState: async () => jsonCopy([...mutationRows.values()]),
  };
  const mutationRun = () => runPipeline(mutationPipeline, {
    ...scope, budgetUsd: 0, defaultRetries: 0, sink: mutationSink,
    rehydrate: async (_block, outputs) => ({ ok: true, outputs }),
  });
  const mutationFirst = await mutationRun();
  assert.equal(mutationFirst.ok, false);
  assert.match(mutationFirst.error!, /STAGE_REUSE_RECONCILIATION_REQUIRED/);
  assert(!Object.hasOwn(mutationFirst.store, "mutationResult"), "mutated invocation output is never accepted");
  const mutationSecond = await mutationRun();
  assert.equal(mutationSecond.ok, false);
  assert.match(mutationSecond.error!, /STAGE_REUSE_RECONCILIATION_REQUIRED.*previous cache identity failure/);
  assert.equal(mutationCalls, 1, "the marker must stop a retry from repeating the side effect");
  assert.deepEqual(mutationRows.get(mutationProducer.id)!.outputs, { immutableInput: { value: 1 } });
  console.log("PASS produced-input nested mutation is terminal across a second actual runner invocation; original source retained");
  console.log("stageReuseProjection: 6 cases passed; controlled persistence only, no native media QA.");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
