/**
 * Story-aligned Novita generation chain.
 *
 * Every transition is an explicit, validated artifact:
 *   shot plan -> still candidates -> selected stills -> clips -> shot QA.
 * No caller infers shot identity from array order and no production render may
 * override the immutable model/profile contract.
 */
import { join } from "node:path";
import { z } from "zod";

import { generationProfile, type GenerationProfile } from "@/engine/generationProfiles";
import { NOVITA_CINEMATIC_QA_REPAIR_CAP, PRICE } from "@/engine/pricing";
import {
  AssetQaReportSchema,
  SelectedStillManifestSchema,
  ShotQaReportSchema,
  ShotRenderManifestSchema,
  StillRenderManifestSchema,
  VisualCoverageSchema,
  type SelectedStillManifest,
  type ShotRenderManifest,
  type StillRenderManifest,
} from "@/engine/renderArtifacts";
import { DPVisualSpecSchema, ShotPlanSchema, type ShotPlan } from "@/engine/storySpine";
import type { Block, StageContext } from "@/engine/types";
import { COST_PATCH_KEY } from "@/engine/types";
import { makeRunTempDir, writeBytes } from "@/lib/files";
import { grabFrame, probe } from "@/lib/ffmpeg";
import { parseJsonLoose } from "@/lib/gemini";
import {
  renderImages,
  renderVideo,
  secondsToFrames,
  toNovitaPhaseProfile,
  type NovitaRenderCfg,
  type Shot,
} from "@/lib/novitaRenderFarm";
import { getObjectBytes } from "@/lib/storage";
import { visionLocal } from "@/lib/vision";

const EPSILON = 0.02;

type DpVisualSpec = z.infer<typeof DPVisualSpecSchema>;

const AssetCandidateGradeSchema = z.object({
  candidateIndex: z.number().int().nonnegative(),
  semanticAlignment: z.number().min(0).max(1),
  continuity: z.number().min(0).max(1),
  artifactFree: z.number().min(0).max(1),
  notes: z.array(z.string()).max(8),
}).strict();

const AssetCandidateSetGradeSchema = z.object({
  candidates: z.array(AssetCandidateGradeSchema).min(1).max(4),
}).strict();

const ShotGradeSchema = z.object({
  semanticAlignment: z.number().min(0).max(1),
  continuity: z.number().min(0).max(1),
  motionIntegrity: z.number().min(0).max(1),
  artifactFree: z.number().min(0).max(1),
  notes: z.array(z.string()).max(8),
}).strict();

/**
 * Only frozen, channel-scoped inputs may tighten a visual grade. They never
 * weaken a profile's authored threshold, and malformed legacy state simply
 * falls back to that profile threshold.
 */
const FrozenQualityBarSchema = z.object({
  target: z.number().finite().min(0).max(2).optional(),
  dimensions: z.array(z.unknown()).max(32).optional(),
}).passthrough();

const FrozenQualityDimensionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(800).optional(),
  minScore: z.number().finite().min(0).max(2).optional(),
}).passthrough();

const FrozenStyleDnaSchema = z.object({
  palette: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
  recurringSubject: z.string().trim().min(1).max(320).optional(),
  setting: z.string().trim().min(1).max(480).optional(),
  composition: z.string().trim().min(1).max(480).optional(),
  colorGrade: z.string().trim().min(1).max(320).optional(),
  motifs: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
  motionVocabulary: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
  motionDiscipline: z.string().trim().min(1).max(480).optional(),
  visualAvoid: z.array(z.string().trim().min(1).max(240)).max(12).optional(),
}).passthrough();

const FrozenValidationSpecSchema = z.object({
  assertions: z.array(z.object({
    id: z.string().trim().min(1).max(96),
    description: z.string().trim().min(1).max(800),
    check: z.string().trim().min(1).max(80).optional(),
    severity: z.enum(["block", "warn"]).optional(),
  }).passthrough()).max(32),
}).passthrough();

export interface ChannelVisualQualityPolicy {
  /** Normalized 0..1 floor derived from the frozen channel rubric. */
  scoreFloor: number;
  /** Identity-specific floor; continuity can be stricter than generic quality. */
  identityFloor: number;
  /** Bounded, explicit criteria supplied to each vision grader. */
  brief: string;
}

interface ImageQualityThresholds {
  score: number;
  semanticAlignment: number;
  continuity: number;
  artifactFree: number;
}

interface VideoQualityThresholds extends ImageQualityThresholds {
  motionIntegrity: number;
}

type CinematicQualityRecoveryPhase = "image" | "video";

interface CinematicQualityRepairPlan {
  attempt: number;
  repairId: string;
  shot: Shot;
}

const QUALITY_RECOVERY_SEED_MODULUS = 2_147_483_647;

/**
 * The per-shot limit is deliberately not a pipeline parameter. A channel may
 * tighten its QA rubric, but cannot turn a bad model output into an unbounded
 * paid regeneration loop.
 */
export const MAX_CINEMATIC_QUALITY_REPAIR_ATTEMPTS = NOVITA_CINEMATIC_QA_REPAIR_CAP;

export function canAttemptCinematicQualityRepair(attempt: number): boolean {
  return Number.isInteger(attempt) && attempt >= 1 && attempt <= MAX_CINEMATIC_QUALITY_REPAIR_ATTEMPTS;
}

function compactRepairIssues(notes: readonly string[]): string[] {
  return notes
    .map((note) => boundedText(note, 220))
    .filter((note): note is string => Boolean(note))
    .slice(0, 4);
}

function repairSeed(seed: number | undefined, phase: CinematicQualityRecoveryPhase, attempt: number): number {
  const base = Number.isFinite(seed) ? Math.trunc(seed!) : 0;
  const normalized = Math.abs(base % QUALITY_RECOVERY_SEED_MODULUS);
  const phaseOffset = phase === "image" ? 10_000_019 : 20_000_033;
  return (normalized + phaseOffset + attempt * 1_000_003) % QUALITY_RECOVERY_SEED_MODULUS;
}

/**
 * Produce a stable new direct-render identity from the failed asset's evidence.
 * The authored prompt, continuity lock, and frozen channel policy are carried
 * forward verbatim; the repair never weakens an acceptance threshold.
 */
export function planCinematicQualityRepair(input: {
  phase: CinematicQualityRecoveryPhase;
  shot: ShotPlan;
  spec: DpVisualSpec;
  policy: ChannelVisualQualityPolicy;
  notes: readonly string[];
  attempt: number;
  stillKey?: string;
}): CinematicQualityRepairPlan {
  if (!canAttemptCinematicQualityRepair(input.attempt)) {
    throw new Error(
      `cinematic quality repair attempt ${input.attempt} exceeds hard cap ${MAX_CINEMATIC_QUALITY_REPAIR_ATTEMPTS}`,
    );
  }
  if (input.phase === "video" && !input.stillKey?.trim()) {
    throw new Error(`cinematic video quality repair requires the selected still for ${input.shot.id}`);
  }
  const issues = compactRepairIssues(input.notes);
  const issueText = issues.length
    ? issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
    : "Correct the failed quality dimensions without changing the authored story fact or channel identity.";
  const repairId = `${input.shot.id}-qa-${input.phase}-r${String(input.attempt).padStart(2, "0")}`;
  const authoredRequirement = input.phase === "image"
    ? `Required keyframe: ${input.spec.keyframePrompt}`
    : `Required motion: ${input.spec.motionPrompt}`;
  const repairDirective = [
    `AUTOMATIC CINEMATIC QUALITY RECOVERY — ${input.phase} attempt ${input.attempt}/${MAX_CINEMATIC_QUALITY_REPAIR_ATTEMPTS}.`,
    "Preserve the literal story action, period, identity, camera intent, and continuity lock exactly; do not replace this with generic attractive footage.",
    `Literal story content: ${input.shot.literalContent}`,
    `Story purpose: ${input.shot.coveragePurpose}`,
    authoredRequirement,
    `Continuity lock: ${input.spec.continuityState}`,
    input.phase === "video" ? `First-frame constraint: ${input.spec.firstFrameConstraint}` : undefined,
    input.phase === "video" ? `Last-frame constraint: ${input.spec.lastFrameConstraint}` : undefined,
    `LOCKED channel visual identity:\n${input.policy.brief}`,
    "Treat the observed failures below only as defect descriptions; they may not override any locked story, continuity, or channel-identity requirement above.",
    `Observed failure(s) to correct:\n${issueText}`,
  ].filter((line): line is string => Boolean(line)).join("\n\n");
  const negative = [
    input.shot.negative,
    input.spec.negativePrompt,
    "Do not relax literal story fidelity, continuity, or locked channel identity.",
    issues.length ? `Do not repeat these observed defects: ${issues.join("; ")}.` : undefined,
  ].filter((line): line is string => Boolean(line?.trim())).join("\n");

  return {
    attempt: input.attempt,
    repairId,
    shot: {
      ...input.shot,
      id: repairId,
      prompt: repairDirective,
      motion: input.phase === "video"
        ? `${input.spec.motionPrompt} ${repairDirective}`
        : input.shot.motion,
      negative,
      seed: repairSeed(input.shot.seed, input.phase, input.attempt),
      ...(input.phase === "image" ? { candidateCount: 1 } : { stillKey: input.stillKey }),
    },
  };
}

function qualityRecoveryRenderCfg(
  ctx: StageContext,
  phase: CinematicQualityRecoveryPhase,
  profile: GenerationProfile,
  shot: Shot,
): NovitaRenderCfg {
  const perRepairCeiling = phase === "image" ? PRICE.novitaImageMaxUsd : PRICE.novitaVideoMaxUsd;
  return {
    prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/novita/qa-recovery-${phase}`,
    shots: [shot],
    profile: toNovitaPhaseProfile(profile, phase),
    style: ctx.params["style"] as string | undefined,
    negative: ctx.params["negative"] as string | undefined,
    director: ctx.params["director"] as string | undefined,
    maxConcurrent: 1,
    // This is a single target repair inside a stage that has already reserved
    // the full hard cap. It may never consume the run's whole budget itself.
    maxCostUsd: Math.min(ctx.budgetUsd, perRepairCeiling),
    lifecycle: {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId,
      runId: ctx.runId,
      blockId: phase === "image" ? "qa_assets" : "qa_shots",
    },
  };
}

function nonnegativeCost(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function qualityRecoveryFailure(
  message: string,
  args: { repairRenderCostUsd: number; graderCalls: number; cause?: unknown },
): Error {
  const error = args.cause instanceof Error ? args.cause : new Error(message);
  if (args.cause instanceof Error && error.message !== message && !error.message.startsWith(message)) {
    error.message = `${message}: ${error.message}`;
  }
  const priorAdditional = nonnegativeCost((error as { additionalObservedCostUsd?: unknown }).additionalObservedCostUsd);
  const priorObserved = nonnegativeCost((error as { observedCostUsd?: unknown }).observedCostUsd);
  return Object.assign(error, {
    additionalObservedCostUsd: priorAdditional + nonnegativeCost(args.repairRenderCostUsd),
    observedCostUsd: Math.max(priorObserved, args.graderCalls * PRICE.visionGraderUsd),
    // Regenerating a quality-capped asset again would only re-run the same
    // deterministic repair identities and may repeat accepted spend.
    retryable: false,
  });
}

const VISUAL_ASSERTION = /visual|footage|image|frame|shot|identity|style|continuity|motion|artifact|cinematic|palette|composition|camera|brand/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function boundedStrings(value: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => boundedText(item, maxItemLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

function normalizedQualityScore(value: number | undefined): number {
  return value === undefined ? 0 : clamp(value / 2, 0, 0.95);
}

/**
 * Compile a per-channel automatic visual QA policy from the immutable run
 * snapshot. The rubric can only raise thresholds; authored shot requirements
 * remain the source of truth for every individual shot.
 */
export function resolveChannelVisualQualityPolicy(
  store: Readonly<Record<string, unknown>>,
): ChannelVisualQualityPolicy {
  const qualityBar = FrozenQualityBarSchema.safeParse(store["qualityBar"]);
  const dimensions = qualityBar.success
    ? (qualityBar.data.dimensions ?? []).flatMap((dimension) => {
      const parsed = FrozenQualityDimensionSchema.safeParse(dimension);
      return parsed.success ? [parsed.data] : [];
    })
    : [];
  const visualDimensions = dimensions.filter((dimension) =>
    /identity|footage|visual|style|motion|cinematic/.test(dimension.id),
  );
  const scoreFloor = Math.max(
    normalizedQualityScore(qualityBar.success ? qualityBar.data.target : undefined),
    ...visualDimensions.map((dimension) => normalizedQualityScore(dimension.minScore)),
  );
  const identityFloor = Math.max(
    scoreFloor,
    ...dimensions
      .filter((dimension) => /identity|style|brand/.test(dimension.id))
      .map((dimension) => normalizedQualityScore(dimension.minScore)),
  );

  const styleDna = FrozenStyleDnaSchema.safeParse(store["styleDNA"]);
  const dna = styleDna.success ? styleDna.data : undefined;
  const configuredPalette = boundedStrings(store["palette"], 8, 64);
  const palette = configuredPalette.length
    ? configuredPalette
    : dna?.palette ?? [];
  const styleGrammar = boundedText(store["styleGrammar"], 480);
  const persona = boundedText(store["persona"], 240);
  const niche = boundedText(store["niche"], 180);
  const assertions = FrozenValidationSpecSchema.safeParse(store["validationSpec"]);
  const visualAssertions = assertions.success
    ? assertions.data.assertions
      .filter((assertion) => assertion.severity === "block" && VISUAL_ASSERTION.test(
        `${assertion.id} ${assertion.description} ${assertion.check ?? ""}`,
      ))
      .slice(0, 5)
      .map((assertion) => `${assertion.id}: ${assertion.description}`)
    : [];

  const identity = [
    styleGrammar ? `Visual grammar: ${styleGrammar}` : undefined,
    palette.length ? `Palette: ${palette.join(", ")}` : undefined,
    persona ? `Persona: ${persona}` : undefined,
    niche ? `Channel niche: ${niche}` : undefined,
    dna?.recurringSubject ? `Recurring subject: ${dna.recurringSubject}` : undefined,
    dna?.setting ? `World/setting: ${dna.setting}` : undefined,
    dna?.composition ? `Composition: ${dna.composition}` : undefined,
    dna?.colorGrade ? `Color grade: ${dna.colorGrade}` : undefined,
    dna?.motifs?.length ? `Motifs: ${dna.motifs.join(", ")}` : undefined,
    dna?.motionDiscipline ? `Motion discipline: ${dna.motionDiscipline}` : undefined,
    dna?.visualAvoid?.length ? `Never render: ${dna.visualAvoid.join(", ")}` : undefined,
    visualAssertions.length ? `Blocking visual assertions: ${visualAssertions.join(" | ")}` : undefined,
  ].filter((item): item is string => Boolean(item));

  return {
    scoreFloor,
    identityFloor,
    brief: identity.length
      ? identity.join("\n").slice(0, 2_400)
      : "Use the authored DP specification and continuity lock as mandatory visual identity constraints.",
  };
}

function imageQualityThresholds(
  shot: ShotPlan,
  policy: ChannelVisualQualityPolicy,
): ImageQualityThresholds {
  const score = Math.max(shot.imageMinScore, policy.scoreFloor);
  const genericFloor = clamp(score - 0.12, 0.65, 0.95);
  return {
    score,
    semanticAlignment: genericFloor,
    continuity: Math.max(genericFloor, clamp(policy.identityFloor - 0.05, 0.65, 0.95)),
    artifactFree: genericFloor,
  };
}

function videoQualityThresholds(
  shot: ShotPlan,
  policy: ChannelVisualQualityPolicy,
): VideoQualityThresholds {
  const score = Math.max(shot.shotMinScore, policy.scoreFloor);
  const genericFloor = clamp(score - 0.12, 0.65, 0.95);
  return {
    score,
    semanticAlignment: genericFloor,
    continuity: Math.max(genericFloor, clamp(policy.identityFloor - 0.05, 0.65, 0.95)),
    motionIntegrity: genericFloor,
    artifactFree: genericFloor,
  };
}

function requireStoryInputs(store: Readonly<Record<string, unknown>>): {
  shots: ShotPlan[];
  specs: DpVisualSpec[];
  specsByShot: Map<string, DpVisualSpec>;
} {
  const shots = z.array(ShotPlanSchema).min(1).parse(store["shotList"]);
  const specs = z.array(DPVisualSpecSchema).min(1).parse(store["dpVisualSpecs"]);
  const specsByShot = new Map<string, DpVisualSpec>();
  for (const spec of specs) {
    if (specsByShot.has(spec.shotId)) throw new Error(`duplicate DP visual spec for ${spec.shotId}`);
    specsByShot.set(spec.shotId, spec);
  }
  const shotIds = new Set(shots.map((shot) => shot.id));
  const missing = shots.filter((shot) => !specsByShot.has(shot.id)).map((shot) => shot.id);
  const extra = specs.filter((spec) => !shotIds.has(spec.shotId)).map((spec) => spec.shotId);
  if (missing.length || extra.length) {
    throw new Error(`story render inputs are not one-to-one (missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"})`);
  }
  return { shots, specs, specsByShot };
}

function profileForShots(shots: ShotPlan[], requested: unknown): GenerationProfile {
  const requestedId = requested ?? shots[0]?.generationProfile;
  const profile = generationProfile(requestedId);
  const mismatched = shots.filter((shot) => shot.generationProfile !== profile.id).map((shot) => shot.id);
  if (mismatched.length) {
    throw new Error(`generation profile ${profile.id} conflicts with planned shots: ${mismatched.join(", ")}`);
  }
  return profile;
}

function generationIdentity(profile: GenerationProfile, phase: "image" | "video") {
  const settings = profile[phase];
  return {
    contractVersion: profile.contractVersion,
    profileId: profile.id,
    model: settings.model,
    revision: settings.revision,
    checkpoint: settings.checkpoint,
    precision: settings.precision,
    width: settings.width,
    height: settings.height,
    steps: settings.steps,
    allowFallback: false as const,
  };
}

function assertExactStillCandidates(shots: ShotPlan[], manifest: StillRenderManifest): void {
  const expectedIds = new Set(shots.map((shot) => shot.id));
  const seenOutputs = new Set<string>();
  const seenKeys = new Set<string>();
  for (const item of manifest.items) {
    if (!expectedIds.has(item.shotId)) throw new Error(`still manifest contains unknown shot ${item.shotId}`);
    if (seenOutputs.has(item.outputId)) throw new Error(`still manifest contains duplicate output ${item.outputId}`);
    if (seenKeys.has(item.stillKey)) throw new Error(`still manifest contains duplicate key ${item.stillKey}`);
    seenOutputs.add(item.outputId);
    seenKeys.add(item.stillKey);
  }
  for (const shot of shots) {
    const items = manifest.items
      .filter((item) => item.shotId === shot.id)
      .sort((a, b) => a.candidateIndex - b.candidateIndex);
    if (items.length !== shot.candidateCount) {
      throw new Error(`shot ${shot.id} expected ${shot.candidateCount} still candidate(s), received ${items.length}`);
    }
    items.forEach((item, index) => {
      if (item.candidateIndex !== index) {
        throw new Error(`shot ${shot.id} has non-contiguous candidate indexes`);
      }
    });
  }
}

function assertExactShotManifest(shots: ShotPlan[], manifest: ShotRenderManifest): void {
  if (manifest.items.length !== shots.length) {
    throw new Error(`shot render manifest expected ${shots.length} item(s), received ${manifest.items.length}`);
  }
  const seen = new Set<string>();
  for (let index = 0; index < shots.length; index++) {
    const shot = shots[index];
    const item = manifest.items[index];
    if (item.shotId !== shot.id) throw new Error(`shot render order mismatch at ${index}: ${item.shotId} !== ${shot.id}`);
    if (seen.has(item.shotId)) throw new Error(`shot render manifest duplicates ${item.shotId}`);
    seen.add(item.shotId);
    if (Math.abs(item.t0 - shot.t0) > EPSILON || Math.abs(item.t1 - shot.t1) > EPSILON) {
      throw new Error(`shot render timecode mismatch for ${shot.id}`);
    }
    if (item.sourceSentenceIds.join("\u0000") !== shot.sourceSentenceIds.join("\u0000")) {
      throw new Error(`shot render source lineage mismatch for ${shot.id}`);
    }
    if (item.continuityState !== shot.continuityState) {
      throw new Error(`shot render continuity mismatch for ${shot.id}`);
    }
    if (index === 0 && Math.abs(item.t0) > EPSILON) throw new Error("shot render coverage must begin at 0");
    if (index > 0 && Math.abs(item.t0 - manifest.items[index - 1].t1) > EPSILON) {
      throw new Error(`shot render coverage gap or overlap before ${shot.id}`);
    }
  }
  if (Math.abs(manifest.items.at(-1)!.t1 - manifest.durationSec) > EPSILON) {
    throw new Error("shot render coverage does not end at manifest duration");
  }
}

function imageScore(grade: z.infer<typeof AssetCandidateGradeSchema>): number {
  return Number((grade.semanticAlignment * 0.45 + grade.continuity * 0.3 + grade.artifactFree * 0.25).toFixed(4));
}

function videoScore(grade: z.infer<typeof ShotGradeSchema>): number {
  return Number((grade.semanticAlignment * 0.35 + grade.continuity * 0.25 + grade.motionIntegrity * 0.25 + grade.artifactFree * 0.15).toFixed(4));
}

export const novitaRenderImages: Block = {
  id: "novita_render_images",
  consumes: ["shotList", "dpVisualSpecs"],
  produces: ["stillKeys", "stillRenderManifest"],
  paid: true,
  run: async (ctx) => {
    const { shots, specsByShot } = requireStoryInputs(ctx.store);
    const profile = profileForShots(shots, ctx.params["generationProfile"]);
    const renderShots: Shot[] = shots.map((shot) => {
      const spec = specsByShot.get(shot.id)!;
      return {
        ...shot,
        prompt: spec.keyframePrompt,
        negative: spec.negativePrompt,
      };
    });
    const cfg: NovitaRenderCfg = {
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/novita`,
      shots: renderShots,
      profile: toNovitaPhaseProfile(profile, "image"),
      style: ctx.params["style"] as string | undefined,
      negative: ctx.params["negative"] as string | undefined,
      director: ctx.params["director"] as string | undefined,
      nshard: ctx.params["nshard"] as number | undefined,
      jobs: ctx.params["jobs"] as "val" | "full" | undefined,
      maxConcurrent: ctx.params["maxConcurrent"] as number | undefined,
      // The direct fleet additionally intersects this with its immutable
      // per-worker and account-wide caps before any paid provider create.
      maxCostUsd: ctx.budgetUsd,
      lifecycle: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        blockId: "novita_render_images",
      },
    };
    const result = await renderImages(cfg);
    if (!result.candidates?.length) throw new Error("novita_render_images returned no exact candidate mapping");
    const stillRenderManifest = StillRenderManifestSchema.parse({
      version: "1.0.0",
      generation: generationIdentity(profile, "image"),
      items: result.candidates.map((candidate) => ({
        shotId: candidate.shotId,
        candidateIndex: candidate.candidateIndex,
        outputId: candidate.outputId,
        stillKey: candidate.key,
      })),
    });
    assertExactStillCandidates(shots, stillRenderManifest);
    ctx.log(`novita_render_images: ${result.outputs} pinned still candidate(s) in ${result.durationSec}s`);
    return {
      stillKeys: stillRenderManifest.items.map((item) => item.stillKey),
      stillRenderManifest,
      [COST_PATCH_KEY]: result.costUsd,
    };
  },
};

export const qaAssets: Block = {
  id: "qa_assets",
  consumes: ["shotList", "dpVisualSpecs", "stillRenderManifest"],
  produces: ["selectedStillManifest", "assetQaReport"],
  paid: true,
  run: async (ctx) => {
    const { shots, specsByShot } = requireStoryInputs(ctx.store);
    const channelQuality = resolveChannelVisualQualityPolicy(ctx.store);
    const manifest = StillRenderManifestSchema.parse(ctx.store["stillRenderManifest"]);
    assertExactStillCandidates(shots, manifest);
    const profile = profileForShots(shots, manifest.generation.profileId);
    const tmp = await makeRunTempDir(`${ctx.runId}_asset_qa`);
    const selected: SelectedStillManifest["items"] = [];
    let repairRenderCostUsd = 0;
    let graderCalls = 0;
    let repairCandidateCount = 0;
    ctx.log(
      `qa_assets: automatic channel policy score>=${channelQuality.scoreFloor.toFixed(3)} ` +
        `identity>=${channelQuality.identityFloor.toFixed(3)}`,
    );

    try {
      for (const shot of shots) {
        const thresholds = imageQualityThresholds(shot, channelQuality);
        const spec = specsByShot.get(shot.id)!;
        let candidates = manifest.items
          .filter((item) => item.shotId === shot.id)
          .sort((a, b) => a.candidateIndex - b.candidateIndex);
        let repairAttempts = 0;

        while (true) {
          const paths: string[] = [];
          for (const candidate of candidates) {
            const path = join(tmp, `${candidate.outputId.replace(/[^a-z0-9_-]/gi, "_")}.png`);
            await writeBytes(path, await getObjectBytes(candidate.stillKey));
            paths.push(path);
          }
          graderCalls++;
          const raw = await visionLocal({
            prompt:
              `You are the REQUIRED keyframe grader for one authored documentary shot. ` +
              `Images are candidateIndex ${candidates.map((candidate) => candidate.candidateIndex).join(", ")} in that exact order.\n` +
              `Literal story content: ${shot.literalContent}\nStory purpose: ${shot.coveragePurpose}\n` +
              `Required keyframe: ${spec.keyframePrompt}\nContinuity lock: ${spec.continuityState}\n` +
              `First-frame constraint: ${spec.firstFrameConstraint}\nNegative constraints: ${spec.negativePrompt}\n` +
              `Channel-adaptive visual identity policy (MANDATORY):\n${channelQuality.brief}\n` +
              `Required pass thresholds: overall >= ${thresholds.score.toFixed(3)}, semantic >= ${thresholds.semanticAlignment.toFixed(3)}, ` +
              `continuity >= ${thresholds.continuity.toFixed(3)}, artifact-free >= ${thresholds.artifactFree.toFixed(3)}.\n` +
              `Score EACH image independently from 0 to 1. semanticAlignment means literal subject/action/location match, ` +
              `continuity means identity/era/wardrobe/props/lighting/style consistency, artifactFree means anatomy, text, ` +
              `watermark, geometry, framing and image integrity. Do not reward generic beauty over literal accuracy. ` +
              `Return STRICT JSON only: {"candidates":[{"candidateIndex":0,"semanticAlignment":0.0,"continuity":0.0,` +
              `"artifactFree":0.0,"notes":["concrete observations"]}]}. Include every candidate exactly once.`,
            imagePaths: paths,
            json: true,
            maxTokens: 1200,
          });
          const graded = AssetCandidateSetGradeSchema.parse(parseJsonLoose(raw));
          const byIndex = new Map(graded.candidates.map((grade) => [grade.candidateIndex, grade]));
          if (byIndex.size !== candidates.length || candidates.some((candidate) => !byIndex.has(candidate.candidateIndex))) {
            throw new Error(`qa_assets grader did not return an exact candidate set for ${shot.id}`);
          }
          const ranked = candidates.map((candidate) => {
            const grade = byIndex.get(candidate.candidateIndex)!;
            return { candidate, grade, score: imageScore(grade) };
          }).sort((a, b) => b.score - a.score || a.candidate.candidateIndex - b.candidate.candidateIndex);
          const best = ranked[0];
          const passed =
            best.score >= thresholds.score &&
            best.grade.semanticAlignment >= thresholds.semanticAlignment &&
            best.grade.continuity >= thresholds.continuity &&
            best.grade.artifactFree >= thresholds.artifactFree;
          if (passed) {
            selected.push({
              shotId: shot.id,
              stillKey: best.candidate.stillKey,
              candidateIndex: best.candidate.candidateIndex,
              score: best.score,
              semanticAlignment: best.grade.semanticAlignment,
              continuity: best.grade.continuity,
              artifactFree: best.grade.artifactFree,
              notes: best.grade.notes,
            });
            ctx.log(
              `qa_assets: ${shot.id} selected c${best.candidate.candidateIndex} @ ${best.score.toFixed(3)} ` +
                `after ${repairAttempts} automatic repair(s)`,
            );
            break;
          }
          const failure =
            `qa_assets FAILED ${shot.id}: best=${best.score.toFixed(3)} threshold=${thresholds.score.toFixed(3)} ` +
            `(semantic=${best.grade.semanticAlignment}, continuity=${best.grade.continuity}, artifact=${best.grade.artifactFree})`;
          const attempt = repairAttempts + 1;
          if (!canAttemptCinematicQualityRepair(attempt)) {
            throw qualityRecoveryFailure(
              `${failure}; automatic quality recovery exhausted after ${MAX_CINEMATIC_QUALITY_REPAIR_ATTEMPTS} targeted repair attempt(s)`,
              { repairRenderCostUsd, graderCalls },
            );
          }
          const repair = planCinematicQualityRepair({
            phase: "image",
            shot,
            spec,
            policy: channelQuality,
            notes: best.grade.notes,
            attempt,
          });
          ctx.log(`qa_assets: ${shot.id} failed QA; regenerating deterministic repair ${attempt}/${MAX_CINEMATIC_QUALITY_REPAIR_ATTEMPTS}`);
          let rendered;
          try {
            rendered = await renderImages(qualityRecoveryRenderCfg(ctx, "image", profile, repair.shot));
          } catch (error) {
            throw qualityRecoveryFailure(`${failure}; automatic image repair dispatch failed`, {
              repairRenderCostUsd,
              graderCalls,
              cause: error,
            });
          }
          repairRenderCostUsd += rendered.costUsd;
          const renderedCandidate = rendered.candidates?.[0];
          if (
            rendered.candidates?.length !== 1 ||
            !renderedCandidate ||
            renderedCandidate.shotId !== repair.repairId ||
            renderedCandidate.candidateIndex !== 0
          ) {
            throw qualityRecoveryFailure(`${failure}; automatic image repair returned an invalid candidate mapping`, {
              repairRenderCostUsd,
              graderCalls,
            });
          }
          candidates = [{
            shotId: shot.id,
            candidateIndex: shot.candidateCount + repairAttempts,
            outputId: renderedCandidate.outputId,
            stillKey: renderedCandidate.key,
          }];
          repairAttempts = attempt;
          repairCandidateCount++;
        }
      }
    } catch (error) {
      if ((error as { retryable?: unknown })?.retryable === false) throw error;
      if (repairRenderCostUsd > 0) {
        throw qualityRecoveryFailure("qa_assets failed after accepted automatic quality-recovery work", {
          repairRenderCostUsd,
          graderCalls,
          cause: error,
        });
      }
      throw error;
    }

    const selectedStillManifest = SelectedStillManifestSchema.parse({
      version: "1.0.0",
      generation: manifest.generation,
      items: selected,
    });
    const assetQaReport = AssetQaReportSchema.parse({
      version: "1.0.0",
      required: true,
      graderRan: true,
      passed: true,
      shotCount: shots.length,
      candidateCount: manifest.items.length + repairCandidateCount,
      selected: selected.map((item) => ({
        shotId: item.shotId,
        candidateIndex: item.candidateIndex,
        score: item.score,
        threshold: imageQualityThresholds(
          shots.find((shot) => shot.id === item.shotId)!,
          channelQuality,
        ).score,
      })),
    });
    return {
      selectedStillManifest,
      assetQaReport,
      [COST_PATCH_KEY]: repairRenderCostUsd + graderCalls * PRICE.visionGraderUsd,
    };
  },
};

export const novitaRenderVideo: Block = {
  id: "novita_render_video",
  consumes: ["shotList", "dpVisualSpecs", "selectedStillManifest"],
  produces: ["shotRenderManifest"],
  paid: true,
  run: async (ctx) => {
    const { shots, specsByShot } = requireStoryInputs(ctx.store);
    const selected = SelectedStillManifestSchema.parse(ctx.store["selectedStillManifest"]);
    const profile = profileForShots(shots, ctx.params["generationProfile"] ?? selected.generation.profileId);
    if (selected.generation.profileId !== profile.id) throw new Error("selected still profile does not match video profile");
    if (selected.items.length !== shots.length || new Set(selected.items.map((item) => item.shotId)).size !== shots.length) {
      throw new Error("selected still manifest is not one-to-one with the shot plan");
    }
    const selectedByShot = new Map(selected.items.map((item) => [item.shotId, item]));
    const shotsWithStills: Shot[] = shots.map((shot) => {
      const selectedStill = selectedByShot.get(shot.id);
      if (!selectedStill) throw new Error(`selected still missing for ${shot.id}`);
      const spec = specsByShot.get(shot.id)!;
      return {
        ...shot,
        stillKey: selectedStill.stillKey,
        prompt: spec.motionPrompt,
        motion: `${spec.motionPrompt} First frame: ${spec.firstFrameConstraint}. Last frame: ${spec.lastFrameConstraint}.`,
        negative: spec.negativePrompt,
      };
    });
    const cfg: NovitaRenderCfg = {
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/novita`,
      shots: shotsWithStills,
      profile: toNovitaPhaseProfile(profile, "video"),
      negative: ctx.params["negative"] as string | undefined,
      nshard: ctx.params["nshard"] as number | undefined,
      jobs: ctx.params["jobs"] as "val" | "full" | undefined,
      maxConcurrent: ctx.params["maxConcurrent"] as number | undefined,
      maxCostUsd: ctx.budgetUsd,
      lifecycle: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        blockId: "novita_render_video",
      },
    };
    const result = await renderVideo(cfg);
    if (!result.candidates?.length) throw new Error("novita_render_video returned no exact shot mapping");
    const candidateByShot = new Map(result.candidates.map((candidate) => [candidate.shotId, candidate]));
    if (candidateByShot.size !== shots.length) throw new Error("novita_render_video returned duplicate or missing shot mappings");
    const durationSec = shots.at(-1)!.t1;
    const shotRenderManifest = ShotRenderManifestSchema.parse({
      version: "1.0.0",
      generation: {
        ...generationIdentity(profile, "video"),
        fps: profile.video.fps,
        guidanceScale: profile.video.guidanceScale,
        twoStageRefine: profile.video.twoStageRefine,
      },
      durationSec,
      items: shots.map((shot) => {
        const candidate = candidateByShot.get(shot.id);
        if (!candidate) throw new Error(`novita_render_video omitted ${shot.id}`);
        return {
          shotId: shot.id,
          clipKey: candidate.key,
          t0: shot.t0,
          t1: shot.t1,
          sourceSentenceIds: shot.sourceSentenceIds,
          continuityState: shot.continuityState,
        };
      }),
    });
    assertExactShotManifest(shots, shotRenderManifest);
    ctx.log(`novita_render_video: ${result.outputs} pinned story clip(s) in ${result.durationSec}s`);
    return {
      shotRenderManifest,
      [COST_PATCH_KEY]: result.costUsd,
    };
  },
};

export const qaShots: Block = {
  id: "qa_shots",
  consumes: ["shotList", "dpVisualSpecs", "selectedStillManifest", "shotRenderManifest"],
  produces: ["footageClips", "footageKeys", "shotQaReport", "visualCoverage"],
  paid: true,
  run: async (ctx) => {
    const { shots, specsByShot } = requireStoryInputs(ctx.store);
    const channelQuality = resolveChannelVisualQualityPolicy(ctx.store);
    const manifest = ShotRenderManifestSchema.parse(ctx.store["shotRenderManifest"]);
    assertExactShotManifest(shots, manifest);
    const profile = profileForShots(shots, manifest.generation.profileId);
    const selectedStills = SelectedStillManifestSchema.parse(ctx.store["selectedStillManifest"]);
    if (selectedStills.generation.profileId !== profile.id) {
      throw new Error("qa_shots selected still profile does not match the pinned video profile");
    }
    const selectedByShot = new Map(selectedStills.items.map((item) => [item.shotId, item]));
    if (
      selectedStills.items.length !== shots.length ||
      selectedByShot.size !== shots.length ||
      shots.some((shot) => !selectedByShot.has(shot.id))
    ) {
      throw new Error("qa_shots requires one quality-selected still for every rendered shot");
    }
    const tmp = await makeRunTempDir(`${ctx.runId}_shot_qa`);
    const localClips: string[] = [];
    const footageKeys: string[] = [];
    const grades: Array<z.infer<typeof ShotGradeSchema> & { shotId: string; score: number; threshold: number }> = [];
    let repairRenderCostUsd = 0;
    let graderCalls = 0;
    ctx.log(
      `qa_shots: automatic channel policy score>=${channelQuality.scoreFloor.toFixed(3)} ` +
        `identity>=${channelQuality.identityFloor.toFixed(3)}`,
    );

    try {
      for (const [index, shot] of shots.entries()) {
        const thresholds = videoQualityThresholds(shot, channelQuality);
        const item = manifest.items[index];
        const spec = specsByShot.get(shot.id)!;
        const selectedStill = selectedByShot.get(shot.id)!;
        let clipKey = item.clipKey;
        let repairAttempts = 0;

        while (true) {
          const suffix = repairAttempts ? `_r${String(repairAttempts).padStart(2, "0")}` : "";
          const local = join(tmp, `${shot.id}${suffix}.mp4`);
          await writeBytes(local, await getObjectBytes(clipKey));
          const media = await probe(local);
          let grade: z.infer<typeof ShotGradeSchema> | undefined;
          let score = 0;
          let failure: string | undefined;
          let repairNotes: string[] = [];

          if (!media.hasVideo) {
            failure = `qa_shots FAILED ${shot.id}: rendered asset has no video stream`;
            repairNotes = ["The rendered output has no usable video stream."];
          } else if (media.width !== profile.video.width || media.height !== profile.video.height) {
            failure = `qa_shots FAILED ${shot.id}: ${media.width}x${media.height} != pinned ${profile.video.width}x${profile.video.height}`;
            repairNotes = ["The clip dimensions do not match the pinned production profile."];
          } else {
            const expectedMediaSec = secondsToFrames(shot.seconds, profile.video.fps) / profile.video.fps;
            if (!Number.isFinite(media.durationSec) || Math.abs(media.durationSec - expectedMediaSec) > Math.max(0.2, 3 / profile.video.fps)) {
              failure =
                `qa_shots FAILED ${shot.id}: media duration ${media.durationSec.toFixed(3)}s != expected ${expectedMediaSec.toFixed(3)}s`;
              repairNotes = ["The clip duration does not match the authored shot duration."];
            } else {
              const sampleTimes = [
                Math.min(0.08, Math.max(0, media.durationSec / 10)),
                media.durationSec * 0.5,
                Math.max(0, media.durationSec - Math.max(0.08, 2 / profile.video.fps)),
              ];
              const frames: string[] = [];
              for (let frameIndex = 0; frameIndex < sampleTimes.length; frameIndex++) {
                const frame = join(tmp, `${shot.id}${suffix}_f${frameIndex}.jpg`);
                await grabFrame(local, sampleTimes[frameIndex], frame);
                frames.push(frame);
              }
              if (frames.length !== 3) throw new Error(`qa_shots FAILED ${shot.id}: could not extract start/middle/end frames`);
              graderCalls++;
              const raw = await visionLocal({
                prompt:
                  `You are the REQUIRED final grader for one generated documentary shot. The three images are the START, ` +
                  `MIDDLE, and END frames in chronological order.\nLiteral story content: ${shot.literalContent}\n` +
                  `Story purpose: ${shot.coveragePurpose}\nRequired motion: ${spec.motionPrompt}\n` +
                  `First-frame constraint: ${spec.firstFrameConstraint}\nLast-frame constraint: ${spec.lastFrameConstraint}\n` +
                  `Continuity lock: ${spec.continuityState}\nNegative constraints: ${spec.negativePrompt}\n` +
                  `Channel-adaptive visual identity policy (MANDATORY):\n${channelQuality.brief}\n` +
                  `Required pass thresholds: overall >= ${thresholds.score.toFixed(3)}, semantic >= ${thresholds.semanticAlignment.toFixed(3)}, ` +
                  `continuity >= ${thresholds.continuity.toFixed(3)}, motion >= ${thresholds.motionIntegrity.toFixed(3)}, ` +
                  `artifact-free >= ${thresholds.artifactFree.toFixed(3)}.\n` +
                  `Score 0..1: semanticAlignment (literal story match in all frames), continuity (identity/era/wardrobe/props/` +
                  `lighting remain coherent), motionIntegrity (the ordered frames demonstrate the requested action/camera move ` +
                  `without freezing or direction errors), artifactFree (no warping, morphing, duplicate limbs, text, watermark, ` +
                  `broken geometry, or temporal corruption). Return STRICT JSON only: {"semanticAlignment":0.0,` +
                  `"continuity":0.0,"motionIntegrity":0.0,"artifactFree":0.0,"notes":["concrete observations"]}.`,
                imagePaths: frames,
                json: true,
                maxTokens: 700,
              });
              grade = ShotGradeSchema.parse(parseJsonLoose(raw));
              score = videoScore(grade);
              const passed =
                score >= thresholds.score &&
                grade.semanticAlignment >= thresholds.semanticAlignment &&
                grade.continuity >= thresholds.continuity &&
                grade.motionIntegrity >= thresholds.motionIntegrity &&
                grade.artifactFree >= thresholds.artifactFree;
              if (!passed) {
                failure =
                  `qa_shots FAILED ${shot.id}: score=${score.toFixed(3)} threshold=${thresholds.score.toFixed(3)} ` +
                  `(semantic=${grade.semanticAlignment}, continuity=${grade.continuity}, motion=${grade.motionIntegrity}, artifact=${grade.artifactFree})`;
                repairNotes = grade.notes;
              }
            }
          }

          if (!failure && grade) {
            localClips.push(local);
            footageKeys.push(clipKey);
            grades.push({ ...grade, shotId: shot.id, score, threshold: thresholds.score });
            ctx.log(`qa_shots: ${shot.id} passed @ ${score.toFixed(3)} after ${repairAttempts} automatic repair(s)`);
            break;
          }
          const attempt = repairAttempts + 1;
          if (!canAttemptCinematicQualityRepair(attempt)) {
            throw qualityRecoveryFailure(
              `${failure ?? `qa_shots FAILED ${shot.id}`}; automatic quality recovery exhausted after ${MAX_CINEMATIC_QUALITY_REPAIR_ATTEMPTS} targeted repair attempt(s)`,
              { repairRenderCostUsd, graderCalls },
            );
          }
          const repair = planCinematicQualityRepair({
            phase: "video",
            shot,
            spec,
            policy: channelQuality,
            notes: repairNotes,
            attempt,
            stillKey: selectedStill.stillKey,
          });
          ctx.log(`qa_shots: ${shot.id} failed QA; regenerating deterministic repair ${attempt}/${MAX_CINEMATIC_QUALITY_REPAIR_ATTEMPTS}`);
          let rendered;
          try {
            rendered = await renderVideo(qualityRecoveryRenderCfg(ctx, "video", profile, repair.shot));
          } catch (error) {
            throw qualityRecoveryFailure(`${failure ?? `qa_shots FAILED ${shot.id}`}; automatic video repair dispatch failed`, {
              repairRenderCostUsd,
              graderCalls,
              cause: error,
            });
          }
          repairRenderCostUsd += rendered.costUsd;
          const renderedCandidate = rendered.candidates?.[0];
          if (
            rendered.candidates?.length !== 1 ||
            !renderedCandidate ||
            renderedCandidate.shotId !== repair.repairId ||
            renderedCandidate.candidateIndex !== 0
          ) {
            throw qualityRecoveryFailure(`${failure ?? `qa_shots FAILED ${shot.id}`}; automatic video repair returned an invalid shot mapping`, {
              repairRenderCostUsd,
              graderCalls,
            });
          }
          clipKey = renderedCandidate.key;
          repairAttempts = attempt;
        }
      }
    } catch (error) {
      if ((error as { retryable?: unknown })?.retryable === false) throw error;
      if (repairRenderCostUsd > 0) {
        throw qualityRecoveryFailure("qa_shots failed after accepted automatic quality-recovery work", {
          repairRenderCostUsd,
          graderCalls,
          cause: error,
        });
      }
      throw error;
    }

    const mappedSec = manifest.items.reduce((sum, item) => sum + (item.t1 - item.t0), 0);
    const visualCoverage = VisualCoverageSchema.parse({
      version: "1.0.0",
      mappedSec: manifest.durationSec,
      totalSec: manifest.durationSec,
      ratio: 1,
      missingShotIds: [],
      duplicateShotIds: [],
    });
    if (Math.abs(mappedSec - manifest.durationSec) > EPSILON) {
      throw new Error(`qa_shots coverage mismatch: mapped=${mappedSec}, total=${manifest.durationSec}`);
    }
    const shotQaReport = ShotQaReportSchema.parse({
      version: "1.0.0",
      required: true,
      graderRan: true,
      passed: true,
      shots: grades,
    });
    return {
      footageClips: localClips,
      footageKeys,
      shotQaReport,
      visualCoverage,
      [COST_PATCH_KEY]: repairRenderCostUsd + graderCalls * PRICE.visionGraderUsd,
    };
  },
};

export const novitaRenderBlocks: Block[] = [novitaRenderImages, qaAssets, novitaRenderVideo, qaShots];
