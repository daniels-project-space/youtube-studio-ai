import { z } from "zod";

const ProfileSchema = z.object({
  contractVersion: z.literal("1.0.0"),
  id: z.enum(["draft", "production", "hero"]),
  infrastructure: z.object({
    provider: z.literal("novita"),
    capacityMode: z.literal("spot"),
    weightStorage: z.literal("local-persistent-disk"),
    cacheMount: z.literal("/workspace/model-cache"),
    checkpointing: z.literal(true),
    idleShutdownSeconds: z.number().int().min(60).max(900),
    elasticGpuCeiling: z.literal(8),
  }),
  image: z.object({
    provider: z.literal("novita"),
    model: z.string().min(1),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    checkpoint: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    steps: z.number().int().positive(),
    guidanceScale: z.number().min(0),
    precision: z.enum(["bf16", "fp16"]),
    candidates: z.number().int().min(1).max(4),
  }),
  video: z.object({
    provider: z.literal("novita"),
    model: z.string().min(1),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    checkpoint: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    steps: z.number().int().positive(),
    guidanceScale: z.number().positive(),
    precision: z.enum(["bf16", "fp16"]),
    pipeline: z.enum(["distilled", "two-stage-hq"]),
    twoStageRefine: z.boolean(),
    distilledLoraCheckpoint: z.string().min(1).optional(),
    textEncoderCheckpoint: z.string().min(1),
    videoVaeCheckpoint: z.string().min(1),
    audioVaeCheckpoint: z.string().min(1),
    spatialUpscalerCheckpoint: z.string().min(1).optional(),
    /** Exact low-VRAM execution mode; never let the runtime choose a fallback. */
    quantization: z.literal("fp8-cast"),
    offload: z.literal("cpu"),
    /** The official distilled pipeline creates stage one at half target size. */
    spatialUpscaleFactor: z.literal(2),
    stageOneWidth: z.number().int().positive(),
    stageOneHeight: z.number().int().positive(),
    candidates: z.number().int().min(1).max(3),
  }),
  qa: z.object({
    imageMinScore: z.number().min(0).max(1),
    shotMinScore: z.number().min(0).max(1),
    maxFreezeFraction: z.number().min(0).max(0.2),
    required: z.literal(true),
  }),
  allowFallback: z.literal(false),
});

export type GenerationProfile = z.infer<typeof ProfileSchema>;

/**
 * A production channel may use the standard profile or the strictly stronger
 * hero profile. Draft deliberately remains outside this set: it is useful for
 * a non-runnable planning/preview surface, but is not an acceptable quality
 * floor for a channel creation, scheduled run, or release.
 */
export function isProductionQualityGenerationProfile(id: unknown): boolean {
  return id === "production" || id === "hero";
}

/**
 * One source of truth for the video renderer. LTX 2.5's distilled pipeline
 * genuinely performs a second, latent-space x2 refinement pass: 640x352 in
 * stage one becomes the deliverable 1280x704 frame. 1280x704 is divisible by
 * 64 as required by the official two-stage pipeline and is intentionally near
 * 720p; this does not pretend an unverified 1440p render fits a 24 GB 4090.
 */
export const LTX_25_RTX_4090_VIDEO = Object.freeze({
  model: "Lightricks/LTX-2.5",
  revision: "ce298b1259d61ce6c87e05154b9ad339b16f32a0",
  checkpoint: "ltx-2.5-22b-distilled-transformer-bf16.safetensors",
  textEncoderCheckpoint: "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
  videoVaeCheckpoint: "ltx-2.5-video-vae-bf16.safetensors",
  audioVaeCheckpoint: "ltx-2.5-audio-vae-bf16.safetensors",
  spatialUpscalerCheckpoint: "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
  runtimeRepository: "Lightricks/LTX-2",
  runtimeRevision: "fd4ded7f2d88d3da713abcdd4ad41ecc4a9314ca",
  width: 1280,
  height: 704,
  fps: 25,
  steps: 8,
  guidanceScale: 1,
  precision: "bf16",
  pipeline: "distilled",
  twoStageRefine: true,
  quantization: "fp8-cast",
  offload: "cpu",
  spatialUpscaleFactor: 2,
  stageOneWidth: 640,
  stageOneHeight: 352,
} as const);

export const LTX_25_MODEL_REVISION = LTX_25_RTX_4090_VIDEO.revision;
export const NOVITA_ELASTIC_GPU_CEILING = 8 as const;

const NOVITA_LOCAL_SPOT_INFRA = {
  provider: "novita" as const,
  capacityMode: "spot" as const,
  weightStorage: "local-persistent-disk" as const,
  cacheMount: "/workspace/model-cache" as const,
  checkpointing: true as const,
  idleShutdownSeconds: 300,
  elasticGpuCeiling: NOVITA_ELASTIC_GPU_CEILING,
};

export const GENERATION_PROFILES: Readonly<Record<GenerationProfile["id"], GenerationProfile>> = {
  draft: ProfileSchema.parse({
    contractVersion: "1.0.0",
    id: "draft",
    infrastructure: NOVITA_LOCAL_SPOT_INFRA,
    image: {
      provider: "novita",
      model: "Tongyi-MAI/Z-Image-Turbo",
      revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
      checkpoint: "Z-Image-Turbo",
      width: 1280,
      height: 736,
      steps: 9,
      guidanceScale: 0,
      precision: "bf16",
      candidates: 1,
    },
    video: {
      provider: "novita",
      ...LTX_25_RTX_4090_VIDEO,
      candidates: 1,
    },
    qa: { imageMinScore: 0.72, shotMinScore: 0.72, maxFreezeFraction: 0.08, required: true },
    allowFallback: false,
  }),
  production: ProfileSchema.parse({
    contractVersion: "1.0.0",
    id: "production",
    infrastructure: NOVITA_LOCAL_SPOT_INFRA,
    image: {
      provider: "novita",
      model: "Tongyi-MAI/Z-Image-Turbo",
      revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
      checkpoint: "Z-Image-Turbo",
      width: 1920,
      height: 1088,
      steps: 9,
      guidanceScale: 0,
      precision: "bf16",
      candidates: 1,
    },
    video: {
      provider: "novita",
      ...LTX_25_RTX_4090_VIDEO,
      candidates: 1,
    },
    qa: { imageMinScore: 0.8, shotMinScore: 0.8, maxFreezeFraction: 0.04, required: true },
    allowFallback: false,
  }),
  hero: ProfileSchema.parse({
    contractVersion: "1.0.0",
    id: "hero",
    infrastructure: NOVITA_LOCAL_SPOT_INFRA,
    image: {
      provider: "novita",
      model: "Tongyi-MAI/Z-Image-Turbo",
      revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
      checkpoint: "Z-Image-Turbo",
      width: 2048,
      height: 1152,
      steps: 9,
      guidanceScale: 0,
      precision: "bf16",
      candidates: 2,
    },
    video: {
      provider: "novita",
      ...LTX_25_RTX_4090_VIDEO,
      candidates: 1,
    },
    qa: { imageMinScore: 0.86, shotMinScore: 0.84, maxFreezeFraction: 0.025, required: true },
    allowFallback: false,
  }),
};

export function generationProfile(id: unknown): GenerationProfile {
  const key = typeof id === "string" ? id : "production";
  const profile = GENERATION_PROFILES[key as GenerationProfile["id"]];
  if (!profile) throw new Error(`unknown generation profile "${key}"`);
  return ProfileSchema.parse(profile);
}
