import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyExecutionError,
  ExecutionError,
} from "@/engine/executionErrors";
import { _clear, register } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import type { Block, RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";
import { rehydrateOutputs } from "@/lib/rehydrate";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

function sinkWithCompleted(
  completed: Array<{
    block: string;
    outputs: unknown;
    cost?: number;
  }> = [],
): RunStageSink {
  return {
    async upsert() {},
    async getCompleted() {
      return completed;
    },
  };
}

const base = {
  ownerId: "recovery_owner",
  runId: "recovery_run",
  channelId: "recovery_channel",
  keyPrefix: "owners/recovery/channels/test/",
  budgetUsd: 10,
  log: () => {},
};

async function classificationAndRetryPolicy(): Promise<void> {
  const terminalTaskError = taskErrorForRetryPolicy(
    new Error("GEMINI_API_KEY is not configured"),
  );
  assert(
    terminalTaskError.classification.kind === "deterministic" &&
      terminalTaskError.error instanceof Error &&
      terminalTaskError.error.name === "AbortTaskRunError",
    "Trigger aborts deterministic bootstrap/configuration failures instead of billing a duplicate task attempt",
  );
  const transientTaskFailure = new ExecutionError("Convex temporarily unavailable", {
    status: 503,
    retryable: true,
  });
  assert(
    taskErrorForRetryPolicy(transientTaskFailure).error === transientTaskFailure,
    "Trigger preserves a concrete transient failure for one infrastructure retry",
  );
  assert(
    taskErrorForRetryPolicy(new Error("channel not found: missing_channel"))
      .classification.kind === "deterministic",
    "missing persisted run inputs do not trigger a duplicate orchestration attempt",
  );

  const deceptive422 = classifyExecutionError(
    new Error(
      'fal i2v submit failed: HTTP 422 {"detail":"network temporarily unavailable is not a valid prompt value"}',
    ),
  );
  assert(
    deceptive422.kind === "deterministic" && !deceptive422.retryable,
    "explicit Fal HTTP 422 wins over transient-looking response prose",
  );

  const renderFailure = new Error(
    "ffmpeg exited 1: Invalid data found when processing input",
  );
  renderFailure.name = "FfmpegError";
  assert(
    classifyExecutionError(renderFailure).kind === "deterministic",
    "repeatable FFmpeg input failure is terminal",
  );
  assert(
    classifyExecutionError(new Error("fetch failed: EAI_AGAIN")).kind === "transient",
    "transport/DNS failure remains retryable",
  );
  assert(
    classifyExecutionError(
      new Error("ElevenLabs TTS failed after 3 attempts: HTTP 503 unavailable"),
    ).kind === "deterministic",
    "provider-local retry exhaustion is not multiplied by the outer block loop",
  );

  let deterministicAttempts = 0;
  const deterministic: Block = {
    id: "recovery_deterministic_422",
    consumes: [],
    produces: ["recoveryResult"],
    run: async () => {
      deterministicAttempts++;
      throw new ExecutionError("fal submit rejected", {
        status: 422,
        retryable: false,
      });
    },
  };
  _clear();
  register(deterministic);
  const stopped = await runPipeline(
    validatePipeline([{ block: deterministic.id, params: { retries: 99 } }]),
    { ...base, sink: sinkWithCompleted(), defaultRetries: 5 },
  );
  assert(
    !stopped.ok && deterministicAttempts === 1,
    "deterministic provider rejection makes one attempt even with a high retry knob",
  );

  let transientAttempts = 0;
  const transient: Block = {
    id: "recovery_transient_503",
    consumes: [],
    produces: ["recoveryResult"],
    run: async () => {
      transientAttempts++;
      if (transientAttempts < 3) {
        throw new ExecutionError("provider overloaded", {
          status: 503,
          retryable: true,
          retryAfterMs: 0,
        });
      }
      return { recoveryResult: "recovered" };
    },
  };
  _clear();
  register(transient);
  const recovered = await runPipeline(
    validatePipeline([{ block: transient.id }]),
    { ...base, sink: sinkWithCompleted(), defaultRetries: 3 },
  );
  assert(
    recovered.ok && transientAttempts === 3,
    "explicit transient 503 retries and recovers",
  );

  let malformedAttempts = 0;
  const malformedRetryKnob: Block = {
    id: "recovery_malformed_retry_knob",
    consumes: [],
    produces: ["recoveryResult"],
    run: async () => {
      malformedAttempts++;
      throw new ExecutionError("provider overloaded", {
        status: 503,
        retryable: true,
        retryAfterMs: 0,
      });
    },
  };
  _clear();
  register(malformedRetryKnob);
  await runPipeline(
    validatePipeline([
      { block: malformedRetryKnob.id, params: { retries: "not-a-number" } },
    ]),
    { ...base, sink: sinkWithCompleted(), defaultRetries: 0 },
  );
  assert(
    malformedAttempts === 1,
    "malformed retry configuration cannot create an unbounded retry loop",
  );

  let paidCallsDuringStageStoreOutage = 0;
  const storeOutageBlock: Block = {
    id: "recovery_stage_store_outage",
    consumes: [],
    produces: ["recoveryResult"],
    paid: true,
    run: async () => {
      paidCallsDuringStageStoreOutage++;
      return { recoveryResult: "charged" };
    },
  };
  _clear();
  register(storeOutageBlock);
  let stageStoreFailedClosed = false;
  try {
    await runPipeline(validatePipeline([{ block: storeOutageBlock.id }]), {
      ...base,
      sink: {
        async upsert() {},
        async getCompleted() {
          throw new ExecutionError("Convex stage query unavailable", {
            status: 503,
            retryable: true,
            retryAfterMs: 0,
          });
        },
      },
    });
  } catch {
    stageStoreFailedClosed = true;
  }
  assert(
    stageStoreFailedClosed && paidCallsDuringStageStoreOutage === 0,
    "stage-store outage fails closed before any paid block can double-run",
  );

  let paidCallsDuringR2Outage = 0;
  const r2OutageBlock: Block = {
    id: "recovery_r2_outage",
    consumes: [],
    produces: ["recoveryResult"],
    paid: true,
    run: async () => {
      paidCallsDuringR2Outage++;
      return { recoveryResult: "charged" };
    },
  };
  _clear();
  register(r2OutageBlock);
  let r2FailedClosed = false;
  try {
    await runPipeline(validatePipeline([{ block: r2OutageBlock.id }]), {
      ...base,
      sink: sinkWithCompleted([
        { block: r2OutageBlock.id, outputs: { recoveryResult: "cached" } },
      ]),
      rehydrate: async () => {
        throw new ExecutionError("R2 temporarily unavailable", {
          status: 503,
          retryable: true,
          retryAfterMs: 0,
        });
      },
    });
  } catch {
    r2FailedClosed = true;
  }
  assert(
    r2FailedClosed && paidCallsDuringR2Outage === 0,
    "R2 outage preserves the completed paid stage instead of regenerating it",
  );

  let paidCallsForMissingArtifact = 0;
  const missingArtifactWrites: Array<{ status: string; error?: string }> = [];
  const missingArtifactBlock: Block = {
    id: "recovery_paid_missing_artifact",
    consumes: [],
    produces: ["recoveryResult"],
    paid: true,
    run: async () => {
      paidCallsForMissingArtifact++;
      return { recoveryResult: "charged-again" };
    },
  };
  _clear();
  register(missingArtifactBlock);
  const missingArtifactResult = await runPipeline(
    validatePipeline([{ block: missingArtifactBlock.id }]),
    {
      ...base,
      sink: {
        async upsert(args) {
          missingArtifactWrites.push({ status: args.status, error: args.error });
        },
        async getCompleted() {
          return [{
            block: missingArtifactBlock.id,
            outputs: { recoveryResult: "paid-but-artifact-missing" },
            cost: 0.42,
          }];
        },
      },
      rehydrate: async (_block, outputs) => ({ ok: false, outputs }),
    },
  );
  assert(
    !missingArtifactResult.ok && paidCallsForMissingArtifact === 0,
    "confirmed-missing outputs never regenerate a completed paid stage",
  );
  assert(
    missingArtifactWrites.some(
      (write) =>
        write.status === "failed" &&
        write.error?.includes("PAID_STAGE_RECONCILIATION_REQUIRED"),
    ),
    "missing paid artifacts persist an actionable reconciliation fence",
  );

  const noRehydratorResult = await runPipeline(
    validatePipeline([{ block: missingArtifactBlock.id }]),
    {
      ...base,
      sink: sinkWithCompleted([{
        block: missingArtifactBlock.id,
        outputs: { recoveryResult: "paid-cached-output" },
        cost: 0.42,
      }]),
    },
  );
  assert(
    !noRehydratorResult.ok && paidCallsForMissingArtifact === 0,
    "completed paid stages also fail closed when no rehydrator is configured",
  );
}

async function narrationResumeDoesNotRespend(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "youtube-recovery-"));
  try {
    const narrationLocalPath = join(directory, "narration.mp3");
    await writeFile(narrationLocalPath, Buffer.from("ID3-recovery-fixture"));

    let paidTtsCalls = 0;
    const narration: Block = {
      id: "recovery_paid_narration",
      consumes: [],
      produces: [
        "narrationKey",
        "narrationDurationSec",
        "narrationLocalPath",
        "sentenceTimings",
        "chapterPlan",
      ],
      paid: true,
      run: async () => {
        paidTtsCalls++;
        throw new Error("paid TTS must not run for a restorable completed stage");
      },
    };
    const cachedOutputs = {
      narrationKey:
        "owners/recovery/channels/test/runs/recovery_run/narration.mp3",
      narrationDurationSec: 180,
      narrationLocalPath,
      sentenceTimings: [
        {
          text: "Support is available 24/7 for rest/recovery.",
          start: 0,
          end: 4,
        },
      ],
      chapterPlan: [],
    };

    _clear();
    register(narration);
    const resumed = await runPipeline(
      validatePipeline([{ block: narration.id }]),
      {
        ...base,
        sink: sinkWithCompleted([
          {
            block: narration.id,
            outputs: cachedOutputs,
            cost: 0.34728,
          },
        ]),
        resume: true,
        rehydrate: (block, outputs) =>
          rehydrateOutputs(block, outputs, base.runId),
      },
    );

    assert(resumed.ok, "completed narration stage resumes successfully");
    assert(
      paidTtsCalls === 0,
      "R2 keys and slash-containing narration prose are not mistaken for missing local files",
    );
    assert(
      Math.abs(resumed.costTotal - 0.34728) < 0.000001,
      "resume preserves original narration cost without charging it again",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function interruptedPaidStageRequiresReconciliation(): Promise<void> {
  let paidCalls = 0;
  const writes: Array<{ status: string; error?: string }> = [];
  const paidBlock: Block = {
    id: "recovery_interrupted_paid_stage",
    consumes: [],
    produces: ["recoveryResult"],
    paid: true,
    run: async () => {
      paidCalls += 1;
      return { recoveryResult: "would-charge-again" };
    },
  };
  _clear();
  register(paidBlock);
  const result = await runPipeline(
    validatePipeline([{ block: paidBlock.id }]),
    {
      ...base,
      sink: {
        async upsert(args) {
          writes.push({ status: args.status, error: args.error });
        },
        async getResumeState() {
          return [{
            block: paidBlock.id,
            status: "running",
            startedAt: 1_700_000_000_000,
          }];
        },
      },
      resume: true,
    },
  );

  assert(!result.ok, "an interrupted paid stage fails closed on worker resume");
  assert(paidCalls === 0, "an interrupted paid stage is never purchased twice");
  assert(
    writes.some(
      (write) =>
        write.status === "failed" &&
        write.error?.includes("PAID_STAGE_RECONCILIATION_REQUIRED"),
    ),
    "the stage records an actionable reconciliation marker",
  );

  const marker = writes.find((write) =>
    write.error?.includes("PAID_STAGE_RECONCILIATION_REQUIRED"),
  )?.error;
  const repeatedResume = await runPipeline(
    validatePipeline([{ block: paidBlock.id }]),
    {
      ...base,
      sink: {
        async upsert() {},
        async getResumeState() {
          return [{
            block: paidBlock.id,
            status: "failed",
            error: marker,
          }];
        },
      },
      resume: true,
    },
  );
  assert(
    !repeatedResume.ok && paidCalls === 0,
    "the reconciliation fence survives further orchestration retries",
  );
}

async function legacyThumbnailResumeFailsClosedWithoutRespend(): Promise<void> {
  let paidThumbnailCalls = 0;
  let persistedOutputs: Record<string, unknown> | undefined;
  const thumbnail: Block = {
    id: "thumbnail_gen",
    consumes: ["title"],
    produces: ["thumbnailKey", "strategy", "thumbnailPublishable"],
    paid: true,
    run: async () => {
      paidThumbnailCalls += 1;
      throw new Error("legacy cached thumbnail must resume without another provider call");
    },
  };
  _clear();
  register(thumbnail);
  const resumed = await runPipeline(
    validatePipeline([{ block: thumbnail.id }], ["title"]),
    {
      ...base,
      seedStore: { title: "A real legacy rental-economy thumbnail" },
      sink: {
        async upsert(args) {
          if (args.status === "ok") {
            persistedOutputs = args.outputs as Record<string, unknown>;
          }
        },
        async getCompleted() {
          return [{
            block: thumbnail.id,
            cost: 0.05321,
            // This is the exact pre-contract shape persisted by older runs.
            outputs: {
              thumbnailKey: "owners/recovery/channels/test/runs/recovery_run/thumbnail.jpg",
              strategy: "playbook",
            },
          }];
        },
      },
      resume: true,
      rehydrate: async (_block, outputs) => ({ ok: true, outputs }),
    },
  );

  assert(resumed.ok, "legacy thumbnail outputs migrate during resume");
  assert(paidThumbnailCalls === 0, "legacy thumbnail resume never re-spends");
  assert(
    resumed.store["thumbnailPublishable"] === false,
    "missing legacy publishability evidence is derived fail-closed",
  );
  assert(
    persistedOutputs?.["thumbnailPublishable"] === false,
    "the migrated publishability flag is persisted for future resumes",
  );
  assert(
    Math.abs(resumed.costTotal - 0.05321) < 0.000001,
    "legacy thumbnail resume preserves its original recorded spend",
  );
}

async function main(): Promise<void> {
  await classificationAndRetryPolicy();
  await narrationResumeDoesNotRespend();
  await interruptedPaidStageRequiresReconciliation();
  await legacyThumbnailResumeFailsClosedWithoutRespend();
  _clear();
  console.log("\nRECOVERY POLICY TEST PASSED");
}

main().catch((error) => {
  console.error("RECOVERY POLICY TEST FAILED", error);
  process.exit(1);
});
