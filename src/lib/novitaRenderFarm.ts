/**
 * NOVITA RENDER FARM — standalone image + video render module driven by the
 * elastic Novita GPU control plane
 * on the VPS): static modulo sharding, spot-pod autoclose + reclaim-requeue,
 * R2-backed checkpoint resume (workers skip jobs recorded as uploaded in the
 * manifest-bound checkpoint; the bridge reconciles artifacts after a hard kill).
 *
 * EXECUTION MODEL — the orchestrator is a long-running Python driver that
 * launches/monitors Novita GPU pods; it does NOT run inside Vercel or a
 * Trigger.dev task (no spot-pod lifecycle, no multi-hour process there). This
 * module therefore never spawns python directly — it POSTs the render cfg to
 * an authenticated HTTPS control-plane bridge, then polls that bridge for
 * completion. Both `NOVITA_RENDER_FARM_API` and `NOVITA_RENDER_FARM_TOKEN` are required;
 * there is deliberately no public or unauthenticated fallback.
 */
import { createHash, createHmac } from "node:crypto";
import { NOVITA_ELASTIC_GPU_CEILING, type GenerationProfile } from "@/engine/generationProfiles";
import { requireNovitaFleetReadiness } from "@/lib/novitaFleet";
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
  shotScale: ShotScale;
  /** Lens description, e.g. "35mm anamorphic", "85mm portrait". */
  lens: string;
  /** Shot duration in seconds (video phase); converted to 8n+1 frames. */
  seconds: number;
  /** Motion cue — what actually moves in-frame (subject/particles), independent of camera. */
  motion: string;
  /** Per-shot negative prompt, appended to the global negative. */
  negative?: string;
  seed?: number;
  /** R2 key of the rendered still once the image phase has produced it. */
  stillKey?: string;
  section?: string;
  storyFunction?: string;
  /** Authored story timecodes and lineage; preserved into render manifests. */
  t0?: number;
  t1?: number;
  sourceSentenceIds?: string[];
  continuityState?: string;
  generationProfile?: "draft" | "production" | "hero";
  candidateCount?: number;
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
  spatialUpscalerCheckpoint?: string;
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
  pipeline?: GenerationProfile["video"]["pipeline"];
  distilledLoraCheckpoint?: string;
  spatialUpscalerCheckpoint?: string;
}

/** Convert one approved studio profile into the exact phase contract accepted by the bridge. */
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
          ...(profile.video.spatialUpscalerCheckpoint
            ? { spatialUpscalerCheckpoint: profile.video.spatialUpscalerCheckpoint }
            : {}),
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

/** Full render job config — maps ~1:1 onto the orchestrator's job schema (no translation layer). */
export interface NovitaRenderCfg {
  /** R2 key prefix for this render's outputs, e.g. "adart2". */
  prefix: string;
  shots: Shot[];
  /** Immutable, provider-pinned profile. There is no implicit production fallback. */
  profile: NovitaPhaseProfile;
  /** Global style string appended to every shot prompt. */
  style?: string;
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
}

/** Result of an image or video render call. */
export interface NovitaRenderResult {
  ok: boolean;
  phase: "image" | "video";
  /** R2 keys of stills produced (image phase). */
  stillKeys?: string[];
  /** Local/streamed clip paths (video phase, if the bridge returns them). */
  footageClips?: string[];
  /** R2 keys of clips produced (video phase). */
  footageKeys?: string[];
  /** Exact shot/candidate mapping; callers never infer identity from array order. */
  candidates?: RenderedCandidate[];
  outputs: number;
  durationSec: number;
  costUsd: number;
  billingReceipt: NovitaBillingReceipt;
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
  does: "Renders a full shot list on an elastic Novita spot fleet (up to eight GPUs) through a signed HTTPS bridge. Approved immutable profiles pin model revision, local persistent-disk cache, checkpoint, dimensions, steps, guidance, precision, FPS, and candidate count; the bridge rejects drift and cross-engine fallback.",
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
    nshard: "Novita pods to shard across, ≤8 (subject to the bridge-attested account quota)",
    jobs: "'val' | 'full' — val proves on 1 shard before a full run",
    maxConcurrent: "max pods in flight at once (default 1, hard ceiling 8)",
  },
  needs: { // environment
    secrets: ["NOVITA_RENDER_FARM_TOKEN"],
    tools: ["authenticated HTTPS render bridge (NOVITA_RENDER_FARM_API)"],
    note: "The GPU control plane owns the Novita and R2 credentials; Vercel/Trigger only receives a scoped bridge token.",
  },
  rules: [
    "Video frames are ALWAYS 8n+1 (LTX/Wan temporal requirement) — seconds are rounded to the nearest valid frame count, never truncated silently.",
    "Every shot needs a motion cue (cameraMove !== 'static' OR a non-empty motion field) — a shot with neither is a still, not a video shot.",
    "width/height MUST be a multiple of 32 (VAE tiling requirement) — never submitted unrounded.",
    "nshard is capped at 8 and the bridge may admit fewer from its live provider-attested quota — a request above the hard ceiling fails validate(), it does not silently clamp.",
    "NO cross-engine fallback: a failed shard retries the SAME engine/pod pattern, then fails loud.",
    "R2-backed checkpoint resume — workers skip uploaded jobs recorded in the manifest-bound checkpoint; bridge-side artifact reconciliation closes the hard-kill gap before requeue.",
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
  pipeline: z.enum(["distilled", "two-stage-hq"]).optional(),
  distilledLoraCheckpoint: z.string().min(1).optional(),
  spatialUpscalerCheckpoint: z.string().min(1).optional(),
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
  const rawUrl = process.env.NOVITA_RENDER_FARM_API?.trim();
  const token = process.env.NOVITA_RENDER_FARM_TOKEN?.trim();
  if (!rawUrl) throw new Error("novitaRenderFarm: NOVITA_RENDER_FARM_API is required");
  if (!token || token.length < 32) {
    throw new Error("novitaRenderFarm: NOVITA_RENDER_FARM_TOKEN must contain at least 32 characters");
  }
  const url = new URL(rawUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("novitaRenderFarm: NOVITA_RENDER_FARM_API must use HTTPS (HTTP is allowed only for loopback)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("novitaRenderFarm: NOVITA_RENDER_FARM_API must not contain credentials, query parameters, or a fragment");
  }
  return { baseUrl: url.toString().replace(/\/$/, ""), token };
}

/** True only when the scoped HTTPS bridge configuration passes all local checks. */
export async function hasNovitaRenderBridge(): Promise<boolean> {
  if (!process.env.NOVITA_RENDER_FARM_API || !process.env.NOVITA_RENDER_FARM_TOKEN) {
    try {
      await bootstrapSecrets();
    } catch {
      return false;
    }
  }
  try {
    renderBridgeConfig();
    return true;
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
      if (profile.id === "draft") {
        if (profile.pipeline !== "distilled" || profile.twoStageRefine !== false || !profile.spatialUpscalerCheckpoint) {
          errs.push("draft video must use the pinned efficient distilled pipeline and spatial upscaler");
        }
      } else if (
        profile.pipeline !== "two-stage-hq"
        || profile.twoStageRefine !== true
        || !profile.distilledLoraCheckpoint
        || !profile.spatialUpscalerCheckpoint
      ) {
        errs.push("production and hero video must use the pinned two-stage HQ pipeline with distilled LoRA and spatial upscaler");
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
): Promise<NovitaRenderLaunch> {
  const { baseUrl, token } = renderBridgeConfig();
  // This authenticated GET is intentionally the only pre-spend call. The
  // bridge must attest the immutable worker, verified local cache, budget,
  // interruption recovery, and scale-to-zero controls before a paid launch.
  const readiness = await requireNovitaFleetReadiness({ baseUrl, token });
  const budget = readiness.attestation?.budget;
  if (!budget) throw new Error("novitaRenderFarm: fleet readiness omitted its spend admission contract");
  const maxCostUsd = Math.min(budget.maxFleetUsd, budget.maxJobUsd * expectedJobIds.length);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error("novitaRenderFarm: fleet readiness returned an invalid hard spend cap");
  }
  const cappedBody: Record<string, unknown> & { prefix: string; maxCostUsd: number } = { ...body, maxCostUsd };
  const expectedProfileHash = createHash("sha256").update(canonicalJson(cappedBody["profile"])).digest("hex");
  const expectedRequestHash = createHash("sha256").update(`${phase}\0`).update(canonicalJson(cappedBody)).digest("hex");
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
    || attestation.pipeline !== launch.profile.pipeline
    || attestation.distilledLoraCheckpoint !== launch.profile.distilledLoraCheckpoint
    || attestation.spatialUpscalerCheckpoint !== launch.profile.spatialUpscalerCheckpoint
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

function imageJobs(cfg: NovitaRenderCfg) {
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

function videoJobs(cfg: NovitaRenderCfg) {
  const fps = cfg.profile.fps;
  if (!fps) throw new Error("novitaRenderFarm: video profile is missing fps");
  return cfg.shots
    .filter((shot) => shot.prompt && shot.prompt.trim() && shot.stillKey)
    .map((shot) => ({
      id: shot.id,
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
  }, jobs.map((job) => job.id));
  return { jobs, launch };
}

async function startVideoRender(userCfg: NovitaRenderCfg) {
  const cfg = normalizedCfg(userCfg);
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
  }, jobs.map((job) => job.id));
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
  const t0 = Date.now();
  const { jobs, launch } = await startImageRender(userCfg);
  const st = await waitForBridgeRender(launch);

  const candidates = jobs.map((job) => ({
    shotId: job.sourceShotId,
    candidateIndex: job.candidateIndex,
    outputId: job.id,
    key: `${st.outputPrefix}/${job.id}.png`,
  }));

  return {
    ok: true,
    phase: "image",
    stillKeys: candidates.map((candidate) => candidate.key),
    candidates,
    outputs: candidates.length,
    durationSec: Math.round((Date.now() - t0) / 1000),
    costUsd: st.billingReceipt.costUsd,
    billingReceipt: st.billingReceipt,
    raw: st,
  };
}

/**
 * Render the VIDEO phase (image-to-video camera moves) for every shot that
 * already has a stillKey. Same VPS bridge, `video` launch. Returns clips +
 * R2 footageKeys — the SAME shape as `gen_footage`'s output, so
 * `timeline_assemble` (and any other downstream block) consumes it unmodified.
 */
export async function renderVideo(userCfg: NovitaRenderCfg): Promise<NovitaRenderResult> {
  const t0 = Date.now();
  const { jobs, launch } = await startVideoRender(userCfg);
  const st = await waitForBridgeRender(launch);

  const candidates = jobs.map((job) => ({
    shotId: job.id,
    candidateIndex: 0,
    outputId: job.id,
    key: `${st.outputPrefix}/${job.id}.mp4`,
  }));
  const footageKeys = candidates.map((candidate) => candidate.key);
  return {
    ok: true,
    phase: "video",
    footageClips: st.footageClips ?? [],
    footageKeys,
    candidates,
    outputs: footageKeys.length,
    durationSec: Math.round((Date.now() - t0) / 1000),
    costUsd: st.billingReceipt.costUsd,
    billingReceipt: st.billingReceipt,
    raw: st,
  };
}
