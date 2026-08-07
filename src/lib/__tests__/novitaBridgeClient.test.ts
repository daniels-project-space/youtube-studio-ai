import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { generationProfile } from "@/engine/generationProfiles";
import { NOVITA_FLEET_CONTRACT_VERSION, NOVITA_HARD_GPU_LIMIT, OFFICIAL_RENDER_PINS } from "@/lib/novitaFleet";
import {
  getNovitaRenderStatus,
  launchImages,
  renderImages,
  toNovitaPhaseProfile,
  type NovitaRenderCfg,
} from "@/lib/novitaRenderFarm";

const TOKEN = "novita-test-token-that-is-longer-than-thirty-two-characters";
const JOB_ID = "image-0123456789abcdef0123456789abcdef";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("undefined contract value");
  return encoded;
}

async function main() {
  process.env.NOVITA_RENDER_FARM_API = "https://render.test/render";
  process.env.NOVITA_RENDER_FARM_TOKEN = TOKEN;
  const profile = toNovitaPhaseProfile(generationProfile("production"), "image");
  const originalFetch = globalThis.fetch;
  let launchBody = "";
  let launchCalls = 0;
  let statusCalls = 0;
  let receiptCostUsd = 0.00005;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://render.test/render/health") {
      return Response.json({
        ok: true,
        contractVersion: NOVITA_FLEET_CONTRACT_VERSION,
        dispatchReady: true,
        provider: { activeInstanceCount: 0, verifiedGpuQuota: 3, compatibleProductId: "4090", inventoryState: "high", spotPriceUsdPerHour: 0.17 },
        registry: { authConfigured: true, workerImage: `ghcr.io/example/worker@sha256:${"a".repeat(64)}`, imagePrewarmed: true },
        storage: { volumeName: "ai-infra-models", volumeSizeGb: 200, clusterId: "us-ca-nas-2", modelManifestSha256: "b".repeat(64) },
        models: {
          gemma: { model: OFFICIAL_RENDER_PINS.gemma.model, revision: "c".repeat(40), localCacheVerified: true },
          zImage: { ...OFFICIAL_RENDER_PINS.zImage, localCacheVerified: true },
          ltx: { model: OFFICIAL_RENDER_PINS.ltx.model, revision: OFFICIAL_RENDER_PINS.ltx.revision, runtimeRepository: OFFICIAL_RENDER_PINS.ltx.runtimeRepository, runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision, localCacheVerified: true, twoStageHqVerified: true },
        },
        controls: { hardGpuLimit: NOVITA_HARD_GPU_LIMIT, capacityAwareWaves: true, checkpointStore: "r2", interruptionRecovery: true, idleShutdownSeconds: 300, reaperEnabled: true, deleteVerification: true, workerHasProviderCredentials: false, workerHasObjectStoreCredentials: false, statusBatchSeconds: 60 },
        budget: { maxJobUsd: 2, maxFleetUsd: 10, admissionRequired: true },
      });
    }
    if (url === "https://render.test/render/image") {
      launchCalls += 1;
      assert.equal(init?.method, "POST");
      launchBody = String(init?.body);
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.authorization, `Bearer ${TOKEN}`);
      assert.match(headers["x-render-timestamp"], /^\d+$/);
      assert.equal(
        headers["x-render-signature"],
        createHmac("sha256", TOKEN)
          .update(`${headers["x-render-timestamp"]}.image.${launchBody}`)
          .digest("hex"),
      );
      const payload = JSON.parse(launchBody) as Record<string, unknown>;
      assert.equal(payload.maxCostUsd, 2);
      return Response.json({
        jobId: JOB_ID,
        requestSha256: payload.requestSha256,
        profileSha256: payload.profileSha256,
        reused: false,
      });
    }
    if (url === `https://render.test/render/status?jobId=${JOB_ID}`) {
      statusCalls += 1;
      const payload = JSON.parse(launchBody) as Record<string, unknown>;
      const outputPrefix = `imagecraft/${payload.prefix}/${JOB_ID}/stills`;
      const expectedKey = `${outputPrefix}/shot-01-c01.png`;
      const billingReceipt = {
        provider: "novita", currency: "USD", receiptId: "receipt-01", gpuSku: "RTX 4090",
        gpuCount: 1, gpuSeconds: receiptCostUsd / 0.00005, gpuRateUsdPerSecond: 0.00005,
        startupUsd: 0, storageUsd: 0, costUsd: receiptCostUsd,
      };
      return Response.json({
        ok: true,
        jobId: JOB_ID,
        phase: "image",
        status: "done",
        outputs: [expectedKey],
        n_outputs: 1,
        n_jobs: 1,
        outputPrefix,
        expectedKeys: [expectedKey],
        missingKeys: [],
        failedIds: [],
        stillKeys: [expectedKey],
        profile,
        profileSha256: createHash("sha256").update(canonicalJson(profile)).digest("hex"),
        manifestSha256: "b".repeat(64),
        requestSha256: payload.requestSha256,
        runtimeAttestation: {
          provider: "novita", capacityMode: "spot", weightStorage: "local-persistent-disk",
          cacheMount: "/workspace/model-cache", checkpointing: true, idleShutdownSeconds: 300,
          gpuCount: 1, model: profile.model, revision: profile.revision, checkpoint: profile.checkpoint,
        },
        billingReceipt,
        billingReceiptSha256: createHash("sha256").update(canonicalJson(billingReceipt)).digest("hex"),
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const renderCfg: NovitaRenderCfg = {
      prefix: "console/test-run",
      profile,
      shots: [{
        id: "shot-01",
        prompt: "A blacksmith working beside a glowing forge",
        cameraMove: "static",
        shotScale: "medium",
        lens: "35mm",
        seconds: 5,
        motion: "sparks rise from the anvil",
      }],
      nshard: 1,
      maxConcurrent: 1,
      jobs: "full",
    };
    const launch = await launchImages(renderCfg);
    assert.equal(launch.jobId, JOB_ID);
    assert.equal(launch.phase, "image");
    assert.deepEqual(launch.expectedJobIds, ["shot-01-c01"]);
    assert.equal(launch.maxCostUsd, 2);
    assert.equal(launchCalls, 1);

    const status = await getNovitaRenderStatus(launch.jobId);
    assert.equal(status.status, "done");
    assert.equal(status.profileSha256, launch.profileSha256);
    assert.equal(status.requestSha256, launch.requestSha256);
    assert.equal(statusCalls, 1);

    receiptCostUsd = 2.0001;
    await assert.rejects(() => renderImages(renderCfg), /exceeded the sealed \$2\.0000 spend cap/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("novita bridge client tests passed");
}

void main();
