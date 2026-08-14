/**
 * novitaCharacterLora — ONE job: PRODUCE a character LoRA reference.
 *
 * Two paths in, one shape out (a `CharacterLoraRef` from src/lib/characterLora.ts):
 *
 *   TRAIN  — generate a small bootstrap set of the described character with
 *            Novita's hosted Z-Image Turbo text-to-image endpoint (multiple
 *            angles and expressions), submit those images to Novita's subject
 *            LoRA training endpoint, and poll until the model is SERVING.
 *   IMPORT — accept a pre-vetted external LoRA (a Novita hub path, or a hosted
 *            .safetensors URL under a size ceiling) with no training at all.
 *
 * WHAT THIS MODULE MUST NEVER DO
 * Produce episode content. The only images it generates are TRAINING INPUTS for
 * the character's own adapter — never a frame that reaches a video. There is no
 * image-to-video call, no render-farm import and no storage of a deliverable
 * here, and the wiring test asserts that against this file's source.
 *
 * HTTP CONVENTIONS
 * Mirrors `NovitaGpuApiClient` in src/lib/novitaFleet.ts deliberately: a small
 * class holding one base URL, `authorization: Bearer <key>` plus a project
 * user-agent, `AbortSignal.timeout` on every request, and errors that report
 * the status and path but NEVER reflect the provider's response body (those
 * bodies can carry account details). The async submit → poll shape is the same
 * one src/lib/novitaRenderPolling.ts already uses for the render bridge.
 *
 * PROVENANCE OF THE API SHAPES BELOW
 * Taken from Novita's published API reference, NOT from a live call made by
 * this repository — no Novita credential was available when this was written.
 * Each endpoint records that in `NOVITA_LORA_API_EVIDENCE` so a reader can see
 * exactly which claims are still doc-only. See also the known limitation
 * recorded on `LORA_SURFACES.novita_bridge_i2v`.
 */
import {
  CHARACTER_LORA_DEFAULT_SCALE,
  makeImportedCharacterLora,
  makeTrainedCharacterLora,
  type CharacterLoraRef,
} from "./characterLora";

const NOVITA_API_BASE = "https://api.novita.ai";

/**
 * What is actually confirmed, and how. Exported so the honesty claim is data a
 * test can assert rather than prose in a comment.
 */
export const NOVITA_LORA_API_EVIDENCE = {
  bootstrapImages: {
    endpoint: "POST /v3/async/z-image-turbo",
    evidence: "docs" as const,
    note: "Async submit returns task_id; poll GET /v3/async/task-result until TASK_STATUS_SUCCEED.",
  },
  submitTraining: {
    endpoint: "POST /v3/training/subject",
    evidence: "docs" as const,
    note: "Async submit returns task_id only.",
  },
  trainingResult: {
    endpoint: "GET /v3/training/subject?task_id=…",
    evidence: "docs" as const,
    note:
      "Returns task_status (UNKNOWN|QUEUING|TRAINING|SUCCESS|CANCELED|FAILED) and models[].model_status " +
      "(DEPLOYING|SERVING). A usable model requires BOTH SUCCESS and SERVING.",
  },
  applyToImages: {
    endpoint: "POST /v3/async/z-image-turbo-lora",
    evidence: "docs" as const,
    note: "Documented `loras: [{path, scale}]`, max 3, scale range [0,4].",
  },
  applyToVideo: {
    endpoint: "(none — see LORA_SURFACES.novita_bridge_i2v)",
    evidence: "unsupported" as const,
    note:
      "This repository's video chain runs self-hosted LTX on Novita GPU instances through a private bridge " +
      "whose job payload has no LoRA field. No hosted Novita i2v endpoint with a documented `loras` " +
      "parameter is called by this codebase today.",
  },
  /**
   * THE OPEN QUESTION A LIVE KEY IS NEEDED TO CLOSE.
   *
   * Subject training returns a `model_name` like
   * "model_1699325939_E83A88DAC5.safetensors". Novita's STYLE-training doc
   * states trained LoRAs are consumed by /v3/async/txt2img|img2img via
   * `loras[].model_name` + `strength`, and explicitly notes that trained LoRAs
   * "can not be used in /v3 endpoint" — while z-image-turbo-lora takes
   * `loras[].path` + `scale`. Whether a subject-trained model_name is
   * acceptable AS a `path` on the Z-Image Turbo LoRA endpoint is therefore NOT
   * established by the documentation and must be confirmed with one real call.
   * Until it is, the IMPORT path (a hub path or hosted URL already known to
   * resolve) is the safer of the two.
   */
  trainedModelOnZImageLora: {
    endpoint: "POST /v3/async/z-image-turbo-lora with a subject-trained model_name",
    evidence: "unconfirmed" as const,
    note:
      "Docs describe trained LoRAs in the txt2img `model_name`+`strength` form and z-image-turbo-lora in the " +
      "`path`+`scale` form. Whether the trained name resolves as a `path` needs ONE live call with a real key.",
  },
} as const;

export class NovitaCharacterLoraError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "NovitaCharacterLoraError";
    this.status = status;
  }
}

/** Novita's documented training lifecycle states. */
export type NovitaTrainingStatus =
  | "UNKNOWN"
  | "QUEUING"
  | "TRAINING"
  | "SUCCESS"
  | "CANCELED"
  | "FAILED";

export type NovitaModelStatus = "DEPLOYING" | "SERVING";

export interface NovitaTrainingResult {
  taskId: string;
  taskStatus: NovitaTrainingStatus;
  models: { modelName: string; modelStatus: NovitaModelStatus }[];
  progressPercent?: number;
}

export const TRAINING_TERMINAL_STATUSES: readonly NovitaTrainingStatus[] = [
  "SUCCESS",
  "CANCELED",
  "FAILED",
];

/** A training run is only usable when the task succeeded AND the model serves. */
export function servingModelName(result: NovitaTrainingResult): string | undefined {
  if (result.taskStatus !== "SUCCESS") return undefined;
  return result.models.find((model) => model.modelStatus === "SERVING")?.modelName;
}

export interface CharacterTrainingImage {
  /** Publicly reachable https URL Novita can fetch. */
  imageUrl: string;
  /** Caption/tags for this image, as the subject-training dataset expects. */
  caption: string;
}

export interface BootstrapImageBrief {
  /** Which angle/expression this frame covers, e.g. "three-quarter left, neutral". */
  variation: string;
  prompt: string;
}

export const BOOTSTRAP_MIN_IMAGES = 6;
export const BOOTSTRAP_MAX_IMAGES = 20;

/**
 * The bootstrap coverage plan. A subject LoRA learns an identity from VARIETY,
 * so this is a fixed, deterministic spread of angles and expressions rather
 * than N samples of one prompt — which is the single most common way a
 * character LoRA ends up only able to reproduce one pose.
 */
export const BOOTSTRAP_VARIATIONS: readonly string[] = [
  "front-facing headshot, neutral expression, even soft light",
  "three-quarter view from the left, slight smile",
  "three-quarter view from the right, neutral expression",
  "profile view, mouth closed, clean background",
  "front-facing, speaking mid-sentence, animated expression",
  "front-facing, laughing openly",
  "slightly low angle, looking up and away, thoughtful",
  "waist-up shot, arms relaxed, plain background",
  "front-facing under warm directional light, one side in soft shadow",
  "front-facing under cool flat light, no shadows",
  "three-quarter view, surprised expression, eyebrows raised",
  "front-facing, serious expression, direct eye contact",
];

/**
 * Turn a character description into a bounded, deterministic bootstrap plan.
 * No model is involved: the variations are a fixed list and the description is
 * the operator's own words, so the same character description always produces
 * the same plan — which is what makes a retrain reproducible.
 */
export function planBootstrapImages(args: {
  characterDescription: string;
  count: number;
}): BootstrapImageBrief[] {
  const description = args.characterDescription.trim();
  if (description.length < 12) {
    throw new NovitaCharacterLoraError(
      "character LoRA training needs a real character description (at least a dozen characters)",
    );
  }
  const count = Math.max(BOOTSTRAP_MIN_IMAGES, Math.min(BOOTSTRAP_MAX_IMAGES, Math.round(args.count)));
  return Array.from({ length: count }, (_, index) => {
    const variation = BOOTSTRAP_VARIATIONS[index % BOOTSTRAP_VARIATIONS.length];
    return {
      variation,
      prompt:
        `${description}. ${variation}. Photographic portrait reference, sharp focus, consistent identity, ` +
        "plain uncluttered background, no text, no watermark, no border, single subject only.",
    };
  });
}

export interface NovitaCharacterLoraClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Injected for tests so poll backoff does not really sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
  requestTimeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Hosted-API client for the LoRA lifecycle. Structural twin of
 * `NovitaGpuApiClient` (src/lib/novitaFleet.ts) — same auth header, same
 * user-agent convention, same "never reflect the response body into the error"
 * rule, same bounded per-request timeout.
 */
export class NovitaCharacterLoraClient {
  private readonly baseUrl = NOVITA_API_BASE;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: NovitaCharacterLoraClientOptions) {
    if (options.apiKey.trim().length < 16) {
      throw new NovitaCharacterLoraError("Novita API key is not configured");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
        "user-agent": "youtube-studio-ai/character-lora-v1",
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!response.ok) {
      // Provider bodies can contain account details. Keep the error useful but
      // deliberately avoid reflecting response content into logs.
      throw new NovitaCharacterLoraError(
        `Novita ${path.split("?")[0]} failed with HTTP ${response.status}`,
        response.status,
      );
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  /**
   * Submit ONE bootstrap image generation. Async: returns a task id to poll.
   * This is a TRAINING INPUT, never an episode frame.
   */
  async submitBootstrapImage(args: {
    prompt: string;
    size?: string;
    seed?: number;
  }): Promise<string> {
    const body = await this.request("/v3/async/z-image-turbo", {
      method: "POST",
      body: JSON.stringify({
        prompt: args.prompt,
        size: args.size ?? "1024*1024",
        ...(args.seed === undefined ? {} : { seed: args.seed }),
      }),
    });
    const taskId = (body as Record<string, unknown>)?.["task_id"];
    if (typeof taskId !== "string" || !taskId) {
      throw new NovitaCharacterLoraError("Novita z-image-turbo submission returned no task_id");
    }
    return taskId;
  }

  /** Poll a v3 async task until it succeeds, and return its image URLs. */
  async waitForAsyncImages(taskId: string, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<string[]> {
    const deadline = Date.now() + (options.timeoutMs ?? 300_000);
    const interval = options.intervalMs ?? 3_000;
    for (;;) {
      const body = (await this.request(
        `/v3/async/task-result?task_id=${encodeURIComponent(taskId)}`,
      )) as Record<string, unknown>;
      const task = (body["task"] ?? {}) as Record<string, unknown>;
      const status = String(task["status"] ?? "");
      if (status === "TASK_STATUS_SUCCEED") {
        const images = Array.isArray(body["images"]) ? (body["images"] as Record<string, unknown>[]) : [];
        return images
          .map((image) => image?.["image_url"])
          .filter((url): url is string => typeof url === "string" && url.length > 0);
      }
      if (status === "TASK_STATUS_FAILED") {
        throw new NovitaCharacterLoraError(`Novita task ${taskId} failed`);
      }
      if (Date.now() >= deadline) {
        throw new NovitaCharacterLoraError(`Novita task ${taskId} did not finish before the deadline`);
      }
      await this.sleepImpl(interval);
    }
  }

  /**
   * Submit a subject (character) LoRA training task. Async: returns a task id.
   * The dataset images must already be publicly fetchable URLs.
   */
  async submitSubjectTraining(args: {
    name: string;
    baseModel: string;
    instancePrompt: string;
    images: readonly CharacterTrainingImage[];
    /** Optional expert settings passed straight through. */
    components?: Record<string, unknown>;
  }): Promise<string> {
    if (args.images.length < BOOTSTRAP_MIN_IMAGES) {
      throw new NovitaCharacterLoraError(
        `subject training needs at least ${BOOTSTRAP_MIN_IMAGES} images, got ${args.images.length}`,
      );
    }
    if (args.images.length > 50) {
      // Novita documents a 50-image cap per task.
      throw new NovitaCharacterLoraError("subject training accepts at most 50 images per task");
    }
    const body = await this.request("/v3/training/subject", {
      method: "POST",
      body: JSON.stringify({
        name: args.name,
        base_model: args.baseModel,
        instance_prompt: args.instancePrompt,
        dataset: {
          images: args.images.map((image) => ({
            image_url: image.imageUrl,
            image_caption: image.caption,
          })),
        },
        ...(args.components ? { components: args.components } : {}),
      }),
    });
    const taskId = (body as Record<string, unknown>)?.["task_id"];
    if (typeof taskId !== "string" || !taskId) {
      throw new NovitaCharacterLoraError("Novita subject training submission returned no task_id");
    }
    return taskId;
  }

  /** One status read of a subject-training task. */
  async getSubjectTraining(taskId: string): Promise<NovitaTrainingResult> {
    const body = (await this.request(
      `/v3/training/subject?task_id=${encodeURIComponent(taskId)}`,
    )) as Record<string, unknown>;
    const models = Array.isArray(body["models"]) ? (body["models"] as Record<string, unknown>[]) : [];
    const extra = (body["extra"] ?? {}) as Record<string, unknown>;
    const progress = Number(extra["progress_percent"]);
    return {
      taskId,
      taskStatus: String(body["task_status"] ?? "UNKNOWN") as NovitaTrainingStatus,
      models: models.map((model) => ({
        modelName: String(model["model_name"] ?? ""),
        modelStatus: String(model["model_status"] ?? "DEPLOYING") as NovitaModelStatus,
      })),
      ...(Number.isFinite(progress) ? { progressPercent: progress } : {}),
    };
  }

  /**
   * Poll until the training task reaches a terminal state AND, on success, the
   * model reports SERVING. A SUCCESS whose model is still DEPLOYING is not yet
   * usable, and treating it as done is how a first render fails on an
   * unresolvable path.
   */
  async waitForServingModel(
    taskId: string,
    options: { timeoutMs?: number; intervalMs?: number; log?: (msg: string) => void } = {},
  ): Promise<string> {
    const deadline = Date.now() + (options.timeoutMs ?? 3_600_000);
    const interval = options.intervalMs ?? 20_000;
    for (;;) {
      const result = await this.getSubjectTraining(taskId);
      const serving = servingModelName(result);
      if (serving) return serving;
      if (TRAINING_TERMINAL_STATUSES.includes(result.taskStatus) && result.taskStatus !== "SUCCESS") {
        throw new NovitaCharacterLoraError(`Novita subject training ${taskId} ended ${result.taskStatus}`);
      }
      if (Date.now() >= deadline) {
        throw new NovitaCharacterLoraError(
          `Novita subject training ${taskId} did not reach SERVING before the deadline (last: ${result.taskStatus})`,
        );
      }
      options.log?.(
        `character-lora: training ${taskId} ${result.taskStatus}` +
          (result.progressPercent !== undefined ? ` ${result.progressPercent.toFixed(0)}%` : ""),
      );
      await this.sleepImpl(interval);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Spend admission
 * ------------------------------------------------------------------ */

/**
 * Conservative training envelope, in the same spirit as the direct-render
 * admission guard: a run must have enough budget for its COMPLETE lifecycle or
 * it never starts — half a bootstrap set is money spent for nothing.
 *
 * Rates are deliberately parameters rather than baked-in constants: Novita's
 * published Z-Image Turbo rate and its training rate are both account- and
 * time-dependent, and this repository has no verified invoice for either.
 */
export interface CharacterLoraCostEnvelope {
  bootstrapImages: number;
  bootstrapMaxCostUsd: number;
  trainingMaxCostUsd: number;
  totalMaxCostUsd: number;
}

export function characterLoraCostEnvelope(input: {
  bootstrapImages: number;
  perImageUsd: number;
  trainingRunUsd: number;
  /** Caller-owned ceiling; must cover the COMPLETE envelope. */
  maxCostUsd?: number;
  label: string;
}): CharacterLoraCostEnvelope {
  const images = input.bootstrapImages;
  if (!Number.isSafeInteger(images) || images < BOOTSTRAP_MIN_IMAGES) {
    throw new NovitaCharacterLoraError(
      `${input.label} must bootstrap at least ${BOOTSTRAP_MIN_IMAGES} images`,
    );
  }
  if (!Number.isFinite(input.perImageUsd) || input.perImageUsd < 0) {
    throw new NovitaCharacterLoraError(`${input.label} has an invalid per-image rate`);
  }
  if (!Number.isFinite(input.trainingRunUsd) || input.trainingRunUsd < 0) {
    throw new NovitaCharacterLoraError(`${input.label} has an invalid training rate`);
  }
  const bootstrapMaxCostUsd = images * input.perImageUsd;
  const trainingMaxCostUsd = input.trainingRunUsd;
  const totalMaxCostUsd = bootstrapMaxCostUsd + trainingMaxCostUsd;
  if (input.maxCostUsd !== undefined) {
    if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0) {
      throw new NovitaCharacterLoraError(`${input.label} has an invalid cost ceiling`);
    }
    if (input.maxCostUsd + 1e-9 < totalMaxCostUsd) {
      throw new NovitaCharacterLoraError(
        `${input.label} requires a $${totalMaxCostUsd.toFixed(4)} envelope but only $${input.maxCostUsd.toFixed(4)} is admitted`,
      );
    }
  }
  return { bootstrapImages: images, bootstrapMaxCostUsd, trainingMaxCostUsd, totalMaxCostUsd };
}

/* ------------------------------------------------------------------ *
 * The two entry points
 * ------------------------------------------------------------------ */

export interface TrainCharacterLoraArgs {
  client: NovitaCharacterLoraClient;
  /** Operator's description of who the character is. */
  characterDescription: string;
  /** Training-task name and the LoRA's summoning token. */
  name: string;
  instancePrompt: string;
  baseModel: string;
  bootstrapCount?: number;
  scale?: number;
  triggerWords?: string[];
  /** Pre-spend admission. Called with the complete envelope before ANY request. */
  beforeProviderSpend?: (envelope: CharacterLoraCostEnvelope) => Promise<void> | void;
  perImageUsd: number;
  trainingRunUsd: number;
  maxCostUsd?: number;
  log?: (msg: string) => void;
}

/**
 * TRAIN PATH. Generates the bootstrap set, submits it for subject training and
 * returns the finished reference. Every image produced here is a training
 * input; none of them is, or becomes, episode content.
 */
export async function trainCharacterLora(args: TrainCharacterLoraArgs): Promise<CharacterLoraRef> {
  const plan = planBootstrapImages({
    characterDescription: args.characterDescription,
    count: args.bootstrapCount ?? BOOTSTRAP_MIN_IMAGES,
  });
  const envelope = characterLoraCostEnvelope({
    bootstrapImages: plan.length,
    perImageUsd: args.perImageUsd,
    trainingRunUsd: args.trainingRunUsd,
    maxCostUsd: args.maxCostUsd,
    label: "character LoRA training",
  });
  // ADMISSION BEFORE THE FIRST BILLABLE CALL — never mid-sequence.
  await args.beforeProviderSpend?.(envelope);

  const images: CharacterTrainingImage[] = [];
  for (const [index, brief] of plan.entries()) {
    const taskId = await args.client.submitBootstrapImage({
      prompt: brief.prompt,
      // Deterministic seeds keep a retrain of the same description reproducible.
      seed: 1_000 + index,
    });
    const urls = await args.client.waitForAsyncImages(taskId);
    if (urls.length === 0) {
      throw new NovitaCharacterLoraError(`bootstrap image ${index + 1} produced no output`);
    }
    images.push({ imageUrl: urls[0], caption: `${args.instancePrompt}, ${brief.variation}` });
    args.log?.(`character-lora: bootstrap ${index + 1}/${plan.length} (${brief.variation})`);
  }

  const trainingTaskId = await args.client.submitSubjectTraining({
    name: args.name,
    baseModel: args.baseModel,
    instancePrompt: args.instancePrompt,
    images,
  });
  args.log?.(`character-lora: submitted subject training ${trainingTaskId}`);
  const modelName = await args.client.waitForServingModel(trainingTaskId, { log: args.log });

  return makeTrainedCharacterLora({
    novitaLoraPath: modelName,
    trainingTaskId,
    scale: args.scale ?? CHARACTER_LORA_DEFAULT_SCALE,
    ...(args.triggerWords?.length ? { triggerWords: args.triggerWords } : {}),
    character: args.characterDescription,
  });
}

/**
 * IMPORT PATH. No training, no generation, no provider call — just validation
 * of a reference someone has already vetted. Deliberately synchronous: there is
 * nothing to wait for, and pretending otherwise would invite a caller to think
 * this path costs something.
 */
export function importCharacterLora(args: {
  novitaLoraPath: string;
  sizeBytes?: number;
  scale?: number;
  triggerWords?: string[];
  character?: string;
}): CharacterLoraRef {
  return makeImportedCharacterLora(args);
}
