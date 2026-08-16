import { createHash } from "node:crypto";
import { generationProfile, type GenerationProfile } from "@/engine/generationProfiles";
import {
  renderImages,
  renderVideo,
  toNovitaPhaseProfile,
  type NovitaRenderResult,
  type NovitaBillingReceipt,
  type NovitaRuntimeAttestation,
  type NovitaRenderCfg,
  type Shot,
} from "@/lib/novitaRenderFarm";
import { recordImageUsage } from "@/lib/imageUsage";
import { getObjectBytes, presignDownload, putObject } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { assertNovitaVideoProfileRuntime } from "@/engine/runtimeCapability";
import { novitaCostEnvelope } from "@/lib/novitaCostEnvelope";
import type { CinematicKeyframeReview } from "@/engine/cinematicKeyframeReview";
import type { CinematicClipReview } from "@/engine/cinematicClipReview";
import { CinematicKeyframeRejectedError } from "@/lib/cinematicKeyframeGate";
import type { LtxCreativeAdapterSelection } from "@/lib/ltxCreativeAdapter";

export type NovitaProfileId = GenerationProfile["id"];
/**
 * Durable identity for a billable direct-Novita worker. Pipeline callers pass
 * their real StageContext identity; callers without an active run intentionally
 * remain unable to acquire a GPU.
 */
export type NovitaRenderLifecycle = NonNullable<NovitaRenderCfg["lifecycle"]>;

export interface NovitaGeneratedScene {
  id: string;
  imagePrompt: string;
  /** Optional reviewed target image prompt for LTX's final conditioned frame. */
  terminalImagePrompt?: string;
  motionPrompt: string;
  /** Diegetic-only sound direction passed to the shared LTX I2V contract. */
  diegeticSoundscape?: string;
  durationSec: number;
  negativePrompt?: string;
  seed?: number;
  cameraMove?: Shot["cameraMove"];
  shotScale?: Shot["shotScale"];
  lens?: string;
  /** Stable mannequin identities that must remain visually continuous. */
  continuityIds?: string[];
  /** Reviewer-facing source/camera/cut obligations for this exact first frame. */
  keyframeRequirements?: string[];
  /** Reviewer-facing endpoint obligations for a terminal conditioned frame. */
  terminalKeyframeRequirements?: string[];
  /** Applied only to the LTX phase after exact worker-manifest admission. */
  creativeAdapter?: LtxCreativeAdapterSelection;
}

export interface NovitaRenderedScene extends NovitaGeneratedScene {
  stillKey: string;
  stillUrl: string;
  /** Present only when the scene was admitted with a terminal LTX keyframe. */
  terminalStillKey?: string;
  terminalStillUrl?: string;
  clipKey: string;
  clipUrl: string;
  keyframeReview?: CinematicKeyframeReview;
  terminalKeyframeReview?: CinematicKeyframeReview;
  /** Independent review of the actual LTX moving take before assembly. */
  clipReview?: CinematicClipReview;
}

export interface NovitaKeyframeGate {
  /** One controlled replacement still is enough to avoid duplicate spend loops. */
  maxImageAttempts?: 1 | 2;
  review(input: {
    scene: NovitaGeneratedScene;
    stillKey: string;
    stillUrl: string;
  }): Promise<CinematicKeyframeReview>;
}

export interface NovitaClipGate {
  /** One controlled replacement take is enough to avoid duplicate spend loops. */
  maxVideoAttempts?: 1 | 2;
  review(input: {
    scene: NovitaGeneratedScene;
    stillKey: string;
    stillUrl: string;
    terminalStillKey?: string;
    terminalStillUrl?: string;
    clipKey: string;
    clipUrl: string;
  }): Promise<CinematicClipReview>;
}

export interface NovitaImageProviderReceipt {
  key: string;
  jobId: string;
  model: string;
  profileId: NovitaProfileId;
  width: number;
  height: number;
  costUsd: number;
  billingReceipt: NovitaBillingReceipt;
  runtimeAttestation: NovitaRuntimeAttestation;
  profileSha256: string;
  manifestSha256: string;
  requestSha256: string;
  requestCanonicalJson: string;
  billingReceiptSha256: string;
}

export interface NovitaRenderedImage extends NovitaImageProviderReceipt {
  url: string;
}

export interface NovitaImageByteRequest {
  prefix: string;
  id: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  profileId?: NovitaProfileId;
  /** Signed ceiling for this direct image worker. */
  maxCostUsd: number;
  lifecycle?: NovitaRenderLifecycle;
  /** Runs after all local work but immediately before the paid bridge launch. */
  beforeProviderSpend?: () => void | Promise<void>;
  /** Runs after a validated paid provider result and before presign/download. */
  onProviderReceipt?: (receipt: NovitaImageProviderReceipt) => void | Promise<void>;
}

export interface AttestedNovitaImageBytes extends NovitaRenderedImage {
  bytes: Buffer;
}

export type NovitaImageReceiptObserver = (receipt: NovitaRenderedImage) => void;
export type NovitaImageProviderReceiptObserver = (
  receipt: NovitaImageProviderReceipt,
) => void | Promise<void>;

type RenderNovitaImageFn = (args: {
  prefix: string;
  id: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  profileId?: NovitaProfileId;
  maxCostUsd: number;
  lifecycle?: NovitaRenderLifecycle;
  beforeProviderSpend?: () => void | Promise<void>;
  onProviderReceipt?: NovitaImageProviderReceiptObserver;
}) => Promise<NovitaRenderedImage>;

type DownloadNovitaImageFn = (key: string) => Promise<Uint8Array>;

export interface NovitaPromptImageRequest {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
}

function safeId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
  if (!normalized) throw new Error("novita media scene id must contain a safe character");
  return normalized;
}

function terminalKeyframeId(sceneId: string): string {
  return `${safeId(sceneId)}-terminal`;
}

function cleanPrefix(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function asShot(
  scene: NovitaGeneratedScene,
  profileId: NovitaProfileId,
  stillKey?: string,
  endStillKey?: string,
): Shot {
  return {
    id: safeId(scene.id),
    prompt: scene.imagePrompt,
    motion: scene.motionPrompt,
    diegeticSoundscape: scene.diegeticSoundscape,
    seconds: scene.durationSec,
    cameraMove: scene.cameraMove ?? "static",
    shotScale: scene.shotScale ?? "medium",
    lens: scene.lens ?? "35mm",
    negative: scene.negativePrompt,
    seed: scene.seed,
    generationProfile: profileId,
    ...(scene.creativeAdapter ? { creativeAdapter: scene.creativeAdapter } : {}),
    ...(stillKey ? { stillKey } : {}),
    ...(endStillKey ? { endStillKey } : {}),
  };
}

/**
 * LTX 2.5 distilled has no negative-prompt switch. Keep the director's
 * exclusions by expressing them as an explicit positive-language constraint,
 * instead of silently dropping them or sending an unsupported CLI flag.
 */
function asLtxDistilledVideoShot(
  scene: NovitaGeneratedScene,
  profileId: NovitaProfileId,
  stillKey: string,
  endStillKey?: string,
): Shot {
  const shot = asShot(scene, profileId, stillKey);
  const exclusion = scene.negativePrompt?.trim();
  if (!exclusion) return { ...shot, negative: undefined, ...(endStillKey ? { endStillKey } : {}) };
  const constraint = `Avoid all of the following: ${exclusion}.`;
  return {
    ...shot,
    prompt: `${shot.prompt}\n\n${constraint}`,
    motion: `${shot.motion}\n\n${constraint}`,
    negative: undefined,
    ...(endStillKey ? { endStillKey } : {}),
  };
}

function keyframeRetrySeed(seed: number | undefined, attempt: number): number {
  const base = Number.isFinite(seed) ? Math.floor(seed!) : 4_242;
  return Math.abs((base + attempt * 104_729) % 2_147_483_647);
}

function clipRetrySeed(seed: number | undefined, attempt: number): number {
  const base = Number.isFinite(seed) ? Math.floor(seed!) : 8_686;
  return Math.abs((base + attempt * 154_858_63) % 2_147_483_647);
}

function imageSpendError(error: unknown, costUsd: number): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  const target = Object.isExtensible(source)
    ? source
    : Object.assign(new Error(source.message), { cause: source });
  const prior = (target as { additionalObservedCostUsd?: unknown }).additionalObservedCostUsd;
  const priorCost = typeof prior === "number" && Number.isFinite(prior) && prior > 0 ? prior : 0;
  return Object.assign(target, {
    additionalObservedCostUsd: priorCost + costUsd,
    retryable: false,
  });
}

/**
 * Selects source stills before LTX spends. A keyframe review may buy exactly
 * one replacement image; it can never loop indefinitely or render video from
 * a reviewer-rejected still. Kept injectable so the recovery contract has a
 * real provider-free test rather than a static source assertion.
 */
export async function reviewKeyframesBeforeVideo(args: {
  scenes: readonly NovitaGeneratedScene[];
  stillByShot: ReadonlyMap<string, string>;
  maxImageAttempts: number;
  imageCostUsd: number;
  imageMaxCostUsd: number;
  imageReceipts: readonly NovitaBillingReceipt[];
  review: (input: { scene: NovitaGeneratedScene; stillKey: string }) => Promise<CinematicKeyframeReview>;
  renderReplacement: (input: {
    scene: NovitaGeneratedScene;
    repairId: string;
    attempt: number;
    prompt: string;
    seed: number;
    remainingCostUsd: number;
  }) => Promise<{ stillKey: string; costUsd: number; billingReceipt: NovitaBillingReceipt }>;
}): Promise<{
  stillByShot: Map<string, string>;
  keyframeReviewByShot: Map<string, CinematicKeyframeReview>;
  imageCostUsd: number;
  imageReceipts: NovitaBillingReceipt[];
}> {
  const stillByShot = new Map(args.stillByShot);
  const keyframeReviewByShot = new Map<string, CinematicKeyframeReview>();
  const imageReceipts = [...args.imageReceipts];
  let observedImageCostUsd = args.imageCostUsd;
  for (const scene of args.scenes) {
    const id = safeId(scene.id);
    let attempt = 1;
    for (;;) {
      const stillKey = stillByShot.get(id);
      if (!stillKey) throw new Error(`novita keyframe gate is missing the initial still for ${id}`);
      try {
        const review = await args.review({ scene, stillKey });
        keyframeReviewByShot.set(id, review);
        break;
      } catch (reviewError) {
        // A replacement image is an evidence-led repair, not a fallback for a
        // reviewer outage, a malformed receipt, or another infrastructure
        // fault. Only the typed pixel-review rejection from the independent
        // keyframe gate is allowed to consume the one repair attempt.
        if (!(reviewError instanceof CinematicKeyframeRejectedError)) {
          throw reviewError;
        }
        if (attempt >= args.maxImageAttempts) throw reviewError;
        const remainingCostUsd = args.imageMaxCostUsd - observedImageCostUsd;
        if (remainingCostUsd <= 0) {
          throw new Error(`novita keyframe retry has no admitted image budget remaining for ${id}`);
        }
        const repairId = `${id}-keyframe-retry-${attempt + 1}`;
        const reason = reviewError instanceof Error ? reviewError.message.slice(0, 420) : String(reviewError).slice(0, 420);
        const replacement = await args.renderReplacement({
          scene,
          repairId,
          attempt: attempt + 1,
          prompt: `${scene.imagePrompt}\n\nIndependent keyframe correction ${attempt + 1}/${args.maxImageAttempts}: preserve every literal mannequin, wardrobe, prop, setting, camera, and no-text lock. Resolve this reviewer finding: ${reason}`,
          seed: keyframeRetrySeed(scene.seed, attempt),
          remainingCostUsd,
        });
        observedImageCostUsd += replacement.costUsd;
        imageReceipts.push(replacement.billingReceipt);
        stillByShot.set(id, replacement.stillKey);
        attempt += 1;
      }
    }
  }
  return { stillByShot, keyframeReviewByShot, imageCostUsd: observedImageCostUsd, imageReceipts };
}

/**
 * Review actual LTX clips before they become an ordered editing manifest. A
 * rejected take receives one repair using the already accepted source still;
 * a second failure is surfaced rather than hidden by repeated paid renders.
 */
export async function reviewClipsBeforeAssembly(args: {
  scenes: readonly NovitaGeneratedScene[];
  stillByShot: ReadonlyMap<string, string>;
  terminalStillByShot?: ReadonlyMap<string, string>;
  clipByShot: ReadonlyMap<string, string>;
  maxVideoAttempts: number;
  videoCostUsd: number;
  videoMaxCostUsd: number;
  videoReceipts: readonly NovitaBillingReceipt[];
  review: (input: { scene: NovitaGeneratedScene; stillKey: string; terminalStillKey?: string; clipKey: string }) => Promise<CinematicClipReview>;
  renderReplacement: (input: {
    scene: NovitaGeneratedScene;
    stillKey: string;
    terminalStillKey?: string;
    repairId: string;
    attempt: number;
    motionPrompt: string;
    seed: number;
    remainingCostUsd: number;
  }) => Promise<{ clipKey: string; costUsd: number; billingReceipt: NovitaBillingReceipt }>;
}): Promise<{
  clipByShot: Map<string, string>;
  clipReviewByShot: Map<string, CinematicClipReview>;
  videoCostUsd: number;
  videoReceipts: NovitaBillingReceipt[];
}> {
  const clipByShot = new Map(args.clipByShot);
  const clipReviewByShot = new Map<string, CinematicClipReview>();
  const videoReceipts = [...args.videoReceipts];
  let observedVideoCostUsd = args.videoCostUsd;
  for (const scene of args.scenes) {
    const id = safeId(scene.id);
    const stillKey = args.stillByShot.get(id);
    if (!stillKey) throw new Error(`novita clip gate is missing the accepted still for ${id}`);
    const terminalStillKey = args.terminalStillByShot?.get(id);
    let attempt = 1;
    for (;;) {
      const clipKey = clipByShot.get(id);
      if (!clipKey) throw new Error(`novita clip gate is missing the initial LTX clip for ${id}`);
      try {
        const review = await args.review({ scene, stillKey, terminalStillKey, clipKey });
        clipReviewByShot.set(id, review);
        break;
      } catch (reviewError) {
        if (attempt >= args.maxVideoAttempts) throw reviewError;
        const remainingCostUsd = args.videoMaxCostUsd - observedVideoCostUsd;
        if (remainingCostUsd <= 0) {
          throw new Error(`novita clip retry has no admitted video budget remaining for ${id}`);
        }
        const repairId = `${id}-motion-retry-${attempt + 1}`;
        const reason = reviewError instanceof Error ? reviewError.message.slice(0, 420) : String(reviewError).slice(0, 420);
        const replacement = await args.renderReplacement({
          scene,
          stillKey,
          ...(terminalStillKey ? { terminalStillKey } : {}),
          repairId,
          attempt: attempt + 1,
          motionPrompt: `${scene.motionPrompt}\n\nIndependent motion correction ${attempt + 1}/${args.maxVideoAttempts}: preserve the accepted first frame, mannequin identity treatment, wardrobe, props, setting, camera, and causal purpose. Execute one continuous readable action and finish its planned result. Resolve this reviewer finding: ${reason}`,
          seed: clipRetrySeed(scene.seed, attempt),
          remainingCostUsd,
        });
        observedVideoCostUsd += replacement.costUsd;
        videoReceipts.push(replacement.billingReceipt);
        clipByShot.set(id, replacement.clipKey);
        attempt += 1;
      }
    }
  }
  return { clipByShot, clipReviewByShot, videoCostUsd: observedVideoCostUsd, videoReceipts };
}

function exactCandidateByShot(result: NovitaRenderResult, ids: readonly string[]): Map<string, string> {
  const candidates = (result.candidates ?? []).filter((candidate) => candidate.candidateIndex === 0);
  const byShot = new Map(candidates.map((candidate) => [candidate.shotId, candidate.key]));
  if (byShot.size !== ids.length || ids.some((id) => !byShot.has(id))) {
    throw new Error("novita media bridge returned an incomplete or ambiguous shot mapping");
  }
  return byShot;
}

export async function renderNovitaGeneratedScenes(args: {
  prefix: string;
  scenes: readonly NovitaGeneratedScene[];
  profileId?: NovitaProfileId;
  /** Complete signed caller-owned envelope for both phases. */
  maxCostUsd: number;
  maxConcurrent?: number;
  lifecycle?: NovitaRenderLifecycle;
  /** Runs after paid still generation and before any LTX video spend. */
  keyframeGate?: NovitaKeyframeGate;
  /** Runs after each LTX take and before any clip can reach the editor. */
  clipGate?: NovitaClipGate;
}): Promise<{
  scenes: NovitaRenderedScene[];
  costUsd: number;
  imageReceipt: NovitaBillingReceipt;
  /** Every paid image receipt, including bounded keyframe replacements. */
  imageReceipts: NovitaBillingReceipt[];
  videoReceipt: NovitaBillingReceipt;
  /** Every paid video receipt, including bounded motion replacements. */
  videoReceipts: NovitaBillingReceipt[];
}> {
  if (!args.scenes.length || args.scenes.length > 24) {
    throw new Error("novita media sequence must contain between 1 and 24 scenes");
  }
  const profile = generationProfile(args.profileId ?? "production");
  // This must stay before the image phase. A known-incompatible video model
  // must never buy keyframes and then fail only when it reaches image-to-video.
  assertNovitaVideoProfileRuntime(profile);
  if (profile.video.candidates !== 1) {
    throw new Error(
      `novita media sequence cannot attest ${profile.video.candidates} video candidates per scene; explicit multi-candidate manifests are required`,
    );
  }
  const prefix = cleanPrefix(args.prefix);
  const imageShots = args.scenes.map((scene) => asShot(scene, profile.id));
  const terminalScenes = args.scenes.flatMap((scene) => {
    if (!scene.terminalImagePrompt?.trim()) return [];
    return [{
      ...scene,
      id: terminalKeyframeId(scene.id),
      imagePrompt: scene.terminalImagePrompt,
      keyframeRequirements: scene.terminalKeyframeRequirements ?? scene.keyframeRequirements,
      terminalImagePrompt: undefined,
      terminalKeyframeRequirements: undefined,
    }];
  });
  const terminalImageShots = terminalScenes.map((scene) => asShot(scene, profile.id));
  const maxImageAttempts = args.keyframeGate
    ? Math.max(1, Math.min(2, args.keyframeGate.maxImageAttempts ?? 1))
    : 1;
  const maxVideoAttempts = args.clipGate
    ? Math.max(1, Math.min(2, args.clipGate.maxVideoAttempts ?? 1))
    : 1;
  const openingImageJobs = imageShots.length * profile.image.candidates * maxImageAttempts;
  const terminalImageJobs = terminalImageShots.length * profile.image.candidates * maxImageAttempts;
  const envelope = novitaCostEnvelope({
    label: "novita media sequence",
    imageJobs: openingImageJobs + terminalImageJobs,
    videoJobs: imageShots.length * maxVideoAttempts,
    maxCostUsd: args.maxCostUsd,
  });
  const openingImageBudgetUsd = terminalImageJobs
    ? envelope.imageMaxCostUsd * (openingImageJobs / (openingImageJobs + terminalImageJobs))
    : envelope.imageMaxCostUsd;
  const terminalImageBudgetUsd = envelope.imageMaxCostUsd - openingImageBudgetUsd;
  const imageResult = await renderImages({
    prefix: `${prefix}/images`,
    shots: imageShots,
    profile: toNovitaPhaseProfile(profile, "image"),
    nshard: Math.min(args.maxConcurrent ?? 1, profile.infrastructure.elasticGpuCeiling),
    maxConcurrent: Math.min(args.maxConcurrent ?? 1, profile.infrastructure.elasticGpuCeiling),
    jobs: "full",
    maxCostUsd: openingImageBudgetUsd,
    lifecycle: args.lifecycle,
  });
  const ids = imageShots.map((shot) => shot.id);
  let stillByShot = exactCandidateByShot(imageResult, ids);
  let keyframeReviewByShot = new Map<string, CinematicKeyframeReview>();
  let imageReceipts = [imageResult.billingReceipt];
  let observedImageCostUsd = imageResult.costUsd;
  if (args.keyframeGate) {
    try {
      const recovery = await reviewKeyframesBeforeVideo({
        scenes: args.scenes,
        stillByShot,
        maxImageAttempts,
        imageCostUsd: observedImageCostUsd,
        imageMaxCostUsd: openingImageBudgetUsd,
        imageReceipts,
        review: async ({ scene, stillKey }) => args.keyframeGate!.review({
          scene,
          stillKey,
          stillUrl: await presignDownload(stillKey),
        }),
        renderReplacement: async ({ scene, repairId, prompt, seed, remainingCostUsd }) => {
          const repairResult = await renderImages({
            prefix: `${prefix}/images-keyframe-retry-${repairId}`,
            shots: [asShot({ ...scene, id: repairId, imagePrompt: prompt, seed }, profile.id)],
            profile: toNovitaPhaseProfile(profile, "image"),
            nshard: 1,
            maxConcurrent: 1,
            jobs: "full",
            maxCostUsd: remainingCostUsd,
            lifecycle: args.lifecycle,
          });
          const stillKey = exactCandidateByShot(repairResult, [repairId]).get(repairId);
          if (!stillKey) throw new Error(`novita keyframe retry did not return ${repairId}`);
          return { stillKey, costUsd: repairResult.costUsd, billingReceipt: repairResult.billingReceipt };
        },
      });
      stillByShot = recovery.stillByShot;
      keyframeReviewByShot = recovery.keyframeReviewByShot;
      observedImageCostUsd = recovery.imageCostUsd;
      imageReceipts = recovery.imageReceipts;
    } catch (error) {
      throw imageSpendError(error, observedImageCostUsd);
    }
  }
  let terminalStillByShot = new Map<string, string>();
  let terminalKeyframeReviewByShot = new Map<string, CinematicKeyframeReview>();
  if (terminalImageShots.length) {
    let terminalImageResult: NovitaRenderResult;
    try {
      terminalImageResult = await renderImages({
        prefix: `${prefix}/images-terminal`,
        shots: terminalImageShots,
        profile: toNovitaPhaseProfile(profile, "image"),
        nshard: Math.min(args.maxConcurrent ?? 1, profile.infrastructure.elasticGpuCeiling),
        maxConcurrent: Math.min(args.maxConcurrent ?? 1, profile.infrastructure.elasticGpuCeiling),
        jobs: "full",
        maxCostUsd: terminalImageBudgetUsd,
        lifecycle: args.lifecycle,
      });
    } catch (error) {
      throw imageSpendError(error, observedImageCostUsd);
    }
    const terminalIds = terminalImageShots.map((shot) => shot.id);
    let terminalStillByTerminalId = exactCandidateByShot(terminalImageResult, terminalIds);
    let terminalReviewsByTerminalId = new Map<string, CinematicKeyframeReview>();
    imageReceipts = [...imageReceipts, terminalImageResult.billingReceipt];
    observedImageCostUsd += terminalImageResult.costUsd;
    if (args.keyframeGate) {
      try {
        const recovery = await reviewKeyframesBeforeVideo({
          scenes: terminalScenes,
          stillByShot: terminalStillByTerminalId,
          maxImageAttempts,
          imageCostUsd: terminalImageResult.costUsd,
          imageMaxCostUsd: terminalImageBudgetUsd,
          imageReceipts: [terminalImageResult.billingReceipt],
          review: async ({ scene, stillKey }) => args.keyframeGate!.review({
            scene,
            stillKey,
            stillUrl: await presignDownload(stillKey),
          }),
          renderReplacement: async ({ scene, repairId, prompt, seed, remainingCostUsd }) => {
            const repairResult = await renderImages({
              prefix: `${prefix}/images-terminal-keyframe-retry-${repairId}`,
              shots: [asShot({ ...scene, id: repairId, imagePrompt: prompt, seed }, profile.id)],
              profile: toNovitaPhaseProfile(profile, "image"),
              nshard: 1,
              maxConcurrent: 1,
              jobs: "full",
              maxCostUsd: remainingCostUsd,
              lifecycle: args.lifecycle,
            });
            const stillKey = exactCandidateByShot(repairResult, [repairId]).get(repairId);
            if (!stillKey) throw new Error(`novita terminal keyframe retry did not return ${repairId}`);
            return { stillKey, costUsd: repairResult.costUsd, billingReceipt: repairResult.billingReceipt };
          },
        });
        terminalStillByTerminalId = recovery.stillByShot;
        terminalReviewsByTerminalId = recovery.keyframeReviewByShot;
        observedImageCostUsd += recovery.imageCostUsd - terminalImageResult.costUsd;
        imageReceipts = [...imageReceipts, ...recovery.imageReceipts.slice(1)];
      } catch (error) {
        throw imageSpendError(error, observedImageCostUsd);
      }
    }
    for (const scene of args.scenes) {
      const terminalId = terminalKeyframeId(scene.id);
      const stillKey = terminalStillByTerminalId.get(terminalId);
      if (!stillKey) continue;
      const sceneId = safeId(scene.id);
      terminalStillByShot.set(sceneId, stillKey);
      const review = terminalReviewsByTerminalId.get(terminalId);
      if (review) terminalKeyframeReviewByShot.set(sceneId, review);
    }
  }
  const videoShots = args.scenes.map((scene) => {
    const id = safeId(scene.id);
    return asLtxDistilledVideoShot(scene, profile.id, stillByShot.get(id)!, terminalStillByShot.get(id));
  });
  let videoResult: NovitaRenderResult;
  try {
    videoResult = await renderVideo({
      prefix: `${prefix}/video`,
      shots: videoShots,
      profile: toNovitaPhaseProfile(profile, "video"),
      nshard: Math.min(args.maxConcurrent ?? 1, profile.infrastructure.elasticGpuCeiling),
      maxConcurrent: Math.min(args.maxConcurrent ?? 1, profile.infrastructure.elasticGpuCeiling),
      jobs: "full",
      maxCostUsd: envelope.videoMaxCostUsd,
      lifecycle: args.lifecycle,
    });
  } catch (error) {
    throw imageSpendError(error, observedImageCostUsd);
  }
  let clipByShot = exactCandidateByShot(videoResult, ids);
  let clipReviewByShot = new Map<string, CinematicClipReview>();
  let videoReceipts = [videoResult.billingReceipt];
  let observedVideoCostUsd = videoResult.costUsd;
  if (args.clipGate) {
    try {
      const recovery = await reviewClipsBeforeAssembly({
        scenes: args.scenes,
        stillByShot,
        terminalStillByShot,
        clipByShot,
        maxVideoAttempts,
        videoCostUsd: observedVideoCostUsd,
        videoMaxCostUsd: envelope.videoMaxCostUsd,
        videoReceipts,
        review: async ({ scene, stillKey, terminalStillKey, clipKey }) => args.clipGate!.review({
          scene,
          stillKey,
          stillUrl: await presignDownload(stillKey),
          ...(terminalStillKey
            ? { terminalStillKey, terminalStillUrl: await presignDownload(terminalStillKey) }
            : {}),
          clipKey,
          clipUrl: await presignDownload(clipKey),
        }),
        renderReplacement: async ({ scene, stillKey, terminalStillKey, repairId, motionPrompt, seed, remainingCostUsd }) => {
          const repairResult = await renderVideo({
            prefix: `${prefix}/video-motion-retry-${repairId}`,
            shots: [asLtxDistilledVideoShot({ ...scene, id: repairId, motionPrompt, seed }, profile.id, stillKey, terminalStillKey)],
            profile: toNovitaPhaseProfile(profile, "video"),
            nshard: 1,
            maxConcurrent: 1,
            jobs: "full",
            maxCostUsd: remainingCostUsd,
            lifecycle: args.lifecycle,
          });
          const clipKey = exactCandidateByShot(repairResult, [repairId]).get(repairId);
          if (!clipKey) throw new Error(`novita clip retry did not return ${repairId}`);
          return { clipKey, costUsd: repairResult.costUsd, billingReceipt: repairResult.billingReceipt };
        },
      });
      clipByShot = recovery.clipByShot;
      clipReviewByShot = recovery.clipReviewByShot;
      observedVideoCostUsd = recovery.videoCostUsd;
      videoReceipts = recovery.videoReceipts;
    } catch (error) {
      throw imageSpendError(error, observedImageCostUsd + observedVideoCostUsd);
    }
  }
  const scenes = await Promise.all(args.scenes.map(async (scene) => {
    const id = safeId(scene.id);
    const stillKey = stillByShot.get(id)!;
    const clipKey = clipByShot.get(id)!;
    return {
      ...scene,
      id,
      stillKey,
      clipKey,
      stillUrl: await presignDownload(stillKey),
      clipUrl: await presignDownload(clipKey),
      ...(terminalStillByShot.has(id)
        ? {
            terminalStillKey: terminalStillByShot.get(id)!,
            terminalStillUrl: await presignDownload(terminalStillByShot.get(id)!),
          }
        : {}),
      ...(keyframeReviewByShot.has(id) ? { keyframeReview: keyframeReviewByShot.get(id)! } : {}),
      ...(terminalKeyframeReviewByShot.has(id)
        ? { terminalKeyframeReview: terminalKeyframeReviewByShot.get(id)! }
        : {}),
      ...(clipReviewByShot.has(id) ? { clipReview: clipReviewByShot.get(id)! } : {}),
    };
  }));
  return {
    scenes,
    costUsd: observedImageCostUsd + observedVideoCostUsd,
    imageReceipt: imageResult.billingReceipt,
    imageReceipts,
    videoReceipt: videoResult.billingReceipt,
    videoReceipts,
  };
}

export async function renderNovitaImage(args: {
  prefix: string;
  id: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  profileId?: NovitaProfileId;
  maxCostUsd: number;
  lifecycle?: NovitaRenderLifecycle;
  beforeProviderSpend?: () => void | Promise<void>;
  onProviderReceipt?: NovitaImageProviderReceiptObserver;
}): Promise<NovitaRenderedImage> {
  const profile = generationProfile(args.profileId ?? "production");
  const envelope = novitaCostEnvelope({
    label: "novita image",
    imageJobs: profile.image.candidates,
    maxCostUsd: args.maxCostUsd,
  });
  const id = safeId(args.id);
  // Image generation still supports the regular negative field. Only the
  // distilled LTX video leg needs its exclusions rewritten into the positive
  // prompt because that official CLI exposes no negative-prompt argument.
  const shot = asShot({
    id,
    imagePrompt: args.prompt,
    motionPrompt: "subtle natural motion",
    durationSec: 5,
    negativePrompt: args.negativePrompt,
    seed: args.seed,
  }, profile.id);
  const result = await renderImages({
    prefix: `${cleanPrefix(args.prefix)}/images`,
    shots: [shot],
    profile: toNovitaPhaseProfile(profile, "image"),
    nshard: 1,
    maxConcurrent: 1,
    jobs: "full",
    maxCostUsd: envelope.imageMaxCostUsd,
    lifecycle: args.lifecycle,
    beforeProviderSpend: args.beforeProviderSpend,
  });
  const key = exactCandidateByShot(result, [id]).get(id)!;
  const providerReceipt: NovitaImageProviderReceipt = {
    key,
    jobId: result.raw.jobId,
    model: `${profile.image.model}@${profile.image.revision}`,
    profileId: profile.id,
    width: profile.image.width,
    height: profile.image.height,
    costUsd: result.costUsd,
    billingReceipt: result.billingReceipt,
    runtimeAttestation: result.raw.runtimeAttestation,
    profileSha256: result.raw.profileSha256,
    manifestSha256: result.raw.manifestSha256,
    requestSha256: result.raw.requestSha256,
    requestCanonicalJson: result.requestCanonicalJson,
    billingReceiptSha256: result.raw.billingReceiptSha256,
  };
  await settleNovitaImageProviderReceipt(providerReceipt, profile.id, args.onProviderReceipt);
  let url: string;
  try {
    url = await presignDownload(key);
  } catch (error) {
    if (error && typeof error === "object") {
      Object.assign(error, {
        observedCostUsd: result.costUsd,
        retryable: false,
        providerReceipt: { key, jobId: result.raw.jobId },
      });
    }
    throw error;
  }
  return { ...providerReceipt, url };
}

/** Re-check the externally visible proof before a production caller accepts bytes. */
export function assertAttestedNovitaImage(
  rendered: NovitaImageProviderReceipt,
  profileId: NovitaProfileId = "production",
): void {
  const profile = generationProfile(profileId);
  const expectedModel = `${profile.image.model}@${profile.image.revision}`;
  const expectedProfileHash = createHash("sha256")
    .update(canonicalJson(toNovitaPhaseProfile(profile, "image")))
    .digest("hex");
  const expectedBillingHash = createHash("sha256")
    .update(canonicalJson(rendered.billingReceipt))
    .digest("hex");
  let canonicalRequest = false;
  try {
    canonicalRequest = canonicalJson(JSON.parse(rendered.requestCanonicalJson)) === rendered.requestCanonicalJson;
  } catch {
    canonicalRequest = false;
  }
  const expectedRequestHash = createHash("sha256")
    .update("image\0")
    .update(rendered.requestCanonicalJson)
    .digest("hex");
  const attestation = rendered.runtimeAttestation;
  const infra = profile.infrastructure;
  const hashes = [
    rendered.profileSha256,
    rendered.manifestSha256,
    rendered.requestSha256,
    rendered.billingReceiptSha256,
  ];
  if (
    rendered.profileId !== profile.id
    || rendered.model !== expectedModel
    || rendered.width !== profile.image.width
    || rendered.height !== profile.image.height
    || rendered.profileSha256 !== expectedProfileHash
    || rendered.billingReceiptSha256 !== expectedBillingHash
    || rendered.requestSha256 !== expectedRequestHash
    || !canonicalRequest
    || attestation.provider !== "novita"
    || attestation.capacityMode !== infra.capacityMode
    || attestation.weightStorage !== infra.weightStorage
    || attestation.cacheMount !== infra.cacheMount
    || attestation.checkpointing !== infra.checkpointing
    || attestation.idleShutdownSeconds !== infra.idleShutdownSeconds
    || attestation.gpuCount < 1
    || attestation.gpuCount > infra.elasticGpuCeiling
    || attestation.model !== profile.image.model
    || attestation.revision !== profile.image.revision
    || attestation.checkpoint !== profile.image.checkpoint
    || rendered.billingReceipt.provider !== "novita"
    || rendered.billingReceipt.gpuCount !== attestation.gpuCount
    || Math.abs(rendered.billingReceipt.costUsd - rendered.costUsd) > 0.000001
    || hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))
  ) {
    throw new Error("novita image: missing or mismatched local Z-Image Turbo runtime attestation");
  }
}

/**
 * Seal known spend before any URL signing or byte delivery. Keeping this as a
 * small exported boundary makes the provider-response crash ordering directly
 * testable without making a paid bridge call.
 */
export async function settleNovitaImageProviderReceipt(
  receipt: NovitaImageProviderReceipt,
  profileId: NovitaProfileId,
  onProviderReceipt?: NovitaImageProviderReceiptObserver,
): Promise<void> {
  const recordReceipt = () => recordImageUsage({
    provider: "novita",
    model: receipt.model,
    route: "local-z-image-turbo",
    images: 1,
    width: receipt.width,
    height: receipt.height,
    costUsd: receipt.costUsd,
  });
  try {
    assertAttestedNovitaImage(receipt, profileId);
  } catch (error) {
    // A terminal provider response can be billable even when its attestation
    // is rejected. Preserve that known spend and fail closed.
    if (Number.isFinite(receipt.costUsd) && receipt.costUsd >= 0) recordReceipt();
    if (error && typeof error === "object") {
      Object.assign(error, {
        observedCostUsd: receipt.costUsd,
        retryable: false,
        providerReceipt: { key: receipt.key, jobId: receipt.jobId },
      });
    }
    throw error;
  }
  recordReceipt();
  await onProviderReceipt?.(receipt);
}

/**
 * Shared production still adapter. It records the signed GPU receipt before
 * downloading bytes, so a post-render R2 failure cannot disappear from cost
 * accounting or trigger a second paid provider submission.
 */
export async function renderAttestedNovitaImageBytes(
  args: NovitaImageByteRequest,
  dependencies: {
    renderImage?: RenderNovitaImageFn;
    downloadImage?: DownloadNovitaImageFn;
  } = {},
): Promise<AttestedNovitaImageBytes> {
  const profileId = args.profileId ?? "production";
  const rendered = await (dependencies.renderImage ?? renderNovitaImage)({
    prefix: args.prefix,
    id: args.id,
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    seed: args.seed,
    profileId,
    maxCostUsd: args.maxCostUsd,
    lifecycle: args.lifecycle,
    beforeProviderSpend: args.beforeProviderSpend,
    onProviderReceipt: args.onProviderReceipt,
  });
  try {
    assertAttestedNovitaImage(rendered, profileId);
  } catch (error) {
    // The bridge submission is already paid when a render receipt reaches this
    // boundary. Refuse its bytes, but never erase that spend from the ledger.
    if (error && typeof error === "object") {
      Object.assign(error, {
        observedCostUsd: rendered.costUsd,
        retryable: false,
        providerReceipt: { key: rendered.key, jobId: rendered.jobId },
      });
    }
    throw error;
  }
  try {
    const bytes = Buffer.from(await (dependencies.downloadImage ?? getObjectBytes)(rendered.key));
    if (!bytes.length || bytes.length > 30 * 1024 * 1024) {
      throw new Error("novita image: downloaded bytes are outside the 1B..30MiB contract");
    }
    return { ...rendered, bytes };
  } catch (error) {
    if (error && typeof error === "object") {
      Object.assign(error, {
        observedCostUsd: rendered.costUsd,
        retryable: false,
        providerReceipt: { key: rendered.key, jobId: rendered.jobId },
      });
    }
    throw error;
  }
}

/** Build a typed, deterministic prompt→bytes dependency for a live module. */
export function createAttestedNovitaImageGenerator<T extends NovitaPromptImageRequest>(args: {
  prefix: string;
  id: (request: T) => string;
  profileId?: NovitaProfileId;
  maxCostUsd: number;
  lifecycle?: NovitaRenderLifecycle;
  beforeProviderSpend?: () => void | Promise<void>;
  onProviderReceipt?: NovitaImageProviderReceiptObserver;
  onReceipt?: NovitaImageReceiptObserver;
}): (request: T) => Promise<Buffer> {
  return async (request) => {
    const rendered = await renderAttestedNovitaImageBytes({
      prefix: args.prefix,
      id: args.id(request),
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      seed: request.seed,
      profileId: args.profileId ?? "production",
      maxCostUsd: args.maxCostUsd,
      lifecycle: args.lifecycle,
      beforeProviderSpend: args.beforeProviderSpend,
      onProviderReceipt: args.onProviderReceipt,
    });
    args.onReceipt?.(rendered);
    return rendered.bytes;
  };
}

async function persistRemoteStill(args: { imageUrl: string; prefix: string; id: string }): Promise<string> {
  const url = new URL(args.imageUrl);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("novita media input image must be a public HTTPS URL");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`novita media input download failed ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!contentType.startsWith("image/")) throw new Error("novita media input URL did not return an image");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) {
    throw new Error("novita media input image size is outside the 1B..30MiB contract");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const key = `${cleanPrefix(args.prefix)}/inputs/${safeId(args.id)}-${digest.slice(0, 20)}`;
  await putObject(key, bytes, { contentType });
  return key;
}

export async function renderNovitaI2V(args: {
  prefix: string;
  id: string;
  prompt: string;
  /** Diegetic-only sound direction for this direct I2V take. */
  diegeticSoundscape?: string;
  imageKey?: string;
  imageUrl?: string;
  /** Optional reviewed/intentional LTX final-frame image. */
  endImageKey?: string;
  endImageUrl?: string;
  durationSec?: number;
  negativePrompt?: string;
  seed?: number;
  profileId?: NovitaProfileId;
  /** Optional sealed LTX creative adapter; runtime/benchmark admission happens in the direct worker path. */
  creativeAdapter?: LtxCreativeAdapterSelection;
  /** Signed envelope for this one direct video worker. */
  maxCostUsd: number;
  lifecycle?: NovitaRenderLifecycle;
}): Promise<{ url: string; key: string; jobId: string; model: string; costUsd: number; billingReceipt: NovitaBillingReceipt }> {
  if (Boolean(args.imageKey) === Boolean(args.imageUrl)) {
    throw new Error("novita i2v requires exactly one of imageKey or imageUrl");
  }
  if (args.endImageKey && args.endImageUrl) {
    throw new Error("novita i2v accepts at most one of endImageKey or endImageUrl");
  }
  const profile = generationProfile(args.profileId ?? "production");
  // Do not persist/download a still or create any direct worker while the
  // exact pinned video profile lacks a benchmarked hardware admission.
  assertNovitaVideoProfileRuntime(profile);
  if (profile.video.candidates !== 1) {
    throw new Error(
      `novita i2v cannot attest ${profile.video.candidates} video candidates; explicit multi-candidate manifests are required`,
    );
  }
  const envelope = novitaCostEnvelope({
    label: "novita i2v",
    videoJobs: 1,
    maxCostUsd: args.maxCostUsd,
  });
  const prefix = cleanPrefix(args.prefix);
  const id = safeId(args.id);
  const stillKey = args.imageKey ?? await persistRemoteStill({ imageUrl: args.imageUrl!, prefix, id });
  const endStillKey = args.endImageKey
    ?? (args.endImageUrl
      ? await persistRemoteStill({ imageUrl: args.endImageUrl, prefix, id: `${id}-terminal` })
      : undefined);
  const shot = asShot({
    id,
    imagePrompt: args.prompt,
    motionPrompt: args.prompt,
    diegeticSoundscape: args.diegeticSoundscape,
    durationSec: args.durationSec ?? 5,
    negativePrompt: args.negativePrompt,
    seed: args.seed,
    creativeAdapter: args.creativeAdapter,
  }, profile.id, stillKey, endStillKey);
  const result = await renderVideo({
    prefix: `${prefix}/video`,
    shots: [shot],
    profile: toNovitaPhaseProfile(profile, "video"),
    nshard: 1,
    maxConcurrent: 1,
    jobs: "full",
    maxCostUsd: envelope.videoMaxCostUsd,
    lifecycle: args.lifecycle,
  });
  const key = exactCandidateByShot(result, [id]).get(id)!;
  return {
    url: await presignDownload(key),
    key,
    jobId: result.raw.jobId,
    model: `${profile.video.model}@${profile.video.revision}`,
    costUsd: result.costUsd,
    billingReceipt: result.billingReceipt,
  };
}
