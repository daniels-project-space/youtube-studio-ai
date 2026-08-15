import { createHash } from "node:crypto";
import { LTX_25_RTX_4090_VIDEO } from "@/engine/generationProfiles";

export const NOVITA_FLEET_CONTRACT_VERSION = "2.0.0" as const;
export const NOVITA_HARD_GPU_LIMIT = 8 as const;
export const NOVITA_DEFAULT_VERIFIED_GPU_QUOTA = 3 as const;
export const NOVITA_STATUS_BATCH_SECONDS = 60 as const;
export const NOVITA_IDLE_SHUTDOWN_SECONDS = 300 as const;
/**
 * This is deliberately not configurable. The cinematic data plane is a
 * single-SKU fleet: any product other than an RTX 4090 is a hard admission
 * failure, even when another GPU happens to be cheaper or available.
 */
export const NOVITA_REQUIRED_GPU_SKU = "RTX 4090" as const;
export const NOVITA_REQUIRED_GPU_COUNT = 1 as const;
/**
 * Public images are normally forbidden: a digest alone is not a publisher
 * identity. This one repository is published by our sealed CI workflow and
 * remains an immutable, source-linked exception so Novita does not need a
 * long-lived registry credential to pull it.
 */
export const NOVITA_PUBLIC_WORKER_REPOSITORY =
  "ghcr.io/daniels-project-space/youtube-render-worker" as const;
/** Public, digest-pinned base used only with the sealed runtime-bundle mode. */
export const NOVITA_PUBLIC_RUNTIME_BASE_IMAGE =
  "pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385" as const;

export const OFFICIAL_RENDER_PINS = Object.freeze({
  zImage: {
    model: "Tongyi-MAI/Z-Image-Turbo",
    revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
  },
  ltx: {
    ...LTX_25_RTX_4090_VIDEO,
  },
});

export type NovitaInventoryState = "high" | "normal" | "low" | "none";

export interface NovitaProductSummary {
  id: string;
  name: string;
  gpuCount?: number;
  availableDeploy: boolean;
  inventoryState: NovitaInventoryState;
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

/** Minimal provider state used solely by the managed-worker reaper. */
export interface NovitaManagedInstance {
  id: string;
  name: string;
  status: string;
}

export interface NovitaFleetAttestation {
  ok: boolean;
  contractVersion: string;
  dispatchReady: boolean;
  provider: {
    activeInstanceCount: number;
    verifiedGpuQuota: number;
    compatibleProductId: string;
    inventoryState: NovitaInventoryState;
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
    zImage: { model: string; revision: string; localCacheVerified: boolean };
    ltx: {
      model: string;
      revision: string;
      runtimeRepository: string;
      runtimeRevision: string;
      checkpoint: string;
      textEncoderCheckpoint: string;
      videoVaeCheckpoint: string;
      audioVaeCheckpoint: string;
      spatialUpscalerCheckpoint: string;
      quantization: "fp8-cast";
      offload: "cpu";
      spatialUpscaleFactor: 2;
      localCacheVerified: boolean;
      distilledTwoStageX2Verified: boolean;
      /** Set only after a real, digest-pinned RTX 4090 benchmark. */
      rtx4090ProfileBenchmarked: boolean;
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
  inventoryState: NovitaInventoryState;
}

export class NovitaAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NovitaAdmissionError";
  }
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isPinnedImage(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/i.test(value);
}

export function isApprovedPublicWorkerImage(value: unknown): value is string {
  return isPinnedImage(value)
    && value.toLowerCase().startsWith(`${NOVITA_PUBLIC_WORKER_REPOSITORY}@sha256:`);
}

export function isApprovedPublicRuntimeBaseImage(value: unknown): value is string {
  return value === NOVITA_PUBLIC_RUNTIME_BASE_IMAGE;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedGpuSku(value: string): string {
  return value
    .toLowerCase()
    .replace(/nvidia|geforce|graphics|gpu/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Exact product gate shared by live admission and test fixtures. */
export function isRtx4090Sku(value: unknown): value is string {
  // Novita currently advertises the valid SKU as "RTX 4090 24GB". Permit only
  // capacity/frequency suffixes on the exact 4090 model; notably reject 4090D,
  // RTX PRO, 5090, A/H-series, and every other accelerator.
  return typeof value === "string" && /^rtx4090(?:24gb(?:highfrequency)?)?$/.test(normalizedGpuSku(value));
}

export function requireRtx4090Product(product: Pick<NovitaProductSummary, "id" | "name" | "gpuCount">): void {
  if (!product.id.trim() || !isRtx4090Sku(product.name)) {
    throw new NovitaAdmissionError(`Novita product must be exactly ${NOVITA_REQUIRED_GPU_SKU}`);
  }
  if (product.gpuCount !== undefined && product.gpuCount !== NOVITA_REQUIRED_GPU_COUNT) {
    throw new NovitaAdmissionError(`Novita worker product must expose exactly ${NOVITA_REQUIRED_GPU_COUNT} GPU`);
  }
}

/**
 * Resolves a pre-pinned product only if the live catalog still proves that it
 * is the required RTX 4090 spot SKU. There is intentionally no fallback to a
 * different GPU or a best-effort catalog choice.
 */
export function selectRtx4090SpotProduct(
  products: readonly NovitaProductSummary[],
  productId: string,
): NovitaProductSummary {
  const product = products.find((item) => item.id === productId);
  if (!product) throw new NovitaAdmissionError("configured RTX 4090 product is absent from the live Novita catalog");
  requireRtx4090Product(product);
  if (!product.availableDeploy || product.inventoryState === "none") {
    throw new NovitaAdmissionError("configured RTX 4090 spot product has no deployable live capacity");
  }
  if (!finitePositive(product.spotPriceUsdPerHour)) {
    throw new NovitaAdmissionError("configured RTX 4090 spot product has no valid live spot price");
  }
  return product;
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
  const ltx = a.models?.ltx;
  if (ltx?.model !== OFFICIAL_RENDER_PINS.ltx.model
      || ltx.revision !== OFFICIAL_RENDER_PINS.ltx.revision
      || ltx.runtimeRepository !== OFFICIAL_RENDER_PINS.ltx.runtimeRepository
      || ltx.runtimeRevision !== OFFICIAL_RENDER_PINS.ltx.runtimeRevision
      || ltx.checkpoint !== OFFICIAL_RENDER_PINS.ltx.checkpoint
      || ltx.textEncoderCheckpoint !== OFFICIAL_RENDER_PINS.ltx.textEncoderCheckpoint
      || ltx.videoVaeCheckpoint !== OFFICIAL_RENDER_PINS.ltx.videoVaeCheckpoint
      || ltx.audioVaeCheckpoint !== OFFICIAL_RENDER_PINS.ltx.audioVaeCheckpoint
      || ltx.spatialUpscalerCheckpoint !== OFFICIAL_RENDER_PINS.ltx.spatialUpscalerCheckpoint
      || ltx.quantization !== OFFICIAL_RENDER_PINS.ltx.quantization
      || ltx.offload !== OFFICIAL_RENDER_PINS.ltx.offload
      || ltx.spatialUpscaleFactor !== OFFICIAL_RENDER_PINS.ltx.spatialUpscaleFactor
      || ltx.localCacheVerified !== true
      || ltx.distilledTwoStageX2Verified !== true
      || ltx.rtx4090ProfileBenchmarked !== true) {
    blockers.push("ltx_2_5_runtime_cache_or_rtx_4090_x2_pipeline_unverified");
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

function inventoryLimit(state: NovitaInventoryState, verifiedQuota: number): number {
  if (state === "high") return verifiedQuota;
  // "normal" is a live availability signal, not a silent three-GPU cap. The
  // controller re-checks product availability before each one-GPU create, and
  // the verified quota is still bounded by the non-negotiable hard ceiling.
  if (state === "normal") return verifiedQuota;
  if (state === "low") return 1;
  return 0;
}

export function planNovitaCapacityWaves(args: {
  jobIds: string[];
  requestedWorkers?: number;
  verifiedGpuQuota?: number | string;
  inventoryState: NovitaInventoryState;
  spotPriceUsdPerHour: number;
  estimatedMinutesPerJob: number;
  coldStartMinutes?: number;
  coldStartPerJob?: boolean;
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
  // A direct worker is deliberately destroyed after its one sealed job. The
  // admission estimate must therefore charge every cold start, not merely the
  // simultaneous worker count in the first wave.
  const coldStartCount = args.coldStartPerJob ? args.jobIds.length : workerCount;
  const gpuMinutes = args.jobIds.length * args.estimatedMinutesPerJob + coldStartCount * coldStartMinutes;
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
  /** Live catalog name, checked against the non-negotiable RTX 4090 policy. */
  gpuSku: string;
  clusterId: string;
  storageId: string;
  image: string;
  /** Required unless the one allowed source-linked public GHCR image is used. */
  imageAuthId?: string;
  /** Opt-in only; prevents an unauthenticated arbitrary registry pull. */
  publicImage?: boolean;
  /** Exact R2 runtime bundle used only with the approved public PyTorch base. */
  runtimeBundle?: {
    downloadUrl: string;
    sha256: string;
  };
  manifestUrl: string;
  manifestSha256: string;
  approval: NovitaCapacityPlan;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

/**
 * Public registries do not need a permanent credential, but they must never
 * be allowed to substitute an arbitrary image. This bootstrap uses the exact
 * public PyTorch base plus a short-lived, SHA-bound R2 bundle and persists the
 * verified runtime on the mounted volume for subsequent short-lived workers.
 */
function runtimeBundleBootstrapCommand(sha256: string): string {
  const runtimeRoot = `/network/runtime/ltx-2.5-${sha256}`;
  const hydrate = [
    "set -euo pipefail",
    `root=${shellQuote(runtimeRoot)}`,
    'if [ -f "$root/.ready" ]; then',
    '  test "$(cat \"$root/.ready\")" = "$NOVITA_RUNTIME_BUNDLE_SHA256"',
    "  exit 0",
    "fi",
    'test ! -e "$root"',
    'stage="$(mktemp -d /network/runtime/.ltx-runtime-stage.XXXXXX)"',
    'trap \'rm -rf "$stage"\' EXIT',
    'bundle="$stage/runtime.tar.zst"',
    'export bundle',
    "python -c 'import os, urllib.request; urllib.request.urlretrieve(os.environ[\"NOVITA_RUNTIME_BUNDLE_URL\"], os.environ[\"bundle\"])'",
    'printf "%s  %s\\n" "$NOVITA_RUNTIME_BUNDLE_SHA256" "$bundle" | sha256sum -c -',
    'tar --use-compress-program=zstd -xf "$bundle" -C "$stage"',
    'test -x "$stage/opt/LTX-2/.venv/bin/python"',
    'test -f "$stage/opt/novita-worker/worker.py"',
    'printf "%s\\n" "$NOVITA_RUNTIME_BUNDLE_SHA256" > "$stage/.ready"',
    'mv "$stage" "$root"',
    "trap - EXIT",
  ].join("\n");
  const command = [
    "set -euo pipefail",
    `root=${shellQuote(runtimeRoot)}`,
    'mkdir -p /network/runtime',
    `flock "${runtimeRoot}.lock" /bin/bash -ceu ${shellQuote(hydrate)}`,
    'exec "$root/opt/LTX-2/.venv/bin/python" "$root/opt/novita-worker/worker.py"',
  ].join("\n");
  return `/bin/bash -ceu ${shellQuote(command)}`;
}

/** A cache-only provider operation; it does not allocate or bill a GPU. */
export interface NovitaImagePrewarmRequest {
  image: string;
  clusterId: string;
  productIds: string[];
  /** Required only for a private image; public worker image uses no credential. */
  repositoryAuthId?: string;
  note: string;
}

export function buildNovitaCreateWorkerRequest(args: NovitaCreateWorkerRequestArgs) {
  if (args.approval.admitted !== true || args.approval.workerCount > NOVITA_HARD_GPU_LIMIT) {
    throw new NovitaAdmissionError("an admitted bounded capacity plan is required");
  }
  const approvedPublicImage = args.publicImage === true
    && (isApprovedPublicWorkerImage(args.image) || isApprovedPublicRuntimeBaseImage(args.image));
  if (!isPinnedImage(args.image) || (!args.imageAuthId && !approvedPublicImage)) {
    throw new NovitaAdmissionError(
      "worker image must be digest-pinned and have registry authentication, or be the approved public GHCR worker",
    );
  }
  if (args.runtimeBundle && !isApprovedPublicRuntimeBaseImage(args.image)) {
    throw new NovitaAdmissionError("runtime bundle mode requires the approved public PyTorch base image");
  }
  if (isApprovedPublicRuntimeBaseImage(args.image) && !args.runtimeBundle) {
    throw new NovitaAdmissionError("approved public PyTorch base image requires a sealed runtime bundle");
  }
  if (args.runtimeBundle && (
    !isSha256(args.runtimeBundle.sha256)
    || !/^https:\/\//.test(args.runtimeBundle.downloadUrl)
  )) {
    throw new NovitaAdmissionError("runtime bundle must use a signed HTTPS URL and SHA-256 identity");
  }
  if (!isSha256(args.manifestSha256) || !/^https:\/\//.test(args.manifestUrl)) {
    throw new NovitaAdmissionError("worker manifest must use a signed HTTPS URL and SHA-256 identity");
  }
  if (!isRtx4090Sku(args.gpuSku)) {
    throw new NovitaAdmissionError(`render worker GPU must be exactly ${NOVITA_REQUIRED_GPU_SKU}`);
  }
  if (![args.name, args.productId, args.clusterId, args.storageId].every((value) => value.trim().length > 0)) {
    throw new NovitaAdmissionError("worker identity, product, cluster, and persistent volume are required");
  }
  if (!/^yt-render-[a-z0-9-]+$/.test(args.name)) {
    throw new NovitaAdmissionError("worker name must use the managed yt-render namespace");
  }
  return {
    name: args.name,
    productId: args.productId,
    clusterId: args.clusterId,
    gpuNum: NOVITA_REQUIRED_GPU_COUNT,
    kind: "gpu",
    billingMode: "spot",
    imageUrl: args.image,
    ...(args.imageAuthId ? { imageAuthId: args.imageAuthId } : {}),
    ...(args.runtimeBundle ? { command: runtimeBundleBootstrapCommand(args.runtimeBundle.sha256) } : {}),
    rootfsSize: 120,
    networkStorages: [{ Id: args.storageId, mountPoint: "/network" }],
    envs: [
      { key: "NOVITA_JOB_MANIFEST_URL", value: args.manifestUrl },
      { key: "NOVITA_MANIFEST_SHA256", value: args.manifestSha256 },
      { key: "NOVITA_MODEL_VOLUME", value: "/network" },
      { key: "NOVITA_LOCAL_MODEL_CACHE", value: "/workspace/model-cache" },
      ...(args.runtimeBundle ? [
        { key: "NOVITA_RUNTIME_BUNDLE_URL", value: args.runtimeBundle.downloadUrl },
        { key: "NOVITA_RUNTIME_BUNDLE_SHA256", value: args.runtimeBundle.sha256 },
      ] : []),
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

  /**
   * Provider quota is account-wide. A first-page count is not evidence that a
   * later page lacks active GPUs, so both admission and absence proofs use a
   * complete bounded listing and fail closed if Novita cannot provide one.
   */
  private async listAllInstanceRows(): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    const pageSize = 100;
    for (let pageNum = 0; pageNum < 20; pageNum += 1) {
      const raw = await this.request(`/gpu/instances?pageSize=${pageSize}&pageNum=${pageNum}`);
      const envelope = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const page = Array.isArray(envelope.instances)
        ? envelope.instances
        : Array.isArray(envelope.data) ? envelope.data : [];
      rows.push(...page.flatMap((value) => value && typeof value === "object"
        ? [value as Record<string, unknown>]
        : []));
      const declaredTotal = Number(envelope.total ?? envelope.totalCount ?? NaN);
      if (page.length < pageSize || (Number.isFinite(declaredTotal) && (pageNum + 1) * pageSize >= declaredTotal)) {
        return rows;
      }
    }
    throw new Error("Novita instance pagination did not reach a complete bounded listing");
  }

  async accountSnapshot(options: { clusterId?: string } = {}): Promise<NovitaAccountSnapshot> {
    const productQuery = new URLSearchParams({
      productName: "4090",
      billingMethod: "spot",
      // The native product API defaults can otherwise surface a multi-GPU SKU.
      gpuNum: String(NOVITA_REQUIRED_GPU_COUNT),
      ...(options.clusterId ? { clusterId: options.clusterId } : {}),
    });
    const [productsRaw, instanceRows, volumesRaw, registryRaw, prewarmRaw] = await Promise.all([
      this.request(`/products?${productQuery.toString()}`),
      this.listAllInstanceRows(),
      this.request("/networkstorages/list?pageSize=100&pageNo=0"),
      this.request("/repository/auths"),
      this.request("/image/prewarm?pageSize=100&page=1"),
    ]) as [
      Record<string, unknown>,
      Record<string, unknown>[],
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    const productRows = Array.isArray(productsRaw.data) ? productsRaw.data : [];
    const volumeRows = Array.isArray(volumesRaw.data) ? volumesRaw.data : [];
    const registryRows = Array.isArray(registryRaw.data) ? registryRaw.data : [];
    const prewarmRows = Array.isArray(prewarmRaw.data) ? prewarmRaw.data : [];
    const inventory = (value: unknown): NovitaInventoryState =>
      value === "high" || value === "normal" || value === "low" ? value : "none";
    const usd = (value: unknown) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number / 100_000 : 0;
    };
    return {
      activeInstanceCount: instanceRows.filter((row) => {
        const status = String(row.status ?? "").toLowerCase();
        return !["removed", "toremove", "removing"].includes(status);
      }).length,
      products: productRows.map((value) => {
        const row = value as Record<string, unknown>;
        return {
          id: String(row.id ?? ""),
          name: String(row.name ?? ""),
          ...(Number.isInteger(Number(row.gpuNum)) && Number(row.gpuNum) > 0
            ? { gpuCount: Number(row.gpuNum) }
            : {}),
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
        return String(row.state ?? "").toLowerCase() === "succeeded" && match
          ? [match[0].slice(1).toLowerCase()]
          : [];
      }),
    };
  }

  async createSpotWorker(request: NovitaCreateWorkerRequest): Promise<string> {
    if (
      request.billingMode !== "spot"
      || request.gpuNum !== NOVITA_REQUIRED_GPU_COUNT
      || !isPinnedImage(request.imageUrl)
      || !/^yt-render-[a-z0-9-]+$/.test(request.name)
    ) {
      throw new NovitaAdmissionError("only managed one-GPU RTX 4090, digest-pinned Novita spot workers may be dispatched");
    }
    const response = await this.request("/gpu/instance/create", {
      method: "POST",
      body: JSON.stringify(request),
    }) as Record<string, unknown>;
    const id = String(response.id ?? "");
    if (!id) throw new Error("Novita create did not return an instance identity");
    return id;
  }

  /**
   * Prime Novita's cluster-local image cache before a billable worker exists.
   * The API accepts public images without an auth ID; retain that omission so
   * a public pull cannot accidentally inherit an unrelated registry secret.
   */
  async createImagePrewarm(request: NovitaImagePrewarmRequest): Promise<string> {
    if (
      !isPinnedImage(request.image)
      || !request.clusterId.trim()
      || !request.productIds.length
      || !request.productIds.every((id) => id.trim())
      || !request.note.trim()
    ) {
      throw new NovitaAdmissionError("image prewarm requires a digest-pinned image, cluster, product, and note");
    }
    const response = await this.request("/image/prewarm", {
      method: "POST",
      body: JSON.stringify({
        imageUrl: request.image,
        ...(request.repositoryAuthId ? { repositoryAuth: request.repositoryAuthId } : {}),
        clusterId: request.clusterId,
        productIds: request.productIds,
        note: request.note,
      }),
    }) as Record<string, unknown>;
    const id = String(response.id ?? "");
    if (!id) throw new Error("Novita image prewarm did not return a task identity");
    return id;
  }

  /**
   * Return only the minimal state required for a deletion receipt. Provider
   * responses have changed shape over time, so unwrap the documented `data`
   * envelope without ever exposing arbitrary provider payloads to callers.
   */
  async getInstance(instanceId: string): Promise<NovitaManagedInstance> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/.test(instanceId)) {
      throw new Error("invalid Novita instance identity");
    }
    const raw = await this.request(`/gpu/instance?instanceId=${encodeURIComponent(instanceId)}`);
    const envelope = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const row = envelope.data && typeof envelope.data === "object"
      ? envelope.data as Record<string, unknown>
      : envelope;
    return {
      id: String(row.id ?? row.instanceId ?? instanceId),
      name: String(row.name ?? row.instanceName ?? ""),
      status: String(row.status ?? "unknown"),
    };
  }

  /**
   * Reapers must never discover or mutate arbitrary customer instances. This
   * method deliberately returns only workers in our immutable namespace.
   */
  async listManagedInstances(): Promise<NovitaManagedInstance[]> {
    const managed = new Map<string, NovitaManagedInstance>();
    for (const row of await this.listAllInstanceRows()) {
      const id = String(row.id ?? row.instanceId ?? "");
      const name = String(row.name ?? row.instanceName ?? "");
      if (!id || !/^yt-render-4090-[a-z0-9-]+$/.test(name)) continue;
      managed.set(id, { id, name, status: String(row.status ?? "unknown") });
    }
    return [...managed.values()];
  }

  async deleteAndVerify(
    instanceId: string,
    wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/.test(instanceId)) throw new Error("invalid Novita instance identity");
    // `toRemove` / `removing` merely mean that billing teardown is in flight;
    // only a terminal `removed` state (or provider 404) is a deletion receipt.
    const isRemoved = (status: string) => status.toLowerCase() === "removed";
    let current: NovitaManagedInstance | undefined;
    try {
      current = await this.getInstance(instanceId);
      if (isRemoved(current.status)) return;
    } catch (error) {
      if (error instanceof Error && /HTTP 404$/.test(error.message)) return;
      throw error;
    }

    // A reclaim or a concurrent reaper can make stop fail. Deletion is still
    // compulsory; never leave a billable worker alive because stop raced.
    const currentStatus = current?.status.toLowerCase() ?? "unknown";
    if (!["stopping", "exited", "stopped", "toremove", "removing"].includes(currentStatus)) {
      try {
        await this.request("/gpu/instance/stop", { method: "POST", body: JSON.stringify({ instanceId }) });
      } catch {
        // The deletion/poll below is the authoritative lifecycle outcome.
      }
    }

    let deleteFailure: unknown;
    try {
      await this.request("/gpu/instance/delete", { method: "POST", body: JSON.stringify({ instanceId }) });
    } catch (error) {
      deleteFailure = error;
    }
    for (const delay of boundedNovitaPollSchedule(12, 5_000, 20_000)) {
      await wait(delay);
      try {
        const observed = await this.getInstance(instanceId);
        if (isRemoved(observed.status)) return;
      } catch (error) {
        if (error instanceof Error && /HTTP 404$/.test(error.message)) return;
        throw error;
      }
    }
    if (deleteFailure instanceof Error) throw deleteFailure;
    throw new Error(`Novita instance ${instanceId} deletion could not be verified`);
  }
}
