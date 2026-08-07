import { createHash } from "node:crypto";

export const NOVITA_FLEET_CONTRACT_VERSION = "2.0.0" as const;
export const NOVITA_HARD_GPU_LIMIT = 8 as const;
export const NOVITA_DEFAULT_VERIFIED_GPU_QUOTA = 3 as const;
export const NOVITA_STATUS_BATCH_SECONDS = 60 as const;
export const NOVITA_IDLE_SHUTDOWN_SECONDS = 300 as const;

export const OFFICIAL_RENDER_PINS = Object.freeze({
  gemma: {
    model: "google/gemma-3-12b-it-qat-q4_0-unquantized",
  },
  zImage: {
    model: "Tongyi-MAI/Z-Image-Turbo",
    revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
  },
  ltx: {
    model: "Lightricks/LTX-2.3",
    revision: "7caa482d5cd10a2eae6b34cb48f093ebc45a263e",
    runtimeRepository: "Lightricks/LTX-2",
    runtimeRevision: "4f8905737aac86a554637cac86c178877a39c744",
    devCheckpoint: "ltx-2.3-22b-dev.safetensors",
    distilledCheckpoint: "ltx-2.3-22b-distilled-1.1.safetensors",
    distilledLoraCheckpoint: "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
    spatialUpscalerCheckpoint: "ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
  },
});

type InventoryState = "high" | "normal" | "low" | "none";

export interface NovitaProductSummary {
  id: string;
  name: string;
  availableDeploy: boolean;
  inventoryState: InventoryState;
  spotPriceUsdPerHour: number;
  regions: string[];
}

export interface NovitaVolumeSummary {
  storageId: string;
  storageName: string;
  storageSizeGb: number;
  clusterId: string;
  clusterName: string;
}

export interface NovitaAccountSnapshot {
  activeInstanceCount: number;
  products: NovitaProductSummary[];
  volumes: NovitaVolumeSummary[];
  registryAuthCount: number;
  prewarmedImageDigests: string[];
}

export interface NovitaFleetAttestation {
  ok: boolean;
  contractVersion: string;
  dispatchReady: boolean;
  provider: {
    activeInstanceCount: number;
    verifiedGpuQuota: number;
    compatibleProductId: string;
    inventoryState: InventoryState;
    spotPriceUsdPerHour: number;
  };
  registry: {
    authConfigured: boolean;
    workerImage: string;
    imagePrewarmed: boolean;
  };
  storage: {
    volumeName: string;
    volumeSizeGb: number;
    clusterId: string;
    modelManifestSha256: string;
  };
  models: {
    gemma: { model: string; revision: string; localCacheVerified: boolean };
    zImage: { model: string; revision: string; localCacheVerified: boolean };
    ltx: {
      model: string;
      revision: string;
      runtimeRepository: string;
      runtimeRevision: string;
      localCacheVerified: boolean;
      twoStageHqVerified: boolean;
    };
  };
  controls: {
    hardGpuLimit: number;
    capacityAwareWaves: boolean;
    checkpointStore: string;
    interruptionRecovery: boolean;
    idleShutdownSeconds: number;
    reaperEnabled: boolean;
    deleteVerification: boolean;
    workerHasProviderCredentials: boolean;
    workerHasObjectStoreCredentials: boolean;
    statusBatchSeconds: number;
  };
  budget: {
    maxJobUsd: number;
    maxFleetUsd: number;
    admissionRequired: boolean;
  };
}

export interface NovitaFleetReadiness {
  ready: boolean;
  effectiveGpuLimit: number;
  blockers: string[];
  attestation?: NovitaFleetAttestation;
}

export interface NovitaCapacityPlan {
  admitted: true;
  workerCount: number;
  waves: string[][];
  estimatedUpperCostUsd: number;
  maxBudgetUsd: number;
  inventoryState: InventoryState;
}

export class NovitaAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NovitaAdmissionError";
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isPinnedImage(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/i.test(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampVerifiedQuota(value: unknown): number {
  if (value === undefined || value === null || value === "") return NOVITA_DEFAULT_VERIFIED_GPU_QUOTA;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > NOVITA_HARD_GPU_LIMIT) {
    throw new NovitaAdmissionError(`verified Novita GPU quota must be an integer from 1 to ${NOVITA_HARD_GPU_LIMIT}`);
  }
  return parsed;
}

export function assessNovitaFleetReadiness(raw: unknown): NovitaFleetReadiness {
  const a = raw as Partial<NovitaFleetAttestation> | undefined;
  const blockers: string[] = [];
  if (!a || typeof a !== "object") return { ready: false, effectiveGpuLimit: 0, blockers: ["bridge_attestation_missing"] };
  if (a.ok !== true || a.dispatchReady !== true) blockers.push("bridge_not_dispatch_ready");
  if (a.contractVersion !== NOVITA_FLEET_CONTRACT_VERSION) blockers.push("bridge_contract_not_v2");

  const provider = a.provider;
  let quota = 0;
  try {
    quota = clampVerifiedQuota(provider?.verifiedGpuQuota);
  } catch {
    blockers.push("verified_gpu_quota_invalid");
  }
  if (!provider?.compatibleProductId || provider.inventoryState === "none") blockers.push("compatible_spot_capacity_missing");
  if (!finitePositive(provider?.spotPriceUsdPerHour)) blockers.push("spot_price_missing");
  const activeInstanceCount = provider?.activeInstanceCount;
  if (!Number.isInteger(activeInstanceCount)
      || (activeInstanceCount ?? -1) < 0
      || (activeInstanceCount ?? NOVITA_HARD_GPU_LIMIT + 1) > NOVITA_HARD_GPU_LIMIT) {
    blockers.push("active_gpu_count_invalid");
  } else if ((activeInstanceCount ?? 0) >= Math.min(quota, NOVITA_HARD_GPU_LIMIT)) {
    blockers.push("verified_gpu_capacity_exhausted");
  }

  if (a.registry?.authConfigured !== true) blockers.push("registry_auth_missing");
  if (!isPinnedImage(a.registry?.workerImage)) blockers.push("worker_image_not_digest_pinned");
  if (a.registry?.imagePrewarmed !== true) blockers.push("worker_image_not_prewarmed");

  if (a.storage?.volumeName !== "ai-infra-models" || !finitePositive(a.storage.volumeSizeGb)) {
    blockers.push("persistent_model_volume_missing");
  }
  if (!a.storage?.clusterId || !isSha256(a.storage.modelManifestSha256)) blockers.push("model_volume_manifest_missing");

  const zImage = a.models?.zImage;
  if (zImage?.model !== OFFICIAL_RENDER_PINS.zImage.model
      || zImage.revision !== OFFICIAL_RENDER_PINS.zImage.revision
      || zImage.localCacheVerified !== true) {
    blockers.push("z_image_cache_or_revision_unverified");
  }
  const gemma = a.models?.gemma;
  if (gemma?.model !== OFFICIAL_RENDER_PINS.gemma.model
      || !/^[a-f0-9]{40}$/.test(gemma.revision ?? "")
      || gemma.localCacheVerified !== true) {
    blockers.push("gemma_cache_or_revision_unverified");
  }
  const ltx = a.models?.ltx;
  if (ltx?.model !== OFFICIAL_RENDER_PINS.ltx.model
      || ltx.revision !== OFFICIAL_RENDER_PINS.ltx.revision
      || ltx.runtimeRepository !== OFFICIAL_RENDER_PINS.ltx.runtimeRepository
      || ltx.runtimeRevision !== OFFICIAL_RENDER_PINS.ltx.runtimeRevision
      || ltx.localCacheVerified !== true
      || ltx.twoStageHqVerified !== true) {
    blockers.push("ltx_runtime_cache_or_hq_pipeline_unverified");
  }

  const controls = a.controls;
  if (controls?.hardGpuLimit !== NOVITA_HARD_GPU_LIMIT || controls.capacityAwareWaves !== true) {
    blockers.push("fleet_hard_limit_or_waves_missing");
  }
  if (controls?.checkpointStore !== "r2" || controls.interruptionRecovery !== true) {
    blockers.push("r2_checkpoint_recovery_missing");
  }
  if (!Number.isInteger(controls?.idleShutdownSeconds)
      || (controls?.idleShutdownSeconds ?? 0) < 60
      || (controls?.idleShutdownSeconds ?? 0) > NOVITA_IDLE_SHUTDOWN_SECONDS) {
    blockers.push("idle_shutdown_invalid");
  }
  if (controls?.reaperEnabled !== true || controls.deleteVerification !== true) blockers.push("verified_reaper_missing");
  if (controls?.workerHasProviderCredentials !== false || controls.workerHasObjectStoreCredentials !== false) {
    blockers.push("worker_credentials_not_scoped");
  }
  if (!Number.isInteger(controls?.statusBatchSeconds)
      || (controls?.statusBatchSeconds ?? 0) < NOVITA_STATUS_BATCH_SECONDS) {
    blockers.push("status_batching_too_frequent");
  }

  if (!finitePositive(a.budget?.maxJobUsd)
      || !finitePositive(a.budget?.maxFleetUsd)
      || (a.budget?.maxJobUsd ?? Number.POSITIVE_INFINITY) > (a.budget?.maxFleetUsd ?? 0)
      || a.budget?.admissionRequired !== true) {
    blockers.push("spend_admission_missing");
  }
  const remainingGpuCapacity = Math.max(
    0,
    Math.min(quota, NOVITA_HARD_GPU_LIMIT) - (Number.isInteger(activeInstanceCount) ? Number(activeInstanceCount) : NOVITA_HARD_GPU_LIMIT),
  );
  return {
    ready: blockers.length === 0,
    effectiveGpuLimit: blockers.length === 0 ? remainingGpuCapacity : 0,
    blockers,
    attestation: a as NovitaFleetAttestation,
  };
}

export async function requireNovitaFleetReadiness(args: {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<NovitaFleetReadiness> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(`${args.baseUrl.replace(/\/$/, "")}/health`, {
    headers: { authorization: `Bearer ${args.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new NovitaAdmissionError(`Novita fleet readiness failed with HTTP ${response.status}`);
  }
  const readiness = assessNovitaFleetReadiness(await response.json());
  if (!readiness.ready) {
    throw new NovitaAdmissionError(`Novita fleet is not production-ready: ${readiness.blockers.join(",")}`);
  }
  return readiness;
}

function inventoryLimit(state: InventoryState, verifiedQuota: number): number {
  if (state === "high") return verifiedQuota;
  if (state === "normal") return Math.min(verifiedQuota, NOVITA_DEFAULT_VERIFIED_GPU_QUOTA);
  if (state === "low") return 1;
  return 0;
}

export function planNovitaCapacityWaves(args: {
  jobIds: string[];
  requestedWorkers?: number;
  verifiedGpuQuota?: number | string;
  inventoryState: InventoryState;
  spotPriceUsdPerHour: number;
  estimatedMinutesPerJob: number;
  coldStartMinutes?: number;
  maxBudgetUsd: number;
}): NovitaCapacityPlan {
  if (args.jobIds.length < 1 || new Set(args.jobIds).size !== args.jobIds.length) {
    throw new NovitaAdmissionError("render jobs must contain at least one unique identity");
  }
  if (!args.jobIds.every((id) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id))) {
    throw new NovitaAdmissionError("render job identity is invalid");
  }
  const quota = clampVerifiedQuota(args.verifiedGpuQuota);
  const requested = args.requestedWorkers ?? quota;
  if (!Number.isInteger(requested) || requested < 1 || requested > NOVITA_HARD_GPU_LIMIT) {
    throw new NovitaAdmissionError(`requested worker count must be from 1 to ${NOVITA_HARD_GPU_LIMIT}`);
  }
  if (!finitePositive(args.spotPriceUsdPerHour)
      || !finitePositive(args.estimatedMinutesPerJob)
      || !finitePositive(args.maxBudgetUsd)) {
    throw new NovitaAdmissionError("spot price, render duration, and budget must be positive finite numbers");
  }
  const workerCount = Math.min(args.jobIds.length, requested, inventoryLimit(args.inventoryState, quota));
  if (workerCount < 1) throw new NovitaAdmissionError("no compatible Novita spot capacity is currently available");
  const coldStartMinutes = args.coldStartMinutes ?? 8;
  if (!Number.isFinite(coldStartMinutes) || coldStartMinutes < 0 || coldStartMinutes > 60) {
    throw new NovitaAdmissionError("cold-start estimate must be between 0 and 60 minutes");
  }
  const gpuMinutes = args.jobIds.length * args.estimatedMinutesPerJob + workerCount * coldStartMinutes;
  const estimatedUpperCostUsd = Math.ceil((gpuMinutes / 60) * args.spotPriceUsdPerHour * 10_000) / 10_000;
  if (estimatedUpperCostUsd > args.maxBudgetUsd) {
    throw new NovitaAdmissionError(
      `estimated Novita cost $${estimatedUpperCostUsd.toFixed(4)} exceeds $${args.maxBudgetUsd.toFixed(4)} admission`,
    );
  }
  const waves: string[][] = [];
  for (let index = 0; index < args.jobIds.length; index += workerCount) {
    waves.push(args.jobIds.slice(index, index + workerCount));
  }
  return {
    admitted: true,
    workerCount,
    waves,
    estimatedUpperCostUsd,
    maxBudgetUsd: args.maxBudgetUsd,
    inventoryState: args.inventoryState,
  };
}

export function boundedNovitaPollSchedule(attempts: number, baseMs = 5_000, maxMs = 60_000): number[] {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 240) {
    throw new Error("poll attempts must be an integer from 1 to 240");
  }
  if (!Number.isInteger(baseMs) || !Number.isInteger(maxMs) || baseMs < 1_000 || maxMs < baseMs) {
    throw new Error("invalid bounded polling interval");
  }
  return Array.from({ length: attempts }, (_, index) => Math.min(maxMs, baseMs * 2 ** Math.min(index, 5)));
}

export interface ImmutableRenderManifestInput {
  phase: "image" | "video";
  profile: unknown;
  jobIds: string[];
  outputPrefix: string;
  maxCostUsd: number;
  expiresAt: number;
}

export function compileImmutableRenderManifest(input: ImmutableRenderManifestInput) {
  if (!finitePositive(input.maxCostUsd) || !Number.isInteger(input.expiresAt) || input.expiresAt <= Date.now()) {
    throw new NovitaAdmissionError("manifest requires a future expiry and positive hard spend cap");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(input.outputPrefix)) {
    throw new NovitaAdmissionError("manifest output prefix is invalid");
  }
  if (input.jobIds.length < 1 || new Set(input.jobIds).size !== input.jobIds.length) {
    throw new NovitaAdmissionError("manifest jobs must be non-empty and unique");
  }
  const profileSha256 = createHash("sha256").update(canonicalJson(input.profile)).digest("hex");
  const core = {
    contractVersion: NOVITA_FLEET_CONTRACT_VERSION,
    phase: input.phase,
    profile: input.profile,
    profileSha256,
    jobIds: [...input.jobIds],
    outputPrefix: input.outputPrefix,
    maxCostUsd: input.maxCostUsd,
    expiresAt: input.expiresAt,
  };
  const requestSha256 = createHash("sha256").update(canonicalJson(core)).digest("hex");
  const unsigned = { ...core, manifestId: `${input.phase}-${requestSha256.slice(0, 32)}` };
  const manifestSha256 = createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
  return { ...unsigned, manifestSha256 };
}

export function sealNovitaWorkerManifest<T extends Record<string, unknown>>(
  unsigned: T & { manifestId: string },
): T & { manifestId: string; manifestSha256: string } {
  if (!/^(image|video)-[a-f0-9]{32}$/.test(unsigned.manifestId)) {
    throw new NovitaAdmissionError("worker manifest identity is invalid");
  }
  if (Object.prototype.hasOwnProperty.call(unsigned, "manifestSha256")) {
    throw new NovitaAdmissionError("worker manifest must be unsigned before sealing");
  }
  const manifestSha256 = createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
  return { ...unsigned, manifestSha256 };
}

export interface NovitaCreateWorkerRequestArgs {
  name: string;
  productId: string;
  clusterId: string;
  storageId: string;
  image: string;
  imageAuthId: string;
  manifestUrl: string;
  manifestSha256: string;
  approval: NovitaCapacityPlan;
}

export function buildNovitaCreateWorkerRequest(args: NovitaCreateWorkerRequestArgs) {
  if (args.approval.admitted !== true || args.approval.workerCount > NOVITA_HARD_GPU_LIMIT) {
    throw new NovitaAdmissionError("an admitted bounded capacity plan is required");
  }
  if (!isPinnedImage(args.image) || !args.imageAuthId) {
    throw new NovitaAdmissionError("worker image must be digest-pinned and have registry authentication");
  }
  if (!isSha256(args.manifestSha256) || !/^https:\/\//.test(args.manifestUrl)) {
    throw new NovitaAdmissionError("worker manifest must use a signed HTTPS URL and SHA-256 identity");
  }
  if (![args.name, args.productId, args.clusterId, args.storageId].every((value) => value.trim().length > 0)) {
    throw new NovitaAdmissionError("worker identity, product, cluster, and persistent volume are required");
  }
  return {
    name: args.name,
    productId: args.productId,
    clusterId: args.clusterId,
    gpuNum: 1,
    kind: "gpu",
    billingMode: "spot",
    imageUrl: args.image,
    imageAuthId: args.imageAuthId,
    rootfsSize: 120,
    localStorageMountPoint: "/workspace",
    networkStorages: [{ Id: args.storageId, mountPoint: "/network" }],
    envs: [
      { key: "NOVITA_JOB_MANIFEST_URL", value: args.manifestUrl },
      { key: "NOVITA_MANIFEST_SHA256", value: args.manifestSha256 },
      { key: "NOVITA_MODEL_VOLUME", value: "/network" },
      { key: "NOVITA_LOCAL_MODEL_CACHE", value: "/workspace/model-cache" },
    ],
  };
}

export function selectIdleReapCandidates(
  instances: Array<{ id: string; name: string; status: string; lastHeartbeatAt: number }>,
  now = Date.now(),
  idleSeconds = NOVITA_IDLE_SHUTDOWN_SECONDS,
): string[] {
  if (!Number.isInteger(idleSeconds) || idleSeconds < 60 || idleSeconds > NOVITA_IDLE_SHUTDOWN_SECONDS) {
    throw new Error("idle reaper must use a timeout from 60 to 300 seconds");
  }
  return instances
    .filter((item) => /^yt-render-[a-z0-9-]+$/.test(item.name)
      && ["running", "exited", "stopping"].includes(item.status)
      && now - item.lastHeartbeatAt >= idleSeconds * 1_000)
    .map((item) => item.id);
}

type NovitaCreateWorkerRequest = ReturnType<typeof buildNovitaCreateWorkerRequest>;

export class NovitaGpuApiClient {
  private readonly baseUrl = "https://api.novita.ai/gpu-instance/openapi/v1";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (apiKey.trim().length < 16) throw new Error("Novita API key is not configured");
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "user-agent": "youtube-studio-ai/novita-fleet-v2",
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // Provider bodies can contain account details. Keep the error useful but
      // deliberately avoid reflecting response content into logs.
      throw new Error(`Novita GPU API ${path.split("?")[0]} failed with HTTP ${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  async accountSnapshot(): Promise<NovitaAccountSnapshot> {
    const [productsRaw, instancesRaw, volumesRaw, registryRaw, prewarmRaw] = await Promise.all([
      this.request("/products?productName=4090&billingMethod=spot"),
      this.request("/gpu/instances?pageSize=100&pageNum=0"),
      this.request("/networkstorages/list?pageSize=100&pageNo=0"),
      this.request("/repository/auths"),
      this.request("/image/prewarm?pageSize=100&pageNum=0"),
    ]) as Array<Record<string, unknown>>;
    const productRows = Array.isArray(productsRaw.data) ? productsRaw.data : [];
    const instanceRows = Array.isArray(instancesRaw.instances)
      ? instancesRaw.instances
      : Array.isArray(instancesRaw.data) ? instancesRaw.data : [];
    const volumeRows = Array.isArray(volumesRaw.data) ? volumesRaw.data : [];
    const registryRows = Array.isArray(registryRaw.data) ? registryRaw.data : [];
    const prewarmRows = Array.isArray(prewarmRaw.data) ? prewarmRaw.data : [];
    const inventory = (value: unknown): InventoryState =>
      value === "high" || value === "normal" || value === "low" ? value : "none";
    const usd = (value: unknown) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number / 100_000 : 0;
    };
    return {
      activeInstanceCount: instanceRows.filter((row) => {
        const status = String((row as Record<string, unknown>).status ?? "");
        return !["removed", "toRemove", "removing"].includes(status);
      }).length,
      products: productRows.map((value) => {
        const row = value as Record<string, unknown>;
        return {
          id: String(row.id ?? ""),
          name: String(row.name ?? ""),
          availableDeploy: row.availableDeploy === true,
          inventoryState: inventory(row.inventoryState),
          spotPriceUsdPerHour: usd(row.spotPrice),
          regions: Array.isArray(row.regions) ? row.regions.map(String) : [],
        };
      }),
      volumes: volumeRows.map((value) => {
        const row = value as Record<string, unknown>;
        return {
          storageId: String(row.storageId ?? ""),
          storageName: String(row.storageName ?? ""),
          storageSizeGb: Number(row.storageSize ?? 0),
          clusterId: String(row.clusterId ?? ""),
          clusterName: String(row.clusterName ?? ""),
        };
      }),
      registryAuthCount: registryRows.length,
      prewarmedImageDigests: prewarmRows.flatMap((value) => {
        const row = value as Record<string, unknown>;
        const match = /@sha256:[a-f0-9]{64}$/i.exec(String(row.imageUrl ?? ""));
        return row.state === "success" && match ? [match[0].slice(1).toLowerCase()] : [];
      }),
    };
  }

  async createSpotWorker(request: NovitaCreateWorkerRequest): Promise<string> {
    if (request.billingMode !== "spot" || request.gpuNum !== 1 || !isPinnedImage(request.imageUrl)) {
      throw new NovitaAdmissionError("only one-GPU, digest-pinned Novita spot workers may be dispatched");
    }
    const response = await this.request("/gpu/instance/create", {
      method: "POST",
      body: JSON.stringify(request),
    }) as Record<string, unknown>;
    const id = String(response.id ?? "");
    if (!id) throw new Error("Novita create did not return an instance identity");
    return id;
  }

  async deleteAndVerify(
    instanceId: string,
    wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/.test(instanceId)) throw new Error("invalid Novita instance identity");
    await this.request("/gpu/instance/stop", { method: "POST", body: JSON.stringify({ instanceId }) });
    await this.request("/gpu/instance/delete", { method: "POST", body: JSON.stringify({ instanceId }) });
    for (const delay of boundedNovitaPollSchedule(12, 5_000, 20_000)) {
      await wait(delay);
      try {
        const current = await this.request(`/gpu/instance?instanceId=${encodeURIComponent(instanceId)}`) as Record<string, unknown>;
        if (current.status === "removed") return;
      } catch (error) {
        if (error instanceof Error && /HTTP 404$/.test(error.message)) return;
        throw error;
      }
    }
    throw new Error(`Novita instance ${instanceId} deletion could not be verified`);
  }
}
