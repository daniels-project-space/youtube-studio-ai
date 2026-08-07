import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NOVITA_FLEET_CONTRACT_VERSION,
  NOVITA_HARD_GPU_LIMIT,
  OFFICIAL_RENDER_PINS,
  type NovitaFleetAttestation,
} from "@/lib/novitaFleet";
import { GET } from "./route";

const INTERNAL_TOKEN = "studio-test-service-token-that-is-long-enough";
const BRIDGE_TOKEN = "novita-test-bridge-token-that-never-leaves-server";

function attestation(activeInstanceCount = 1): NovitaFleetAttestation {
  return {
    ok: true,
    contractVersion: NOVITA_FLEET_CONTRACT_VERSION,
    dispatchReady: true,
    provider: {
      activeInstanceCount,
      verifiedGpuQuota: 3,
      compatibleProductId: "private-product-id",
      inventoryState: "high",
      spotPriceUsdPerHour: 0.17,
    },
    registry: {
      authConfigured: true,
      workerImage: `private.registry/worker@sha256:${"a".repeat(64)}`,
      imagePrewarmed: true,
    },
    storage: {
      volumeName: "ai-infra-models",
      volumeSizeGb: 200,
      clusterId: "private-cluster-id",
      modelManifestSha256: "b".repeat(64),
    },
    models: {
      gemma: {
        model: OFFICIAL_RENDER_PINS.gemma.model,
        revision: "c".repeat(40),
        localCacheVerified: true,
      },
      zImage: { ...OFFICIAL_RENDER_PINS.zImage, localCacheVerified: true },
      ltx: {
        model: OFFICIAL_RENDER_PINS.ltx.model,
        revision: OFFICIAL_RENDER_PINS.ltx.revision,
        runtimeRepository: OFFICIAL_RENDER_PINS.ltx.runtimeRepository,
        runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
        localCacheVerified: true,
        twoStageHqVerified: true,
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

function healthRequest(authenticated = true): Request {
  return new Request("https://studio.test/api/novita-render?health=1", {
    headers: authenticated ? { authorization: `Bearer ${INTERNAL_TOKEN}` } : undefined,
  });
}

async function main() {
  const originalFetch = globalThis.fetch;
  const originalInternalToken = process.env.STUDIO_INTERNAL_API_TOKEN;
  const originalBridgeApi = process.env.NOVITA_RENDER_FARM_API;
  const originalBridgeToken = process.env.NOVITA_RENDER_FARM_TOKEN;
  process.env.STUDIO_INTERNAL_API_TOKEN = INTERNAL_TOKEN;
  process.env.NOVITA_RENDER_FARM_API = "https://bridge.test/render";
  process.env.NOVITA_RENDER_FARM_TOKEN = BRIDGE_TOKEN;

  try {
    let providerCalls = 0;
    let providerResponse: Response = Response.json(attestation());
    globalThis.fetch = async (input, init) => {
      providerCalls += 1;
      assert.equal(String(input), "https://bridge.test/render/health");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${BRIDGE_TOKEN}`);
      return providerResponse;
    };

    const readyResponse = await GET(healthRequest());
    assert.equal(readyResponse.status, 200);
    assert.equal(readyResponse.headers.get("cache-control"), "no-store");
    const ready = await readyResponse.json() as {
      ready: boolean;
      architecturalGpuCeiling: number;
      verifiedGpuQuota: number;
      effectiveGpuLimit: number;
      activeGpuCount: number;
      blockers: string[];
      contract: { version: string; dispatchReady: boolean };
      models: { zImage: { name: string }; ltx: { twoStageHqVerified: boolean } };
      storage: { persistentModelVolumeVerified: boolean; volumeSizeGb: number };
      controls: { r2CheckpointRecovery: boolean; verifiedReaper: boolean };
    };
    assert.equal(providerCalls, 1);
    assert.equal(ready.ready, true);
    assert.equal(ready.architecturalGpuCeiling, 8);
    assert.equal(ready.verifiedGpuQuota, 3);
    assert.equal(ready.activeGpuCount, 1);
    assert.equal(ready.effectiveGpuLimit, 2);
    assert.deepEqual(ready.blockers, []);
    assert.equal(ready.contract.version, NOVITA_FLEET_CONTRACT_VERSION);
    assert.equal(ready.contract.dispatchReady, true);
    assert.equal(ready.models.zImage.name, OFFICIAL_RENDER_PINS.zImage.model);
    assert.equal(ready.models.ltx.twoStageHqVerified, true);
    assert.equal(ready.storage.persistentModelVolumeVerified, true);
    assert.equal(ready.storage.volumeSizeGb, 200);
    assert.equal(ready.controls.r2CheckpointRecovery, true);
    assert.equal(ready.controls.verifiedReaper, true);

    const serializedReady = JSON.stringify(ready);
    for (const privateValue of [
      BRIDGE_TOKEN,
      "bridge.test",
      "private-product-id",
      "private-cluster-id",
      "private.registry",
      OFFICIAL_RENDER_PINS.zImage.revision,
    ]) {
      assert.equal(serializedReady.includes(privateValue), false, `health response leaked ${privateValue}`);
    }

    providerResponse = Response.json(attestation(3));
    const blockedResponse = await GET(healthRequest());
    assert.equal(blockedResponse.status, 503);
    const blocked = await blockedResponse.json() as {
      ready: boolean;
      verifiedGpuQuota: null;
      effectiveGpuLimit: null;
      blockers: string[];
      contract: null;
    };
    assert.equal(blocked.ready, false);
    assert.equal(blocked.verifiedGpuQuota, null);
    assert.equal(blocked.effectiveGpuLimit, null);
    assert.deepEqual(blocked.blockers, ["verified_gpu_capacity_exhausted"]);
    assert.equal(blocked.contract, null);
    assert.equal(JSON.stringify(blocked).includes(BRIDGE_TOKEN), false);

    providerResponse = Response.json({}, { status: 502 });
    const unavailableResponse = await GET(healthRequest());
    assert.equal(unavailableResponse.status, 503);
    const unavailable = await unavailableResponse.json() as { ready: boolean; blockers: string[] };
    assert.equal(unavailable.ready, false);
    assert.deepEqual(unavailable.blockers, ["fleet_readiness_unavailable"]);

    providerCalls = 0;
    const unauthorizedResponse = await GET(healthRequest(false));
    assert.equal(unauthorizedResponse.status, 401);
    assert.equal(providerCalls, 0, "authentication must happen before credential or provider access");

    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(source, /await requireStudioActor\(request\);[\s\S]*searchParams\.get\("health"\) === "1"/);
    assert.match(source, /NOVITA_HEALTH_SECRET_KEYS = \[\s*"NOVITA_RENDER_FARM_API",\s*"NOVITA_RENDER_FARM_TOKEN"/);
    assert.match(source, /getOne\("novita", key\)/);
    assert.doesNotMatch(source, /bootstrapSecrets/);
    assert.match(source, /getNovitaRenderStatus\(jobId\.data\)/, "existing job-status GET must remain intact");
    assert.match(source, /isDeepStrictEqual\(status\.profile, expectedProfile\)/, "status profile validation must remain intact");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("STUDIO_INTERNAL_API_TOKEN", originalInternalToken);
    restoreEnv("NOVITA_RENDER_FARM_API", originalBridgeApi);
    restoreEnv("NOVITA_RENDER_FARM_TOKEN", originalBridgeToken);
  }

  console.log("Novita render fleet health route tests passed");
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
