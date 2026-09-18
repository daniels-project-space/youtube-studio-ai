import { createHash } from "node:crypto";
import { generationProfile, type GenerationProfile } from "@/engine/generationProfiles";
import {
  renderImages,
  toNovitaPhaseProfile,
  type NovitaRenderResult,
  type NovitaBillingReceipt,
  type NovitaRuntimeAttestation,
  type NovitaRenderCfg,
  type Shot,
} from "@/lib/novitaRenderFarm";
import { recordImageUsage } from "@/lib/imageUsage";
import { DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS } from "@/lib/files";
import { getObjectBytes, presignDownload } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { novitaCostEnvelope } from "@/lib/novitaCostEnvelope";
import {
  CINEMATIC_KEYFRAME_REVIEW_VERSION,
  type CinematicKeyframeReview,
} from "@/engine/cinematicKeyframeReview";
import {
  CINEMATIC_CLIP_REVIEW_VERSION,
  type MiniMaxH3OpeningMotionQaEvidence,
  type CinematicClipReview,
} from "@/engine/cinematicClipReview";
import {
  classifyVisualArtifactReviewOutcome,
  type VisualArtifactReviewRejection,
} from "@/engine/visualArtifactReviewOutcome";

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
  /** Optional reviewed target image prompt for terminal-continuity evidence. */
  terminalImagePrompt?: string;
  motionPrompt: string;
  /** Diegetic-only sound direction retained with the shot's edit evidence. */
  diegeticSoundscape?: string;
  durationSec: number;
  negativePrompt?: string;
  seed?: number;
  cameraMove?: Shot["cameraMove"];
  /** Concrete camera path grounded in the approved source frame. */
  cameraInstruction?: string;
  shotScale?: Shot["shotScale"];
  lens?: string;
  /** Stable mannequin identities that must remain visually continuous. */
  continuityIds?: string[];
  /** Exact sealed cast allowed in a Casefile render; [] permits no people/mannequins. */
  expectedCastIds?: string[];
  /** Casefile scenes cannot add bystanders, background people, or mannequins. */
  forbidAdditionalPeople?: true;
  /** Reviewer-facing source/camera/cut obligations for this exact first frame. */
  keyframeRequirements?: string[];
  /** Reviewer-facing endpoint obligations for a terminal conditioned frame. */
  terminalKeyframeRequirements?: string[];
}

export interface NovitaRenderedScene extends NovitaGeneratedScene {
  stillKey: string;
  stillUrl: string;
  /** Present only when the scene was admitted with a terminal continuity frame. */
  terminalStillKey?: string;
  terminalStillUrl?: string;
  clipKey: string;
  clipUrl: string;
  keyframeReview?: CinematicKeyframeReview;
  terminalKeyframeReview?: CinematicKeyframeReview;
  /** Independent review of the actual moving take before assembly. */
  clipReview?: CinematicClipReview;
  /**
   * Deterministic H3 temporal receipt for generic footage paths that do not
   * use the full source-bound cinematic reviewer.
   */
  openingMotionQa?: MiniMaxH3OpeningMotionQaEvidence;
}

export interface NovitaKeyframeGate {
  /** One controlled replacement still is enough to avoid duplicate spend loops. */
  maxImageAttempts?: 1 | 2;
  review(input: {
    scene: NovitaGeneratedScene;
    stillKey: string;
    stillUrl: string;
  }): Promise<CinematicKeyframeReview>;
  /**
   * Record-only observation of the independent gate. It is awaited before a
   * replacement can be rendered, but it never decides whether a replacement
   * is allowed; that remains the fail-closed review-outcome policy below.
   */
  checkpointReview?: (event: NovitaKeyframeReviewCheckpoint) => Promise<void>;
}

export type NovitaKeyframeReviewCheckpoint =
  | {
      scene: NovitaGeneratedScene;
      stillKey: string;
      attempt: number;
      verdict: "accepted";
      review: CinematicKeyframeReview;
    }
  | {
      scene: NovitaGeneratedScene;
      stillKey: string;
      attempt: number;
      verdict: "rejected";
      rejection: VisualArtifactReviewRejection;
    };

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
  /** See NovitaKeyframeGate.checkpointReview. */
  checkpointReview?: (event: NovitaClipReviewCheckpoint) => Promise<void>;
}

export type NovitaClipReviewCheckpoint =
  | {
      scene: NovitaGeneratedScene;
      clipKey: string;
      attempt: number;
      verdict: "accepted";
      review: CinematicClipReview;
    }
  | {
      scene: NovitaGeneratedScene;
      clipKey: string;
      attempt: number;
      verdict: "rejected";
      rejection: VisualArtifactReviewRejection;
    };

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
    cameraInstruction: scene.cameraInstruction,
    shotScale: scene.shotScale ?? "medium",
    lens: scene.lens ?? "35mm",
    negative: scene.negativePrompt,
    seed: scene.seed,
    generationProfile: profileId,
    ...(stillKey ? { stillKey } : {}),
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

/**
 * Selects source stills before video spending. A keyframe review may buy exactly
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
  checkpointReview?: (event: NovitaKeyframeReviewCheckpoint) => Promise<void>;
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
        await args.checkpointReview?.({
          scene,
          stillKey,
          attempt,
          verdict: "accepted",
          review,
        });
        keyframeReviewByShot.set(id, review);
        break;
      } catch (reviewError) {
        // A replacement image is an evidence-led repair, not a fallback for a
        // reviewer outage, a malformed receipt, or another infrastructure
        // fault. Only the structurally valid pixel-review rejection from the
        // independent keyframe gate is allowed to consume the one repair.
        const outcome = classifyVisualArtifactReviewOutcome(reviewError, {
          gateId: "cinematic-keyframe",
          artifactKind: "image",
          subjectId: id,
          reviewVersion: CINEMATIC_KEYFRAME_REVIEW_VERSION,
        });
        if (outcome.disposition !== "render_replacement") {
          throw reviewError;
        }
        // Durable audit persistence is deliberately before the paid repair.
        // A failed checkpoint must therefore stop rather than double-spend.
        await args.checkpointReview?.({
          scene,
          stillKey,
          attempt,
          verdict: "rejected",
          rejection: outcome.rejection,
        });
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
 * Review actual generated clips before they become an ordered editing manifest. A
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
  checkpointReview?: (event: NovitaClipReviewCheckpoint) => Promise<void>;
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
      if (!clipKey) throw new Error(`novita clip gate is missing the initial generated clip for ${id}`);
      try {
        const review = await args.review({ scene, stillKey, terminalStillKey, clipKey });
        await args.checkpointReview?.({
          scene,
          clipKey,
          attempt,
          verdict: "accepted",
          review,
        });
        clipReviewByShot.set(id, review);
        break;
      } catch (reviewError) {
        // A second generated take is a repair only after the independent gate has
        // parsed and typed a real pixel-level rejection. A reviewer outage,
        // malformed verdict, R2/download failure, or ffprobe/frame fault must
        // retain the paid candidate and fail closed rather than buy new pixels.
        const outcome = classifyVisualArtifactReviewOutcome(reviewError, {
          gateId: "cinematic-clip",
          artifactKind: "video",
          subjectId: id,
          reviewVersion: CINEMATIC_CLIP_REVIEW_VERSION,
        });
        if (outcome.disposition !== "render_replacement") {
          throw reviewError;
        }
        // Keep the rejected take durable before any second paid video request.
        await args.checkpointReview?.({
          scene,
          clipKey,
          attempt,
          verdict: "rejected",
          rejection: outcome.rejection,
        });
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

type RetiredNovitaGeneratedScenesArgs = {
  prefix: string;
  scenes: readonly NovitaGeneratedScene[];
  profileId?: NovitaProfileId;
  /** Preserved only for historical caller compatibility; never dispatched. */
  styleId?: string;
  /** Complete signed caller-owned envelope for both phases. */
  maxCostUsd: number;
  maxConcurrent?: number;
  lifecycle?: NovitaRenderLifecycle;
  /** Preserved compatibility shape; this retired route never renders. */
  keyframeGate?: NovitaKeyframeGate;
  /** Preserved compatibility shape; this retired route never renders. */
  clipGate?: NovitaClipGate;
};

type RetiredNovitaGeneratedScenesResult = {
  scenes: NovitaRenderedScene[];
  costUsd: number;
  imageReceipt: NovitaBillingReceipt;
  /** Every paid image receipt, including bounded keyframe replacements. */
  imageReceipts: NovitaBillingReceipt[];
  videoReceipt: NovitaBillingReceipt;
  /** Every paid video receipt, including bounded motion replacements. */
  videoReceipts: NovitaBillingReceipt[];
};

/**
 * Compatibility-only admission surface for historical callers. Fresh generated
 * footage is structurally H3-only; this fails before image or video spend.
 */
export async function renderNovitaGeneratedScenes(
  _args: RetiredNovitaGeneratedScenesArgs,
): Promise<RetiredNovitaGeneratedScenesResult> {
  void _args;
  throw new Error(
    "renderNovitaGeneratedScenes is retired for new work; dispatch through the MiniMax H3 footage adapter instead",
  );
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
  // Direct Novita image generation supports its regular negative-prompt field,
  // so the caller's exclusions remain part of its attested image request.
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
    const downloadImage = dependencies.downloadImage ?? ((key: string) =>
      getObjectBytes(key, undefined, { timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS }));
    const bytes = Buffer.from(await downloadImage(rendered.key));
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
    // This text-only route cannot condition on reference pixels. Check the
    // generic caller's extended request before ID allocation or paid work;
    // never silently discard references while returning attested text-only art.
    const images = (request as NovitaPromptImageRequest & { images?: unknown }).images;
    if (images !== undefined && (!Array.isArray(images) || images.length !== 0)) {
      throw new Error("novita image: reference images are unsupported by this text-only route; images must be absent or an empty array");
    }
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
