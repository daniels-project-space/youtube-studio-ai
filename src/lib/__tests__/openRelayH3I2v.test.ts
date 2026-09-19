import assert from "node:assert/strict";
import {
  renderOpenRelayH3I2V,
  type OpenRelayH3I2VDependencies,
} from "@/lib/openRelayH3I2v";
import type { OpenRelayH3Receipt, OpenRelayH3RenderRequest } from "@/lib/openRelayH3";

const INPUT_KEY = "owner/daniel/channel/demo/runs/run-1/stills/first.png";
let durableReceipt = "";
let ensureCalls = 0;
let reconcileCalls = 0;
let submitCalls = 0;
let pending = false;

function receiptFor(request: OpenRelayH3RenderRequest): OpenRelayH3Receipt {
  return {
    schema: "minimax-h3-worker/v1",
    requestKey: request.request_key,
    jobId: `h3-${request.request_key.slice(0, 12)}`,
    execution: request.execution,
    profile: request.profile,
    promptSha256: "c".repeat(64),
    seed: request.seed,
    firstFrame: { r2Key: request.first_frame_key, sha256: request.first_frame_sha256 },
    output: {
      r2Key: request.output_key,
      contentSha256: "d".repeat(64),
      byteLength: 123,
      contentType: "video/mp4",
    },
    runtime: {
      provider: "openrelay",
      gpuModel: "A100",
      runtimeId: "minimax-h3-turbo8-a100-v1",
      modelManifestSha256: "1e1b44f69249511e8e7308e5ceb9c9fa60efff4abde37f200dc33f28345b5ae3",
      capacityMode: "persistent-disk-auto-stop",
      costUsd: 0.42,
    },
  };
}

const dependencies: Partial<OpenRelayH3I2VDependencies> = {
  getObjectIntegrity: async (key) => key === INPUT_KEY
    ? { sha256: "b".repeat(64), byteLength: 456 }
    : { sha256: "d".repeat(64), byteLength: 123 },
  headObjectMetadata: async () => ({ contentLength: 123, contentType: "video/mp4", metadata: {} }),
  getObjectBytes: async () => {
    if (!durableReceipt) {
      const error = new Error("not found") as Error & { name: string; $metadata: { httpStatusCode: number } };
      error.name = "NoSuchKey";
      error.$metadata = { httpStatusCode: 404 };
      throw error;
    }
    return new TextEncoder().encode(durableReceipt);
  },
  presignDownload: async (key) => `https://objects.example.test/${key}?get=redacted`,
  presignUpload: async (key) => `https://objects.example.test/${key}?put=redacted`,
  putObject: async (_key, body) => {
    durableReceipt = String(body);
    return "receipt.json";
  },
  ensureReady: async () => {
    ensureCalls += 1;
    return {
      schema: "minimax-h3-worker/v1",
      ready: true,
      route: "minimax-h3-turbo8-a100",
      profile: "official-turbo8-native-768p",
      modelLoad: "per-job-high-vram",
      persistentCacheReady: true,
      busy: false,
      draining: false,
      idleSeconds: 0,
    };
  },
  reconcile: async () => {
    reconcileCalls += 1;
    return pending ? { status: "pending" } : { status: "absent" };
  },
  submit: async (request) => {
    submitCalls += 1;
    return receiptFor(request);
  },
};

async function main(): Promise<void> {
  const args = {
    prefix: "owner/daniel/channel/demo/runs/run-1",
    id: "scene-001",
    prompt: "A quiet blue geometric sculpture rotates in a dark studio.",
    imageKey: INPUT_KEY,
    durationSec: 5,
    aspectRatio: "16:9",
    maxCostUsd: 0.98,
  } as const;

  const first = await renderOpenRelayH3I2V(args, dependencies);
  assert.equal(first.reused, false);
  assert.equal(first.costUsd, 0.42);
  assert.equal(ensureCalls, 1);
  assert.equal(reconcileCalls, 1);
  assert.equal(submitCalls, 1);
  assert.match(durableReceipt, /openrelay-h3-i2v-receipt\/v1/);

  const reused = await renderOpenRelayH3I2V(args, dependencies);
  assert.equal(reused.reused, true);
  assert.equal(reused.jobId, first.jobId);
  assert.equal(ensureCalls, 1, "a durable receipt must avoid waking a stopped A100");
  assert.equal(reconcileCalls, 1);
  assert.equal(submitCalls, 1);

  durableReceipt = "";
  pending = true;
  await assert.rejects(
    renderOpenRelayH3I2V({ ...args, id: "scene-002", prompt: `${args.prompt} Different take.` }, dependencies),
    /pending reconciliation/i,
  );
  assert.equal(submitCalls, 1, "a pending job must never submit a second paid take");

  console.log("OPENRELAY H3 I2V DURABLE ADAPTER PASS");
}

void main();
