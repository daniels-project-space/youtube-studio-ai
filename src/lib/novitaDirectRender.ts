/**
 * Cloud-only Novita control plane.
 *
 * Trigger owns this module; it creates one immutable, short-lived RTX 4090
 * worker per admitted shard, observes the worker through scoped R2 receipts,
 * and does not return a render success until the provider has confirmed
 * deletion. Neither the browser nor the worker receives a Novita API key.
 */
import { createHash, randomUUID } from "node:crypto";
import { api } from "../../convex/_generated/api";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  assertNovitaVideoPhaseProfileRuntime,
  assessNovitaVideoProfileRuntime,
  type NovitaVideoRuntimeTarget,
} from "@/engine/runtimeCapability";
import { generationProfile } from "@/engine/generationProfiles";
import {
  getObjectBytes,
  headObjectMetadata,
  presignDownload,
  presignUpload,
  putObject,
} from "@/lib/storage";
import {
  NOVITA_HARD_GPU_LIMIT,
  NOVITA_REQUIRED_GPU_COUNT,
  NOVITA_REQUIRED_GPU_SKU,
  OFFICIAL_RENDER_PINS,
  NovitaAdmissionError,
  NovitaGpuApiClient,
  canonicalJson,
  isApprovedPublicRuntimeBaseImage,
  isApprovedPublicWorkerImage,
  isPinnedImage,
  isSha256,
  planNovitaCapacityWaves,
  selectRtx4090SpotProduct,
  sealNovitaWorkerManifest,
  buildNovitaCreateWorkerRequest,
  type NovitaCapacityPlan,
  type NovitaProductSummary,
  type NovitaVolumeSummary,
} from "@/lib/novitaFleet";
import { waitForNovitaRenderPoll } from "@/lib/novitaPollWait";
import { assertLtxWorkerCompletionEvidence } from "@/lib/ltxVideoProof";
import {
  resolveLtxCreativeAdapters,
  type ResolvedLtxCreativeAdapter,
} from "@/lib/ltxCreativeAdapter";
import type {
  NovitaBillingReceipt,
  NovitaBridgeStatus,
  NovitaPhaseProfile,
  NovitaRenderCfg,
  NovitaRenderResult,
  NovitaVideoOutputProof,
  RenderedCandidate,
  Shot,
} from "@/lib/novitaRenderFarm";

const WORKER_NAME = /^yt-render-4090-[a-z0-9-]+$/;
const MAX_BOOT_WINDOW_MS = 20 * 60 * 1_000;
const MAX_WORKER_LIFETIME_MS = 2 * 60 * 60 * 1_000;
// Novita bills from allocation, not only from Python inference. Reserve a
// conservative allocation/hydration window inside every immutable job budget.
const BILLING_STARTUP_ALLOWANCE_MS = 8 * 60 * 1_000;
const BILLING_TEARDOWN_GRACE_MS = 2 * 60 * 1_000;
const MIN_WORKER_RUNTIME_MS = 60 * 1_000;
const MANIFEST_URL_TTL_SECONDS = 3 * 60 * 60;
const STATUS_POLL_MS = 15_000;

type Phase = "image" | "video";
type LeaseStatus =
  | "requested"
  | "create_claimed"
  | "create_dispatched"
  | "provisioning"
  | "booting"
  | "rendering"
  | "draining"
  | "delete_requested"
  | "deleted_verified"
  | "failed"
  | "deletion_unverified";

interface DirectNovitaConfig {
  apiKey: string;
  workerImage: string;
  imageAuthId?: string;
  imageAccess: "private-registry" | "public-ghcr" | "public-runtime-base";
  runtimeBundle?: { key: string; sha256: string };
  productId: string;
  verifiedGpuQuota: number;
  modelManifestKey: string;
  modelManifestSha256: string;
  maximumJobUsd: number;
  maximumFleetUsd: number;
  internalSecret: string;
}

interface DirectRenderJob {
  id: string;
  shotId: string;
  candidateIndex: number;
  key: string;
  payload: Record<string, unknown>;
}

interface PreparedWorker {
  phase: Phase;
  job: DirectRenderJob;
  manifestId: string;
  manifestSha256: string;
  manifestKey: string;
  completionKey: string;
  heartbeatKey: string;
  workerName: string;
  requestCanonicalJson: string;
  requestSha256: string;
  profileSha256: string;
  expiresAt: number;
  maximumCostUsd: number;
  manifest: Record<string, unknown>;
  /** Set only after a worker's ffprobe-backed completion receipt validates. */
  videoOutputProof?: NovitaVideoOutputProof;
}

interface ReservedLease {
  leaseId: string;
  reused: boolean;
  status: LeaseStatus;
  instanceId?: string;
  requestedAt: number;
  instanceCreatedAt?: number;
  deletedVerifiedAt?: number;
  billingReceipt?: unknown;
}

interface CreateClaim {
  claimed: boolean;
  status: LeaseStatus;
  instanceId?: string;
}

interface CompletionReport {
  manifestId?: string;
  completedJobIds?: unknown;
  status?: string;
  error?: unknown;
  gpuSku?: unknown;
  gpuCount?: unknown;
  renderContract?: unknown;
  videoOutputs?: unknown;
}

interface DirectControlPlane {
  config: DirectNovitaConfig;
  provider: NovitaGpuApiClient;
  volume: NovitaVolumeSummary;
  product: NovitaProductSummary;
  models: Array<Record<string, unknown>>;
  activeInstanceCount: number;
}

/**
 * A direct worker has a second, pure pre-spend gate in addition to pipeline
 * admission. It accepts only the exact LTX 2.5 FP8/CPU-offloaded x2 profile,
 * and only after that exact profile has a deliberate RTX 4090 benchmark pin.
 */
export function assertRtx4090VideoRuntime(
  profile: NovitaPhaseProfile,
  runtime?: NovitaVideoRuntimeTarget,
): void {
  if (profile.phase !== "video" || !profile.fps || !profile.pipeline || profile.twoStageRefine === undefined) {
    throw new NovitaAdmissionError("direct Novita video profile is missing its sealed LTX runtime fields");
  }
  try {
    assertNovitaVideoPhaseProfileRuntime({
      id: profile.id,
      model: profile.model,
      revision: profile.revision,
      checkpoint: profile.checkpoint,
      width: profile.width,
      height: profile.height,
      fps: profile.fps,
      steps: profile.steps,
      guidanceScale: profile.guidanceScale,
      precision: profile.precision,
      pipeline: profile.pipeline,
      twoStageRefine: profile.twoStageRefine,
      textEncoderCheckpoint: profile.textEncoderCheckpoint,
      videoVaeCheckpoint: profile.videoVaeCheckpoint,
      audioVaeCheckpoint: profile.audioVaeCheckpoint,
      spatialUpscalerCheckpoint: profile.spatialUpscalerCheckpoint,
      quantization: profile.quantization,
      offload: profile.offload,
      spatialUpscaleFactor: profile.spatialUpscaleFactor,
      stageOneWidth: profile.stageOneWidth,
      stageOneHeight: profile.stageOneHeight,
    }, runtime);
  } catch (error) {
    throw new NovitaAdmissionError(error instanceof Error ? error.message : "Novita video runtime is not admissible");
  }
}

export interface DirectNovitaFleetHealth {
  ready: boolean;
  blockers: string[];
  gpuSku: typeof NOVITA_REQUIRED_GPU_SKU;
  verifiedGpuQuota?: number;
  productId?: string;
  clusterId?: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new NovitaAdmissionError(`${name} is required for direct Novita rendering`);
  return value;
}

function positiveEnv(name: string, maximum: number): number {
  const raw = requiredEnv(name);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new NovitaAdmissionError(`${name} must be a positive finite number no greater than ${maximum}`);
  }
  return value;
}

function directConfig(): DirectNovitaConfig {
  const workerImage = requiredEnv("NOVITA_RENDER_WORKER_IMAGE");
  if (!isPinnedImage(workerImage)) {
    throw new NovitaAdmissionError("NOVITA_RENDER_WORKER_IMAGE must be digest pinned");
  }
  const publicWorker = process.env.NOVITA_RENDER_PUBLIC_WORKER_IMAGE === "1";
  const imageAccess = isApprovedPublicRuntimeBaseImage(workerImage)
    ? "public-runtime-base" as const
    : publicWorker ? "public-ghcr" as const : "private-registry" as const;
  if (imageAccess === "public-ghcr" && !isApprovedPublicWorkerImage(workerImage)) {
    throw new NovitaAdmissionError(
      "public worker access is restricted to the sealed YouTube Studio GHCR repository",
    );
  }
  const runtimeBundle = imageAccess === "public-runtime-base" ? {
    key: requiredEnv("NOVITA_RUNTIME_BUNDLE_KEY"),
    sha256: requiredEnv("NOVITA_RUNTIME_BUNDLE_SHA256").toLowerCase(),
  } : undefined;
  if (runtimeBundle && (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,767}$/.test(runtimeBundle.key)
    || runtimeBundle.key.includes("..")
    || !isSha256(runtimeBundle.sha256)
  )) {
    throw new NovitaAdmissionError("sealed public runtime bundle must use a safe R2 key and SHA-256 identity");
  }
  const modelManifestSha256 = requiredEnv("NOVITA_MODEL_MANIFEST_SHA256").toLowerCase();
  if (!isSha256(modelManifestSha256)) {
    throw new NovitaAdmissionError("NOVITA_MODEL_MANIFEST_SHA256 must be a SHA-256 digest");
  }
  const quota = Number(requiredEnv("NOVITA_VERIFIED_4090_GPU_QUOTA"));
  if (!Number.isInteger(quota) || quota < 1 || quota > NOVITA_HARD_GPU_LIMIT) {
    throw new NovitaAdmissionError(`NOVITA_VERIFIED_4090_GPU_QUOTA must be an integer from 1 to ${NOVITA_HARD_GPU_LIMIT}`);
  }
  const modelManifestKey = requiredEnv("NOVITA_MODEL_MANIFEST_KEY");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,767}$/.test(modelManifestKey) || modelManifestKey.includes("..")) {
    throw new NovitaAdmissionError("NOVITA_MODEL_MANIFEST_KEY must be a safe R2 object key");
  }
  return {
    apiKey: requiredEnv("NOVITA_API_KEY"),
    workerImage,
    ...(imageAccess === "private-registry"
      ? { imageAuthId: requiredEnv("NOVITA_RENDER_IMAGE_AUTH_ID") }
      : {}),
    imageAccess,
    ...(runtimeBundle ? { runtimeBundle } : {}),
    productId: requiredEnv("NOVITA_RENDER_4090_PRODUCT_ID"),
    verifiedGpuQuota: quota,
    modelManifestKey,
    modelManifestSha256,
    maximumJobUsd: positiveEnv("NOVITA_RENDER_MAX_JOB_USD", 10_000),
    maximumFleetUsd: positiveEnv("NOVITA_RENDER_MAX_FLEET_USD", 10_000),
    internalSecret: requiredEnv("INTERNAL_QUERY_SECRET"),
  };
}

/** A synchronous environment-only check suitable for UI/provider health. */
export function hasDirectNovitaRenderConfig(): boolean {
  try {
    directConfig();
    return true;
  } catch {
    return false;
  }
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\u0000]+/g, " ").slice(0, 900);
}

class CreateClaimInProgressError extends Error {
  constructor(workerName: string) {
    super(`Novita worker ${workerName} is already being created by another durable attempt`);
    this.name = "CreateClaimInProgressError";
  }
}

class ExecutionClaimInProgressError extends Error {
  constructor(workerName: string) {
    super(`Novita worker ${workerName} is already being observed by another durable execution`);
    this.name = "ExecutionClaimInProgressError";
  }
}

function ensureLifecycle(cfg: NovitaRenderCfg): NonNullable<NovitaRenderCfg["lifecycle"]> {
  const lifecycle = cfg.lifecycle;
  if (!lifecycle || ![lifecycle.ownerId, lifecycle.channelId, lifecycle.runId, lifecycle.blockId].every((value) => value.trim())) {
    throw new NovitaAdmissionError("direct Novita render requires owner, channel, run, and block lifecycle identity");
  }
  return lifecycle;
}

function renderPrompt(cfg: NovitaRenderCfg, shot: Shot): string {
  return [shot.prompt, cfg.style, cfg.director].filter((value): value is string => Boolean(value?.trim())).join("\n\n");
}

function negativePrompt(cfg: NovitaRenderCfg, shot: Shot): string {
  return [cfg.negative, shot.negative].filter((value): value is string => Boolean(value?.trim())).join("; ");
}

function secondsToLtxFrames(seconds: number, fps: number): number {
  const raw = Math.max(9, Math.round(seconds * fps));
  return Math.max(9, Math.round((raw - 1) / 8) * 8 + 1);
}

function makeRenderJobs(
  cfg: NovitaRenderCfg,
  phase: Phase,
  adapters = new Map<string, ResolvedLtxCreativeAdapter>(),
): DirectRenderJob[] {
  const profile = cfg.profile;
  if (phase === "image") {
    return cfg.shots.flatMap((shot) => {
      const count = shot.candidateCount ?? profile.candidates;
      return Array.from({ length: count }, (_, candidateIndex) => {
        const id = `${shot.id}-c${String(candidateIndex + 1).padStart(2, "0")}`;
        return {
          id,
          shotId: shot.id,
          candidateIndex,
          key: "",
          payload: {
            id,
            prompt: renderPrompt(cfg, shot),
            seed: (shot.seed ?? 0) + candidateIndex * 10_000,
            width: profile.width,
            height: profile.height,
            steps: profile.steps,
            guidanceScale: profile.guidanceScale,
          },
        };
      });
    });
  }
  const fps = profile.fps;
  if (!fps) throw new NovitaAdmissionError("direct LTX render profile is missing FPS");
  return cfg.shots.map((shot) => {
    if (!shot.stillKey) throw new NovitaAdmissionError(`direct LTX render is missing stillKey for ${shot.id}`);
    const sealedNegativePrompt = negativePrompt(cfg, shot);
    // Official LTX 2.5 distilled does not expose a negative-prompt argument.
    // Reject it instead of silently dropping a creator's safety/quality cue.
    if (sealedNegativePrompt) {
      throw new NovitaAdmissionError(`LTX-2.5 distilled does not support a negative prompt for ${shot.id}`);
    }
    const creativeAdapter = adapters.get(shot.id);
    const prompt = [
      renderPrompt(cfg, shot),
      ...(creativeAdapter
        ? [`[LTX creative adapter ${creativeAdapter.id}] Activate only with these calibrated trigger tokens: ${creativeAdapter.triggerTokens.join(", ")}.`]
        : []),
    ].join("\n\n");
    return {
      id: shot.id,
      shotId: shot.id,
      candidateIndex: 0,
      key: "",
      payload: {
        id: shot.id,
        prompt,
        seed: shot.seed ?? 0,
        width: profile.width,
        height: profile.height,
        steps: profile.steps,
        frames: secondsToLtxFrames(shot.seconds, fps),
        fps,
        // Leave room for the 20-minute boot/deletion windows under the hard
        // two-hour worker lease. One worker has one bounded LTX clip.
        timeoutSeconds: 5_400,
        stillKey: shot.stillKey,
        ...(shot.endStillKey ? { endStillKey: shot.endStillKey } : {}),
        ...(creativeAdapter ? { creativeAdapter } : {}),
      },
    };
  });
}

/**
 * Capacity policy is intentionally binary. Small cinematic work remains on
 * one RTX 4090 to avoid needless cold starts; a substantial storyboard uses
 * all eight independent one-GPU workers when the live, verified quota permits
 * it. LTX is not model-parallel across those workers—each receives one sealed
 * job, so this is safe horizontal concurrency rather than a false 8-GPU model
 * claim.
 */
export function automaticRtx4090Concurrency(shots: Array<Pick<Shot, "seconds">>): 1 | 8 {
  const totalDurationSeconds = shots.reduce((total, shot) => total + Math.max(0, shot.seconds), 0);
  return shots.length >= 8 || totalDurationSeconds >= 60 ? NOVITA_HARD_GPU_LIMIT : 1;
}

async function loadModelManifest(config: DirectNovitaConfig): Promise<Array<Record<string, unknown>>> {
  const bytes = await getObjectBytes(config.modelManifestKey);
  if (hash(bytes) !== config.modelManifestSha256) {
    throw new NovitaAdmissionError("R2 model manifest digest does not match NOVITA_MODEL_MANIFEST_SHA256");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new NovitaAdmissionError("R2 model manifest is not valid JSON");
  }
  const models = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { models?: unknown }).models)
      ? (parsed as { models: unknown[] }).models
      : undefined;
  if (!models || !models.every((model) => model && typeof model === "object")) {
    throw new NovitaAdmissionError("R2 model manifest has no worker model contracts");
  }
  return models as Array<Record<string, unknown>>;
}

async function prepareControlPlane(): Promise<DirectControlPlane> {
  const config = directConfig();
  const provider = new NovitaGpuApiClient(config.apiKey);
  const account = await provider.accountSnapshot();
  const volume = account.volumes.find((item) => item.storageName === "ai-infra-models" && item.storageSizeGb > 0);
  if (!volume) throw new NovitaAdmissionError("Novita persistent ai-infra-models volume is unavailable");
  const scoped = await provider.accountSnapshot({ clusterId: volume.clusterId });
  const product = selectRtx4090SpotProduct(scoped.products, config.productId);
  if (config.imageAccess === "private-registry" && account.registryAuthCount < 1) {
    throw new NovitaAdmissionError("Novita registry authentication is required for the immutable worker image");
  }
  const imageDigest = config.workerImage.slice(config.workerImage.indexOf("@") + 1).toLowerCase();
  if (!scoped.prewarmedImageDigests.includes(imageDigest)) {
    throw new NovitaAdmissionError("immutable RTX 4090 worker image is not prewarmed in the selected Novita cluster");
  }
  const models = await loadModelManifest(config);
  return {
    config,
    provider,
    volume,
    product,
    models,
    activeInstanceCount: scoped.activeInstanceCount,
  };
}

/** Read-only cloud readiness; it never creates a provider worker. */
export async function directNovitaFleetHealth(): Promise<DirectNovitaFleetHealth> {
  try {
    await bootstrapSecrets();
    const control = await prepareControlPlane();
    const videoRuntime = assessNovitaVideoProfileRuntime(generationProfile("production"));
    // Control-plane readiness is not video admission. In particular the
    // exact model/runtime profile stays fail-closed until an operator records
    // the real 4090 benchmark; a model label alone cannot activate spending.
    return {
      ready: videoRuntime.ready,
      blockers: videoRuntime.ready ? [] : [...videoRuntime.blockers, "benchmark_and_pin_the_exact_ltx_2_5_4090_worker_before_enabling_video"],
      gpuSku: NOVITA_REQUIRED_GPU_SKU,
      verifiedGpuQuota: control.config.verifiedGpuQuota,
      productId: control.product.id,
      clusterId: control.volume.clusterId,
    };
  } catch (error) {
    return { ready: false, blockers: [safeError(error)], gpuSku: NOVITA_REQUIRED_GPU_SKU };
  }
}

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new NovitaAdmissionError("CONVEX_URL is required for the direct Novita worker lease");
  return new StudioConvexHttpClient(url);
}

function leaseFunctions(): Record<string, unknown> {
  const group = (api as unknown as { novitaWorkerLeases?: Record<string, unknown> }).novitaWorkerLeases;
  if (!group) throw new NovitaAdmissionError("Novita worker lease functions have not been deployed to Convex");
  return group;
}

async function leaseMutation<T>(
  convex: StudioConvexHttpClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const ref = leaseFunctions()[name];
  if (!ref) throw new NovitaAdmissionError(`Novita worker lease mutation ${name} is unavailable`);
  return await convex.mutation(ref as never, args as never) as T;
}

function stableRequest(cfg: NovitaRenderCfg, phase: Phase, job: DirectRenderJob, outputKey: string): {
  canonical: string;
  sha256: string;
  manifestId: string;
  profileSha256: string;
} {
  const profileSha256 = hash(canonicalJson(cfg.profile));
  const core = {
    contractVersion: "2.0.0",
    phase,
    profile: cfg.profile,
    profileSha256,
    job: job.payload,
    outputKey,
  };
  const canonical = canonicalJson(core);
  const sha256 = hash(canonical);
  return {
    canonical,
    sha256,
    manifestId: `${phase}-${sha256.slice(0, 32)}`,
    profileSha256,
  };
}

function existingManifest(value: unknown, manifestId: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const claimed = record.manifestSha256;
  const unsigned = { ...record };
  delete unsigned.manifestSha256;
  if (record.manifestId !== manifestId || !isSha256(claimed) || hash(canonicalJson(unsigned)) !== claimed) return undefined;
  if (!Number.isInteger(record.expiresAt) || Number(record.expiresAt) <= Date.now()) return undefined;
  return record;
}

export function budgetBoundedWorkerLifetime(args: { maximumCostUsd: number; hourlyRate: number }): {
  expiresAt: number;
  maxRuntimeSeconds: number;
} {
  if (!Number.isFinite(args.maximumCostUsd) || args.maximumCostUsd <= 0 || !Number.isFinite(args.hourlyRate) || args.hourlyRate <= 0) {
    throw new NovitaAdmissionError("direct Novita worker needs a finite positive budget and live spot rate");
  }
  const budgetLifetimeMs = Math.floor((args.maximumCostUsd / args.hourlyRate) * 3_600_000);
  const usableLifetimeMs = Math.min(
    MAX_WORKER_LIFETIME_MS,
    budgetLifetimeMs - BILLING_STARTUP_ALLOWANCE_MS - BILLING_TEARDOWN_GRACE_MS,
  );
  if (!Number.isSafeInteger(usableLifetimeMs) || usableLifetimeMs < MIN_WORKER_RUNTIME_MS) {
    throw new NovitaAdmissionError(
      "per-worker Novita budget cannot fund the allocation, minimum render window, and verified teardown grace",
    );
  }
  return {
    expiresAt: Date.now() + usableLifetimeMs,
    maxRuntimeSeconds: Math.floor(usableLifetimeMs / 1_000),
  };
}

function assertExistingManifestAdmission(
  manifest: Record<string, unknown>,
  args: { phase: Phase; profileSha256: string; maximumCostUsd: number },
): number {
  const maxCostUsd = Number(manifest.maxCostUsd);
  const maxRuntimeSeconds = Number(manifest.maxRuntimeSeconds);
  if (
    manifest.phase !== args.phase
    || manifest.gpuSku !== NOVITA_REQUIRED_GPU_SKU
    || manifest.gpuCount !== NOVITA_REQUIRED_GPU_COUNT
    || manifest.profileSha256 !== args.profileSha256
    || !Number.isFinite(maxCostUsd)
    || maxCostUsd <= 0
    || maxCostUsd > args.maximumCostUsd
    || !Number.isInteger(maxRuntimeSeconds)
    || maxRuntimeSeconds < MIN_WORKER_RUNTIME_MS / 1_000
    || maxRuntimeSeconds > MAX_WORKER_LIFETIME_MS / 1_000
  ) {
    throw new NovitaAdmissionError(
      "existing immutable Novita manifest no longer satisfies the current 4090/profile/budget admission",
    );
  }
  return maxCostUsd;
}

async function readJsonIfPresent(key: string): Promise<Record<string, unknown> | undefined> {
  try {
    const bytes = await getObjectBytes(key);
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;
    if (status === 404 || name === "NoSuchKey" || name === "NotFound") return undefined;
    throw error;
  }
}

function metadataFor(manifestId: string, profileSha256: string, jobId: string): Record<string, string> {
  return { "manifest-id": manifestId, "profile-sha256": profileSha256, "job-id": jobId };
}

function metadataHeaders(manifestId: string, profileSha256: string, jobId: string, contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "x-amz-meta-manifest-id": manifestId,
    "x-amz-meta-profile-sha256": profileSha256,
    "x-amz-meta-job-id": jobId,
  };
}

async function prepareWorkerManifest(args: {
  cfg: NovitaRenderCfg;
  phase: Phase;
  job: DirectRenderJob;
  control: DirectControlPlane;
  maximumCostUsd: number;
}): Promise<PreparedWorker> {
  const outputPrefix = `${args.cfg.prefix.replace(/\/$/, "")}/${args.phase}`;
  const extension = args.phase === "image" ? "png" : "mp4";
  const key = `${outputPrefix}/${args.job.id}.${extension}`;
  const identity = stableRequest(args.cfg, args.phase, args.job, key);
  const workerName = `yt-render-4090-${identity.manifestId}`;
  if (!WORKER_NAME.test(workerName)) throw new NovitaAdmissionError("direct Novita worker name violated the 4090 namespace");
  const controlPrefix = `${args.cfg.prefix.replace(/\/$/, "")}/control/${identity.manifestId}`;
  const manifestKey = `${controlPrefix}/manifest.json`;
  const existing = existingManifest(await readJsonIfPresent(manifestKey), identity.manifestId);
  if (existing) {
    const maximumCostUsd = assertExistingManifestAdmission(existing, {
      phase: args.phase,
      profileSha256: identity.profileSha256,
      maximumCostUsd: args.maximumCostUsd,
    });
    const manifestSha256 = String(existing.manifestSha256);
    const completionKey = String((existing.completion as { key?: unknown } | undefined)?.key ?? `${controlPrefix}/completion.json`);
    const heartbeatKey = String((existing.heartbeat as { key?: unknown } | undefined)?.key ?? `${controlPrefix}/heartbeat.json`);
    return {
      phase: args.phase,
      job: { ...args.job, key },
      manifestId: identity.manifestId,
      manifestSha256,
      manifestKey,
      completionKey,
      heartbeatKey,
      workerName,
      requestCanonicalJson: identity.canonical,
      requestSha256: identity.sha256,
      profileSha256: identity.profileSha256,
      expiresAt: Number(existing.expiresAt),
      maximumCostUsd,
      manifest: existing,
    };
  }

  const { expiresAt, maxRuntimeSeconds } = budgetBoundedWorkerLifetime({
    maximumCostUsd: args.maximumCostUsd,
    hourlyRate: args.control.product.spotPriceUsdPerHour,
  });
  const checkpointKey = `${controlPrefix}/checkpoint.json`;
  const heartbeatKey = `${controlPrefix}/heartbeat.json`;
  const completionKey = `${controlPrefix}/completion.json`;
  const contentType = args.phase === "image" ? "image/png" : "video/mp4";
  const artifactPutUrl = await presignUpload(key, {
    contentType,
    expiresIn: MANIFEST_URL_TTL_SECONDS,
    metadata: metadataFor(identity.manifestId, identity.profileSha256, args.job.id),
  });
  const [checkpointGetUrl, checkpointPutUrl, heartbeatPutUrl, completionPutUrl] = await Promise.all([
    presignDownload(checkpointKey, { expiresIn: MANIFEST_URL_TTL_SECONDS }),
    presignUpload(checkpointKey, { contentType: "application/json", expiresIn: MANIFEST_URL_TTL_SECONDS }),
    presignUpload(heartbeatKey, { contentType: "application/json", expiresIn: MANIFEST_URL_TTL_SECONDS }),
    presignUpload(completionKey, { contentType: "application/json", expiresIn: MANIFEST_URL_TTL_SECONDS }),
  ]);
  const payload = { ...args.job.payload };
  if (args.phase === "video") {
    const stillKey = String(payload.stillKey ?? "");
    const stillBytes = await getObjectBytes(stillKey);
    delete payload.stillKey;
    payload.input = { getUrl: await presignDownload(stillKey, { expiresIn: MANIFEST_URL_TTL_SECONDS }), sha256: hash(stillBytes) };
    const endStillKey = String(payload.endStillKey ?? "").trim();
    if (endStillKey) {
      const endStillBytes = await getObjectBytes(endStillKey);
      delete payload.endStillKey;
      payload.endInput = {
        getUrl: await presignDownload(endStillKey, { expiresIn: MANIFEST_URL_TTL_SECONDS }),
        sha256: hash(endStillBytes),
      };
    }
  }
  const unsigned = {
    contractVersion: "2.0.0" as const,
    phase: args.phase,
    manifestId: identity.manifestId,
    gpuSku: NOVITA_REQUIRED_GPU_SKU,
    gpuCount: NOVITA_REQUIRED_GPU_COUNT,
    expiresAt,
    maxCostUsd: args.maximumCostUsd,
    maxRuntimeSeconds,
    profile: args.cfg.profile,
    profileSha256: identity.profileSha256,
    ...(args.phase === "video"
      ? {
          runtimeRepository: OFFICIAL_RENDER_PINS.ltx.runtimeRepository,
          runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
        }
      : {}),
    models: args.control.models,
    checkpoint: {
      key: checkpointKey,
      getUrl: checkpointGetUrl,
      putUrl: checkpointPutUrl,
      headers: { "Content-Type": "application/json" },
    },
    heartbeat: {
      key: heartbeatKey,
      putUrl: heartbeatPutUrl,
      headers: { "Content-Type": "application/json" },
    },
    completion: {
      key: completionKey,
      putUrl: completionPutUrl,
      headers: { "Content-Type": "application/json" },
    },
    jobs: [{
      ...payload,
      artifact: {
        key,
        putUrl: artifactPutUrl,
        contentType,
        headers: metadataHeaders(identity.manifestId, identity.profileSha256, args.job.id, contentType),
      },
    }],
  };
  const manifest = sealNovitaWorkerManifest(unsigned);
  try {
    await putObject(manifestKey, JSON.stringify(manifest), {
      contentType: "application/json",
      metadata: { "manifest-id": identity.manifestId, "manifest-sha256": manifest.manifestSha256 },
      ifNoneMatch: "*",
    });
  } catch (error) {
    // A concurrent Trigger retry uses the first sealed manifest, never a new
    // URL/hash under the same paid worker identity.
    const raced = existingManifest(await readJsonIfPresent(manifestKey), identity.manifestId);
    if (!raced) throw error;
    const maximumCostUsd = assertExistingManifestAdmission(raced, {
      phase: args.phase,
      profileSha256: identity.profileSha256,
      maximumCostUsd: args.maximumCostUsd,
    });
    return {
      phase: args.phase,
      job: { ...args.job, key },
      manifestId: identity.manifestId,
      manifestSha256: String(raced.manifestSha256),
      manifestKey,
      completionKey: String((raced.completion as { key?: unknown } | undefined)?.key ?? completionKey),
      heartbeatKey: String((raced.heartbeat as { key?: unknown } | undefined)?.key ?? heartbeatKey),
      workerName,
      requestCanonicalJson: identity.canonical,
      requestSha256: identity.sha256,
      profileSha256: identity.profileSha256,
      expiresAt: Number(raced.expiresAt),
      maximumCostUsd,
      manifest: raced,
    };
  }
  return {
    phase: args.phase,
    job: { ...args.job, key },
    manifestId: identity.manifestId,
    manifestSha256: manifest.manifestSha256,
    manifestKey,
    completionKey,
    heartbeatKey,
    workerName,
    requestCanonicalJson: identity.canonical,
    requestSha256: identity.sha256,
    profileSha256: identity.profileSha256,
    expiresAt,
    maximumCostUsd: args.maximumCostUsd,
    manifest,
  };
}

async function artifactIsComplete(worker: PreparedWorker): Promise<boolean> {
  const metadata = await headObjectMetadata(worker.job.key);
  if (!metadata || metadata.contentLength === undefined || metadata.contentLength < 1) return false;
  const expected = metadataFor(worker.manifestId, worker.profileSha256, worker.job.id);
  return Object.entries(expected).every(([key, value]) => metadata.metadata[key] === value);
}

function reserveArgs(args: {
  worker: PreparedWorker;
  lifecycle: NonNullable<NovitaRenderCfg["lifecycle"]>;
  control: DirectControlPlane;
}): Record<string, unknown> {
  const now = Date.now();
  return {
    secret: args.control.config.internalSecret,
    ownerId: args.lifecycle.ownerId,
    channelId: args.lifecycle.channelId,
    runId: args.lifecycle.runId,
    blockId: args.lifecycle.blockId,
    phase: args.worker.phase,
    manifestId: args.worker.manifestId,
    manifestSha256: args.worker.manifestSha256,
    workerName: args.worker.workerName,
    productId: args.control.product.id,
    gpuSku: NOVITA_REQUIRED_GPU_SKU,
    gpuCount: NOVITA_REQUIRED_GPU_COUNT,
    clusterId: args.control.volume.clusterId,
    storageId: args.control.volume.storageId,
    imageDigest: args.control.config.workerImage,
    maximumCostUsd: args.worker.maximumCostUsd,
    verifiedGpuQuota: args.control.config.verifiedGpuQuota,
    requestedAt: now,
    bootDeadlineAt: Math.min(now + MAX_BOOT_WINDOW_MS, args.worker.expiresAt),
    absoluteDeadlineAt: args.worker.expiresAt,
  };
}

async function reserveLease(
  convex: StudioConvexHttpClient,
  args: Record<string, unknown>,
): Promise<ReservedLease> {
  return await leaseMutation<ReservedLease>(convex, "reserve", args);
}

function acceptWorkerVideoCompletionEvidence(worker: PreparedWorker, completion: CompletionReport): void {
  try {
    worker.videoOutputProof = assertLtxWorkerCompletionEvidence({
      profile: worker.manifest.profile as NovitaPhaseProfile,
      jobId: worker.job.id,
      completion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "returned invalid LTX x2 output evidence";
    throw new NovitaAdmissionError(`worker ${worker.workerName} ${message}`);
  }
}

async function restoreWorkerVideoCompletionEvidence(worker: PreparedWorker): Promise<void> {
  const completion = await readJsonIfPresent(worker.completionKey) as CompletionReport | undefined;
  if (completion?.status !== "done" || completion.manifestId !== worker.manifestId) {
    throw new NovitaAdmissionError(`worker ${worker.workerName} has an artifact without a matching LTX completion receipt`);
  }
  acceptWorkerVideoCompletionEvidence(worker, completion);
}

async function observeWorker(
  worker: PreparedWorker,
  convex: StudioConvexHttpClient,
  secret: string,
): Promise<void> {
  let attempt = 0;
  for (;;) {
    const completion = await readJsonIfPresent(worker.completionKey) as CompletionReport | undefined;
    if (completion?.status === "done") {
      const completed = completion.completedJobIds;
      if (
        completion.manifestId !== worker.manifestId
        || !Array.isArray(completed)
        || completed.length !== 1
        || completed[0] !== worker.job.id
        || completion.gpuSku !== NOVITA_REQUIRED_GPU_SKU
        || completion.gpuCount !== NOVITA_REQUIRED_GPU_COUNT
      ) {
        throw new NovitaAdmissionError(`worker ${worker.workerName} returned an invalid completion attestation`);
      }
      if (worker.phase === "video") {
        acceptWorkerVideoCompletionEvidence(worker, completion);
      }
      await leaseMutation<void>(convex, "heartbeat", {
        secret,
        workerName: worker.workerName,
        status: "draining",
        completionKey: worker.completionKey,
        now: Date.now(),
      });
      return;
    }
    if (completion?.status === "failed" || completion?.status === "interrupted") {
      throw new Error(`Novita worker ${worker.workerName} failed: ${String(completion.error ?? "unknown")}`);
    }
    const heartbeat = await readJsonIfPresent(worker.heartbeatKey) as CompletionReport | undefined;
    if (heartbeat?.manifestId === worker.manifestId && heartbeat.status === "running") {
      await leaseMutation<void>(convex, "heartbeat", {
        secret,
        workerName: worker.workerName,
        status: "rendering",
        now: Date.now(),
      });
    }
    if (Date.now() >= worker.expiresAt) {
      throw new Error(`Novita worker ${worker.workerName} exceeded its immutable two-hour lease`);
    }
    attempt += 1;
    await waitForNovitaRenderPoll({
      milliseconds: STATUS_POLL_MS,
      idempotencyKey: `novita-direct:${worker.manifestId}:poll:${attempt}`,
    });
  }
}

function lifecycleReceipt(args: {
  worker: PreparedWorker;
  instanceId: string;
  startedAt: number;
  endedAt: number;
  hourlyRate: number;
}): NovitaBillingReceipt {
  const gpuSeconds = Math.max(0, Math.ceil((args.endedAt - args.startedAt) / 1_000));
  const receipt = {
    provider: "novita" as const,
    currency: "USD" as const,
    receiptId: `novita-${args.worker.manifestId}-${args.instanceId}`.slice(0, 200),
    gpuSku: NOVITA_REQUIRED_GPU_SKU,
    gpuCount: NOVITA_REQUIRED_GPU_COUNT,
    gpuSeconds,
    gpuRateUsdPerSecond: args.hourlyRate / 3_600,
    startupUsd: 0,
    storageUsd: 0,
    costUsd: gpuSeconds * (args.hourlyRate / 3_600),
    costSource: "lifecycle_estimate" as const,
  };
  return receipt as NovitaBillingReceipt;
}

function storedBillingReceipt(value: unknown): NovitaBillingReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const receipt = value as Record<string, unknown>;
  const numeric = [
    receipt.gpuSeconds,
    receipt.gpuRateUsdPerSecond,
    receipt.startupUsd,
    receipt.storageUsd,
    receipt.costUsd,
  ];
  if (
    receipt.provider !== "novita"
    || receipt.currency !== "USD"
    || typeof receipt.receiptId !== "string"
    || receipt.receiptId.length < 8
    || receipt.gpuSku !== NOVITA_REQUIRED_GPU_SKU
    || receipt.gpuCount !== NOVITA_REQUIRED_GPU_COUNT
    || numeric.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)
    || (receipt.costSource !== undefined && receipt.costSource !== "provider_reported" && receipt.costSource !== "lifecycle_estimate")
  ) {
    return undefined;
  }
  return receipt as NovitaBillingReceipt;
}

async function deleteWorker(args: {
  worker: PreparedWorker;
  provider: NovitaGpuApiClient;
  convex: StudioConvexHttpClient;
  secret: string;
  instanceId: string;
  startedAt: number;
  hourlyRate: number;
  reason: string;
}): Promise<NovitaBillingReceipt> {
  await leaseMutation<void>(args.convex, "requestDeletion", {
    secret: args.secret,
    workerName: args.worker.workerName,
    now: Date.now(),
    reason: args.reason,
  });
  try {
    await args.provider.deleteAndVerify(args.instanceId);
    const receipt = lifecycleReceipt({
      worker: args.worker,
      instanceId: args.instanceId,
      startedAt: args.startedAt,
      endedAt: Date.now(),
      hourlyRate: args.hourlyRate,
    });
    await leaseMutation<void>(args.convex, "markDeletedVerified", {
      secret: args.secret,
      workerName: args.worker.workerName,
      now: Date.now(),
      billingReceipt: receipt,
    });
    return receipt;
  } catch (error) {
    await leaseMutation<void>(args.convex, "markDeletionUnverified", {
      secret: args.secret,
      workerName: args.worker.workerName,
      now: Date.now(),
      error: safeError(error),
    }).catch(() => undefined);
    throw new Error(`Novita worker ${args.worker.workerName} teardown was not verified: ${safeError(error)}`);
  }
}

async function recoverOrCreateInstance(args: {
  worker: PreparedWorker;
  lease: ReservedLease;
  control: DirectControlPlane;
  convex: StudioConvexHttpClient;
}): Promise<string> {
  const secret = args.control.config.internalSecret;
  if (args.lease.instanceId) return args.lease.instanceId;
  const attemptToken = randomUUID();
  const claim = await leaseMutation<CreateClaim>(args.convex, "claimCreate", {
    secret,
    workerName: args.worker.workerName,
    attemptToken,
    now: Date.now(),
  });
  if (!claim.claimed) {
    if (claim.instanceId) return claim.instanceId;
    // Only the mutation that owns this opaque token may send Novita's paid
    // create POST. A duplicate Trigger retry waits for that owner/reaper
    // instead of producing a second physical worker for one manifest.
    throw new CreateClaimInProgressError(args.worker.workerName);
  }
  const existing = (await args.control.provider.listManagedInstances())
    .find((instance) => instance.name === args.worker.workerName);
  let instanceId = existing?.id;
  if (!instanceId) {
    // Commit this transition before dispatching the non-transactional provider
    // request. If its HTTP response is lost, the reaper must retain an
    // unverified lease until the deterministic-name instance can be found and
    // deleted; it may never fabricate an absence receipt.
    await leaseMutation<void>(args.convex, "markCreateDispatched", {
      secret,
      workerName: args.worker.workerName,
      attemptToken,
      now: Date.now(),
    });
    instanceId = await args.control.provider.createSpotWorker(
      buildNovitaCreateWorkerRequest({
        name: args.worker.workerName,
        productId: args.control.product.id,
        gpuSku: NOVITA_REQUIRED_GPU_SKU,
        clusterId: args.control.volume.clusterId,
        storageId: args.control.volume.storageId,
        image: args.control.config.workerImage,
        ...(args.control.config.imageAuthId ? { imageAuthId: args.control.config.imageAuthId } : {}),
        publicImage: args.control.config.imageAccess !== "private-registry",
        ...(args.control.config.runtimeBundle ? {
          runtimeBundle: {
            downloadUrl: await presignDownload(args.control.config.runtimeBundle.key, {
              expiresIn: MANIFEST_URL_TTL_SECONDS,
            }),
            sha256: args.control.config.runtimeBundle.sha256,
          },
        } : {}),
        manifestUrl: await presignDownload(args.worker.manifestKey, { expiresIn: MANIFEST_URL_TTL_SECONDS }),
        manifestSha256: args.worker.manifestSha256,
        approval: {
          admitted: true,
          workerCount: 1,
          waves: [[args.worker.job.id]],
          estimatedUpperCostUsd: args.worker.maximumCostUsd,
          maxBudgetUsd: args.worker.maximumCostUsd,
          inventoryState: args.control.product.inventoryState,
        },
      }),
    );
  }
  await leaseMutation<void>(args.convex, "bindInstance", {
    secret,
    workerName: args.worker.workerName,
    instanceId,
    attemptToken,
    now: Date.now(),
  });
  await leaseMutation<void>(args.convex, "heartbeat", {
    secret,
    workerName: args.worker.workerName,
    status: "booting",
    now: Date.now(),
  });
  return instanceId;
}

async function renderWorker(args: {
  worker: PreparedWorker;
  lifecycle: NonNullable<NovitaRenderCfg["lifecycle"]>;
  control: DirectControlPlane;
  convex: StudioConvexHttpClient;
}): Promise<NovitaBillingReceipt> {
  const { worker, control, convex } = args;
  const secret = control.config.internalSecret;
  const lease = await reserveLease(convex, reserveArgs(args));
  if (lease.status === "deletion_unverified") {
    throw new Error(`Novita worker ${worker.workerName} has unverified prior teardown; reaper must close it first`);
  }
  if (lease.status === "failed") {
    throw new Error(`Novita worker ${worker.workerName} already failed; a new immutable render request is required`);
  }
  if (lease.status === "deleted_verified") {
    if (await artifactIsComplete(worker)) {
      const stored = storedBillingReceipt(lease.billingReceipt);
      if (stored) return stored;
      // A reaper can verify deletion after a crashed controller. It deliberately
      // records only a teardown receipt, so retain a conservative lifecycle
      // estimate rather than reporting a false zero-cost render.
      return lifecycleReceipt({
        worker,
        instanceId: "reaper-verified",
        startedAt: lease.requestedAt,
        endedAt: lease.deletedVerifiedAt ?? Date.now(),
        hourlyRate: control.product.spotPriceUsdPerHour,
      });
    }
    throw new Error(`Novita worker ${worker.workerName} was deleted before its required artifact was verified`);
  }

  const execution = await leaseMutation<CreateClaim>(convex, "claimExecution", {
    secret,
    workerName: worker.workerName,
    attemptToken: randomUUID(),
    now: Date.now(),
  });
  if (!execution.claimed) {
    // A duplicate Trigger retry is deliberately non-destructive. The durable
    // owner keeps its worker; a crash is resolved by the minute reaper rather
    // than two observers racing completion and deletion.
    throw new ExecutionClaimInProgressError(worker.workerName);
  }

  if (lease.status === "delete_requested") {
    // A retry must never turn a persisted teardown intent into a fresh paid
    // create. The execution fence above also prevents two retry observers from
    // racing this final deletion receipt.
    if (!lease.instanceId) {
      throw new Error(`Novita worker ${worker.workerName} has a pending teardown without a provider identity; reaper reconciliation is required`);
    }
    const receipt = await deleteWorker({
      worker,
      provider: control.provider,
      convex,
      secret,
      instanceId: lease.instanceId,
      startedAt: lease.instanceCreatedAt ?? lease.requestedAt,
      hourlyRate: control.product.spotPriceUsdPerHour,
      reason: "resuming automatic teardown requested by a prior attempt",
    });
    if (!await artifactIsComplete(worker)) {
      throw new Error(`Novita worker ${worker.workerName} closed while its required R2 artifact remained incomplete`);
    }
    return receipt;
  }

  let instanceId: string | undefined;
  // A resumed controller must never report only its own retry tail as total
  // GPU usage. The durable lease anchor is intentionally conservative.
  const startedAt = lease.instanceCreatedAt ?? lease.requestedAt;
  let renderError: unknown;
  try {
    // Recheck the exact SKU immediately before every paid create. A normal
    // availability signal never authorizes a silent H100/A100 substitution.
    const latest = await control.provider.accountSnapshot({ clusterId: control.volume.clusterId });
    selectRtx4090SpotProduct(latest.products, control.product.id);
    if (latest.activeInstanceCount >= control.config.verifiedGpuQuota) {
      throw new NovitaAdmissionError("verified RTX 4090 quota is exhausted before worker create");
    }
    instanceId = await recoverOrCreateInstance({ worker, lease, control, convex });
    await observeWorker(worker, convex, secret);
  } catch (error) {
    if (error instanceof CreateClaimInProgressError || error instanceof ExecutionClaimInProgressError) throw error;
    renderError = error;
    await leaseMutation<void>(convex, "markFailed", {
      secret,
      workerName: worker.workerName,
      now: Date.now(),
      error: safeError(error),
    }).catch(() => undefined);
  }

  if (!instanceId) {
    // The create request may have timed out after the provider accepted it.
    // Do not falsely attest deletion: the minute reaper will match any
    // deterministic-name orphan and retain this unverified lease until then.
    await leaseMutation<void>(convex, "requestDeletion", {
      secret,
      workerName: worker.workerName,
      now: Date.now(),
      reason: renderError ? safeError(renderError) : "provider instance identity unavailable",
    }).catch(() => undefined);
    await leaseMutation<void>(convex, "markDeletionUnverified", {
      secret,
      workerName: worker.workerName,
      now: Date.now(),
      error: "provider instance identity unavailable; deterministic-name reaper required",
    }).catch(() => undefined);
    throw renderError ?? new Error(`Novita worker ${worker.workerName} did not return an instance identity`);
  }

  const receipt = await deleteWorker({
    worker,
    provider: control.provider,
    convex,
    secret,
    instanceId,
    startedAt,
    hourlyRate: control.product.spotPriceUsdPerHour,
    reason: renderError ? `render failed: ${safeError(renderError)}` : "render complete",
  });
  if (renderError) throw renderError;
  if (!await artifactIsComplete(worker)) {
    throw new Error(`Novita worker ${worker.workerName} closed without its required R2 artifact`);
  }
  return receipt;
}

function aggregateReceipt(receipts: NovitaBillingReceipt[], requestSha256: string): NovitaBillingReceipt {
  const gpuSeconds = receipts.reduce((sum, receipt) => sum + receipt.gpuSeconds, 0);
  const costUsd = receipts.reduce((sum, receipt) => sum + receipt.costUsd, 0);
  const gpuRateUsdPerSecond = receipts.length ? Math.max(...receipts.map((receipt) => receipt.gpuRateUsdPerSecond)) : 0;
  return {
    provider: "novita",
    currency: "USD",
    receiptId: `novita-aggregate-${requestSha256.slice(0, 32)}`,
    gpuSku: NOVITA_REQUIRED_GPU_SKU,
    gpuCount: NOVITA_REQUIRED_GPU_COUNT,
    gpuSeconds,
    gpuRateUsdPerSecond,
    startupUsd: 0,
    storageUsd: 0,
    costUsd,
    costSource: "lifecycle_estimate",
  } as NovitaBillingReceipt;
}

function directStatus(args: {
  phase: Phase;
  cfg: NovitaRenderCfg;
  workers: PreparedWorker[];
  receipt: NovitaBillingReceipt;
}): NovitaBridgeStatus {
  const videoProof = args.phase === "video" ? args.workers[0]?.videoOutputProof : undefined;
  if (args.phase === "video" && (!videoProof || args.workers.some((worker) =>
    !worker.videoOutputProof
    || worker.videoOutputProof.outputWidth !== videoProof.outputWidth
    || worker.videoOutputProof.outputHeight !== videoProof.outputHeight
    || worker.videoOutputProof.stageOneWidth !== videoProof.stageOneWidth
    || worker.videoOutputProof.stageOneHeight !== videoProof.stageOneHeight
  ))) {
    throw new NovitaAdmissionError("direct LTX render is missing consistent worker-observed x2 output proofs");
  }
  const expectedKeys = args.workers.map((worker) => worker.job.key);
  const profileSha256 = hash(canonicalJson(args.cfg.profile));
  const requestCanonicalJson = canonicalJson({
    phase: args.phase,
    workers: args.workers.map((worker) => worker.requestSha256).sort(),
  });
  const requestSha256 = hash(requestCanonicalJson);
  const status = {
    ok: true,
    jobId: `${args.phase}-${requestSha256.slice(0, 32)}`,
    phase: args.phase,
    status: "done" as const,
    outputs: expectedKeys,
    n_outputs: expectedKeys.length,
    n_jobs: expectedKeys.length,
    outputPrefix: `${args.cfg.prefix.replace(/\/$/, "")}/${args.phase}`,
    expectedKeys,
    missingKeys: [],
    failedIds: [],
    ...(args.phase === "image" ? { stillKeys: expectedKeys } : { footageKeys: expectedKeys, footageClips: [] }),
    profile: args.cfg.profile,
    profileSha256,
    // Aggregation has multiple independently sealed worker manifests. This
    // deterministic request hash is the parent identity; individual hashes
    // remain in the immutable lease records and R2 artifact metadata.
    manifestSha256: hash(canonicalJson(args.workers.map((worker) => worker.manifestSha256).sort())),
    requestSha256,
    runtimeAttestation: {
      provider: "novita" as const,
      capacityMode: "spot" as const,
      weightStorage: "local-persistent-disk" as const,
      cacheMount: "/workspace/model-cache",
      checkpointing: true as const,
      idleShutdownSeconds: 120,
      gpuCount: NOVITA_REQUIRED_GPU_COUNT,
      model: args.cfg.profile.model,
      revision: args.cfg.profile.revision,
      checkpoint: args.cfg.profile.checkpoint,
      ...(args.phase === "video" ? { precision: args.cfg.profile.precision } : {}),
      ...(args.phase === "video" && args.cfg.profile.pipeline ? { pipeline: args.cfg.profile.pipeline } : {}),
      ...(args.phase === "video" && args.cfg.profile.twoStageRefine !== undefined
        ? { twoStageRefine: args.cfg.profile.twoStageRefine }
        : {}),
      ...(args.phase === "video" && args.cfg.profile.distilledLoraCheckpoint
        ? { distilledLoraCheckpoint: args.cfg.profile.distilledLoraCheckpoint }
        : {}),
      ...(args.phase === "video" && args.cfg.profile.textEncoderCheckpoint
        ? { textEncoderCheckpoint: args.cfg.profile.textEncoderCheckpoint }
        : {}),
      ...(args.phase === "video" && args.cfg.profile.videoVaeCheckpoint
        ? { videoVaeCheckpoint: args.cfg.profile.videoVaeCheckpoint }
        : {}),
      ...(args.phase === "video" && args.cfg.profile.audioVaeCheckpoint
        ? { audioVaeCheckpoint: args.cfg.profile.audioVaeCheckpoint }
        : {}),
      ...(args.phase === "video" && args.cfg.profile.spatialUpscalerCheckpoint
        ? { spatialUpscalerCheckpoint: args.cfg.profile.spatialUpscalerCheckpoint }
        : {}),
      ...(args.phase === "video" && args.cfg.profile.quantization
        ? { quantization: args.cfg.profile.quantization }
        : {}),
      ...(args.phase === "video" && args.cfg.profile.offload
        ? { offload: args.cfg.profile.offload }
        : {}),
      ...(args.phase === "video" && args.cfg.profile.spatialUpscaleFactor
        ? { spatialUpscaleFactor: args.cfg.profile.spatialUpscaleFactor }
        : {}),
      ...(args.phase === "video" && args.cfg.profile.stageOneWidth
        ? { stageOneWidth: args.cfg.profile.stageOneWidth }
        : {}),
      ...(args.phase === "video" && args.cfg.profile.stageOneHeight
        ? { stageOneHeight: args.cfg.profile.stageOneHeight }
        : {}),
      ...(videoProof ? { outputWidth: videoProof.outputWidth, outputHeight: videoProof.outputHeight } : {}),
    },
    billingReceipt: args.receipt,
    billingReceiptSha256: hash(canonicalJson(args.receipt)),
    error: null,
  };
  return status as NovitaBridgeStatus;
}

/**
 * Execute either Z-Image keyframes or LTX video directly from a Trigger cloud
 * task. It is deliberately not exported from a route/UI surface.
 */
export async function renderDirectNovita(cfg: NovitaRenderCfg, phase: Phase): Promise<NovitaRenderResult> {
  const lifecycle = ensureLifecycle(cfg);
  if (phase === "video") assertRtx4090VideoRuntime(cfg.profile);
  // A provider-facing caller must carry its own conservative worker envelope.
  // Falling back to the fleet-wide account cap converts a missing module
  // reservation into permission to consume unrelated stages' budget.
  if (!Number.isFinite(cfg.maxCostUsd) || !cfg.maxCostUsd || cfg.maxCostUsd <= 0) {
    throw new NovitaAdmissionError(
      "direct Novita render requires an explicit positive maxCostUsd before control-plane admission",
    );
  }
  await bootstrapSecrets();
  const control = await prepareControlPlane();
  if (control.activeInstanceCount >= control.config.verifiedGpuQuota) {
    throw new NovitaAdmissionError("all verified RTX 4090 capacity is currently in use");
  }
  const adapters = phase === "video"
    ? resolveLtxCreativeAdapters({
        selections: new Map(cfg.shots.map((shot) => [shot.id, shot.creativeAdapter] as const)),
        modelSpecs: control.models,
        baseModel: cfg.profile.model,
        baseRevision: cfg.profile.revision,
        runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
      })
    : new Map<string, ResolvedLtxCreativeAdapter>();
  const jobs = makeRenderJobs(cfg, phase, adapters);
  if (!jobs.length) throw new NovitaAdmissionError("direct Novita render has no jobs");
  const requestedWorkers = automaticRtx4090Concurrency(cfg.shots);
  const totalMaximumCost = Math.min(cfg.maxCostUsd, control.config.maximumFleetUsd);
  if (!Number.isFinite(totalMaximumCost) || totalMaximumCost <= 0) {
    throw new NovitaAdmissionError("direct Novita render has no positive fleet budget");
  }
  const perWorkerMaximumCost = Math.min(control.config.maximumJobUsd, totalMaximumCost / jobs.length);
  if (!Number.isFinite(perWorkerMaximumCost) || perWorkerMaximumCost <= 0) {
    throw new NovitaAdmissionError("direct Novita render has no positive per-worker budget");
  }
  const estimatedMinutesPerJob = phase === "image" ? 3 : 20;
  const coldStartMinutes = (BILLING_STARTUP_ALLOWANCE_MS + BILLING_TEARDOWN_GRACE_MS) / 60_000;
  const requiredWorkerRuntimeSeconds = estimatedMinutesPerJob * 60;
  const boundedLifetime = budgetBoundedWorkerLifetime({
    maximumCostUsd: perWorkerMaximumCost,
    hourlyRate: control.product.spotPriceUsdPerHour,
  });
  if (boundedLifetime.maxRuntimeSeconds < requiredWorkerRuntimeSeconds) {
    throw new NovitaAdmissionError(
      `per-worker budget permits ${boundedLifetime.maxRuntimeSeconds}s but ${phase} admission requires ${requiredWorkerRuntimeSeconds}s`,
    );
  }
  const plan: NovitaCapacityPlan = planNovitaCapacityWaves({
    jobIds: jobs.map((job) => job.id),
    requestedWorkers,
    verifiedGpuQuota: Math.max(0, control.config.verifiedGpuQuota - control.activeInstanceCount),
    inventoryState: control.product.inventoryState,
    spotPriceUsdPerHour: control.product.spotPriceUsdPerHour,
    estimatedMinutesPerJob,
    coldStartMinutes,
    coldStartPerJob: true,
    maxBudgetUsd: totalMaximumCost,
  });
  // A sealed manifest contains non-refreshable signed R2 URLs and its own
  // absolute deadline. Prepare only the imminent wave, never the whole
  // storyboard, so a queue cannot burn through a later worker's lifetime
  // before it is even allocated.
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const prepared: PreparedWorker[] = [];
  const convex = convexClient();
  const receiptByManifest = new Map<string, NovitaBillingReceipt>();
  let spendAuthorized = false;
  for (const waveIds of plan.waves) {
    const wave: PreparedWorker[] = [];
    for (const jobId of waveIds) {
      const job = jobsById.get(jobId);
      if (!job) throw new NovitaAdmissionError(`Novita capacity plan references unknown job ${jobId}`);
      const worker = await prepareWorkerManifest({
        cfg,
        phase,
        job,
        control,
        maximumCostUsd: perWorkerMaximumCost,
      });
      prepared.push(worker);
      if (!await artifactIsComplete(worker)) {
        wave.push(worker);
      } else if (phase === "video") {
        // A pre-existing R2 artifact is not enough to reuse a video result:
        // restore the worker's immutable ffprobe proof before it can bypass
        // a paid execution.
        await restoreWorkerVideoCompletionEvidence(worker);
      }
    }
    if (wave.length && !spendAuthorized && cfg.beforeProviderSpend) {
      await cfg.beforeProviderSpend();
      spendAuthorized = true;
    }
    const receipts = await Promise.all(wave.map(async (worker) => ({
      manifestId: worker.manifestId,
      receipt: await renderWorker({ worker, lifecycle, control, convex }),
    })));
    receipts.forEach(({ manifestId, receipt }) => receiptByManifest.set(manifestId, receipt));
  }
  const allReceipts = prepared.map((worker) => receiptByManifest.get(worker.manifestId) ?? lifecycleReceipt({
    worker,
    instanceId: "already-closed",
    startedAt: Date.now(),
    endedAt: Date.now(),
    hourlyRate: control.product.spotPriceUsdPerHour,
  }));
  if (phase === "video") {
    await Promise.all(prepared.map(async (worker) => {
      if (!worker.videoOutputProof) await restoreWorkerVideoCompletionEvidence(worker);
    }));
  }
  const status = directStatus({ phase, cfg, workers: prepared, receipt: aggregateReceipt(allReceipts, hash(canonicalJson(plan))) });
  const candidates: RenderedCandidate[] = prepared.map((worker) => ({
    shotId: worker.job.shotId,
    candidateIndex: worker.job.candidateIndex,
    outputId: worker.job.id,
    key: worker.job.key,
  }));
  return {
    ok: true,
    phase,
    ...(phase === "image" ? { stillKeys: candidates.map((candidate) => candidate.key) } : { footageKeys: candidates.map((candidate) => candidate.key), footageClips: [] }),
    candidates,
    ...(phase === "video" ? {
      videoOutputProofs: Object.fromEntries(prepared.map((worker) => [worker.job.shotId, worker.videoOutputProof!])),
    } : {}),
    outputs: candidates.length,
    durationSec: 0,
    costUsd: status.billingReceipt.costUsd,
    billingReceipt: status.billingReceipt,
    requestCanonicalJson: canonicalJson({ phase, plan, workerRequests: prepared.map((worker) => worker.requestSha256).sort() }),
    raw: status,
  };
}
