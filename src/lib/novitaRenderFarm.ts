/**
 * NOVITA RENDER FARM — cloud-only image + video render module driven by the
 * elastic Novita GPU control plane. Trigger owns a short-lived, one-GPU RTX
 * 4090 lease for every immutable R2 manifest, with checkpoint recovery and a
 * deletion-verifying reaper. Workers never receive provider credentials.
 */
import { createHash, createHmac } from "node:crypto";
import {
  LTX_25_RTX_4090_VIDEO,
  NOVITA_ELASTIC_GPU_CEILING,
  type GenerationProfile,
} from "@/engine/generationProfiles";
import { NovitaAdmissionError, requireNovitaFleetReadiness } from "@/lib/novitaFleet";
import { novitaCostEnvelope } from "@/lib/novitaCostEnvelope";
import { applyLtxI2vPromptContract } from "@/lib/ltxI2vPrompt";
import { assertCinematicProofAdmission } from "@/lib/cinematicProofAdmission";
import type { LtxCreativeAdapterInput } from "@/lib/ltxCreativeAdapter";
import {
  waitForNovitaRenderPoll,
  type NovitaRenderPollWait,
} from "@/lib/novitaPollWait";
import { bootstrapSecrets } from "./bootstrap";
import { z } from "zod";

/** One of the 10 canonical camera moves a shot can use (static = no camera motion). */
export type CameraMove =
  | "static"
  | "dolly_push"
  | "dolly_pull"
  | "crane_up"
  | "crane_down"
  | "orbit_left"
  | "orbit_right"
  | "truck_left"
  | "truck_right"
  | "handheld_drift";

/** Shot framing — how tight/wide the composition is. */
export type ShotScale = "wide" | "medium" | "close" | "extreme_close" | "establishing";

/** One shot in the render's shot list — the editable repeater row in the console. */
export interface Shot {
  id: string;
  /** Script line / image-generation prompt for this shot. */
  prompt: string;
  cameraMove: CameraMove;
  /**
   * Optional shot-specific camera direction. This preserves an approved
   * concrete move (for example, its real foreground/midground parallax) while
   * `cameraMove` remains the canonical coarse movement category.
   */
  cameraInstruction?: string;
  shotScale: ShotScale;
  /** Lens description, e.g. "35mm anamorphic", "85mm portrait". */
  lens: string;
  /** Shot duration in seconds (video phase); converted to 8n+1 frames. */
  seconds: number;
  /** Motion cue — what actually moves in-frame (subject/particles), independent of camera. */
  motion: string;
  /**
   * Optional in-world sound direction for LTX's audio-aware video pass. This
   * must describe only ambience or physical action: narration, dialogue, and
   * score remain the responsibility of the separately attested final mix.
   */
  diegeticSoundscape?: string;
  /** Per-shot negative prompt, appended to the global negative. */
  negative?: string;
  seed?: number;
  /** R2 key of the rendered still once the image phase has produced it. */
  stillKey?: string;
  /** Optional R2 key of a reviewed target for LTX's final conditioned frame. */
  endStillKey?: string;
  section?: string;
  storyFunction?: string;
  /** Authored story timecodes and lineage; preserved into render manifests. */
  t0?: number;
  t1?: number;
  sourceSentenceIds?: string[];
  continuityState?: string;
  generationProfile?: "draft" | "production" | "hero";
  candidateCount?: number;
  /**
   * Optional cache-pinned LTX creative adapter input. A single LoRA remains
   * compatible; a stack is capped to complementary roles and needs its own
   * matched quality benchmark before a worker can be created.
   */
  creativeAdapter?: LtxCreativeAdapterInput;
}

export interface NovitaPhaseProfile {
  contractVersion: "1.0.0";
  id: "draft" | "production" | "hero";
  phase: "image" | "video";
  model: string;
  revision: string;
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  precision: "bf16" | "fp16";
  candidates: number;
  infrastructure: GenerationProfile["infrastructure"];
  fps?: number;
  pipeline?: GenerationProfile["video"]["pipeline"];
  twoStageRefine?: boolean;
  distilledLoraCheckpoint?: string;
  textEncoderCheckpoint?: string;
  videoVaeCheckpoint?: string;
  audioVaeCheckpoint?: string;
  spatialUpscalerCheckpoint?: string;
  quantization?: "fp8-cast";
  offload?: "cpu";
  spatialUpscaleFactor?: 2;
  stageOneWidth?: number;
  stageOneHeight?: number;
  imageGuideStrength?: 0.9;
  allowFallback: false;
}

export interface NovitaRuntimeAttestation {
  provider: "novita";
  capacityMode: "spot";
  weightStorage: "local-persistent-disk";
  cacheMount: "/workspace/model-cache";
  checkpointing: true;
  idleShutdownSeconds: number;
  gpuCount: number;
  model: string;
  revision: string;
  checkpoint: string;
  precision?: "bf16" | "fp16";
  pipeline?: GenerationProfile["video"]["pipeline"];
  twoStageRefine?: boolean;
  distilledLoraCheckpoint?: string;
  textEncoderCheckpoint?: string;
  videoVaeCheckpoint?: string;
  audioVaeCheckpoint?: string;
  spatialUpscalerCheckpoint?: string;
  quantization?: "fp8-cast";
  offload?: "cpu";
  spatialUpscaleFactor?: 2;
  stageOneWidth?: number;
  stageOneHeight?: number;
  /** Worker-probed encoded frame dimensions, not controller intent. */
  outputWidth?: number;
  outputHeight?: number;
}

/** Convert one approved studio profile into the exact direct-worker phase contract. */
export function toNovitaPhaseProfile(
  profile: GenerationProfile,
  phase: "image" | "video",
): NovitaPhaseProfile {
  const settings = profile[phase];
  return {
    contractVersion: profile.contractVersion,
    id: profile.id,
    phase,
    model: settings.model,
    revision: settings.revision,
    checkpoint: settings.checkpoint,
    width: settings.width,
    height: settings.height,
    steps: settings.steps,
    guidanceScale: settings.guidanceScale,
    precision: settings.precision,
    candidates: settings.candidates,
    infrastructure: profile.infrastructure,
    ...(phase === "video"
      ? {
          fps: profile.video.fps,
          pipeline: profile.video.pipeline,
          twoStageRefine: profile.video.twoStageRefine,
          ...(profile.video.distilledLoraCheckpoint
            ? { distilledLoraCheckpoint: profile.video.distilledLoraCheckpoint }
            : {}),
          textEncoderCheckpoint: profile.video.textEncoderCheckpoint,
          videoVaeCheckpoint: profile.video.videoVaeCheckpoint,
          audioVaeCheckpoint: profile.video.audioVaeCheckpoint,
          ...(profile.video.spatialUpscalerCheckpoint
            ? { spatialUpscalerCheckpoint: profile.video.spatialUpscalerCheckpoint }
            : {}),
          quantization: profile.video.quantization,
          offload: profile.video.offload,
          spatialUpscaleFactor: profile.video.spatialUpscaleFactor,
          stageOneWidth: profile.video.stageOneWidth,
          stageOneHeight: profile.video.stageOneHeight,
          imageGuideStrength: profile.video.imageGuideStrength,
        }
      : {}),
    allowFallback: false,
  };
}

export interface RenderedCandidate {
  shotId: string;
  candidateIndex: number;
  outputId: string;
  key: string;
}

/** Worker-probed geometry for a still that conditioned an LTX video job. */
export interface NovitaStillGeometryReceipt {
  /** SHA-256 already verified while the worker downloaded this exact still. */
  sha256: string;
  width: number;
  height: number;
}

/** Native-720p x2 evidence for every still that conditioned a video job. */
export interface NovitaVideoInputGeometryReceipt {
  initial: NovitaStillGeometryReceipt;
  end?: NovitaStillGeometryReceipt;
}

/**
 * SHA-256 values from the sealed worker manifest. Native-720p video receipts
 * are valid only when their ffprobe geometry is bound to these exact stills.
 */
export interface NovitaNativeInputGeometrySources {
  initialSha256: string;
  endSha256?: string;
}

export interface NovitaVideoOutputProof {
  outputWidth: number;
  outputHeight: number;
  /** Worker-observed LTX audio stream; required for diegetic scene assembly. */
  hasAudio: true;
  stageOneWidth: number;
  stageOneHeight: number;
  spatialUpscaleFactor: 2;
  pipeline: "distilled";
  quantization: "fp8-cast";
  offload: "cpu";
  /**
   * Present only for the benchmark-only native 1280x704 -> 2560x1408 path.
   * Existing 640x352 -> 1280x704 results intentionally retain their prior
   * evidence shape so they can be restored without a migration.
   */
  inputGeometry?: NovitaVideoInputGeometryReceipt;
}

/** Full render job config — maps ~1:1 onto the orchestrator's job schema (no translation layer). */
export interface NovitaRenderCfg {
  /** R2 key prefix for this render's outputs, e.g. "adart2". */
  prefix: string;
  shots: Shot[];
  /** Immutable, provider-pinned profile. There is no implicit production fallback. */
  profile: NovitaPhaseProfile;
  /** Global style string appended to every shot prompt. */
  style?: string;
  /**
   * Optional LTX 2.5 visual-style preset id (src/engine/ltxStylePresets.ts),
   * merged into the video phase's I2V prompt contract via
   * applyLtxI2vPromptContract. Distinct from `style` above, which is raw
   * prose appended to every shot prompt in both phases. Omitted/unknown ids
   * fall back to DEFAULT_LTX_STYLE_ID through getLtxStyle's own fallback.
   */
  styleId?: string;
  /** Global negative prompt, prepended to every shot's negative. */
  negative?: string;
  /** Director notes — appended to every shot prompt (global creative direction). */
  director?: string;
  steps?: number;
  cfg?: number;
  fps?: number;
  width?: number;
  height?: number;
  /** Elastic Novita spot GPU shard count, hard-capped at eight. */
  nshard?: number;
  jobs?: "val" | "full";
  maxConcurrent?: number;
  /** Optional stricter caller cap, always intersected with fleet admission. */
  maxCostUsd?: number;
  /**
   * Durable identity for the cloud-only worker lease. Direct Novita renders
   * reject anonymous calls so every billable GPU has an owner, run, and stage
   * that the reaper can close and attest.
   */
  lifecycle?: {
    ownerId: string;
    channelId: string;
    runId: string;
    blockId: string;
  };
  /**
   * Present only for an authenticated remote render child. It is checked by
   * the durable Novita worker lease mutations themselves, not merely by the
   * caller-side pre-spend callback.
   */
  remoteChildFence?: {
    leaseOwner: string;
    executionLeaseToken: number;
    dispatchKey: string;
  };
  /**
   * Fenced immediately before every paid direct-worker wave/create and while a
   * checkpointed worker is being polled. Implementations must tolerate
   * repeated calls; bridge compatibility callers may still receive no event.
   */
  beforeProviderSpend?: (event?: {
    reason: "paid_wave" | "worker_create" | "poll";
  }) => void | Promise<void>;
}

/** Result of an image or video render call. */
export interface NovitaRenderResult {
  ok: boolean;
  phase: "image" | "video";
  /** R2 keys of stills produced (image phase). */
  stillKeys?: string[];
  /** Local/streamed clip paths (video phase, normally R2-only in direct mode). */
  footageClips?: string[];
  /** R2 keys of clips produced (video phase). */
  footageKeys?: string[];
  /** Exact shot/candidate mapping; callers never infer identity from array order. */
  candidates?: RenderedCandidate[];
  /**
   * Per-output canonical request hashes from the sealed direct-worker
   * manifests. These are intentionally separate from the aggregate bridge
   * request so a derivative R2 asset can bind to the exact paid worker that
   * created it.
   */
  requestSha256ByOutputId?: Readonly<Record<string, string>>;
  /**
   * Per-output lifecycle receipts from the sealed direct workers. Aggregate
   * billing remains on `billingReceipt`; this map prevents downstream asset
   * adapters from inventing a proportional cost allocation.
   */
  billingReceiptsByOutputId?: Readonly<Record<string, NovitaBillingReceipt>>;
  /** Per-shot ffprobe evidence for the LTX x2 video phase. */
  videoOutputProofs?: Readonly<Record<string, NovitaVideoOutputProof>>;
  /** Sealed native-720p conditioning still hashes, keyed by exact shot id. */
  nativeInputGeometrySources?: Readonly<Record<string, NovitaNativeInputGeometrySources>>;
  outputs: number;
  durationSec: number;
  costUsd: number;
  billingReceipt: NovitaBillingReceipt;
  /** Exact canonical body whose phase-prefixed SHA-256 admitted the paid job. */
  requestCanonicalJson: string;
  raw: NovitaBridgeStatus;
}

/**
 * NOVITA_RENDER_FARM_MODULE — the self-describing contract. Mirrors
 * LORESHORT_MODULE's shape (key/title/stage/does/produces/requires/optional/
 * needs/rules) so this module is consistent with the rest of the golden set.
 */
export const NOVITA_RENDER_FARM_MODULE = {
  key: "novita-render-farm",
  title: "Novita Render Farm",
  stage: "visual",
  does: "Renders a full shot list on an elastic Novita RTX 4090 spot fleet (up to eight one-GPU workers) from Trigger. Immutable R2 manifests pin model revision, local persistent-disk cache, checkpoint, dimensions, steps, guidance, precision, FPS, and candidate count; every worker self-attests its physical GPU and is deletion-verified after completion.",
  produces: {
    kind: "shot_list_render",
    file: "R2-backed stills (png/jpg) + clips (mp4, H.264)",
    duration: "per-shot, driven by shots[].seconds",
    returns: "{ ok, phase, stillKeys, footageClips, footageKeys, outputs, durationSec }",
  },
  requires: { // the caller MUST supply these
    prefix: "string — R2 key prefix that names this render's outputs",
    shots: "Shot[] — at least one shot with a non-empty prompt",
    profile: "approved immutable image- or video-phase generation profile",
  },
  optional: { // sensible defaults
    style: "string — global style suffix appended to every shot prompt",
    negative: "string — global negative prompt",
    director: "string — director notes, appended to every shot prompt",
    steps: "compatibility guard — if supplied, must exactly equal the pinned profile",
    cfg: "compatibility guard — if supplied, must exactly equal the pinned profile",
    fps: "compatibility guard — if supplied, must exactly equal the pinned video profile",
    width: "compatibility guard — if supplied, must exactly equal the pinned profile",
    height: "compatibility guard — if supplied, must exactly equal the pinned profile",
    nshard: "Novita one-GPU RTX 4090 workers to shard across, ≤8 (subject to live provider quota)",
    jobs: "'val' | 'full' — val proves on 1 shard before a full run",
    maxConcurrent: "max pods in flight at once (default 1, hard ceiling 8)",
  },
  needs: { // environment
    secrets: ["NOVITA_API_KEY (Trigger only)", "R2 scoped manifest credentials"],
    tools: ["Novita GPU API", "Convex worker leases", "Trigger durable waits", "Cloudflare R2"],
    note: "Vercel has no provider credential. Trigger owns admission and workers receive only scoped object URLs.",
  },
  rules: [
    "Video frames are ALWAYS 8n+1 (LTX/Wan temporal requirement) — seconds are rounded to the nearest valid frame count, never truncated silently.",
    "Every shot needs a motion cue (cameraMove !== 'static' OR a non-empty motion field) — a shot with neither is a still, not a video shot.",
    "LTX stage-one width/height MUST be divisible by 32 and the distilled-x2 output by 64 (VAE tiling requirement) — a 720x1280 canvas is rejected before spend, never rounded silently.",
    "nshard is capped at 8 and the direct controller may admit fewer from its live provider-attested quota — a request above the hard ceiling fails validate(), it does not silently clamp.",
    "NO cross-engine fallback: a failed shard retries the SAME engine/pod pattern, then fails loud.",
    "R2-backed checkpoint resume — workers skip uploaded jobs recorded in the manifest-bound checkpoint; deterministic leases and artifact metadata close the hard-kill gap before requeue.",
  ],
} as const;

const DEFAULTS = {
  style: "", negative: "", director: "",
  steps: 40, cfg: 4.5, fps: 24, width: 1024, height: 576,
  nshard: 1, jobs: "val" as const, maxConcurrent: 1,
};

const BridgeLaunchSchema = z.object({
  jobId: z.string().regex(/^(image|video)-[a-f0-9]{32}$/),
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  profileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reused: z.boolean(),
});

const RuntimeAttestationSchema = z.object({
  provider: z.literal("novita"),
  capacityMode: z.literal("spot"),
  weightStorage: z.literal("local-persistent-disk"),
  cacheMount: z.literal("/workspace/model-cache"),
  checkpointing: z.literal(true),
  idleShutdownSeconds: z.number().int().min(60).max(900),
  gpuCount: z.number().int().min(1).max(NOVITA_ELASTIC_GPU_CEILING),
  model: z.string().min(1),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  checkpoint: z.string().min(1),
  precision: z.enum(["bf16", "fp16"]).optional(),
  pipeline: z.enum(["distilled", "two-stage-hq"]).optional(),
  twoStageRefine: z.boolean().optional(),
  distilledLoraCheckpoint: z.string().min(1).optional(),
  textEncoderCheckpoint: z.string().min(1).optional(),
  videoVaeCheckpoint: z.string().min(1).optional(),
  audioVaeCheckpoint: z.string().min(1).optional(),
  spatialUpscalerCheckpoint: z.string().min(1).optional(),
  quantization: z.literal("fp8-cast").optional(),
  offload: z.literal("cpu").optional(),
  spatialUpscaleFactor: z.literal(2).optional(),
  stageOneWidth: z.number().int().positive().optional(),
  stageOneHeight: z.number().int().positive().optional(),
  outputWidth: z.number().int().positive().optional(),
  outputHeight: z.number().int().positive().optional(),
});

const BillingReceiptSchema = z.object({
  provider: z.literal("novita"),
  currency: z.literal("USD"),
  receiptId: z.string().min(8).max(200),
  gpuSku: z.string().min(1).max(100),
  gpuCount: z.number().int().min(1).max(NOVITA_ELASTIC_GPU_CEILING),
  gpuSeconds: z.number().finite().nonnegative(),
  gpuRateUsdPerSecond: z.number().finite().nonnegative(),
  startupUsd: z.number().finite().nonnegative(),
  storageUsd: z.number().finite().nonnegative(),
  costUsd: z.number().finite().nonnegative(),
  /** Direct workers report a lifecycle estimate until Novita exposes an immutable bill line item. */
  costSource: z.enum(["provider_reported", "lifecycle_estimate"]).optional(),
});

export type NovitaBillingReceipt = z.infer<typeof BillingReceiptSchema>;

const BridgeStatusSchema = z.object({
  ok: z.boolean(),
  jobId: z.string(),
  phase: z.enum(["image", "video"]),
  status: z.enum(["queued", "launching", "running", "done", "failed"]),
  outputs: z.array(z.string()),
  n_outputs: z.number().int().nonnegative(),
  n_jobs: z.number().int().positive(),
  outputPrefix: z.string().min(1),
  expectedKeys: z.array(z.string()),
  missingKeys: z.array(z.string()),
  failedIds: z.array(z.string()),
  stillKeys: z.array(z.string()).optional(),
  footageKeys: z.array(z.string()).optional(),
  footageClips: z.array(z.string()).optional(),
  profile: z.unknown(),
  profileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  runtimeAttestation: RuntimeAttestationSchema,
  billingReceipt: BillingReceiptSchema,
  billingReceiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  error: z.string().nullable().optional(),
}).passthrough();

export type NovitaBridgeStatus = z.infer<typeof BridgeStatusSchema>;

/** Server-side verification receipt for an accepted bridge launch. */
export interface NovitaRenderLaunch {
  jobId: string;
  phase: "image" | "video";
  prefix: string;
  expectedJobIds: string[];
  profile: NovitaPhaseProfile;
  profileSha256: string;
  requestSha256: string;
  requestCanonicalJson: string;
  nshard: number;
  maxCostUsd: number;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("novitaRenderFarm: contract contains an undefined value");
  return encoded;
}

function renderBridgeConfig(): { baseUrl: string; token: string } {
  // Deliberately fail hard if an old caller survives. The VPS/HTTPS bridge is
  // retired; all billable work now enters only through the direct Trigger
  // controller and durable Convex lease.
  throw new NovitaAdmissionError("legacy Novita bridge is disabled; use the direct Trigger render controller");
}

/**
 * Synchronous, zero-network preflight for production callers. Secrets are
 * bootstrapped by the owning Trigger task before this check; the authenticated
 * fleet-readiness request still runs immediately before every paid launch.
 */
export function hasNovitaRenderFarmConfig(): boolean {
  // Compatibility name retained for callers. The former bridge is not a
  // runtime dependency: a render is configured only when the direct Trigger
  // worker lease can be constructed from its cloud-only environment.
  try {
    // `require` would break the ESM/Next boundary; this fast path deliberately
    // mirrors the direct config's required names without loading provider code.
    const required = [
      "NOVITA_API_KEY",
      "NOVITA_RENDER_WORKER_IMAGE",
      "NOVITA_RENDER_4090_PRODUCT_ID",
      "NOVITA_VERIFIED_4090_GPU_QUOTA",
      "NOVITA_MODEL_MANIFEST_KEY",
      "NOVITA_MODEL_MANIFEST_SHA256",
      "NOVITA_RENDER_MAX_JOB_USD",
      "NOVITA_RENDER_MAX_FLEET_USD",
      "INTERNAL_QUERY_SECRET",
    ];
    const usesPublicRuntimeBase = process.env.NOVITA_RENDER_WORKER_IMAGE
      === "pytorch/pytorch@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385";
    if (usesPublicRuntimeBase) {
      required.push("NOVITA_RUNTIME_BUNDLE_KEY", "NOVITA_RUNTIME_BUNDLE_SHA256", "NOVITA_LTX_WORKER_OVERLAY_SHA256");
    } else if (process.env.NOVITA_RENDER_PUBLIC_WORKER_IMAGE !== "1") {
      required.push("NOVITA_RENDER_IMAGE_AUTH_ID");
    }
    return required.every((name) => Boolean(process.env[name]?.trim()));
  } catch {
    return false;
  }
}

/** True only when the scoped HTTPS bridge configuration passes all local checks. */
export async function hasNovitaRenderBridge(): Promise<boolean> {
  try {
    await bootstrapSecrets();
    const { hasDirectNovitaRenderConfig } = await import("./novitaDirectRender");
    return hasDirectNovitaRenderConfig();
  } catch {
    return false;
  }
}

/** Round seconds → the nearest valid 8n+1 frame count at the given fps (never below 9 frames / 1 shard). */
export function secondsToFrames(seconds: number, fps: number): number {
  const raw = Math.max(1, seconds) * fps;
  const n = Math.max(1, Math.round((raw - 1) / 8));
  return 8 * n + 1;
}

/**
 * Quality gates. `phase` narrows which checks apply — "image" only needs
 * prompts + dims; "video" additionally needs frames/motion/stillKey.
 * Throws with ALL violations joined (fail loud, fail once).
 */
export function validate(cfg: NovitaRenderCfg, phase: "image" | "video"): void {
  const errs: string[] = [];
  if (!cfg.prefix || !cfg.prefix.trim()) errs.push("prefix is required");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(cfg.prefix) || cfg.prefix.split("/").some((part) => part === "." || part === "..")) {
    errs.push("prefix must be a safe, relative R2 key prefix");
  }
  const shots = cfg.shots ?? [];
  const profile = cfg.profile;
  if (!profile) {
    errs.push("an explicit immutable generation profile is required");
  } else {
    if (profile.contractVersion !== "1.0.0") errs.push("unsupported generation profile contract version");
    if (profile.phase !== phase) errs.push(`profile phase ${profile.phase} does not match ${phase}`);
    if (profile.allowFallback !== false) errs.push("generation profile must prohibit fallback");
    const infra = profile.infrastructure;
    if (infra.provider !== "novita" || infra.capacityMode !== "spot") {
      errs.push("generation profile must use Novita spot capacity");
    }
    if (infra.weightStorage !== "local-persistent-disk" || infra.cacheMount !== "/workspace/model-cache") {
      errs.push("generation profile must load weights from the pinned local persistent-disk cache");
    }
    if (infra.checkpointing !== true || infra.elasticGpuCeiling !== NOVITA_ELASTIC_GPU_CEILING) {
      errs.push("generation profile must require checkpointing and the eight-GPU elastic ceiling");
    }
    if (!/^[a-f0-9]{40}$/.test(profile.revision)) errs.push("profile revision must be a pinned 40-character commit");
    if (!profile.model.trim() || !profile.checkpoint.trim()) errs.push("profile model and checkpoint are required");
    if (!Number.isInteger(profile.steps) || profile.steps < 1) errs.push("profile steps must be a positive integer");
    if (profile.width % 32 !== 0 || profile.height % 32 !== 0) {
      errs.push(`profile dimensions ${profile.width}x${profile.height} must be divisible by 32`);
    }
    if (cfg.width !== undefined && cfg.width !== profile.width) errs.push("width override conflicts with pinned profile");
    if (cfg.height !== undefined && cfg.height !== profile.height) errs.push("height override conflicts with pinned profile");
    if (cfg.steps !== undefined && cfg.steps !== profile.steps) errs.push("steps override conflicts with pinned profile");
    if (cfg.cfg !== undefined && cfg.cfg !== profile.guidanceScale) errs.push("CFG override conflicts with pinned profile");
    if (phase === "video" && cfg.fps !== undefined && cfg.fps !== profile.fps) {
      errs.push("fps override conflicts with pinned profile");
    }
    if (phase === "video") {
      const expected = LTX_25_RTX_4090_VIDEO;
      if (
        profile.model !== expected.model
        || profile.revision !== expected.revision
        || profile.checkpoint !== expected.checkpoint
        || profile.width !== expected.width
        || profile.height !== expected.height
        || profile.fps !== expected.fps
        || profile.steps !== expected.steps
        || profile.guidanceScale !== expected.guidanceScale
        || profile.precision !== expected.precision
        || profile.pipeline !== expected.pipeline
        || profile.twoStageRefine !== expected.twoStageRefine
        || profile.textEncoderCheckpoint !== expected.textEncoderCheckpoint
        || profile.videoVaeCheckpoint !== expected.videoVaeCheckpoint
        || profile.audioVaeCheckpoint !== expected.audioVaeCheckpoint
        || profile.spatialUpscalerCheckpoint !== expected.spatialUpscalerCheckpoint
        || profile.quantization !== expected.quantization
        || profile.offload !== expected.offload
        || profile.spatialUpscaleFactor !== expected.spatialUpscaleFactor
        || profile.stageOneWidth !== expected.stageOneWidth
        || profile.stageOneHeight !== expected.stageOneHeight
        || profile.imageGuideStrength !== expected.imageGuideStrength
      ) {
        errs.push("video must use the exact LTX-2.5 distilled 640x352-to-1280x704 x2 RTX-4090 contract");
      }
    }
  }
  const expandedCount = phase === "image"
    ? shots.reduce((sum, shot) => sum + (shot.candidateCount ?? profile?.candidates ?? 1), 0)
    : shots.length;
  if (expandedCount > 240) errs.push("expanded render count exceeds the bridge limit of 240");
  const withPrompt = shots.filter((s) => s.prompt && s.prompt.trim());
  if (withPrompt.length < 1) errs.push("at least one shot with a non-empty prompt is required");
  const seenIds = new Set<string>();
  for (const shot of shots) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(shot.id)) {
      errs.push(`shot id ${JSON.stringify(shot.id)} must be a safe output identifier`);
    } else if (seenIds.has(shot.id)) {
      errs.push(`duplicate shot id ${shot.id}`);
    }
    seenIds.add(shot.id);
  }

  const width = profile?.width ?? cfg.width ?? DEFAULTS.width;
  const height = profile?.height ?? cfg.height ?? DEFAULTS.height;
  if (width % 32 !== 0) errs.push(`width ${width} must be a multiple of 32`);
  if (height % 32 !== 0) errs.push(`height ${height} must be a multiple of 32`);
  if (phase === "video" && (width % 64 !== 0 || height % 64 !== 0)) {
    errs.push(`two-stage LTX dimensions ${width}x${height} must be divisible by 64`);
  }

  const nshard = cfg.nshard ?? DEFAULTS.nshard;
  if (nshard > NOVITA_ELASTIC_GPU_CEILING) {
    errs.push(`nshard ${nshard} exceeds the elastic ceiling of ${NOVITA_ELASTIC_GPU_CEILING}`);
  }
  if (nshard < 1) errs.push("nshard must be >= 1");
  const maxConcurrent = cfg.maxConcurrent ?? DEFAULTS.maxConcurrent;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > NOVITA_ELASTIC_GPU_CEILING) {
    errs.push(`maxConcurrent must be an integer between 1 and ${NOVITA_ELASTIC_GPU_CEILING}`);
  }

  if (phase === "video") {
    const fps = profile?.fps ?? cfg.fps ?? DEFAULTS.fps;
    for (const s of shots) {
      if (!s.prompt || !s.prompt.trim()) continue; // already flagged above if it's the only shot
      const frames = secondsToFrames(s.seconds, fps);
      if ((frames - 1) % 8 !== 0) errs.push(`shot ${s.id}: frame count ${frames} is not 8n+1`);
      const hasMotionCue = (s.cameraMove && s.cameraMove !== "static") || (s.motion && s.motion.trim());
      if (!hasMotionCue) errs.push(`shot ${s.id}: no motion cue (cameraMove is 'static' and motion is empty)`);
      if (!s.stillKey || !s.stillKey.trim()) errs.push(`shot ${s.id}: missing stillKey (video phase needs a rendered still to animate)`);
      if (s.generationProfile && profile && s.generationProfile !== profile.id) {
        errs.push(`shot ${s.id}: profile ${s.generationProfile} does not match render profile ${profile.id}`);
      }
    }
  } else {
    for (const s of shots) {
      const candidates = s.candidateCount ?? profile?.candidates ?? 1;
      if (!Number.isInteger(candidates) || candidates < 1 || candidates > 4) {
        errs.push(`shot ${s.id}: candidateCount must be an integer between 1 and 4`);
      }
      if (s.generationProfile && profile && s.generationProfile !== profile.id) {
        errs.push(`shot ${s.id}: profile ${s.generationProfile} does not match render profile ${profile.id}`);
      }
    }
  }

  if (errs.length) throw new Error(`novitaRenderFarm.validate(${phase}): ${errs.join("; ")}`);
}

/** Build the full per-shot prompt: global style + director notes + shot prompt. */
function shotPrompt(cfg: NovitaRenderCfg, s: Shot): string {
  return [s.prompt, cfg.style, cfg.director].filter((p) => p && p.trim()).join(". ");
}

function shotNegative(cfg: NovitaRenderCfg, s: Shot): string {
  return [cfg.negative, s.negative].filter((p) => p && p.trim()).join(", ");
}

function expectedBridgeOutputPrefix(phase: "image" | "video", prefix: string, jobId: string): string {
  const root = phase === "image" ? "imagecraft" : "videocraft";
  const leaf = phase === "image" ? "stills" : "shots";
  return `${root}/${prefix}/${jobId}/${leaf}`;
}

export function validateBridgeCompletion(args: {
  phase: "image" | "video";
  prefix: string;
  jobId: string;
  expectedJobIds: string[];
  status: NovitaBridgeStatus;
}): string[] {
  const { phase, prefix, jobId, expectedJobIds, status } = args;
  if (status.status !== "done" || status.ok !== true) {
    throw new Error(`novitaRenderFarm: ${phase} job ${jobId} did not report a successful terminal state`);
  }
  if (status.jobId !== jobId || status.phase !== phase) {
    throw new Error(`novitaRenderFarm: ${phase} job ${jobId} returned mismatched job identity`);
  }
  if (status.failedIds.length || status.missingKeys.length) {
    throw new Error(`novitaRenderFarm: ${phase} job ${jobId} reported failed or missing outputs`);
  }
  const outputPrefix = expectedBridgeOutputPrefix(phase, prefix, jobId);
  if (status.outputPrefix !== outputPrefix) {
    throw new Error(`novitaRenderFarm: ${phase} job ${jobId} returned an unexpected output namespace`);
  }
  const extension = phase === "image" ? "png" : "mp4";
  const expectedKeys = expectedJobIds.map((id) => `${outputPrefix}/${id}.${extension}`);
  const outputs = phase === "image" ? status.stillKeys : status.footageKeys;
  if (!outputs || status.n_jobs !== expectedKeys.length || status.n_outputs !== expectedKeys.length) {
    throw new Error(`novitaRenderFarm: ${phase} job ${jobId} returned an incomplete output count`);
  }
  const expectedSet = new Set(expectedKeys);
  const outputSet = new Set(outputs);
  const protocolSet = new Set(status.expectedKeys);
  if (outputSet.size !== expectedSet.size || protocolSet.size !== expectedSet.size
      || expectedKeys.some((key) => !outputSet.has(key) || !protocolSet.has(key))) {
    throw new Error(`novitaRenderFarm: ${phase} job ${jobId} returned stale, duplicate, or unexpected output keys`);
  }
  return expectedKeys;
}

/** POST one immutable render contract to the authenticated bridge. */
async function launchBridgeRender(
  phase: "image" | "video",
  body: Record<string, unknown> & { prefix: string },
  expectedJobIds: string[],
  beforeProviderSpend?: () => void | Promise<void>,
  callerMaxCostUsd?: number,
): Promise<NovitaRenderLaunch> {
  const { baseUrl, token } = renderBridgeConfig();
  // This authenticated GET is intentionally the only pre-spend call. The
  // bridge must attest the immutable worker, verified local cache, budget,
  // interruption recovery, and scale-to-zero controls before a paid launch.
  const readiness = await requireNovitaFleetReadiness({ baseUrl, token });
  const budget = readiness.attestation?.budget;
  if (!budget) throw new Error("novitaRenderFarm: fleet readiness omitted its spend admission contract");
  // Retired today, but keep this dormant bridge safe if it is ever revived:
  // an omitted caller cap must not become fleet-wide admission.
  if (!Number.isFinite(callerMaxCostUsd) || callerMaxCostUsd === undefined || callerMaxCostUsd <= 0) {
    throw new NovitaAdmissionError("legacy Novita bridge requires an explicit positive signed worker cost ceiling");
  }
  const requestedCap = callerMaxCostUsd;
  const maxCostUsd = Math.min(budget.maxFleetUsd, budget.maxJobUsd * expectedJobIds.length, requestedCap);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error("novitaRenderFarm: fleet readiness returned an invalid hard spend cap");
  }
  const cappedBody: Record<string, unknown> & { prefix: string; maxCostUsd: number } = { ...body, maxCostUsd };
  const requestCanonicalJson = canonicalJson(cappedBody);
  const expectedProfileHash = createHash("sha256").update(canonicalJson(cappedBody["profile"])).digest("hex");
  const expectedRequestHash = createHash("sha256").update(`${phase}\0`).update(requestCanonicalJson).digest("hex");
  const payload = JSON.stringify({
    ...cappedBody,
    requestSha256: expectedRequestHash,
    profileSha256: expectedProfileHash,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", token)
    .update(`${timestamp}.${phase}.${payload}`)
    .digest("hex");
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "x-render-timestamp": timestamp,
    "x-render-signature": signature,
    "x-render-idempotency-key": expectedRequestHash,
    "x-render-profile-sha256": expectedProfileHash,
  };
  await beforeProviderSpend?.();
  const launchRes = await fetch(`${baseUrl}/${phase}`, {
    method: "POST",
    headers,
    body: payload,
    signal: AbortSignal.timeout(45_000),
  });
  if (!launchRes.ok) {
    throw new Error(`novitaRenderFarm: bridge launch ${phase} failed ${launchRes.status}: ${(await launchRes.text()).slice(0, 300)}`);
  }
  const launch = BridgeLaunchSchema.parse(await launchRes.json());
  if (launch.requestSha256 !== expectedRequestHash || launch.profileSha256 !== expectedProfileHash) {
    throw new Error(`novitaRenderFarm: bridge launch returned mismatched contract hashes for ${phase}`);
  }
  const jobId = launch.jobId;
  if (!jobId.startsWith(`${phase}-`)) {
    throw new Error(`novitaRenderFarm: bridge launch returned mismatched identity for ${phase}`);
  }
  return {
    jobId,
    phase,
    prefix: cappedBody.prefix,
    expectedJobIds: [...expectedJobIds],
    profile: cappedBody["profile"] as NovitaPhaseProfile,
    profileSha256: expectedProfileHash,
    requestSha256: expectedRequestHash,
    requestCanonicalJson,
    nshard: typeof cappedBody["nshard"] === "number" ? cappedBody["nshard"] : 1,
    maxCostUsd,
  };
}

/** Read and schema-check one bridge job without launching or waiting. */
export async function getNovitaRenderStatus(jobId: string): Promise<NovitaBridgeStatus> {
  const identity = /^(image|video)-[a-f0-9]{32}$/.exec(jobId);
  if (!identity) throw new Error("novitaRenderFarm: invalid bridge job id");
  await bootstrapSecrets(() => {}, { required: ["NOVITA_RENDER_FARM_API", "NOVITA_RENDER_FARM_TOKEN"] });
  const { baseUrl, token } = renderBridgeConfig();
  const statusRes = await fetch(`${baseUrl}/status?jobId=${encodeURIComponent(jobId)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!statusRes.ok) {
    throw new Error(`novitaRenderFarm: bridge status failed ${statusRes.status}: ${(await statusRes.text()).slice(0, 300)}`);
  }
  const status = BridgeStatusSchema.parse(await statusRes.json());
  if (status.jobId !== jobId || status.phase !== identity[1]) {
    throw new Error(`novitaRenderFarm: bridge status returned mismatched identity for ${jobId}`);
  }
  const profileHash = createHash("sha256").update(canonicalJson(status.profile)).digest("hex");
  if (profileHash !== status.profileSha256) {
    throw new Error(`novitaRenderFarm: bridge status returned a corrupted profile contract for ${jobId}`);
  }
  const receiptHash = createHash("sha256").update(canonicalJson(status.billingReceipt)).digest("hex");
  if (receiptHash !== status.billingReceiptSha256) {
    throw new Error(`novitaRenderFarm: bridge status returned a corrupted billing receipt for ${jobId}`);
  }
  const receipt = status.billingReceipt;
  const calculatedCost = receipt.gpuSeconds * receipt.gpuRateUsdPerSecond
    + receipt.startupUsd
    + receipt.storageUsd;
  if (Math.abs(calculatedCost - receipt.costUsd) > 0.000001 || receipt.gpuCount !== status.runtimeAttestation.gpuCount) {
    throw new Error(`novitaRenderFarm: bridge status returned an internally inconsistent billing receipt for ${jobId}`);
  }
  return status;
}

function assertStatusMatchesLaunch(
  launch: NovitaRenderLaunch,
  status: NovitaBridgeStatus,
): void {
  if (status.jobId !== launch.jobId || status.phase !== launch.phase) {
    throw new Error(`novitaRenderFarm: bridge status returned mismatched identity for ${launch.jobId}`);
  }
  if (canonicalJson(status.profile) !== canonicalJson(launch.profile)) {
    throw new Error(`novitaRenderFarm: bridge status returned a mismatched generation profile for ${launch.jobId}`);
  }
  if (status.profileSha256 !== launch.profileSha256 || status.requestSha256 !== launch.requestSha256) {
    throw new Error(`novitaRenderFarm: bridge status returned mismatched contract hashes for ${launch.jobId}`);
  }
  if (status.billingReceipt.costUsd > launch.maxCostUsd + 0.000001) {
    throw new Error(`novitaRenderFarm: bridge exceeded the sealed $${launch.maxCostUsd.toFixed(4)} spend cap for ${launch.jobId}`);
  }
  const attestation = status.runtimeAttestation;
  const infra = launch.profile.infrastructure;
  if (
    attestation.provider !== infra.provider
    || attestation.capacityMode !== infra.capacityMode
    || attestation.weightStorage !== infra.weightStorage
    || attestation.cacheMount !== infra.cacheMount
    || attestation.checkpointing !== infra.checkpointing
    || attestation.idleShutdownSeconds !== infra.idleShutdownSeconds
    || attestation.gpuCount > launch.nshard
    || attestation.gpuCount > infra.elasticGpuCeiling
    || attestation.model !== launch.profile.model
    || attestation.revision !== launch.profile.revision
    || attestation.checkpoint !== launch.profile.checkpoint
    || (launch.phase === "video" && attestation.precision !== launch.profile.precision)
    || attestation.pipeline !== launch.profile.pipeline
    || attestation.twoStageRefine !== launch.profile.twoStageRefine
    || attestation.distilledLoraCheckpoint !== launch.profile.distilledLoraCheckpoint
    || attestation.textEncoderCheckpoint !== launch.profile.textEncoderCheckpoint
    || attestation.videoVaeCheckpoint !== launch.profile.videoVaeCheckpoint
    || attestation.audioVaeCheckpoint !== launch.profile.audioVaeCheckpoint
    || attestation.spatialUpscalerCheckpoint !== launch.profile.spatialUpscalerCheckpoint
    || attestation.quantization !== launch.profile.quantization
    || attestation.offload !== launch.profile.offload
    || attestation.spatialUpscaleFactor !== launch.profile.spatialUpscaleFactor
    || attestation.stageOneWidth !== launch.profile.stageOneWidth
    || attestation.stageOneHeight !== launch.profile.stageOneHeight
    || (launch.phase === "video" && attestation.outputWidth !== launch.profile.width)
    || (launch.phase === "video" && attestation.outputHeight !== launch.profile.height)
  ) {
    throw new Error(`novitaRenderFarm: bridge worker did not attest the pinned Novita spot/local-disk model contract for ${launch.jobId}`);
  }
}

export interface NovitaRenderPollOptions {
  pollMs?: number;
  timeoutMs?: number;
  pollWait?: NovitaRenderPollWait;
  statusReader?: (jobId: string) => Promise<NovitaBridgeStatus>;
  now?: () => number;
}

/** Poll a previously accepted launch and re-verify its identity and contract on every response. */
export async function waitForBridgeRender(
  launch: NovitaRenderLaunch,
  opts: NovitaRenderPollOptions = {},
): Promise<NovitaBridgeStatus> {
  const basePollMs = Math.max(30_000, opts.pollMs ?? 30_000);
  const waves = Math.ceil(
    launch.expectedJobIds.length / Math.max(1, Math.min(NOVITA_ELASTIC_GPU_CEILING, launch.nshard)),
  );
  const estimatedMs = waves * (launch.phase === "image" ? 3 : 20) * 60_000 + 60 * 60_000;
  const timeoutMs = opts.timeoutMs ?? Math.min(24 * 60 * 60 * 1000, Math.max(4 * 60 * 60 * 1000, estimatedMs));

  const now = opts.now ?? Date.now;
  const readStatus = opts.statusReader ?? getNovitaRenderStatus;
  const pollWait = opts.pollWait ?? waitForNovitaRenderPoll;
  const t0 = now();
  let consecutivePollFailures = 0;
  let pollAttempt = 0;
  for (;;) {
    let status: NovitaBridgeStatus | undefined;
    try {
      status = await readStatus(launch.jobId);
    } catch (error) {
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= 5) throw error;
    }
    if (status) {
      consecutivePollFailures = 0;
      assertStatusMatchesLaunch(launch, status);
      if (status.status === "failed") {
        throw new Error(`novitaRenderFarm: ${launch.phase} job ${launch.jobId} failed: ${status.error ?? "unknown"}`);
      }
      if (status.status === "done") {
        validateBridgeCompletion({
          phase: launch.phase,
          prefix: launch.prefix,
          jobId: launch.jobId,
          expectedJobIds: launch.expectedJobIds,
          status,
        });
        return status;
      }
    }
    if (now() - t0 > timeoutMs) {
      throw new Error(`novitaRenderFarm: ${launch.phase} job ${launch.jobId} timed out after ${timeoutMs}ms`);
    }
    // Status checks are deliberately sparse and back off to two minutes. The
    // bridge batches fleet state, so hot polling would only waste Trigger
    // runtime and control-plane requests without making a render finish sooner.
    const pollMs = Math.min(120_000, Math.ceil(basePollMs * 1.5 ** pollAttempt));
    pollAttempt += 1;
    await pollWait({
      milliseconds: pollMs,
      idempotencyKey: `novita-render:${launch.jobId}:poll:${pollAttempt}`,
    });
  }
}

function normalizedCfg(userCfg: NovitaRenderCfg): NovitaRenderCfg {
  return {
    ...userCfg,
    style: userCfg.style ?? DEFAULTS.style,
    negative: userCfg.negative ?? DEFAULTS.negative,
    director: userCfg.director ?? DEFAULTS.director,
    nshard: userCfg.nshard ?? DEFAULTS.nshard,
    jobs: userCfg.jobs ?? DEFAULTS.jobs,
    maxConcurrent: userCfg.maxConcurrent ?? DEFAULTS.maxConcurrent,
  };
}

/**
 * Every public video route (normal renders, repair retries, and the retained
 * bridge launcher) resolves native-720p promotion authority here before it
 * can bootstrap credentials or reach a provider. The resolver has no
 * caller-provided receipt input, so a task payload cannot self-authorize.
 */
function assertCinematicVideoAdmission(profile: NovitaPhaseProfile): void {
  try {
    assertCinematicProofAdmission({ profile });
  } catch (error) {
    throw new NovitaAdmissionError(
      error instanceof Error ? error.message : "cinematic proof admission rejected the requested profile",
    );
  }
}

export function imageJobs(cfg: NovitaRenderCfg) {
  return cfg.shots
    .filter((shot) => shot.prompt && shot.prompt.trim())
    .flatMap((shot) => Array.from(
      { length: shot.candidateCount ?? cfg.profile.candidates },
      (_, candidateIndex) => ({
        id: `${shot.id}-c${String(candidateIndex + 1).padStart(2, "0")}`,
        sourceShotId: shot.id,
        candidateIndex,
        prompt: shotPrompt(cfg, shot),
        negative: shotNegative(cfg, shot),
        width: cfg.profile.width,
        height: cfg.profile.height,
        steps: cfg.profile.steps,
        cfg: cfg.profile.guidanceScale,
        seed: (shot.seed ?? 0) + candidateIndex * 10_000,
      }),
    ));
}

export function videoJobs(cfg: NovitaRenderCfg) {
  const fps = cfg.profile.fps;
  if (!fps) throw new Error("novitaRenderFarm: video profile is missing fps");
  return cfg.shots
    .filter((shot) => shot.prompt && shot.prompt.trim() && shot.stillKey)
    .map((shot) => ({
      id: shot.id,
      prompt: shotPrompt(cfg, shot),
      stillKey: shot.stillKey,
      cameraMove: shot.cameraMove,
      shotScale: shot.shotScale,
      lens: shot.lens,
      motion: shot.motion,
      frames: secondsToFrames(shot.seconds, fps),
      fps,
      negative: shotNegative(cfg, shot),
      seed: shot.seed,
    }));
}

async function startImageRender(userCfg: NovitaRenderCfg) {
  const cfg = normalizedCfg(userCfg);
  validate(cfg, "image");
  await bootstrapSecrets(() => {}, { required: ["NOVITA_RENDER_FARM_API", "NOVITA_RENDER_FARM_TOKEN"] });
  const jobs = imageJobs(cfg);
  const launch = await launchBridgeRender("image", {
    prefix: cfg.prefix,
    jobs,
    nshard: cfg.nshard ?? DEFAULTS.nshard,
    jobsSel: cfg.jobs ?? DEFAULTS.jobs,
    maxConcurrent: cfg.maxConcurrent ?? DEFAULTS.maxConcurrent,
    profile: cfg.profile,
  }, jobs.map((job) => job.id), cfg.beforeProviderSpend, cfg.maxCostUsd);
  return { jobs, launch };
}

async function startVideoRender(userCfg: NovitaRenderCfg) {
  const cfg = normalizedCfg({ ...userCfg, shots: userCfg.shots.map((shot) => applyLtxI2vPromptContract(shot, userCfg.styleId)) });
  assertCinematicVideoAdmission(cfg.profile);
  validate(cfg, "video");
  await bootstrapSecrets(() => {}, { required: ["NOVITA_RENDER_FARM_API", "NOVITA_RENDER_FARM_TOKEN"] });
  const jobs = videoJobs(cfg);
  const launch = await launchBridgeRender("video", {
    prefix: cfg.prefix,
    jobs,
    nshard: cfg.nshard ?? DEFAULTS.nshard,
    jobsSel: cfg.jobs ?? DEFAULTS.jobs,
    maxConcurrent: cfg.maxConcurrent ?? DEFAULTS.maxConcurrent,
    profile: cfg.profile,
  }, jobs.map((job) => job.id), cfg.beforeProviderSpend, cfg.maxCostUsd);
  return { jobs, launch };
}

/** Launch the image phase and return immediately with a bridge job receipt. */
export async function launchImages(userCfg: NovitaRenderCfg): Promise<NovitaRenderLaunch> {
  return (await startImageRender(userCfg)).launch;
}

/** Launch the video phase and return immediately with a bridge job receipt. */
export async function launchVideo(userCfg: NovitaRenderCfg): Promise<NovitaRenderLaunch> {
  return (await startVideoRender(userCfg)).launch;
}

/**
 * Render the IMAGE phase for every shot with a prompt. POSTs the shot list to
 * the VPS render-API bridge (which invokes orchestrator.py's `image` launch),
 * then polls until all shards report done. Returns R2 stillKeys.
 */
export async function renderImages(userCfg: NovitaRenderCfg): Promise<NovitaRenderResult> {
  const cfg = normalizedCfg(userCfg);
  validate(cfg, "image");
  if (cfg.maxCostUsd === undefined) {
    throw new NovitaAdmissionError("novita image render requires an explicit signed worker cost ceiling");
  }
  // Do not let a caller hand the direct fleet a broad stage/run ceiling. The
  // immutable profile and actual candidate fanout determine the only valid
  // per-worker envelope, and the caller ceiling merely admits or rejects it.
  const envelope = novitaCostEnvelope({
    label: "novita image render",
    imageJobs: imageJobs(cfg).length,
    maxCostUsd: cfg.maxCostUsd,
  });
  // Dynamic import prevents the type-only direct controller dependency from
  // creating a module cycle while retaining the old bridge helpers solely for
  // historical receipt validation. Runtime rendering never reaches the VPS
  // bridge.
  const { renderDirectNovita } = await import("./novitaDirectRender");
  return await renderDirectNovita({ ...cfg, maxCostUsd: envelope.imageMaxCostUsd }, "image");
}

/**
 * Render the VIDEO phase (image-to-video camera moves) for every shot that
 * already has a stillKey. Same VPS bridge, `video` launch. Returns clips +
 * R2 footageKeys — the SAME shape as `gen_footage`'s output, so
 * `timeline_assemble` (and any other downstream block) consumes it unmodified.
 */
export async function renderVideo(userCfg: NovitaRenderCfg): Promise<NovitaRenderResult> {
  const cfg = normalizedCfg({ ...userCfg, shots: userCfg.shots.map((shot) => applyLtxI2vPromptContract(shot, userCfg.styleId)) });
  assertCinematicVideoAdmission(cfg.profile);
  validate(cfg, "video");
  if (cfg.maxCostUsd === undefined) {
    throw new NovitaAdmissionError("novita video render requires an explicit signed worker cost ceiling");
  }
  const envelope = novitaCostEnvelope({
    label: "novita video render",
    videoJobs: videoJobs(cfg).length,
    maxCostUsd: cfg.maxCostUsd,
  });
  const { renderDirectNovita } = await import("./novitaDirectRender");
  return await renderDirectNovita({ ...cfg, maxCostUsd: envelope.videoMaxCostUsd }, "video");
}
