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
import { generateFalI2V } from "@/lib/falVideo";
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

async function falQueueRecoveryKeepsAcceptedJob(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FAL_KEY;
  process.env.FAL_KEY = "test-only-fal-key";
  try {
    let submitCalls = 0;
    let statusCalls = 0;
    let resultCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        submitCalls++;
        return new Response(
          JSON.stringify({
            request_id: "accepted-job",
            status_url: "https://fal.test/status",
            response_url: "https://fal.test/result",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/status")) {
        statusCalls++;
        return new Response(JSON.stringify({ status: "COMPLETED" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      resultCalls++;
      if (resultCalls === 1) {
        return new Response(JSON.stringify({ detail: "temporary overload" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ video: { url: "https://cdn.test/video.mp4" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const recovered = await generateFalI2V({
      prompt: "A bounded camera move",
      imageUrl: "https://cdn.test/source.jpg",
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    });
    assert(
      recovered.jobId === "accepted-job" &&
        submitCalls === 1 &&
        statusCalls === 2 &&
        resultCalls === 2,
      "transient result fetch recovers the accepted Fal job without a second paid submission",
    );

    let rejectedCalls = 0;
    globalThis.fetch = (async () => {
      rejectedCalls++;
      return new Response(
        JSON.stringify({
          detail: "network temporarily unavailable is not a valid prompt value",
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    let rejectionKind = "";
    try {
      await generateFalI2V({
        prompt: "Invalid fixture",
        imageUrl: "https://cdn.test/source.jpg",
      });
    } catch (error) {
      rejectionKind = classifyExecutionError(error).kind;
    }
    assert(
      rejectionKind === "deterministic" && rejectedCalls === 1,
      "Fal 422 is emitted with structured terminal metadata after one request",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalKey;
  }
}

async function main(): Promise<void> {
  await classificationAndRetryPolicy();
  await narrationResumeDoesNotRespend();
  await falQueueRecoveryKeepsAcceptedJob();
  _clear();
  console.log("\nRECOVERY POLICY TEST PASSED");
}

main().catch((error) => {
  console.error("RECOVERY POLICY TEST FAILED", error);
  process.exit(1);
});
