import assert from "node:assert/strict";
import {
  buildMiniMaxH3SceneRequest,
  assertMiniMaxH3R2ModelManifest,
  assertMiniMaxH3SaladCapacity,
  MINIMAX_H3_MANIFEST_SHA256,
  MINIMAX_H3_OPENRELAY_CAPACITY_MODE,
  MINIMAX_H3_SALAD_CAPACITY_MODE,
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
  MiniMaxH3Error,
  MiniMaxH3OpeningMotionRejectedRenderError,
  minimaxH3Readiness,
  miniMaxH3GpuModel,
  type MiniMaxH3SaladCapacityClient,
  miniMaxH3RequestKey,
  miniMaxH3RuntimeId,
  renderMiniMaxH3,
  renderMiniMaxH3WeeklyBatch,
} from "@/lib/minimaxH3";
import {
  MINIMAX_H3_IMMEDIATE_MOTION_PROMPT,
  MiniMaxH3OpeningMotionRejectedError,
} from "@/lib/minimaxH3OpeningMotionQa";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";

const saved = { ...process.env };
function configure(provider: "salad" | "novita" | "openrelay") {
  const prefix = provider === "salad" ? "MINIMAX_H3_SALAD" : provider === "novita" ? "MINIMAX_H3_NOVITA" : "MINIMAX_H3_OPENRELAY";
  process.env[`${prefix}_WORKER_URL`] = "http://127.0.0.1:8080/v1/videos";
  process.env[`${prefix}_WORKER_TOKEN`] = "x".repeat(32);
  process.env[`${prefix}_QUALIFIED`] = "1";
  process.env[`${prefix}_QUALIFICATION_RECEIPT_SHA256`] = "a".repeat(64);
  if (provider === "openrelay") process.env.OPENRELAY_API_KEY = "o".repeat(32);
  if (provider === "salad") process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY = "1";
}
const output = new Uint8Array(1_024).fill(7);
const firstFrame = new Uint8Array(1_024).fill(8);
let sharedOpeningMotionChecks = 0;
const passingOpeningMotion = ({ durationSec }: { durationSec: number }) => {
  sharedOpeningMotionChecks += 1;
  return {
    contract: "minimax-h3-opening-motion-qa/v1" as const,
    source: "ffmpeg/freezedetect+ssim" as const,
    verdict: "pass" as const,
    durationSec,
    maxFreezeFraction: 0.1,
    maxStaticHoldSec: durationSec * 0.1,
    maxOpeningFrozenHoldSec: 0.125,
    maxFrozenHoldSec: 0,
    openingFrozenHoldSec: 0,
    frozenIntervals: [],
    violatingIntervals: [],
  };
};
function request(provider: "salad" | "novita" | "openrelay", execution: "weekly-batch" | "weekly-fallback" | "on-demand", output = "owner/o/channel/c/clip.mp4") {
  return { provider, execution, prompt: "A precise continuous cinematic action with no text.", seed: 42,
    firstFrame: { r2Key: "owner/o/channel/c/frame.png", sha256: sha256BytesHex(firstFrame) }, output: { r2Key: output }, maxCostUsd: 0.4 } as const;
}

const builtSceneRequest = buildMiniMaxH3SceneRequest({
  provider: "novita",
  execution: "on-demand",
  prompt: "A rainy station at night.",
  motionPrompt: "A figure turns toward the platform lights.",
  cameraInstruction: "slow lateral track",
  negativePrompt: "text, logos",
  seed: 42,
  firstFrame: { r2Key: "owner/test/scene/frame.png", sha256: "a".repeat(64) },
  output: { r2Key: "owner/test/scene/clip.mp4" },
  maxCostUsd: 0.4,
});
assert.equal(
  builtSceneRequest.prompt,
  `A rainy station at night.\n\nMotion: A figure turns toward the platform lights.\n\nCamera: slow lateral track\n\n${MINIMAX_H3_IMMEDIATE_MOTION_PROMPT}\n\nAvoid: text, logos`,
  "scene request builder must preserve canonical prompt section order",
);
assert.deepEqual(builtSceneRequest.firstFrame, { r2Key: "owner/test/scene/frame.png", sha256: "a".repeat(64) });
assert.deepEqual(builtSceneRequest.output, { r2Key: "owner/test/scene/clip.mp4" });
assert.equal(builtSceneRequest.maxCostUsd, 0.4);
assert.notEqual(
  miniMaxH3RequestKey(request("salad", "weekly-batch")),
  miniMaxH3RequestKey(request("novita", "on-demand")),
  "weekly and on-demand routes must have distinct idempotency identities",
);
function responseFor(input: ReturnType<typeof request>, capacityMode: "medium" | "high" | "spot" | "persistent-disk-auto-stop" = input.provider === "salad" ? "medium" : input.provider === "novita" ? "spot" : "persistent-disk-auto-stop") {
  return new Response(JSON.stringify({ receipt: {
    schema: "minimax-h3-worker/v1", requestKey: "", jobId: "job-1", execution: input.execution,
    profile: MINIMAX_H3_PROFILE, promptSha256: "", seed: input.seed, firstFrame: input.firstFrame,
    output: { r2Key: input.output.r2Key, contentSha256: sha256BytesHex(output), byteLength: output.byteLength, contentType: "video/mp4" },
    runtime: { provider: input.provider, gpuModel: miniMaxH3GpuModel(input.provider), runtimeId: miniMaxH3RuntimeId(input.provider),
      modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256, capacityMode, costUsd: 0.2 },
  } }), { status: 200, headers: { "content-type": "application/json" } });
}
async function test() {
  const classes = [{
    id: "851399fb-7329-4195-a042-d6514b28cf33",
    name: "RTX 5090 (32 GB)",
    prices: [
      { price: "0.417", priority: "medium" as const },
      { price: "0.58", priority: "high" as const },
    ],
  }];
  let capacityRequest: { gpu_classes: string[]; memory: number; storage_amount: number } | undefined;
  let availabilityCalls = 0;
  const capacityClient: MiniMaxH3SaladCapacityClient = {
    listGpuClasses: async () => classes,
    getGpuAvailability: async (resources) => {
      availabilityCalls += 1;
      capacityRequest = resources;
      return { available_gpu_medium: 3 };
    },
  };
  await assert.rejects(
    () => assertMiniMaxH3SaladCapacity(2, {
      client: { ...capacityClient, getOccupiedGpuSlots: async () => 2 },
    }),
    /account capacity is occupied/,
    "market availability must not over-commit the shared three-GPU Salad lease",
  );
  assert.equal(availabilityCalls, 0, "an occupied account lease must short-circuit the market query");
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(4, { client: capacityClient }),
    { requiredGpuCount: 3, availableGpuCount: 3, gpuClassId: classes[0]!.id, selectedPriceUsdPerHour: 0.417, capacityMode: "medium", fallbackUsed: false },
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
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getGpuAvailability: async () => ({ available_gpu_medium: 1, available_gpu_high: 2 }),
      },
      allowHighPriorityFallback: true,
    }),
    { requiredGpuCount: 2, availableGpuCount: 2, gpuClassId: classes[0]!.id, selectedPriceUsdPerHour: 0.58, capacityMode: "high", fallbackUsed: true },
    "high fallback must also unlock a wave when medium exists but has too few exact-class slots",
  );
  const shortLocalityQueries: Array<string[] | undefined> = [];
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getGpuAvailability: async (_resources, countryCodes) => {
          shortLocalityQueries.push(countryCodes);
          return countryCodes
            ? { available_gpu_medium: 1, available_gpu_high: 1 }
            : { available_gpu_medium: 1, available_gpu_high: 2 };
        },
      },
      allowHighPriorityFallback: true,
    }),
    { requiredGpuCount: 2, availableGpuCount: 2, gpuClassId: classes[0]!.id, selectedPriceUsdPerHour: 0.58, capacityMode: "high", fallbackUsed: true },
    "a preferred locality that is short for the whole wave must be able to upgrade to a globally available high tier",
  );
  assert.deepEqual(shortLocalityQueries, [["cn"], undefined], "a short preferred locality must make one bounded global retry");
  const countryQueries: Array<string[] | undefined> = [];
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getGpuAvailability: async (_resources, countryCodes) => {
          countryQueries.push(countryCodes);
          return countryCodes ? { available_gpu_medium: 0, available_gpu_high: 0 } : { available_gpu_high: 2 };
        },
      },
      allowHighPriorityFallback: true,
    }),
    { requiredGpuCount: 2, availableGpuCount: 2, gpuClassId: classes[0]!.id, selectedPriceUsdPerHour: 0.58, capacityMode: "high", fallbackUsed: true },
    "a country-scoped zero must retry the global market before holding an otherwise available high-tier wave",
  );
  assert.deepEqual(countryQueries, [["cn"], undefined], "global capacity retry must be bounded and omit the country filter");
  const failedLocalityQueries: Array<string[] | undefined> = [];
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getGpuAvailability: async (_resources, countryCodes) => {
          failedLocalityQueries.push(countryCodes);
          if (countryCodes) throw new Error("preferred Salad locality read unavailable");
          return { available_gpu_medium: 0, available_gpu_high: 2 };
        },
      },
      allowHighPriorityFallback: true,
    }),
    { requiredGpuCount: 2, availableGpuCount: 2, gpuClassId: classes[0]!.id, selectedPriceUsdPerHour: 0.58, capacityMode: "high", fallbackUsed: true },
    "a failed preferred locality read may use one successful global read to unlock an admitted high-tier wave",
  );
  assert.deepEqual(failedLocalityQueries, [["cn"], undefined], "preferred-read recovery must remain one bounded global retry");
  const unavailableMarketQueries: Array<string[] | undefined> = [];
  await assert.rejects(
    () => assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getGpuAvailability: async (_resources, countryCodes) => {
          unavailableMarketQueries.push(countryCodes);
          throw new Error("Salad market unavailable");
        },
      },
      allowHighPriorityFallback: true,
    }),
    /capacity check failed before dispatch/,
    "if both preferred and global reads fail, H3 admission must hold without guessing capacity",
  );
  assert.deepEqual(unavailableMarketQueries, [["cn"], undefined], "market failure recovery must remain bounded");
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getGpuAvailability: async () => ({ available_gpu_medium: 0, available_gpu_high: 2 }),
        getOccupiedGpuSlots: async () => 1,
      },
      allowHighPriorityFallback: true,
    }),
    { requiredGpuCount: 2, availableGpuCount: 2, gpuClassId: classes[0]!.id, selectedPriceUsdPerHour: 0.58, capacityMode: "high", fallbackUsed: true },
    "high fallback must be admitted when medium is unavailable, high has enough exact-class slots, and the shared lease has room",
  );
  // Omitted options inherit the deployment policy rather than silently
  // disabling the costlier escape hatch for an unwrapped caller.
  process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY = "0";
  process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK = "1";
  assert.equal(
    (await assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getGpuAvailability: async () => ({ available_gpu_medium: 0, available_gpu_high: 2 }),
      },
    })).capacityMode,
    "high",
    "direct H3 admission must inherit the enabled high fallback policy",
  );
  process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK = "0";
  await assert.rejects(
    () => assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getGpuAvailability: async () => ({ available_gpu_medium: 0, available_gpu_high: 2 }),
      },
    }),
    /high-priority fallback is disabled|capacity is insufficient|exact desktop RTX 5090/,
    "direct H3 admission must honor an explicitly disabled high fallback",
  );
  process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY = "1";
  process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK = "1";
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(1, {
      client: {
        listGpuClasses: async () => [{ ...classes[0]!, prices: [{ price: "0.58", priority: "high" as const }] }],
        getGpuAvailability: async () => ({ available_gpu_medium: 1, available_gpu_high: 1 }),
      },
      allowHighPriorityFallback: true,
    }),
    { requiredGpuCount: 1, availableGpuCount: 1, gpuClassId: classes[0]!.id, selectedPriceUsdPerHour: 0.58, capacityMode: "high", fallbackUsed: true },
    "a missing medium price must not silently dispatch medium; explicit high fallback may still proceed",
  );
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(2, {
      client: {
        listGpuClasses: async () => [{ ...classes[0]!, prices: [{ price: "0.58", priority: "high" as const }] }],
        getGpuAvailability: async () => ({ available_gpu_high: 2 }),
        getOccupiedGpuSlots: async () => 0,
      },
      allowHighPriorityFallback: true,
    }),
    { requiredGpuCount: 2, availableGpuCount: 2, gpuClassId: classes[0]!.id, selectedPriceUsdPerHour: 0.58, capacityMode: "high", fallbackUsed: true },
    "when medium is absent from Salad discovery entirely, a priced exact high tier may unlock the wave",
  );
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getGpuAvailability: async () => ({ available_gpu_medium: 3, available_gpu_high: 2 }),
      },
      allowHighPriorityFallback: true,
      preferHighPriority: true,
    }),
    { requiredGpuCount: 2, availableGpuCount: 2, gpuClassId: classes[0]!.id, selectedPriceUsdPerHour: 0.58, capacityMode: "high", fallbackUsed: true },
    "a replay of an already-upgraded fleet lease must remain on high even if medium returns later",
  );
  assert.deepEqual(
    await assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getGpuAvailability: async () => ({ available_gpu_medium: 2, available_gpu_high: 2 }),
      },
      mediumPriorityEnabled: false,
      allowHighPriorityFallback: true,
    }),
    { requiredGpuCount: 2, availableGpuCount: 2, gpuClassId: classes[0]!.id, selectedPriceUsdPerHour: 0.58, capacityMode: "high", fallbackUsed: true },
    "a disabled medium deployment must not report medium admission when high can unlock the wave",
  );
  let leaseReads = 0;
  await assert.rejects(
    () => assertMiniMaxH3SaladCapacity(2, {
      client: {
        ...capacityClient,
        getOccupiedGpuSlots: async () => {
          leaseReads += 1;
          return leaseReads === 1 ? 0 : 2;
        },
      },
      allowHighPriorityFallback: true,
    }),
    /account capacity is occupied/,
    "a concurrent lease acquired after the market snapshot must block both medium and high dispatch",
  );
  assert.equal(leaseReads, 2, "capacity admission must re-read the shared lease after market availability");
  configure("salad"); configure("novita"); configure("openrelay");
  const salad = request("salad", "weekly-batch");
  let seen: Record<string, unknown> | undefined;
  let spendFenceCalls = 0;
  const rendered = await renderMiniMaxH3(salad, {
    presignRead: async () => "https://r2.example/read",
    presignWrite: async () => "https://r2.example/write",
    readObject: async (key) => key.endsWith("frame.png") ? firstFrame : output,
    assertModelManifest: async () => {},
    verifyOpeningMotion: passingOpeningMotion,
    beforeProviderSpend: async () => { spendFenceCalls += 1; },
    fetch: async (_url, init) => {
      assert.equal(spendFenceCalls, 1, "the durable ownership fence must run immediately before H3 provider submission");
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
  assert.equal(seen?.capacity_mode, MINIMAX_H3_SALAD_CAPACITY_MODE);
  assert.equal(spendFenceCalls, 1, "one H3 submission must make exactly one final ownership assertion");
  assert.equal(rendered.openingMotionQa?.verdict, "pass", "the default shared H3 path must attach opening-motion evidence");

  const openRelayFallback = request("openrelay", "weekly-fallback", "owner/o/channel/c/openrelay.mp4");
  const openRelayRendered = await renderMiniMaxH3(openRelayFallback, {
    presignRead: async () => "https://r2.example/read",
    presignWrite: async () => "https://r2.example/write",
    readObject: async (key) => key.endsWith("frame.png") ? firstFrame : output,
    assertModelManifest: async () => {},
    verifyOpeningMotion: passingOpeningMotion,
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-api-key"), "o".repeat(32), "OpenRelay account auth must terminate at its private gateway");
      assert.equal(headers.get("x-worker-authorization"), "Bearer " + "x".repeat(32), "the worker must receive its dedicated authorization header");
      assert.equal(headers.get("authorization"), null, "the gateway key must not be reused as worker authorization");
      seen = JSON.parse(String(init?.body));
      const reply = responseFor(openRelayFallback);
      const body = await reply.json() as { receipt: Record<string, unknown> };
      body.receipt.requestKey = String(seen?.request_key);
      body.receipt.promptSha256 = sha256Hex(openRelayFallback.prompt);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(openRelayRendered.receipt.runtime.provider, "openrelay");
  assert.equal(seen?.capacity_mode, MINIMAX_H3_OPENRELAY_CAPACITY_MODE);

  const novitaFallback = request("novita", "weekly-fallback", "owner/o/channel/c/novita-fallback.mp4");
  const novitaRendered = await renderMiniMaxH3(novitaFallback, {
    presignRead: async () => "https://r2.example/read",
    presignWrite: async () => "https://r2.example/write",
    readObject: async (key) => key.endsWith("frame.png") ? firstFrame : output,
    assertModelManifest: async () => {},
    verifyOpeningMotion: passingOpeningMotion,
    fetch: async (_url, init) => {
      seen = JSON.parse(String(init?.body));
      const reply = responseFor(novitaFallback);
      const body = await reply.json() as { receipt: Record<string, unknown> };
      body.receipt.requestKey = String(seen?.request_key);
      body.receipt.promptSha256 = sha256Hex(novitaFallback.prompt);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(novitaRendered.receipt.runtime.provider, "novita", "the terminal weekly route must honour the Novita fallback");
  assert.equal(seen?.capacity_mode, "spot");

  let reconciliationPolls = 0;
  const reconciledOpenRelay = await renderMiniMaxH3(openRelayFallback, {
    presignRead: async () => "https://r2.example/read",
    presignWrite: async () => "https://r2.example/write",
    readObject: async (key) => key.endsWith("frame.png") ? firstFrame : output,
    assertModelManifest: async () => {},
    verifyOpeningMotion: passingOpeningMotion,
    openRelayReceiptWait: async () => {},
    openRelayReceiptPollTimeoutMs: 100,
    fetch: async (url, init) => {
      if (init?.method === "POST") {
        seen = JSON.parse(String(init.body));
        return new Response("upstream produced no response", { status: 504 });
      }
      assert.equal(String(url).endsWith(`/${seen?.request_key}`), true, "gateway timeout must reconcile the exact idempotency key");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-api-key"), "o".repeat(32));
      assert.equal(headers.get("x-worker-authorization"), "Bearer " + "x".repeat(32));
      reconciliationPolls += 1;
      if (reconciliationPolls === 1) return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
      const reply = responseFor(openRelayFallback);
      const body = await reply.json() as { receipt: Record<string, unknown> };
      body.receipt.requestKey = String(seen?.request_key);
      body.receipt.promptSha256 = sha256Hex(openRelayFallback.prompt);
      return new Response(JSON.stringify({ status: "complete", receipt: body.receipt }), { status: 200 });
    },
  });
  assert.equal(reconciledOpenRelay.receipt.runtime.provider, "openrelay");
  assert.equal(reconciliationPolls, 2, "a gateway timeout must poll the retained receipt without submitting a second render");

  await assert.rejects(
    () => renderMiniMaxH3(salad, {
      presignRead: async () => "https://r2.example/read",
      presignWrite: async () => "https://r2.example/write",
      readObject: async (key) => key.endsWith("frame.png") ? firstFrame : output,
      assertModelManifest: async () => {},
      verifyOpeningMotion: ({ durationSec }) => {
        throw new MiniMaxH3OpeningMotionRejectedError({
          contract: "minimax-h3-opening-motion-qa/v1",
          source: "ffmpeg/freezedetect+ssim",
          verdict: "fail",
          durationSec,
          maxFreezeFraction: 0.1,
          maxStaticHoldSec: durationSec * 0.1,
          maxOpeningFrozenHoldSec: 0.125,
          maxFrozenHoldSec: 0.25,
          openingFrozenHoldSec: 0.25,
          frozenIntervals: [{ startSec: 0, endSec: 0.25, durationSec: 0.25 }],
          violatingIntervals: [{ startSec: 0, endSec: 0.25, durationSec: 0.25 }],
          detail: "fixture holds its conditioning frame",
        }, "shared H3 fixture");
      },
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { request_key: string };
        const reply = responseFor(salad);
        const receipt = await reply.json() as { receipt: Record<string, unknown> };
        receipt.receipt.requestKey = body.request_key;
        receipt.receipt.promptSha256 = sha256Hex(salad.prompt);
        return new Response(JSON.stringify(receipt), { status: 200, headers: { "content-type": "application/json" } });
      },
    }),
    (error: unknown) =>
      error instanceof MiniMaxH3OpeningMotionRejectedRenderError &&
      error.observedCostUsd === 0.2 &&
      error.evidence.openingFrozenHoldSec === 0.25,
    "the shared H3 boundary must deny a frozen output while retaining exact paid-work evidence",
  );

  // The selected high fallback must still dispatch when the medium flag is
  // absent; this exercises the actual paid-route readiness seam, not only
  // the pure readiness projection.
  delete process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY;
  process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK = "1";
  const high = await renderMiniMaxH3(salad, {
    saladCapacityMode: "high",
    presignRead: async () => "https://r2.example/read",
    presignWrite: async () => "https://r2.example/write",
    readObject: async (key) => key.endsWith("frame.png") ? firstFrame : output,
    assertModelManifest: async () => {},
    verifyOpeningMotion: passingOpeningMotion,
    fetch: async (_url, init) => {
      seen = JSON.parse(String(init?.body));
      const reply = responseFor(salad, "high");
      const body = await reply.json() as { receipt: Record<string, unknown> };
      body.receipt.requestKey = String(seen?.request_key);
      body.receipt.promptSha256 = sha256Hex(salad.prompt);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(high.receipt.runtime.capacityMode, "high");
  assert.equal(seen?.capacity_mode, "high");

  // A capacity admission may deliberately choose high when medium is
  // unavailable. Readiness must honour that selected tier instead of
  // re-blocking the paid request on the medium-only feature flag.
  configure("salad");
  process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY = "0";
  process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK = "1";
  assert.equal(minimaxH3Readiness("salad", { saladCapacityMode: "high" }).admitted, true);
  assert.equal(minimaxH3Readiness("salad", { saladCapacityMode: "medium" }).admitted, false);
  process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY = "1";

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
  let batchModelManifestChecks = 0;
  const completedIndices: number[] = [];
  const batched = await renderMiniMaxH3WeeklyBatch(jobs, {
    presignRead: async () => "https://r2.example/read",
    presignWrite: async () => "https://r2.example/write",
    readObject: async (key) => key.endsWith("frame.png") ? firstFrame : output,
    assertModelManifest: async () => { batchModelManifestChecks += 1; },
    verifyOpeningMotion: passingOpeningMotion,
    onJobComplete: async (index) => { completedIndices.push(index); },
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
  assert.equal(batchModelManifestChecks, 1, "weekly H3 jobs must share one immutable model-manifest verification");
  assert.equal(sharedOpeningMotionChecks, 9, "the shared gate must inspect every default H3 result, including both terminal fallback routes");
  assert.deepEqual(completedIndices.sort((a, b) => a - b), [0, 1, 2, 3], "durable batch hooks must observe every verified shot");

  let failedBatchModelManifestChecks = 0;
  await assert.rejects(
    () => renderMiniMaxH3WeeklyBatch(jobs.slice(0, 2), {
      assertModelManifest: () => {
        failedBatchModelManifestChecks += 1;
        throw new Error("manifest verifier failed");
      },
      fetch: async () => { throw new Error("provider must not be contacted"); },
    }),
    /manifest verifier failed/,
  );
  assert.equal(failedBatchModelManifestChecks, 1, "weekly H3 manifest failures must be shared, not retried per job");
}
void test().finally(() => { process.env = saved; }).then(() => console.log("minimax H3 contract tests passed"));
