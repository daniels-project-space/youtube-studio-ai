import {
  GENERATION_PROFILES,
  LTX_25_RTX_4090_VIDEO,
  type GenerationProfile,
} from "@/engine/generationProfiles";

/**
 * Static, provider-free admission facts for the video side of the Novita
 * render fleet.  This is deliberately separate from the code that launches a
 * worker: a pipeline can be rejected before it creates a paid job.
 */
export interface NovitaVideoRuntimeTarget {
  readonly gpuSku: string;
  readonly vramGb: number;
  /**
 * Exact model/runtime-profile identities that have passed the operator's
 * benchmark on this hardware contract. An empty list means fail closed.
   */
  readonly benchmarkedVideoProfileRevisions: readonly string[];
}

export interface NovitaVideoModelRuntimeRequirement {
  readonly minimumVramGb: number;
  readonly modelCode: string;
  /** Reject a model that is nominally compatible but not the sealed GPU profile. */
  readonly profileBlockers?: (profile: NovitaVideoRuntimeProfileInput) => readonly string[];
}

export type GenerationProfileId = GenerationProfile["id"];

/**
 * The narrow profile shape that must be proven before a 24 GB worker can be
 * admitted. Keeping it independent from the controller interface lets the
 * same pre-spend gate validate both authored profiles and sealed worker jobs.
 */
export interface NovitaVideoRuntimeProfileInput {
  readonly id: GenerationProfileId;
  readonly model: string;
  readonly revision: string;
  readonly checkpoint: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly steps: number;
  readonly guidanceScale: number;
  readonly precision: "bf16" | "fp16";
  readonly pipeline?: "distilled" | "two-stage-hq";
  readonly twoStageRefine?: boolean;
  readonly textEncoderCheckpoint?: string;
  readonly videoVaeCheckpoint?: string;
  readonly audioVaeCheckpoint?: string;
  readonly spatialUpscalerCheckpoint?: string;
  readonly quantization?: "fp8-cast";
  readonly offload?: "cpu";
  readonly spatialUpscaleFactor?: 2;
  readonly stageOneWidth?: number;
  readonly stageOneHeight?: number;
}

function ltx25Rtx4090ProfileBlockers(profile: NovitaVideoRuntimeProfileInput): readonly string[] {
  const expected = LTX_25_RTX_4090_VIDEO;
  const blockers: string[] = [];
  const checks: ReadonlyArray<[string, unknown, unknown]> = [
    ["checkpoint", profile.checkpoint, expected.checkpoint],
    ["width", profile.width, expected.width],
    ["height", profile.height, expected.height],
    ["fps", profile.fps, expected.fps],
    ["steps", profile.steps, expected.steps],
    ["guidance", profile.guidanceScale, expected.guidanceScale],
    ["precision", profile.precision, expected.precision],
    ["pipeline", profile.pipeline, expected.pipeline],
    ["two_stage_refine", profile.twoStageRefine, expected.twoStageRefine],
    ["text_encoder", profile.textEncoderCheckpoint, expected.textEncoderCheckpoint],
    ["video_vae", profile.videoVaeCheckpoint, expected.videoVaeCheckpoint],
    ["audio_vae", profile.audioVaeCheckpoint, expected.audioVaeCheckpoint],
    ["spatial_upscaler", profile.spatialUpscalerCheckpoint, expected.spatialUpscalerCheckpoint],
    ["quantization", profile.quantization, expected.quantization],
    ["offload", profile.offload, expected.offload],
    ["spatial_upscale_factor", profile.spatialUpscaleFactor, expected.spatialUpscaleFactor],
    ["stage_one_width", profile.stageOneWidth, expected.stageOneWidth],
    ["stage_one_height", profile.stageOneHeight, expected.stageOneHeight],
  ];
  for (const [name, actual, required] of checks) {
    if (actual !== required) blockers.push(`ltx_2_5_rtx_4090_contract_${name}_mismatch`);
  }
  return blockers;
}

export const NOVITA_LOCKED_VIDEO_RUNTIME: NovitaVideoRuntimeTarget = Object.freeze({
  gpuSku: "RTX 4090",
  vramGb: 24,
  benchmarkedVideoProfileRevisions: Object.freeze([]),
});

/**
 * Add an explicit, benchmarked model requirement here before a new video
 * model is admitted.  Unknown models intentionally remain blocked.
 */
export const NOVITA_VIDEO_MODEL_RUNTIME_REQUIREMENTS: Readonly<
  Partial<Record<string, NovitaVideoModelRuntimeRequirement>>
> = Object.freeze({
  [LTX_25_RTX_4090_VIDEO.model]: Object.freeze({
    // This is a strict candidate profile, not an asserted live benchmark. The
    // independent revision allow-list below remains empty until a paid 4090
    // proof run completes successfully.
    minimumVramGb: 24,
    modelCode: "ltx_2_5",
    profileBlockers: ltx25Rtx4090ProfileBlockers,
  }),
});

export const NOVITA_VIDEO_RUNTIME_REMEDIATION =
  "Deploy a digest-pinned, benchmarked video runtime on a GPU contract that meets the model VRAM floor before enabling paid video renders.";

export interface NovitaVideoRuntimeAssessment {
  readonly profileId: GenerationProfileId;
  readonly model: string;
  readonly revision: string;
  readonly profileIdentity: string;
  readonly gpuSku: string;
  readonly availableVramGb: number;
  readonly requiredVramGb?: number;
  readonly ready: boolean;
  readonly blockers: readonly string[];
  readonly remediation: string;
}

/** A stable identity which cannot confuse a 720p FP8 proof with another LTX mode. */
function runtimeProfileIdentity(profile: Omit<NovitaVideoRuntimeProfileInput, "id">): string {
  return [
    `${profile.model}@${profile.revision}`,
    `checkpoint=${profile.checkpoint}`,
    `target=${profile.width}x${profile.height}@${profile.fps}`,
    `steps=${profile.steps}`,
    `guidance=${profile.guidanceScale}`,
    `precision=${profile.precision}`,
    `pipeline=${profile.pipeline ?? "none"}`,
    `twoStageRefine=${String(profile.twoStageRefine)}`,
    `textEncoder=${profile.textEncoderCheckpoint ?? "none"}`,
    `videoVae=${profile.videoVaeCheckpoint ?? "none"}`,
    `audioVae=${profile.audioVaeCheckpoint ?? "none"}`,
    `spatialUpscaler=${profile.spatialUpscalerCheckpoint ?? "none"}`,
    `quantization=${profile.quantization ?? "none"}`,
    `offload=${profile.offload ?? "none"}`,
    `spatialUpscaleFactor=${profile.spatialUpscaleFactor ?? "none"}`,
    `stageOne=${profile.stageOneWidth ?? "none"}x${profile.stageOneHeight ?? "none"}`,
  ].join("|");
}

/** A concise, stable identity suitable for an explicit benchmark allow-list. */
export function novitaVideoProfileIdentity(profile: Pick<GenerationProfile, "video">): string {
  return runtimeProfileIdentity(profile.video);
}

function asRuntimeProfile(profile: Pick<GenerationProfile, "id" | "video">): NovitaVideoRuntimeProfileInput {
  return { id: profile.id, ...profile.video };
}

/** Evaluate a sealed worker-side video profile with the same pure gate as authored profiles. */
export function assessNovitaVideoPhaseProfileRuntime(
  profile: NovitaVideoRuntimeProfileInput,
  runtime: NovitaVideoRuntimeTarget = NOVITA_LOCKED_VIDEO_RUNTIME,
): NovitaVideoRuntimeAssessment {
  const requirement = NOVITA_VIDEO_MODEL_RUNTIME_REQUIREMENTS[profile.model];
  const { id: _id, ...settings } = profile;
  void _id;
  const profileIdentity = runtimeProfileIdentity(settings);
  const blockers: string[] = [];

  if (!requirement) {
    blockers.push(`unrecognized_novita_video_model:${profile.model}`);
  } else {
    if (!Number.isFinite(runtime.vramGb) || runtime.vramGb < requirement.minimumVramGb) {
      blockers.push(
        `${requirement.modelCode}_requires_${requirement.minimumVramGb}gb_but_${runtime.gpuSku.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}_has_${Number.isFinite(runtime.vramGb) ? runtime.vramGb : "unknown"}gb`,
      );
    }
    blockers.push(...(requirement.profileBlockers?.(profile) ?? []));
    if (!runtime.benchmarkedVideoProfileRevisions.includes(profileIdentity)) {
      blockers.push(
        `${requirement.modelCode}_revision_not_benchmarked_on_${runtime.gpuSku.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      );
    }
  }

  return {
    profileId: profile.id,
    model: profile.model,
    revision: profile.revision,
    profileIdentity,
    gpuSku: runtime.gpuSku,
    availableVramGb: runtime.vramGb,
    ...(requirement ? { requiredVramGb: requirement.minimumVramGb } : {}),
    ready: blockers.length === 0,
    blockers,
    remediation: NOVITA_VIDEO_RUNTIME_REMEDIATION,
  };
}

/**
 * Evaluate a profile with no network, environment, or provider side effects.
 * A sufficient VRAM amount alone is deliberately not enough: the exact pinned
 * model revision must also have a benchmark attestation for the target fleet.
 */
export function assessNovitaVideoProfileRuntime(
  profile: Pick<GenerationProfile, "id" | "video">,
  runtime: NovitaVideoRuntimeTarget = NOVITA_LOCKED_VIDEO_RUNTIME,
): NovitaVideoRuntimeAssessment {
  return assessNovitaVideoPhaseProfileRuntime(asRuntimeProfile(profile), runtime);
}

/** All configured profiles must be checked together; a production-only check can hide an invalid proof profile. */
export function assessConfiguredNovitaVideoProfiles(
  runtime: NovitaVideoRuntimeTarget = NOVITA_LOCKED_VIDEO_RUNTIME,
): readonly NovitaVideoRuntimeAssessment[] {
  return Object.values(GENERATION_PROFILES).map((profile) =>
    assessNovitaVideoProfileRuntime(profile, runtime),
  );
}

/** Direct-provider helpers use this before creating any image or video job. */
export function assertNovitaVideoProfileRuntime(
  profile: Pick<GenerationProfile, "id" | "video">,
  runtime: NovitaVideoRuntimeTarget = NOVITA_LOCKED_VIDEO_RUNTIME,
): void {
  const assessment = assessNovitaVideoProfileRuntime(profile, runtime);
  if (assessment.ready) return;
  throw new Error(
    `Novita video profile ${assessment.profileIdentity} is not admissible: ` +
    `${assessment.blockers.join("; ")}. ${assessment.remediation}`,
  );
}

/** Pre-spend assertion for the direct worker's already-flattened phase profile. */
export function assertNovitaVideoPhaseProfileRuntime(
  profile: NovitaVideoRuntimeProfileInput,
  runtime: NovitaVideoRuntimeTarget = NOVITA_LOCKED_VIDEO_RUNTIME,
): void {
  const assessment = assessNovitaVideoPhaseProfileRuntime(profile, runtime);
  if (assessment.ready) return;
  throw new Error(
    `Novita video profile ${assessment.profileIdentity} is not admissible: ` +
    `${assessment.blockers.join("; ")}. ${assessment.remediation}`,
  );
}

/**
 * These are the actual executable pipeline blocks that buy or produce
 * image-to-video footage. `qa_shots` is included because a failed motion
 * grade may deliberately launch a bounded LTX repair; treating it as a pure
 * consumer would leave custom or legacy pipelines an expensive bypass.
 */
export const NOVITA_VIDEO_REQUIRED_BLOCKS = [
  "loop_clips",
  "lore_short",
  "gen_footage",
  "signature_clips",
  "novita_render_video",
  "qa_shots",
] as const;

export type NovitaVideoRequiredBlock = (typeof NOVITA_VIDEO_REQUIRED_BLOCKS)[number];

export interface PipelineRuntimeBlock {
  readonly block: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export type PipelineRuntimeBlockInput = string | PipelineRuntimeBlock;

export interface PipelineVideoBlockRuntimeAssessment {
  readonly blockId: NovitaVideoRequiredBlock;
  readonly profileId: string;
  readonly ready: boolean;
  readonly blockers: readonly string[];
  readonly profileAssessment?: NovitaVideoRuntimeAssessment;
}

export interface PipelineVideoRuntimeReadiness {
  readonly videoRequired: boolean;
  readonly ready: boolean;
  readonly blockAssessments: readonly PipelineVideoBlockRuntimeAssessment[];
  readonly blockers: readonly string[];
}

const DEFAULT_VIDEO_PROFILE_BY_BLOCK: Readonly<Record<NovitaVideoRequiredBlock, GenerationProfileId>> = {
  loop_clips: "production",
  lore_short: "production",
  gen_footage: "production",
  signature_clips: "production",
  novita_render_video: "production",
  qa_shots: "production",
};

export function isNovitaVideoRequiredBlock(
  blockId: string,
): blockId is NovitaVideoRequiredBlock {
  return (NOVITA_VIDEO_REQUIRED_BLOCKS as readonly string[]).includes(blockId);
}

function runtimeBlock(entry: PipelineRuntimeBlockInput): PipelineRuntimeBlock {
  return typeof entry === "string" ? { block: entry } : entry;
}

function configuredProfileId(entry: PipelineRuntimeBlock): string {
  // The dedicated cinematic block is the only video block whose pipeline
  // config can select a profile.  The other executable paths hard-pin their
  // production profile at the block implementation.
  if (entry.block === "novita_render_video" && typeof entry.params?.generationProfile === "string") {
    return entry.params.generationProfile;
  }
  return isNovitaVideoRequiredBlock(entry.block)
    ? DEFAULT_VIDEO_PROFILE_BY_BLOCK[entry.block]
    : "production";
}

/**
 * Check only blocks which can launch video generation.  It accepts the simple
 * `{ block, params }` shape used by compiled pipeline entries without importing
 * the compiler, so the engine boundary stays pure and acyclic.
 */
export function assessPipelineVideoRuntimeReadiness(
  entries: readonly PipelineRuntimeBlockInput[],
  runtime: NovitaVideoRuntimeTarget = NOVITA_LOCKED_VIDEO_RUNTIME,
): PipelineVideoRuntimeReadiness {
  const blockAssessments: PipelineVideoBlockRuntimeAssessment[] = [];

  for (const input of entries) {
    const entry = runtimeBlock(input);
    if (!isNovitaVideoRequiredBlock(entry.block)) continue;

    const profileId = configuredProfileId(entry);
    const profile = GENERATION_PROFILES[profileId as GenerationProfileId];
    if (!profile) {
      blockAssessments.push({
        blockId: entry.block,
        profileId,
        ready: false,
        blockers: [`unknown_novita_generation_profile:${profileId}`],
      });
      continue;
    }

    const profileAssessment = assessNovitaVideoProfileRuntime(profile, runtime);
    blockAssessments.push({
      blockId: entry.block,
      profileId,
      ready: profileAssessment.ready,
      blockers: profileAssessment.blockers,
      profileAssessment,
    });
  }

  const blockers = blockAssessments.flatMap((assessment) =>
    assessment.blockers.map((blocker) => `${assessment.blockId}:${blocker}`),
  );
  return {
    videoRequired: blockAssessments.length > 0,
    ready: blockers.length === 0,
    blockAssessments,
    blockers,
  };
}

/** Throw a clear pre-spend error that callers can convert to a 4xx/task failure. */
export function assertPipelineVideoRuntimeReady(
  entries: readonly PipelineRuntimeBlockInput[],
  runtime: NovitaVideoRuntimeTarget = NOVITA_LOCKED_VIDEO_RUNTIME,
): void {
  const readiness = assessPipelineVideoRuntimeReadiness(entries, runtime);
  if (readiness.ready) return;
  throw new Error(
    `pipeline video runtime is not admissible: ${readiness.blockers.join("; ")}. ${NOVITA_VIDEO_RUNTIME_REMEDIATION}`,
  );
}
