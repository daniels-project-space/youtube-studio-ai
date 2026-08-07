import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generationProfile } from "@/engine/generationProfiles";
import {
  toNovitaPhaseProfile,
  waitForBridgeRender,
  type NovitaBillingReceipt,
  type NovitaBridgeStatus,
  type NovitaRenderLaunch,
} from "@/lib/novitaRenderFarm";
import { createNovitaRenderPollWait } from "@/lib/novitaPollWait";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  const checkpointWaits: Array<{ seconds: number; idempotencyKey: string }> = [];
  let rawSleeps = 0;
  const triggerPollWait = createNovitaRenderPollWait({
    isInsideTriggerTask: () => true,
    checkpointWait: async (options) => {
      checkpointWaits.push(options);
    },
    sleep: async () => {
      rawSleeps += 1;
    },
  });

  await triggerPollWait({ milliseconds: 30_001, idempotencyKey: "render-job:poll:1" });
  assert.deepEqual(checkpointWaits, [{ seconds: 30.001, idempotencyKey: "render-job:poll:1" }]);
  assert.equal(rawSleeps, 0, "Trigger execution must never use a billed raw timer");

  const outsideSleeps: number[] = [];
  const outsidePollWait = createNovitaRenderPollWait({
    isInsideTriggerTask: () => false,
    checkpointWait: async () => {
      throw new Error("checkpoint wait must not run outside Trigger");
    },
    sleep: async (milliseconds) => {
      outsideSleeps.push(milliseconds);
    },
  });
  await outsidePollWait({ milliseconds: 30_001, idempotencyKey: "local:poll:1" });
  assert.deepEqual(outsideSleeps, [30_001], "plain Node callers must retain the testable timer path");

  const profile = toNovitaPhaseProfile(generationProfile("production"), "image");
  const jobId = `image-${"a".repeat(32)}`;
  const prefix = "checkpoint-wait/test";
  const outputPrefix = `imagecraft/${prefix}/${jobId}/stills`;
  const expectedKey = `${outputPrefix}/shot-01-c01.png`;
  const profileSha256 = createHash("sha256").update(canonicalJson(profile)).digest("hex");
  const requestSha256 = "b".repeat(64);
  const receipt: NovitaBillingReceipt = {
    provider: "novita",
    currency: "USD",
    receiptId: "receipt-checkpoint-wait",
    gpuSku: "RTX 4090",
    gpuCount: 1,
    gpuSeconds: 1,
    gpuRateUsdPerSecond: 0.00005,
    startupUsd: 0,
    storageUsd: 0,
    costUsd: 0.00005,
  };
  const launch: NovitaRenderLaunch = {
    jobId,
    phase: "image",
    prefix,
    profile,
    expectedJobIds: ["shot-01-c01"],
    profileSha256,
    requestSha256,
    requestCanonicalJson: canonicalJson({}),
    nshard: 1,
    maxCostUsd: 2,
  };
  const commonStatus = {
    jobId,
    phase: "image" as const,
    n_jobs: 1,
    outputPrefix,
    expectedKeys: [expectedKey],
    missingKeys: [],
    failedIds: [],
    profile,
    profileSha256,
    manifestSha256: "c".repeat(64),
    requestSha256,
    runtimeAttestation: {
      provider: "novita" as const,
      capacityMode: "spot" as const,
      weightStorage: "local-persistent-disk" as const,
      cacheMount: "/workspace/model-cache" as const,
      checkpointing: true as const,
      idleShutdownSeconds: profile.infrastructure.idleShutdownSeconds,
      gpuCount: 1,
      model: profile.model,
      revision: profile.revision,
      checkpoint: profile.checkpoint,
    },
    billingReceipt: receipt,
    billingReceiptSha256: "d".repeat(64),
  };
  const statuses: NovitaBridgeStatus[] = [
    { ...commonStatus, ok: true, status: "running", outputs: [], n_outputs: 0, stillKeys: [] },
    { ...commonStatus, ok: true, status: "running", outputs: [], n_outputs: 0, stillKeys: [] },
    { ...commonStatus, ok: true, status: "done", outputs: [expectedKey], n_outputs: 1, stillKeys: [expectedKey] },
  ];
  const loopWaits: Array<{ milliseconds: number; idempotencyKey: string }> = [];
  let nowMs = 0;
  const terminal = await waitForBridgeRender(launch, {
    pollMs: 30_000,
    timeoutMs: 120_000,
    now: () => nowMs,
    statusReader: async (requestedJobId) => {
      assert.equal(requestedJobId, jobId);
      const status = statuses.shift();
      assert.ok(status, "poll loop requested an unexpected extra status");
      return status;
    },
    pollWait: async (request) => {
      loopWaits.push(request);
      await triggerPollWait(request);
      nowMs += request.milliseconds;
    },
  });

  assert.equal(terminal.status, "done");
  assert.deepEqual(loopWaits, [
    { milliseconds: 30_000, idempotencyKey: `novita-render:${jobId}:poll:1` },
    { milliseconds: 45_000, idempotencyKey: `novita-render:${jobId}:poll:2` },
  ]);
  assert.equal(rawSleeps, 0, "the wired poll loop must remain on checkpoint waits inside Trigger");
  assert.deepEqual(checkpointWaits.slice(1).map(({ seconds }) => seconds), [30, 45]);

  console.log("novita checkpoint wait tests passed");
}

void main();
