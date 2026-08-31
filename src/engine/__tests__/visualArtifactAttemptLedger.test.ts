import assert from "node:assert/strict";

import { artifactContract } from "@/engine/artifactSchemas";
import { _clear, register } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import type { Block, RunStageSink } from "@/engine/types";
import {
  VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION,
  type VisualArtifactReviewRejection,
} from "@/engine/visualArtifactReviewOutcome";
import {
  assertVisualArtifactAttempt,
  assertVisualArtifactAttemptLedger,
  createVisualArtifactAttempt,
  createVisualArtifactAttemptLedger,
  visualArtifactReviewRejectionFingerprint,
} from "@/engine/visualArtifactAttemptLedger";
import { validatePipeline } from "@/engine/validate";

const scopeFingerprint = "a".repeat(64);
const candidateSha256 = "b".repeat(64);
const rejection: VisualArtifactReviewRejection = {
  schemaVersion: VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION,
  gateId: "independent-motion-gate",
  artifactKind: "video",
  subjectId: "shot-17",
  reviewVersion: "independent-motion-review/v1",
  notes: ["The candidate freezes before the planned reveal."],
};

function rejectedAttempt() {
  return createVisualArtifactAttempt({
    adapterId: "casefile_cinematic",
    scopeFingerprint,
    attemptId: "shot-17-keyframe-1",
    ordinal: 1,
    artifact: {
      kind: "video",
      subjectId: "shot-17",
      candidate: {
        id: "candidate-shot-17-keyframe-1",
        r2Key: "owners/test/runs/run-1/candidates/shot-17-v1.mp4",
        sha256: candidateSha256,
        byteLength: 1_024,
        captureScope: "local_review_input",
        objectDurability: "not_reverified",
      },
    },
    review: {
      verdict: "rejected",
      gateId: rejection.gateId,
      reviewVersion: rejection.reviewVersion,
      notes: rejection.notes,
      rejection,
    },
    repair: { kind: "initial" },
  });
}

function acceptedReplacement(parent = rejectedAttempt()) {
  return createVisualArtifactAttempt({
    adapterId: "casefile_cinematic",
    scopeFingerprint,
    attemptId: "shot-17-keyframe-2",
    ordinal: 2,
    artifact: {
      kind: "video",
      subjectId: "shot-17",
      candidate: {
        id: "candidate-shot-17-keyframe-2",
        r2Key: "owners/test/runs/run-1/candidates/shot-17-v2.mp4",
      },
    },
    review: {
      verdict: "accepted",
      gateId: rejection.gateId,
      reviewVersion: rejection.reviewVersion,
      notes: ["Motion and reveal are coherent through the full clip."],
    },
    repair: {
      kind: "replacement",
      parentAttemptFingerprint: parent.attemptFingerprint,
      parentRejectionFingerprint: visualArtifactReviewRejectionFingerprint(rejection),
    },
  });
}

function ledgerSchemaAndLineage(): void {
  const initial = rejectedAttempt();
  const replacement = acceptedReplacement(initial);
  const ledger = createVisualArtifactAttemptLedger({
    scopeFingerprint,
    attempts: [initial, replacement],
  });
  assert.equal(ledger.attempts.length, 2);
  assert.equal(ledger.attempts[1]?.repair.kind, "replacement");

  const contract = artifactContract("visualArtifactAttempt");
  assert.equal(contract.opaque, false, "attempt checkpoints use a typed contract");
  assert.equal(contract.persist, "reference", "attempt checkpoints retain their exact payload");

  assert.throws(
    () => assertVisualArtifactAttempt({
      ...initial,
      artifact: {
        ...initial.artifact,
        candidate: { ...initial.artifact.candidate, sha256: "c".repeat(64) },
      },
    }),
    /fingerprint/,
    "changing candidate bytes invalidates the sealed attempt",
  );
  assert.throws(
    () => assertVisualArtifactAttemptLedger({
      ...ledger,
      attempts: [replacement, initial],
    }),
    /parent must be an earlier attempt|ordinals/,
    "a replacement cannot cite a future or missing rejected parent",
  );
}

const base = {
  ownerId: "attempt-ledger-owner",
  runId: "attempt-ledger-run",
  channelId: "attempt-ledger-channel",
  keyPrefix: "owners/attempt-ledger/channels/test/",
  budgetUsd: 10,
  log: () => {},
};

async function checkpointSurvivesStageFailure(): Promise<void> {
  const attempt = rejectedAttempt();
  const artifactBatches: Array<Parameters<NonNullable<RunStageSink["upsertArtifacts"]>>[0]> = [];
  const stages: Array<{ status: string; error?: string }> = [];
  const block: Block = {
    id: "visual_attempt_checkpoint_stage_failure",
    consumes: [],
    produces: ["result"],
    paid: true,
    run: async (ctx) => {
      assert.ok(ctx.checkpointVisualArtifactAttempts, "runner supplies the audit-only checkpoint hook");
      const refs = await ctx.checkpointVisualArtifactAttempts([attempt]);
      assert.equal(refs.length, 1, "checkpoint returns its durable artifact reference");
      throw new Error("forced failure after visual artifact review checkpoint");
    },
  };
  _clear();
  register(block);
  const sink: RunStageSink = {
    async upsert(args) {
      stages.push({ status: args.status, error: args.error });
    },
    async upsertArtifacts(args) {
      artifactBatches.push(args);
    },
  };
  const result = await runPipeline(validatePipeline([{ block: block.id }]), {
    ...base,
    sink,
  });
  assert.equal(result.ok, false, "the deliberate post-checkpoint stage failure remains a failure");
  assert.equal(artifactBatches.length, 1, "attempt is persisted before the stage fails");
  assert.equal(artifactBatches[0]?.artifacts.length, 1);
  assert.equal(artifactBatches[0]?.artifacts[0]?.artifact.key, "visualArtifactAttempt");
  assert.deepEqual(artifactBatches[0]?.artifacts[0]?.payload, attempt);
  assert.ok(
    stages.some((stage) => stage.status === "failed"),
    "the normal failed-stage status is still persisted separately",
  );
}

async function checkpointFailureStopsNextOperation(): Promise<void> {
  let replacementCalls = 0;
  const block: Block = {
    id: "visual_attempt_checkpoint_sink_failure",
    consumes: [],
    produces: ["result"],
    run: async (ctx) => {
      assert.ok(ctx.checkpointVisualArtifactAttempts, "runner supplies the audit-only checkpoint hook");
      await ctx.checkpointVisualArtifactAttempts([rejectedAttempt()]);
      // This stands in for a future replacement render. No provider is called
      // in this test; the checkpoint write must fail before this line runs.
      replacementCalls += 1;
      return { result: "would-render-a-replacement" };
    },
  };
  _clear();
  register(block);
  const result = await runPipeline(validatePipeline([{ block: block.id }]), {
    ...base,
    runId: "attempt-ledger-missing-sink",
    sink: { async upsert() {} },
  });
  assert.equal(result.ok, false, "a missing artifact sink fails the checkpoint closed");
  assert.equal(replacementCalls, 0, "no next operation runs after an undurable checkpoint");
  assert.match(result.error ?? "", /requires a durable artifact sink/);
}

async function checkpointDoesNotAlterPaidReconciliation(): Promise<void> {
  let paidBlockCalls = 0;
  const block: Block = {
    id: "visual_attempt_checkpoint_reconciliation",
    consumes: [],
    produces: ["result"],
    paid: true,
    run: async () => {
      paidBlockCalls += 1;
      return { result: "would-spend" };
    },
  };
  _clear();
  register(block);
  const result = await runPipeline(validatePipeline([{ block: block.id }]), {
    ...base,
    runId: "attempt-ledger-reconciliation",
    sink: {
      async upsert() {},
      async upsertArtifacts() {},
      async getResumeState() {
        return [{ block: block.id, status: "running", startedAt: 1_700_000_000_000 }];
      },
    },
    resume: true,
  });
  assert.equal(result.ok, false, "existing paid-stage reconciliation still fails closed");
  assert.equal(paidBlockCalls, 0, "attempt-ledger support does not authorize a second paid call");
  assert.match(result.error ?? "", /PAID_STAGE_RECONCILIATION_REQUIRED/);
}

async function main(): Promise<void> {
  ledgerSchemaAndLineage();
  await checkpointSurvivesStageFailure();
  await checkpointFailureStopsNextOperation();
  await checkpointDoesNotAlterPaidReconciliation();
  _clear();
  console.log("visual artifact attempt ledger tests passed");
}

main().catch((error) => {
  console.error("visual artifact attempt ledger tests failed", error);
  process.exit(1);
});
