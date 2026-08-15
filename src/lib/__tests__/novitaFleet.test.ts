import assert from "node:assert/strict";
import {
  NOVITA_FLEET_CONTRACT_VERSION,
  NOVITA_HARD_GPU_LIMIT,
  OFFICIAL_RENDER_PINS,
  NovitaAdmissionError,
  NovitaGpuApiClient,
  assessNovitaFleetReadiness,
  boundedNovitaPollSchedule,
  buildNovitaCreateWorkerRequest,
  compileImmutableRenderManifest,
  isRtx4090Sku,
  planNovitaCapacityWaves,
  requireNovitaFleetReadiness,
  selectRtx4090SpotProduct,
  selectIdleReapCandidates,
  type NovitaFleetAttestation,
} from "@/lib/novitaFleet";
import {
  assertRtx4090VideoRuntime,
  automaticRtx4090Concurrency,
  budgetBoundedWorkerLifetime,
} from "@/lib/novitaDirectRender";
import { generationProfile } from "@/engine/generationProfiles";
import { toNovitaPhaseProfile } from "@/lib/novitaRenderFarm";

function attestation(): NovitaFleetAttestation {
  return {
    ok: true,
    contractVersion: NOVITA_FLEET_CONTRACT_VERSION,
    dispatchReady: true,
    provider: {
      activeInstanceCount: 0,
      verifiedGpuQuota: 3,
      compatibleProductId: "4090.16c96g.v2",
      inventoryState: "high",
      spotPriceUsdPerHour: 0.17,
    },
    registry: {
      authConfigured: true,
      workerImage: `ghcr.io/daniels-project-space/youtube-render-worker@sha256:${"a".repeat(64)}`,
      imagePrewarmed: true,
    },
    storage: {
      volumeName: "ai-infra-models",
      volumeSizeGb: 200,
      clusterId: "us-ca-nas-2",
      modelManifestSha256: "b".repeat(64),
    },
    models: {
      zImage: { ...OFFICIAL_RENDER_PINS.zImage, localCacheVerified: true },
      ltx: {
        ...OFFICIAL_RENDER_PINS.ltx,
        localCacheVerified: true,
        distilledTwoStageX2Verified: true,
        rtx4090ProfileBenchmarked: true,
      },
    },
    controls: {
      hardGpuLimit: NOVITA_HARD_GPU_LIMIT,
      capacityAwareWaves: true,
      checkpointStore: "r2",
      interruptionRecovery: true,
      idleShutdownSeconds: 300,
      reaperEnabled: true,
      deleteVerification: true,
      workerHasProviderCredentials: false,
      workerHasObjectStoreCredentials: false,
      statusBatchSeconds: 60,
    },
    budget: { maxJobUsd: 2, maxFleetUsd: 10, admissionRequired: true },
  };
}

async function main() {
  const ready = assessNovitaFleetReadiness(attestation());
  assert.equal(ready.ready, true);
  assert.equal(ready.effectiveGpuLimit, 3);

  const partiallyOccupied = attestation();
  partiallyOccupied.provider.activeInstanceCount = 2;
  const oneSlotLeft = assessNovitaFleetReadiness(partiallyOccupied);
  assert.equal(oneSlotLeft.ready, true);
  assert.equal(oneSlotLeft.effectiveGpuLimit, 1);

  const exhausted = attestation();
  exhausted.provider.activeInstanceCount = 3;
  const noSlotsLeft = assessNovitaFleetReadiness(exhausted);
  assert.equal(noSlotsLeft.ready, false);
  assert(noSlotsLeft.blockers.includes("verified_gpu_capacity_exhausted"));

  const contradictoryBudget = attestation();
  contradictoryBudget.budget.maxJobUsd = 11;
  assert(assessNovitaFleetReadiness(contradictoryBudget).blockers.includes("spend_admission_missing"));

  const legacy = assessNovitaFleetReadiness({ ok: true, contractVersion: "1.0.0" });
  assert.equal(legacy.ready, false);
  assert(legacy.blockers.includes("bridge_contract_not_v2"));
  assert(legacy.blockers.includes("worker_image_not_digest_pinned"));

  const credentialLeak = attestation();
  credentialLeak.controls.workerHasObjectStoreCredentials = true;
  assert(assessNovitaFleetReadiness(credentialLeak).blockers.includes("worker_credentials_not_scoped"));

  const jobIds = Array.from({ length: 8 }, (_, index) => `shot-${index + 1}`);
  const provenQuota = planNovitaCapacityWaves({
    jobIds,
    requestedWorkers: 8,
    inventoryState: "high",
    spotPriceUsdPerHour: 0.17,
    estimatedMinutesPerJob: 20,
    maxBudgetUsd: 2,
  });
  assert.equal(provenQuota.workerCount, 3);
  assert.deepEqual(provenQuota.waves.map((wave) => wave.length), [3, 3, 2]);

  const verifiedEight = planNovitaCapacityWaves({
    jobIds,
    requestedWorkers: 8,
    verifiedGpuQuota: 8,
    inventoryState: "high",
    spotPriceUsdPerHour: 0.17,
    estimatedMinutesPerJob: 20,
    maxBudgetUsd: 2,
  });
  assert.equal(verifiedEight.workerCount, 8);
  assert.equal(verifiedEight.waves.length, 1);

  const normalInventory = planNovitaCapacityWaves({
    jobIds,
    requestedWorkers: 8,
    verifiedGpuQuota: 8,
    inventoryState: "normal",
    spotPriceUsdPerHour: 0.17,
    estimatedMinutesPerJob: 10,
    maxBudgetUsd: 2,
  });
  // A live "normal" signal still admits the verified 8×4090 quota; the
  // controller independently re-checks availability before each one-GPU create.
  assert.equal(normalInventory.workerCount, 8);

  const oneJobPerWorker = planNovitaCapacityWaves({
    jobIds: ["shot-a", "shot-b", "shot-c", "shot-d"],
    requestedWorkers: 1,
    verifiedGpuQuota: 1,
    inventoryState: "high",
    spotPriceUsdPerHour: 1,
    estimatedMinutesPerJob: 1,
    coldStartMinutes: 1,
    coldStartPerJob: true,
    maxBudgetUsd: 1,
  });
  assert.equal(oneJobPerWorker.estimatedUpperCostUsd, 0.1334);

  assert.equal(automaticRtx4090Concurrency(Array.from({ length: 7 }, () => ({ seconds: 5 }))), 1);
  assert.equal(automaticRtx4090Concurrency(Array.from({ length: 8 }, () => ({ seconds: 5 }))), 8);
  assert.equal(automaticRtx4090Concurrency(Array.from({ length: 5 }, () => ({ seconds: 12 }))), 8);
  assert.equal(budgetBoundedWorkerLifetime({ maximumCostUsd: 0.4, hourlyRate: 0.17 }).maxRuntimeSeconds, 7_200);
  assert(budgetBoundedWorkerLifetime({ maximumCostUsd: 0.35, hourlyRate: 0.17 }).maxRuntimeSeconds < 7_200);
  assert(budgetBoundedWorkerLifetime({ maximumCostUsd: 0.1, hourlyRate: 0.17 }).maxRuntimeSeconds < 7_200);
  assert.throws(() => budgetBoundedWorkerLifetime({ maximumCostUsd: 0.001, hourlyRate: 0.17 }), NovitaAdmissionError);
  assert.throws(
    () => assertRtx4090VideoRuntime(toNovitaPhaseProfile(generationProfile("production"), "video")),
    /ltx_2_5_revision_not_benchmarked_on_rtx_4090/,
  );

  assert.throws(
    () => planNovitaCapacityWaves({
      jobIds,
      verifiedGpuQuota: 8,
      inventoryState: "high",
      spotPriceUsdPerHour: 0.17,
      estimatedMinutesPerJob: 30,
      maxBudgetUsd: 0.1,
    }),
    NovitaAdmissionError,
  );

  const schedule = boundedNovitaPollSchedule(12);
  assert.equal(schedule.length, 12);
  assert.equal(schedule[0], 5_000);
  assert.equal(schedule.at(-1), 60_000);
  assert.throws(() => boundedNovitaPollSchedule(241));

  const manifestInput = {
    phase: "video" as const,
    profile: { model: OFFICIAL_RENDER_PINS.ltx.model, revision: OFFICIAL_RENDER_PINS.ltx.revision },
    jobIds: ["shot-1"],
    outputPrefix: "runs/test/video",
    maxCostUsd: 1,
    expiresAt: Date.now() + 3_600_000,
  };
  const firstManifest = compileImmutableRenderManifest(manifestInput);
  const secondManifest = compileImmutableRenderManifest(manifestInput);
  assert.equal(firstManifest.manifestSha256, secondManifest.manifestSha256);
  assert.match(firstManifest.manifestId, /^video-[a-f0-9]{32}$/);
  assert.notEqual(
    firstManifest.manifestSha256,
    compileImmutableRenderManifest({ ...manifestInput, jobIds: ["shot-2"] }).manifestSha256,
  );

  const requestArgs = {
    name: "yt-render-video-0001",
    productId: "4090.16c96g.v2",
    gpuSku: "NVIDIA GeForce RTX 4090 24GB",
    clusterId: "us-ca-nas-2",
    storageId: "storage-id",
    image: `ghcr.io/daniels-project-space/youtube-render-worker@sha256:${"c".repeat(64)}`,
    imageAuthId: "registry-auth-id",
    manifestUrl: "https://signed.example/manifest.json?signature=redacted",
    manifestSha256: "d".repeat(64),
    approval: verifiedEight,
  };
  const request = buildNovitaCreateWorkerRequest(requestArgs);
  assert.equal(request.gpuNum, 1);
  assert.equal(request.billingMode, "spot");
  assert.deepEqual(request.networkStorages, [{ Id: "storage-id", mountPoint: "/network" }]);
  assert(!request.envs.some((item) => /SECRET|ACCESS_KEY|API_KEY|TOKEN/.test(item.key)));
  const publicRequest = buildNovitaCreateWorkerRequest({
    ...requestArgs,
    imageAuthId: undefined,
    publicImage: true,
  });
  assert.equal("imageAuthId" in publicRequest, false);
  assert.throws(
    () => buildNovitaCreateWorkerRequest({ ...requestArgs, imageAuthId: undefined }),
    /registry authentication, or be the approved public GHCR worker/,
  );
  assert.throws(
    () => buildNovitaCreateWorkerRequest({
      ...requestArgs,
      image: `ghcr.io/example/untrusted-worker@sha256:${"e".repeat(64)}`,
      imageAuthId: undefined,
      publicImage: true,
    }),
    /registry authentication, or be the approved public GHCR worker/,
  );

  assert.equal(isRtx4090Sku("RTX 4090"), true);
  assert.equal(isRtx4090Sku("NVIDIA GeForce RTX 4090 24GB"), true);
  assert.equal(isRtx4090Sku("RTX 4090D"), false);
  assert.equal(isRtx4090Sku("NVIDIA H100 80GB HBM3"), false);
  assert.throws(
    () => buildNovitaCreateWorkerRequest({ ...requestArgs, gpuSku: "RTX 4090D" }),
    /exactly RTX 4090/,
  );
  assert.throws(
    () => selectRtx4090SpotProduct([{
      id: "h100.8c80g",
      name: "NVIDIA H100 80GB HBM3",
      gpuCount: 1,
      availableDeploy: true,
      inventoryState: "high",
      spotPriceUsdPerHour: 2.5,
      regions: ["US-CA-NAS-02 (California)"],
    }], "h100.8c80g"),
    /RTX 4090/,
  );

  const now = Date.now();
  assert.deepEqual(selectIdleReapCandidates([
    { id: "owned", name: "yt-render-video-abcd", status: "running", lastHeartbeatAt: now - 301_000 },
    { id: "fresh", name: "yt-render-video-fresh", status: "running", lastHeartbeatAt: now - 30_000 },
    { id: "foreign", name: "other-service", status: "running", lastHeartbeatAt: 0 },
  ], now), ["owned"]);

  let readinessCalls = 0;
  const fetched = await requireNovitaFleetReadiness({
    baseUrl: "https://bridge.example/render/",
    token: "test-token-that-is-never-returned",
    fetchImpl: async (input, init) => {
      readinessCalls += 1;
      assert.equal(String(input), "https://bridge.example/render/health");
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-token-that-is-never-returned");
      assert.equal(init?.method, undefined);
      return Response.json(attestation());
    },
  });
  assert.equal(fetched.ready, true);
  assert.equal(readinessCalls, 1);

  const providerCalls: string[] = [];
  let instanceReads = 0;
  const provider = new NovitaGpuApiClient("provider-test-key-that-is-long-enough", async (input, init) => {
    const url = String(input);
    const parsedUrl = new URL(url);
    providerCalls.push(`${init?.method ?? "GET"} ${parsedUrl.pathname}${parsedUrl.search}`);
    if (url.includes("/products?")) {
      assert.equal(parsedUrl.searchParams.get("productName"), "4090");
      assert.equal(parsedUrl.searchParams.get("billingMethod"), "spot");
      assert.equal(parsedUrl.searchParams.get("gpuNum"), "1");
      return Response.json({ data: [{
      id: "4090.16c96g.v2", name: "RTX 4090 24GB", gpuNum: 1, availableDeploy: true,
      inventoryState: "high", spotPrice: "17000", regions: ["US-CA-NAS-02 (California)"],
      }] });
    }
    if (url.includes("/gpu/instances?")) return Response.json({ instances: [] });
    if (url.includes("/networkstorages/list")) return Response.json({ data: [{
      storageId: "volume-id", storageName: "ai-infra-models", storageSize: 200,
      clusterId: "us-ca-nas-2", clusterName: "US-CA-NAS-02 (California)",
    }] });
    if (url.endsWith("/repository/auths")) return Response.json({ data: [{
      id: "registry-id", name: "ghcr", username: "must-not-leak", password: "must-not-leak",
    }] });
    if (url.endsWith("/image/prewarm") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(body.imageUrl, requestArgs.image);
      assert.equal("repositoryAuth" in body, false);
      assert.deepEqual(body.productIds, ["4090.16c96g.v2"]);
      return Response.json({ id: "prewarm-123" });
    }
    if (url.includes("/image/prewarm")) {
      assert.equal(parsedUrl.searchParams.get("page"), "1");
      assert.equal(parsedUrl.searchParams.get("pageSize"), "100");
      return Response.json({ data: [{
        state: "Succeeded",
        imageUrl: `ghcr.io/daniels-project-space/youtube-render-worker@sha256:${"a".repeat(64)}`,
      }] });
    }
    if (url.endsWith("/gpu/instance/create")) return Response.json({ id: "instance-123" });
    if (url.endsWith("/gpu/instance/stop") || url.endsWith("/gpu/instance/delete")) return Response.json({});
    if (url.includes("/gpu/instance?instanceId=")) {
      instanceReads += 1;
      return Response.json({ status: instanceReads === 1 ? "running" : "removed" });
    }
    return Response.json({}, { status: 404 });
  });
  const snapshot = await provider.accountSnapshot();
  assert.equal(snapshot.products[0]?.spotPriceUsdPerHour, 0.17);
  assert.equal(snapshot.products[0]?.gpuCount, 1);
  assert.equal(snapshot.volumes[0]?.storageName, "ai-infra-models");
  assert.equal(snapshot.registryAuthCount, 1);
  assert.deepEqual(snapshot.prewarmedImageDigests, [`sha256:${"a".repeat(64)}`]);
  assert.equal(JSON.stringify(snapshot).includes("must-not-leak"), false);
  assert.equal(await provider.createImagePrewarm({
    image: requestArgs.image,
    clusterId: "us-ca-nas-2",
    productIds: ["4090.16c96g.v2"],
    note: "sealed LTX worker prewarm",
  }), "prewarm-123");
  assert.equal(await provider.createSpotWorker(request), "instance-123");
  const waits: number[] = [];
  await provider.deleteAndVerify("instance-123", async (milliseconds) => { waits.push(milliseconds); });
  assert.deepEqual(waits, [5_000]);
  assert.equal(providerCalls.filter((call) => call.includes("/gpu/instance/create")).length, 1);
  assert.equal(providerCalls.filter((call) => call.includes("/gpu/instance/stop")).length, 1);
  assert.equal(providerCalls.filter((call) => call.includes("/gpu/instance/delete")).length, 1);
  assert.equal(providerCalls.filter((call) => call.includes("/gpu/instance?")).length, 2);

  // A managed worker can be beyond page 0. Its absence is used as a billing
  // proof, so pagination must be complete rather than an optimistic first page.
  const paginatedProvider = new NovitaGpuApiClient("provider-test-key-that-is-long-enough", async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("pageNum"));
    if (url.pathname.endsWith("/gpu/instances") && page === 0) {
      return Response.json({
        total: 101,
        instances: Array.from({ length: 100 }, (_, index) => ({
          id: `foreign-${index}`,
          name: `other-service-${index}`,
          status: "running",
        })),
      });
    }
    if (url.pathname.endsWith("/gpu/instances") && page === 1) {
      return Response.json({
        total: 101,
        instances: [{ id: "late-worker", name: "yt-render-4090-late-page", status: "running" }],
      });
    }
    return Response.json({}, { status: 404 });
  });
  assert.deepEqual(await paginatedProvider.listManagedInstances(), [{
    id: "late-worker",
    name: "yt-render-4090-late-page",
    status: "running",
  }]);

  console.log("novita fleet production contract tests passed");
}

void main();
