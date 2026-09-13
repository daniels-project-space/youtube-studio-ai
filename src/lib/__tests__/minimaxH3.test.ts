import assert from "node:assert/strict";
import {
  assertMiniMaxH3R2ModelManifest,
  assertMiniMaxH3SaladCapacity,
  MINIMAX_H3_MANIFEST_SHA256,
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
  MiniMaxH3Error,
  type MiniMaxH3SaladCapacityClient,
  miniMaxH3RequestKey,
  renderMiniMaxH3,
  renderMiniMaxH3WeeklyBatch,
} from "@/lib/minimaxH3";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";

const saved = { ...process.env };
function configure(provider: "salad" | "novita") {
  const prefix = provider === "salad" ? "MINIMAX_H3_SALAD" : "MINIMAX_H3_NOVITA";
  process.env[`${prefix}_WORKER_URL`] = "http://127.0.0.1:8080/v1/videos";
  process.env[`${prefix}_WORKER_TOKEN`] = "x".repeat(32);
  process.env[`${prefix}_QUALIFIED`] = "1";
  process.env[`${prefix}_QUALIFICATION_RECEIPT_SHA256`] = "a".repeat(64);
  if (provider === "salad") process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY = "1";
}
const output = new Uint8Array(1_024).fill(7);
const firstFrame = new Uint8Array(1_024).fill(8);
function request(provider: "salad" | "novita", execution: "weekly-batch" | "on-demand", output = "owner/o/channel/c/clip.mp4") {
  return { provider, execution, prompt: "A precise continuous cinematic action with no text.", seed: 42,
    firstFrame: { r2Key: "owner/o/channel/c/frame.png", sha256: sha256BytesHex(firstFrame) }, output: { r2Key: output }, maxCostUsd: 0.4 } as const;
}
assert.notEqual(
  miniMaxH3RequestKey(request("salad", "weekly-batch")),
  miniMaxH3RequestKey(request("novita", "on-demand")),
  "weekly and on-demand routes must have distinct idempotency identities",
);
function responseFor(input: ReturnType<typeof request>) {
  return new Response(JSON.stringify({ receipt: {
    schema: "minimax-h3-worker/v1", requestKey: "", jobId: "job-1", execution: input.execution,
    profile: MINIMAX_H3_PROFILE, promptSha256: "", seed: input.seed, firstFrame: input.firstFrame,
    output: { r2Key: input.output.r2Key, contentSha256: sha256BytesHex(output), byteLength: output.byteLength, contentType: "video/mp4" },
    runtime: { provider: input.provider, gpuModel: "RTX 5090", runtimeId: MINIMAX_H3_RUNTIME_ID,
      modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256, capacityMode: input.provider === "salad" ? "medium" : "spot", costUsd: 0.2 },
  } }), { status: 200, headers: { "content-type": "application/json" } });
}
async function test() {
  const classes = [{
    id: "851399fb-7329-4195-a042-d6514b28cf33",
    name: "RTX 5090 (32 GB)",
    prices: [{ price: "0.417", priority: "medium" as const }],
  }];
  let capacityRequest: { gpu_classes: string[]; memory: number; storage_amount: number } | undefined;
  const capacityClient: MiniMaxH3SaladCapacityClient = {
    listGpuClasses: async () => classes,
    getGpuAvailability: async (resources) => {
      capacityRequest = resources;
      return { available_gpu_medium: 3 };
    },
  };
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(4, { client: capacityClient }),
    { requiredGpuCount: 3, availableGpuCount: 3, gpuClassId: classes[0]!.id },
  );
  assert.deepEqual(capacityRequest, {
    cpu: 8, gpu_classes: [classes[0]!.id], memory: 131_072, storage_amount: 100 * 1024 ** 3,
  });
  await assert.rejects(
    () => assertMiniMaxH3SaladCapacity(2, {
      client: { ...capacityClient, getGpuAvailability: async () => ({ available_gpu_medium: 1 }) },
    }),
    /capacity is insufficient/,
  );
  configure("salad"); configure("novita");
  const salad = request("salad", "weekly-batch");
  let seen: Record<string, unknown> | undefined;
  const rendered = await renderMiniMaxH3(salad, {
    presignRead: async () => "https://r2.example/read",
    presignWrite: async () => "https://r2.example/write",
    readObject: async (key) => key.endsWith("frame.png") ? firstFrame : output,
    assertModelManifest: async () => {},
    fetch: async (_url, init) => {
      seen = JSON.parse(String(init?.body));
      const reply = responseFor(salad);
      const body = await reply.json() as { receipt: Record<string, unknown> };
      body.receipt.requestKey = String(seen?.request_key);
      body.receipt.promptSha256 = sha256Hex(salad.prompt);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(rendered.receipt.runtime.provider, "salad");
  assert.equal(seen?.first_frame_url, "https://r2.example/read");
  assert.equal(seen?.first_frame_key, salad.firstFrame.r2Key);
  assert.equal(seen?.output_key, salad.output.r2Key);
  assert.equal(seen?.output_put_url, "https://r2.example/write");
  assert.equal(seen?.execution, "weekly-batch");

  await assert.rejects(
    () => renderMiniMaxH3(salad, {
      readObject: async () => output,
      assertModelManifest: async () => {},
      fetch: async () => { throw new Error("provider must not be contacted"); },
    }),
    /first-frame input digest does not match/,
    "a stale first-frame digest must fail before the paid worker call",
  );

  await assert.rejects(
    () => assertMiniMaxH3R2ModelManifest(async () => new Uint8Array([1])),
    /manifest digest/,
  );

  await assert.rejects(
    () => renderMiniMaxH3({ ...salad, execution: "on-demand" }),
    (error: unknown) => error instanceof MiniMaxH3Error && /Novita route/.test(error.message),
  );
  await assert.rejects(
    () => renderMiniMaxH3WeeklyBatch([{ ...request("salad", "weekly-batch"), output: { r2Key: "owner/o/channel/c/a.mp4" } }, { ...request("salad", "weekly-batch"), output: { r2Key: "owner/o/channel/c/a.mp4" } }]),
    /duplicate output keys/,
  );
  const jobs = ["a", "b", "c", "d"].map((suffix) => ({
    ...request("salad", "weekly-batch", `owner/o/channel/c/${suffix}.mp4`),
  }));
  let active = 0;
  let peak = 0;
  const batched = await renderMiniMaxH3WeeklyBatch(jobs, {
    presignRead: async () => "https://r2.example/read",
    presignWrite: async () => "https://r2.example/write",
    readObject: async (key) => key.endsWith("frame.png") ? firstFrame : output,
    assertModelManifest: async () => {},
    fetch: async (_url, init) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      const body = JSON.parse(String(init?.body)) as { request_key: string; output_key: string };
      const input = request("salad", "weekly-batch", body.output_key);
      const reply = responseFor(input);
      const parsed = await reply.json() as { receipt: Record<string, unknown> };
      parsed.receipt.requestKey = body.request_key;
      parsed.receipt.promptSha256 = sha256Hex(input.prompt);
      active -= 1;
      return new Response(JSON.stringify(parsed), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(batched.length, 4);
  assert.equal(peak, 3, "weekly Salad work must use the bounded three-GPU wave");
}
void test().finally(() => { process.env = saved; }).then(() => console.log("minimax H3 contract tests passed"));
