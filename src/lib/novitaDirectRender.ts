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
import {
  assertLtxWorkerCompletionEvidence,
  type LtxNativeInputGeometrySources,
} from "@/lib/ltxVideoProof";
import {
  assertCinematicProofAdmission,
  requiresNative720X2CinematicProof,
} from "@/lib/cinematicProofAdmission";
import {
  resolveLtxCreativeAdapters,
  LTX_CREATIVE_ADAPTER_STACK_VERSION,
  type ResolvedLtxCreativeAdapterStack,
} from "@/lib/ltxCreativeAdapter";
import { applyLtxI2vPromptContract } from "@/lib/ltxI2vPrompt";
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
  runtimeBundle?: { key: string; sha256: string; archive: "gzip" };
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

function workerWaveTerminalError(total: number, failures: readonly unknown[]): Error {
  return new Error(
    `Novita worker wave reached ${total} terminal outcome(s) with ${failures.length} failure(s): ${safeError(failures[0])}`,
  );
}

async function renderNovitaWorkerWave(args: {
  workers: readonly PreparedWorker[];
  lifecycle: NonNullable<NovitaRenderCfg["lifecycle"]>;
  control: DirectControlPlane;
  convex: StudioConvexHttpClient;
  beforeProviderSpend?: NovitaRenderCfg["beforeProviderSpend"];
  remoteChildFence?: NovitaRenderCfg["remoteChildFence"];
}): Promise<Array<{ manifestId: string; receipt: NovitaBillingReceipt }>> {
  // Starting a bounded capacity wave remains concurrent. Only observation is
  // serialized through the single durable wave checkpoint below.
  const started = await Promise.allSettled(args.workers.map((worker) => startWorker({
    worker,
    lifecycle: args.lifecycle,
    control: args.control,
    convex: args.convex,
    beforeProviderSpend: args.beforeProviderSpend,
    remoteChildFence: args.remoteChildFence,
  })));
  const receipts = new Map<string, NovitaBillingReceipt>();
  const failures: unknown[] = [];
  const active: ActiveNovitaWorker[] = [];
  for (let index = 0; index < started.length; index += 1) {
    const result = started[index]!;
    if (result.status === "rejected") {
      failures.push(result.reason);
      continue;
    }
    if (result.value.status === "completed") {
      receipts.set(args.workers[index]!.manifestId, result.value.receipt);
    } else {
      active.push(result.value.active);
    }
  }

  const finalized = new Set<ActiveNovitaWorker>();
  const outcomes = new Map<ActiveNovitaWorker, NovitaWorkerTerminalOutcome>();
  const settleWorkers = async (workers: readonly ActiveNovitaWorker[]) => {
    await Promise.all(workers.map(async (activeWorker) => {
      if (finalized.has(activeWorker)) return;
      finalized.add(activeWorker);
      const outcome = outcomes.get(activeWorker) ?? ({ failed: false } as const);
      if (outcome.failed && !activeWorker.startupFailed) {
        await markActiveWorkerFailed(activeWorker, outcome.error);
      }
      try {
        const receipt = await closeActiveWorker(activeWorker, outcome);
        receipts.set(activeWorker.worker.manifestId, receipt);
      } catch (error) {
        failures.push(error);
      }
    }));
  };

  let checkpointFailed = false;
  let checkpointFailure: unknown;
  const pollScope = args.workers.length === 1
    ? args.workers[0]!.manifestId
    : `wave-${hash(canonicalJson(args.workers.map((worker) => worker.manifestId).sort())).slice(0, 32)}`;
  try {
    await pollNovitaWorkerWave({
      workers: active,
      inspect: async (activeWorker) => {
        if (activeWorker.startupFailed) {
          outcomes.set(activeWorker, { failed: true, error: activeWorker.startupFailure });
          return "complete";
        }
        try {
          const state = await observeWorkerTick(
            activeWorker.worker,
            activeWorker.convex,
            activeWorker.secret,
            activeWorker.remoteChildFence,
          );
          if (state === "complete") outcomes.set(activeWorker, { failed: false });
          return state;
        } catch (error) {
          outcomes.set(activeWorker, { failed: true, error });
          return "complete";
        }
      },
      settleTerminal: settleWorkers,
      checkpoint: async ({ attempt }) => {
        // Reassert the remote-child generation once for this durable wave
        // checkpoint. A stale parent cannot keep any worker alive into the
        // next poll, while every worker retains its own durable heartbeat.
        await args.beforeProviderSpend?.({ reason: "poll" });
        await waitForNovitaRenderPoll({
          milliseconds: STATUS_POLL_MS,
          idempotencyKey: `novita-direct:${pollScope}:poll:${attempt}`,
        });
      },
    });
  } catch (error) {
    checkpointFailed = true;
    checkpointFailure = error;
  }

  if (checkpointFailed) {
    for (const activeWorker of active) {
      if (!finalized.has(activeWorker)) {
        outcomes.set(activeWorker, { failed: true, error: checkpointFailure });
      }
    }
    await settleWorkers(active);
  }

  if (failures.length) throw workerWaveTerminalError(args.workers.length, failures);
  return args.workers.map((worker) => {
    const receipt = receipts.get(worker.manifestId);
    if (!receipt) throw new Error(`Novita worker ${worker.workerName} did not reach a billing receipt`);
    return { manifestId: worker.manifestId, receipt };
  });
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
  const runtimeBundleKey = imageAccess === "public-runtime-base"
    ? requiredEnv("NOVITA_RUNTIME_BUNDLE_KEY")
    : undefined;
  const runtimeBundle = runtimeBundleKey ? {
    key: runtimeBundleKey,
    sha256: requiredEnv("NOVITA_RUNTIME_BUNDLE_SHA256").toLowerCase(),
    archive: "gzip" as const,
  } : undefined;
  if (runtimeBundle && (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,767}$/.test(runtimeBundle.key)
    || runtimeBundle.key.includes("..")
    || !isSha256(runtimeBundle.sha256)
    || !/\.tar\.gz$/.test(runtimeBundle.key)
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
  adapters = new Map<string, ResolvedLtxCreativeAdapterStack>(),
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
    const creativeAdapterStack = adapters.get(shot.id);
    const creativeAdapters = creativeAdapterStack?.adapters ?? [];
    const prompt = [
      renderPrompt(cfg, shot),
      ...creativeAdapters.map((adapter) => (
        `[LTX creative adapter ${adapter.id}] Activate only with these calibrated trigger tokens: ${adapter.triggerTokens.join(", ")}.`
      )),
    ].join("\n\n");
    const workerAdapters = creativeAdapters.map(({ id, strength, triggerTokens }) => ({ id, strength, triggerTokens }));
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
        ...(creativeAdapterStack?.benchmark
          ? {
              creativeAdapterStack: {
                version: LTX_CREATIVE_ADAPTER_STACK_VERSION,
                adapters: workerAdapters,
                benchmark: creativeAdapterStack.benchmark,
              },
            }
          : workerAdapters[0] ? { creativeAdapter: workerAdapters[0] } : {}),
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

/**
 * Novita re-wraps a worker command before executing it, so a multi-line shell
 * bootstrap is not stable at the provider boundary.  The command is kept to
 * a tiny Python URL loader; this source is a SHA-bound R2 object fetched by
 * that loader and verifies/extracts only the sealed gzip runtime bundle.
 */
/**
 * Content-addressed bootstrap used by every public-base LTX worker.  Keep the
 * compatibility receipt deliberately inside the sealed runtime root: a
 * worker may only reuse it after re-proving the exact CUDA/Torch runtime.
 */
export function runtimeBootstrapSource(runtimeSha256: string): string {
  return String.raw`import fcntl,hashlib,os,pathlib,shutil,tarfile,tempfile,urllib.request
sha=${JSON.stringify(runtimeSha256)}
root=pathlib.Path('/network/runtime/ltx-2.5-'+sha)
compatibility=root/'.torch-cu128-2.8.0'
def torch_cuda_ready():
  python=root/'opt/LTX-2/.venv/bin/python'
  if not python.is_file(): return False
  import subprocess
  try:
    evidence=subprocess.check_output([str(python),'-c',"import torch,torch.sparse;print(torch.__version__+'|'+str(torch.version.cuda)+'|'+str(torch.cuda.is_available()))"],text=True,stderr=subprocess.DEVNULL,timeout=45).strip()
  except (OSError,subprocess.SubprocessError): return False
  return evidence=='2.8.0+cu128|12.8|True'
def compatibility_ready():
  # A historical bootstrap wrote a literal backslash-n. It was written only
  # after the CUDA probe below succeeded, so normalize that valid receipt.
  return compatibility.is_file() and compatibility.read_text().strip().replace(chr(92)+'n','')=='torch==2.8.0+cu128' and torch_cuda_ready()
def repair_python_paths(runtime_root):
  original='/opt/LTX-2'
  relocated=str(runtime_root/'opt/LTX-2')
  for receipt in (runtime_root/'opt/LTX-2/.venv').rglob('*.pth'):
    content=receipt.read_text('utf-8')
    if original in content: receipt.write_text(content.replace(original,relocated),'utf-8')
def runtime_ready():
  return (root/'.ready').is_file() and (root/'.ready').read_text().strip()==sha and compatibility_ready()
def ensure_cuda_compatibility():
  if compatibility_ready(): return
  python=root/'opt/LTX-2/.venv/bin/python'
  if not python.is_file(): raise RuntimeError('portable Python is missing before CUDA compatibility install')
  import subprocess,sys
  subprocess.run([sys.executable,'-m','pip','install','--no-cache-dir','uv==0.10.6'],check=True,stdout=subprocess.DEVNULL)
  subprocess.run(['uv','pip','install','--python',str(python),'--reinstall','torch==2.8.0','torchvision==0.23.0','torchaudio==2.8.0','--index-url','https://download.pytorch.org/whl/cu128'],check=True,stdout=subprocess.DEVNULL)
  evidence=subprocess.check_output([str(python),'-c',"import torch,torch.sparse;print(torch.__version__+'|'+str(torch.version.cuda)+'|'+str(torch.cuda.is_available()))"],text=True).strip()
  if evidence!='2.8.0+cu128|12.8|True': raise RuntimeError('CUDA-compatible Torch verification failed: '+evidence)
  compatibility.write_text('torch==2.8.0+cu128'+chr(10))
def command_ready(command,version_argument):
  if not command: return False
  import subprocess
  try:
    subprocess.run([command,version_argument],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
    return True
  except (OSError,subprocess.SubprocessError): return False
def compiler_ready(command): return command_ready(command,'--version')
def media_tool_ready(command): return command_ready(command,'-version')
def ensure_triton_toolchain():
  # Torch 2.8 may JIT Triton kernels on the first LTX inference. The public
  # PyTorch runtime image intentionally omits build and media-probe tools, so
  # install and validate them before the worker touches the model. ffprobe is
  # a required completion gate, not an optional post-processing dependency.
  cc=shutil.which('gcc')
  cxx=shutil.which('g++')
  ffmpeg=shutil.which('ffmpeg')
  ffprobe=shutil.which('ffprobe')
  if not compiler_ready(cc) or not compiler_ready(cxx) or not media_tool_ready(ffmpeg) or not media_tool_ready(ffprobe):
    import subprocess
    if os.geteuid()!=0: raise RuntimeError('LTX requires gcc/g++ and ffmpeg/ffprobe but worker cannot install the verified dependencies')
    environment=dict(os.environ,DEBIAN_FRONTEND='noninteractive')
    subprocess.run(['apt-get','update','-qq'],check=True,env=environment,stdout=subprocess.DEVNULL)
    subprocess.run(['apt-get','install','-y','--no-install-recommends','build-essential','ffmpeg'],check=True,env=environment,stdout=subprocess.DEVNULL)
    cc=shutil.which('gcc')
    cxx=shutil.which('g++')
    ffmpeg=shutil.which('ffmpeg')
    ffprobe=shutil.which('ffprobe')
  if not compiler_ready(cc) or not compiler_ready(cxx): raise RuntimeError('Triton compiler toolchain is unavailable after verified install')
  if not media_tool_ready(ffmpeg) or not media_tool_ready(ffprobe): raise RuntimeError('LTX ffmpeg/ffprobe completion tools are unavailable after verified install')
  os.environ['CC']=cc
  os.environ['CXX']=cxx
def exec_worker():
  ensure_triton_toolchain()
  project=str(root/'opt/LTX-2')
  package_paths=[
    project,
    str(root/'opt/LTX-2/packages/ltx-core/src'),
    str(root/'opt/LTX-2/packages/ltx-pipelines/src'),
  ]
  if not all(pathlib.Path(item).is_dir() for item in package_paths): raise RuntimeError('official LTX runtime package sources are incomplete')
  previous=os.environ.get('PYTHONPATH','')
  os.environ['PYTHONPATH']=os.pathsep.join(package_paths+([previous] if previous else []))
  python=str(root/'opt/LTX-2/.venv/bin/python')
  os.execv(python,[python,str(root/'opt/novita-worker/worker.py')])
if runtime_ready():
  repair_python_paths(root)
  exec_worker()
lock=root.with_name(root.name+'.lock')
lock.parent.mkdir(parents=True,exist_ok=True)
with lock.open('a+b') as handle:
  fcntl.flock(handle,fcntl.LOCK_EX)
  if runtime_ready():
    repair_python_paths(root)
    exec_worker()
  if (root/'.ready').is_file() and (root/'.ready').read_text().strip()==sha:
    repair_python_paths(root)
    ensure_cuda_compatibility()
    exec_worker()
  if root.exists(): raise RuntimeError('runtime root exists without its matching ready receipt')
  stage=pathlib.Path(tempfile.mkdtemp(prefix='.ltx-runtime-stage.',dir='/network/runtime'))
  try:
    archives=[item for item in pathlib.Path('/network/runtime').glob('.ltx-runtime-stage.*/runtime.tar.gz') if item.is_file()]
    bundle=max(archives,key=lambda item:item.stat().st_size,default=stage/'runtime.tar.gz')
    request=urllib.request.Request(os.environ['NOVITA_RUNTIME_BUNDLE_URL'],headers={'Range':'bytes=0-0'})
    with urllib.request.urlopen(request) as response:
      content_range=str(response.headers.get('Content-Range') or '')
    if '/' not in content_range: raise RuntimeError('runtime server does not support verified byte ranges')
    total=int(content_range.rsplit('/',1)[1])
    descriptor=os.open(bundle,os.O_RDWR|os.O_CREAT,0o600)
    try:
      os.ftruncate(descriptor,total)
      from concurrent.futures import ThreadPoolExecutor
      def fetch_range(start):
        end=min(total-1,start+32*1024*1024-1)
        request=urllib.request.Request(os.environ['NOVITA_RUNTIME_BUNDLE_URL'],headers={'Range':f'bytes={start}-{end}'})
        with urllib.request.urlopen(request) as response: payload=response.read()
        if len(payload)!=end-start+1: raise RuntimeError('runtime range length mismatch')
        os.pwrite(descriptor,payload,start)
      with ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(fetch_range,range(0,total,32*1024*1024)))
    finally: os.close(descriptor)
    digest=hashlib.sha256(bundle.read_bytes()).hexdigest()
    if digest!=sha: raise RuntimeError('runtime bundle SHA-256 mismatch')
    with tarfile.open(bundle,'r:gz') as archive:
      for member in archive.getmembers():
        target=(stage/member.name).resolve()
        if target!=stage and stage not in target.parents: raise RuntimeError('runtime archive path escapes staging root')
        if not (member.isdir() or member.isfile() or member.issym() or member.islnk()): raise RuntimeError('runtime archive has unsupported member type')
      for member in archive.getmembers(): archive.extract(member,stage)
    # The old sealed archive omitted uv's CPython installation although its
    # virtual environment points at it. Recreate only that pinned interpreter
    # inside this immutable runtime root, then relocate in-archive /opt links.
    for link in stage.rglob('*'):
      if not link.is_symlink(): continue
      destination=os.readlink(link)
      if not destination.startswith('/opt/'): continue
      relocated=stage/destination.lstrip('/')
      if not relocated.exists() and destination.startswith('/opt/uv/python/'):
        import subprocess,sys
        environment=dict(os.environ,UV_PYTHON_INSTALL_DIR=str(stage/'opt/uv/python'),UV_NO_CACHE='1')
        subprocess.run([sys.executable,'-m','pip','install','--no-cache-dir','uv==0.10.6'],check=True,stdout=subprocess.DEVNULL)
        subprocess.run(['uv','python','install','3.12.12'],check=True,env=environment,stdout=subprocess.DEVNULL)
      if not relocated.exists(): raise RuntimeError('runtime archive has unresolved /opt symlink')
      link.unlink()
      link.symlink_to(os.path.relpath(relocated,link.parent))
    repair_python_paths(stage)
    if not (stage/'opt/LTX-2/.venv/bin/python').is_file() or not (stage/'opt/novita-worker/worker.py').is_file(): raise RuntimeError('runtime archive is incomplete')
    (stage/'.ready').write_text(sha+'\n')
    if bundle.parent!=stage: shutil.rmtree(bundle.parent,ignore_errors=True)
    os.replace(stage,root)
    ensure_cuda_compatibility()
  except BaseException:
    shutil.rmtree(stage,ignore_errors=True)
    raise
exec_worker()
`;
}

async function prepareRuntimeBootstrap(runtime: NonNullable<DirectNovitaConfig["runtimeBundle"]>): Promise<string> {
  const key = `novita/runtime/bootstraps/ltx-2.5-${runtime.sha256}.py`;
  try {
    await putObject(key, runtimeBootstrapSource(runtime.sha256), {
      contentType: "text/x-python",
      metadata: { "runtime-sha256": runtime.sha256, archive: runtime.archive },
      ifNoneMatch: "*",
    });
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 409 && status !== 412) throw error;
  }
  return await presignDownload(key, { expiresIn: MANIFEST_URL_TTL_SECONDS });
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
  remoteChildFence?: NovitaRenderCfg["remoteChildFence"];
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
    ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
  };
}

async function reserveLease(
  convex: StudioConvexHttpClient,
  args: Record<string, unknown>,
): Promise<ReservedLease> {
  return await leaseMutation<ReservedLease>(convex, "reserve", args);
}

function sealedNativeInputGeometrySources(worker: PreparedWorker): LtxNativeInputGeometrySources | undefined {
  const profile = worker.manifest.profile as NovitaPhaseProfile;
  if (!requiresNative720X2CinematicProof(profile)) return undefined;
  const jobs = worker.manifest.jobs;
  const job = Array.isArray(jobs)
    ? jobs.find((candidate): candidate is Record<string, unknown> => (
      Boolean(candidate)
      && typeof candidate === "object"
      && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>).id === worker.job.id
    ))
    : undefined;
  if (!job) {
    throw new NovitaAdmissionError(`worker ${worker.workerName} native-720p manifest is missing its sealed video job`);
  }
  const sourceSha256 = (field: "input" | "endInput", required: boolean): string | undefined => {
    const source = job[field];
    if (source === undefined && !required) return undefined;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new NovitaAdmissionError(`worker ${worker.workerName} native-720p manifest is missing sealed ${field}`);
    }
    const sha256 = (source as Record<string, unknown>).sha256;
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new NovitaAdmissionError(`worker ${worker.workerName} native-720p manifest has invalid sealed ${field} hash`);
    }
    return sha256;
  };
  const initialSha256 = sourceSha256("input", true);
  const endSha256 = sourceSha256("endInput", false);
  return {
    initialSha256: initialSha256!,
    ...(endSha256 ? { endSha256 } : {}),
  };
}

/**
 * Preserve controller-normalized source bindings with the direct result. The
 * story block revalidates the output proof against this sealed map rather than
 * reconstructing authority from caller-supplied still keys.
 */
function nativeInputGeometrySourcesByShot(
  workers: readonly PreparedWorker[],
): Readonly<Record<string, LtxNativeInputGeometrySources>> {
  const sourcesByShot: Record<string, LtxNativeInputGeometrySources> = Object.create(null) as Record<string, LtxNativeInputGeometrySources>;
  for (const worker of workers) {
    const sources = sealedNativeInputGeometrySources(worker);
    if (!sources) {
      throw new NovitaAdmissionError(`worker ${worker.workerName} omitted native-720p sealed input geometry sources`);
    }
    if (Object.prototype.hasOwnProperty.call(sourcesByShot, worker.job.shotId)) {
      throw new NovitaAdmissionError(`native-720p result has duplicate source bindings for ${worker.job.shotId}`);
    }
    sourcesByShot[worker.job.shotId] = sources;
  }
  return sourcesByShot;
}

function acceptWorkerVideoCompletionEvidence(worker: PreparedWorker, completion: CompletionReport): void {
  try {
    worker.videoOutputProof = assertLtxWorkerCompletionEvidence({
      profile: worker.manifest.profile as NovitaPhaseProfile,
      jobId: worker.job.id,
      completion,
      nativeInputGeometrySources: sealedNativeInputGeometrySources(worker),
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

type NovitaWorkerPollState = "pending" | "complete";

/**
 * Inspect exactly one worker without yielding the Trigger task. The caller is
 * deliberately responsible for the checkpoint: a capacity wave has one
 * durable wait, rather than one unsupported parallel wait per GPU.
 */
async function observeWorkerTick(
  worker: PreparedWorker,
  convex: StudioConvexHttpClient,
  secret: string,
  remoteChildFence?: NovitaRenderCfg["remoteChildFence"],
): Promise<NovitaWorkerPollState> {
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
      ...(remoteChildFence ? { remoteChildFence } : {}),
    });
    return "complete";
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
      ...(remoteChildFence ? { remoteChildFence } : {}),
    });
  }
  if (Date.now() >= worker.expiresAt) {
    throw new Error(`Novita worker ${worker.workerName} exceeded its immutable two-hour lease`);
  }
  return "pending";
}

/**
 * One wave may create several GPUs in parallel, but Trigger only permits one
 * checkpoint wait at a time. Inspect each live worker first, settle every
 * terminal worker as a batch, then await one checkpoint for the remaining
 * wave. The sequential inspection is intentional: no callback can overlap a
 * prior checkpoint wait.
 */
export async function pollNovitaWorkerWave<T>(args: {
  workers: readonly T[];
  inspect: (worker: T) => Promise<NovitaWorkerPollState>;
  settleTerminal?: (workers: readonly T[]) => Promise<void>;
  checkpoint: (args: { attempt: number; pendingWorkers: number }) => Promise<void>;
}): Promise<void> {
  let pending = args.workers.map((worker, index) => ({ worker, index }));
  let attempt = 0;
  while (pending.length) {
    const next: Array<{ worker: T; index: number }> = [];
    const terminal: T[] = [];
    for (const entry of pending) {
      if (await args.inspect(entry.worker) === "pending") next.push(entry);
      else terminal.push(entry.worker);
    }
    if (terminal.length) await args.settleTerminal?.(terminal);
    pending = next;
    if (!pending.length) return;
    attempt += 1;
    await args.checkpoint({ attempt, pendingWorkers: pending.length });
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
  remoteChildFence?: NovitaRenderCfg["remoteChildFence"];
}): Promise<NovitaBillingReceipt> {
  await leaseMutation<void>(args.convex, "requestDeletion", {
    secret: args.secret,
    workerName: args.worker.workerName,
    now: Date.now(),
    reason: args.reason,
    ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
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
      ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
      billingReceipt: receipt,
    });
    return receipt;
  } catch (error) {
    await leaseMutation<void>(args.convex, "markDeletionUnverified", {
      secret: args.secret,
      workerName: args.worker.workerName,
      now: Date.now(),
      error: safeError(error),
      ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
    }).catch(() => undefined);
    throw new Error(`Novita worker ${args.worker.workerName} teardown was not verified: ${safeError(error)}`);
  }
}

async function recoverOrCreateInstance(args: {
  worker: PreparedWorker;
  lease: ReservedLease;
  control: DirectControlPlane;
  convex: StudioConvexHttpClient;
  beforeProviderSpend?: NovitaRenderCfg["beforeProviderSpend"];
  remoteChildFence?: NovitaRenderCfg["remoteChildFence"];
}): Promise<string> {
  const secret = args.control.config.internalSecret;
  if (args.lease.instanceId) return args.lease.instanceId;
  const attemptToken = randomUUID();
  const claim = await leaseMutation<CreateClaim>(args.convex, "claimCreate", {
    secret,
    workerName: args.worker.workerName,
    attemptToken,
    now: Date.now(),
    ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
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
    // Finish every provider-free request preparation before the execution
    // fence. If that fence rejects, this worker has neither a dispatched
    // durable create intent nor a provider request to reconcile.
    const runtimeBootstrapUrl = args.control.config.runtimeBundle
      ? await prepareRuntimeBootstrap(args.control.config.runtimeBundle)
      : undefined;
    const createRequest = buildNovitaCreateWorkerRequest({
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
          archive: args.control.config.runtimeBundle.archive,
          bootstrapUrl: runtimeBootstrapUrl!,
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
    });
    await args.beforeProviderSpend?.({ reason: "worker_create" });
    // Commit this transition before dispatching the non-transactional provider
    // request. If its HTTP response is lost, the reaper must retain an
    // unverified lease until the deterministic-name instance can be found and
    // deleted; it may never fabricate an absence receipt.
    await leaseMutation<void>(args.convex, "markCreateDispatched", {
      secret,
      workerName: args.worker.workerName,
      attemptToken,
      now: Date.now(),
      ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
    });
    instanceId = await args.control.provider.createSpotWorker(createRequest);
  }
  await leaseMutation<void>(args.convex, "bindInstance", {
    secret,
    workerName: args.worker.workerName,
    instanceId,
    attemptToken,
    now: Date.now(),
    ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
  });
  await leaseMutation<void>(args.convex, "heartbeat", {
    secret,
    workerName: args.worker.workerName,
    status: "booting",
    now: Date.now(),
    ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
  });
  return instanceId;
}

interface ActiveNovitaWorker {
  worker: PreparedWorker;
  control: DirectControlPlane;
  convex: StudioConvexHttpClient;
  secret: string;
  instanceId: string;
  startedAt: number;
  startupFailed: boolean;
  startupFailure?: unknown;
  remoteChildFence?: NovitaRenderCfg["remoteChildFence"];
}

type StartedNovitaWorker =
  | { status: "completed"; receipt: NovitaBillingReceipt }
  | { status: "active"; active: ActiveNovitaWorker };

type NovitaWorkerTerminalOutcome =
  | { failed: false }
  | { failed: true; error: unknown };

async function markActiveWorkerFailed(active: ActiveNovitaWorker, error: unknown): Promise<void> {
  await leaseMutation<void>(active.convex, "markFailed", {
    secret: active.secret,
    workerName: active.worker.workerName,
    now: Date.now(),
    error: safeError(error),
    ...(active.remoteChildFence ? { remoteChildFence: active.remoteChildFence } : {}),
  }).catch(() => undefined);
}

async function closeActiveWorker(
  active: ActiveNovitaWorker,
  outcome: NovitaWorkerTerminalOutcome,
): Promise<NovitaBillingReceipt> {
  const receipt = await deleteWorker({
    worker: active.worker,
    provider: active.control.provider,
    convex: active.convex,
    secret: active.secret,
    instanceId: active.instanceId,
    startedAt: active.startedAt,
    hourlyRate: active.control.product.spotPriceUsdPerHour,
    reason: outcome.failed ? `render failed: ${safeError(outcome.error)}` : "render complete",
    remoteChildFence: active.remoteChildFence,
  });
  if (outcome.failed) throw outcome.error;
  if (!await artifactIsComplete(active.worker)) {
    throw new Error(`Novita worker ${active.worker.workerName} closed without its required R2 artifact`);
  }
  return receipt;
}

async function startWorker(args: {
  worker: PreparedWorker;
  lifecycle: NonNullable<NovitaRenderCfg["lifecycle"]>;
  control: DirectControlPlane;
  convex: StudioConvexHttpClient;
  beforeProviderSpend?: NovitaRenderCfg["beforeProviderSpend"];
  remoteChildFence?: NovitaRenderCfg["remoteChildFence"];
}): Promise<StartedNovitaWorker> {
  const { worker, control, convex } = args;
  const secret = control.config.internalSecret;
  // A durable worker reservation can block the recovered generation even
  // without a provider POST. Fence it too, not only the later create, so a
  // stale child cannot strand an otherwise valid retry behind its lease row.
  await args.beforeProviderSpend?.({ reason: "worker_create" });
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
      if (stored) return { status: "completed", receipt: stored };
      // A reaper can verify deletion after a crashed controller. It deliberately
      // records only a teardown receipt, so retain a conservative lifecycle
      // estimate rather than reporting a false zero-cost render.
      return {
        status: "completed",
        receipt: lifecycleReceipt({
          worker,
          instanceId: "reaper-verified",
          startedAt: lease.requestedAt,
          endedAt: lease.deletedVerifiedAt ?? Date.now(),
          hourlyRate: control.product.spotPriceUsdPerHour,
        }),
      };
    }
    throw new Error(`Novita worker ${worker.workerName} was deleted before its required artifact was verified`);
  }

  const execution = await leaseMutation<CreateClaim>(convex, "claimExecution", {
    secret,
    workerName: worker.workerName,
    attemptToken: randomUUID(),
    now: Date.now(),
    ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
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
      remoteChildFence: args.remoteChildFence,
    });
    if (!await artifactIsComplete(worker)) {
      throw new Error(`Novita worker ${worker.workerName} closed while its required R2 artifact remained incomplete`);
    }
    return { status: "completed", receipt };
  }

  let instanceId: string | undefined;
  // A resumed controller must never report only its own retry tail as total
  // GPU usage. The durable lease anchor is intentionally conservative.
  const startedAt = lease.instanceCreatedAt ?? lease.requestedAt;
  let startupFailure: unknown;
  let startupFailed = false;
  try {
    // Recheck the exact SKU immediately before every paid create. A normal
    // availability signal never authorizes a silent H100/A100 substitution.
    const latest = await control.provider.accountSnapshot({ clusterId: control.volume.clusterId });
    selectRtx4090SpotProduct(latest.products, control.product.id);
    if (latest.activeInstanceCount >= control.config.verifiedGpuQuota) {
      throw new NovitaAdmissionError("verified RTX 4090 quota is exhausted before worker create");
    }
    instanceId = await recoverOrCreateInstance({
      worker,
      lease,
      control,
      convex,
      beforeProviderSpend: args.beforeProviderSpend,
      remoteChildFence: args.remoteChildFence,
    });
  } catch (error) {
    if (error instanceof CreateClaimInProgressError || error instanceof ExecutionClaimInProgressError) throw error;
    startupFailed = true;
    startupFailure = error;
    await markActiveWorkerFailed({
      worker,
      control,
      convex,
      secret,
      instanceId: instanceId ?? "pending-provider-identity",
      startedAt,
      startupFailed,
      startupFailure,
      remoteChildFence: args.remoteChildFence,
    }, error);
  }

  if (!instanceId) {
    // The create request may have timed out after the provider accepted it.
    // Do not falsely attest deletion: the minute reaper will match any
    // deterministic-name orphan and retain this unverified lease until then.
    await leaseMutation<void>(convex, "requestDeletion", {
      secret,
      workerName: worker.workerName,
      now: Date.now(),
      reason: startupFailed ? safeError(startupFailure) : "provider instance identity unavailable",
      ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
    }).catch(() => undefined);
    await leaseMutation<void>(convex, "markDeletionUnverified", {
      secret,
      workerName: worker.workerName,
      now: Date.now(),
      error: "provider instance identity unavailable; deterministic-name reaper required",
      ...(args.remoteChildFence ? { remoteChildFence: args.remoteChildFence } : {}),
    }).catch(() => undefined);
    if (startupFailed) throw startupFailure;
    throw new Error(`Novita worker ${worker.workerName} did not return an instance identity`);
  }

  return {
    status: "active",
    active: {
      worker,
      control,
      convex,
      secret,
      instanceId,
      startedAt,
      startupFailed,
      ...(startupFailed ? { startupFailure } : {}),
      remoteChildFence: args.remoteChildFence,
    },
  };
}

/**
 * Wait for every worker that a wave has started to reach its terminal
 * renderer/teardown outcome before letting the owning Trigger stage fail.
 *
 * `Promise.all` is unsafe here: its first rejection releases the parent
 * render stage while sibling workers may still be booting or rendering.  The
 * sibling `renderWorker` calls own their normal delete-and-verify path, but
 * the parent must keep observing them long enough for that path to finish
 * rather than depending on the minute reaper after a process abort.  This is
 * deliberately generic so image, LTX video, and future Novita phases share
 * the same terminal-wave fence.
 */
export async function settleNovitaWorkerWave<T, TResult>(
  workers: readonly T[],
  render: (worker: T) => Promise<TResult>,
): Promise<TResult[]> {
  const settled = await Promise.allSettled(workers.map((worker) => render(worker)));
  const rejected = settled.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected.length) {
    throw workerWaveTerminalError(settled.length, rejected.map((result) => result.reason));
  }
  return settled.map((result) => {
    if (result.status !== "fulfilled") {
      // The rejected branch above proves this unreachable; retain a narrow
      // guard so a future type/control-flow change cannot turn an unsettled
      // worker into a false success.
      throw new Error("Novita worker wave did not reach a fulfilled terminal outcome");
    }
    return result.value;
  });
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
export async function renderDirectNovita(inputCfg: NovitaRenderCfg, phase: Phase): Promise<NovitaRenderResult> {
  // The direct worker controller is itself a provider boundary. Normal
  // callers have already applied this contract, but re-applying it here makes
  // a raw/direct caller just as unable to bypass continuity or style locks.
  const cfg = phase === "video"
    ? { ...inputCfg, shots: inputCfg.shots.map((shot) => applyLtxI2vPromptContract(shot, inputCfg.styleId)) }
    : inputCfg;
  // Keep the unproven native-720p x2 promotion path outside all provider work:
  // not merely before POST, but before secret bootstrap, fleet discovery, or
  // any worker-manifest/reservation side effect.
  if (phase === "video") {
    try {
      assertCinematicProofAdmission({ profile: cfg.profile });
    } catch (error) {
      throw new NovitaAdmissionError(
        error instanceof Error ? error.message : "cinematic proof admission rejected the requested profile",
      );
    }
  }
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
    : new Map<string, ResolvedLtxCreativeAdapterStack>();
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
    if (wave.length && cfg.beforeProviderSpend) {
      // Do not treat a first-wave admission as authority for every later
      // checkpointed batch. A recovered parent revokes the old generation,
      // and this exact check stops it before a later paid wave begins.
      await cfg.beforeProviderSpend({ reason: "paid_wave" });
    }
    const receipts = await renderNovitaWorkerWave({
      workers: wave,
      lifecycle,
      control,
      convex,
      beforeProviderSpend: cfg.beforeProviderSpend,
      remoteChildFence: cfg.remoteChildFence,
    });
    receipts.forEach(({ manifestId, receipt }) => receiptByManifest.set(manifestId, receipt));
  }
  // Keep the exact worker receipt beside its exact output id. Some callers
  // create a derivative R2 asset from one direct still and need to attest it
  // without falsely dividing an aggregate receipt across unrelated workers.
  const receiptByOutputId = new Map<string, NovitaBillingReceipt>();
  const allReceipts = prepared.map((worker) => {
    const receipt = receiptByManifest.get(worker.manifestId) ?? lifecycleReceipt({
      worker,
      instanceId: "already-closed",
      startedAt: Date.now(),
      endedAt: Date.now(),
      hourlyRate: control.product.spotPriceUsdPerHour,
    });
    receiptByOutputId.set(worker.job.id, receipt);
    return receipt;
  });
  if (phase === "video") {
    await Promise.all(prepared.map(async (worker) => {
      if (!worker.videoOutputProof) await restoreWorkerVideoCompletionEvidence(worker);
    }));
  }
  const nativeInputGeometrySources = phase === "video" && requiresNative720X2CinematicProof(cfg.profile)
    ? nativeInputGeometrySourcesByShot(prepared)
    : undefined;
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
      ...(nativeInputGeometrySources ? { nativeInputGeometrySources } : {}),
    } : {}),
    requestSha256ByOutputId: Object.fromEntries(
      prepared.map((worker) => [worker.job.id, worker.requestSha256]),
    ),
    billingReceiptsByOutputId: Object.fromEntries(
      prepared.map((worker) => [worker.job.id, receiptByOutputId.get(worker.job.id)!]),
    ),
    outputs: candidates.length,
    durationSec: 0,
    costUsd: status.billingReceipt.costUsd,
    billingReceipt: status.billingReceipt,
    requestCanonicalJson: canonicalJson({ phase, plan, workerRequests: prepared.map((worker) => worker.requestSha256).sort() }),
    raw: status,
  };
}
