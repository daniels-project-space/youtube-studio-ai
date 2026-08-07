import { createHash } from "node:crypto";
import { generationProfile, type GenerationProfile } from "@/engine/generationProfiles";
import {
  renderImages,
  renderVideo,
  toNovitaPhaseProfile,
  type NovitaRenderResult,
  type NovitaBillingReceipt,
  type NovitaRuntimeAttestation,
  type Shot,
} from "@/lib/novitaRenderFarm";
import { recordImageUsage } from "@/lib/imageUsage";
import { getObjectBytes, presignDownload, putObject } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";

export type NovitaProfileId = GenerationProfile["id"];

export interface NovitaGeneratedScene {
  id: string;
  imagePrompt: string;
  motionPrompt: string;
  durationSec: number;
  negativePrompt?: string;
  seed?: number;
  cameraMove?: Shot["cameraMove"];
  shotScale?: Shot["shotScale"];
  lens?: string;
}

export interface NovitaRenderedScene extends NovitaGeneratedScene {
  stillKey: string;
  stillUrl: string;
  clipKey: string;
  clipUrl: string;
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
  maxCostUsd?: number;
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
  maxCostUsd?: number;
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

function asShot(scene: NovitaGeneratedScene, profileId: NovitaProfileId, stillKey?: string): Shot {
  return {
    id: safeId(scene.id),
    prompt: scene.imagePrompt,
    motion: scene.motionPrompt,
    seconds: scene.durationSec,
    cameraMove: scene.cameraMove ?? "static",
    shotScale: scene.shotScale ?? "medium",
    lens: scene.lens ?? "35mm",
    negative: scene.negativePrompt,
    seed: scene.seed,
    generationProfile: profileId,
    ...(stillKey ? { stillKey } : {}),
  };
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
  maxConcurrent?: number;
}): Promise<{
  scenes: NovitaRenderedScene[];
  costUsd: number;
  imageReceipt: NovitaBillingReceipt;
  videoReceipt: NovitaBillingReceipt;
}> {
  if (!args.scenes.length || args.scenes.length > 24) {
    throw new Error("novita media sequence must contain between 1 and 24 scenes");
  }
  const profile = generationProfile(args.profileId ?? "production");
  const prefix = cleanPrefix(args.prefix);
  const imageShots = args.scenes.map((scene) => asShot(scene, profile.id));
  const imageResult = await renderImages({
    prefix: `${prefix}/images`,
    shots: imageShots,
    profile: toNovitaPhaseProfile(profile, "image"),
    nshard: Math.min(args.maxConcurrent ?? 1, profile.infrastructure.elasticGpuCeiling),
    maxConcurrent: Math.min(args.maxConcurrent ?? 1, profile.infrastructure.elasticGpuCeiling),
    jobs: "full",
  });
  const ids = imageShots.map((shot) => shot.id);
  const stillByShot = exactCandidateByShot(imageResult, ids);
  const videoShots = args.scenes.map((scene) => {
    const id = safeId(scene.id);
    return asShot(scene, profile.id, stillByShot.get(id));
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
    });
  } catch (error) {
    if (error && typeof error === "object") {
      Object.assign(error, {
        additionalObservedCostUsd: imageResult.costUsd,
        retryable: false,
      });
    }
    throw error;
  }
  const clipByShot = exactCandidateByShot(videoResult, ids);
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
    };
  }));
  return {
    scenes,
    costUsd: imageResult.costUsd + videoResult.costUsd,
    imageReceipt: imageResult.billingReceipt,
    videoReceipt: videoResult.billingReceipt,
  };
}

export async function renderNovitaImage(args: {
  prefix: string;
  id: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  profileId?: NovitaProfileId;
  maxCostUsd?: number;
  beforeProviderSpend?: () => void | Promise<void>;
  onProviderReceipt?: NovitaImageProviderReceiptObserver;
}): Promise<NovitaRenderedImage> {
  const profile = generationProfile(args.profileId ?? "production");
  const id = safeId(args.id);
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
    maxCostUsd: args.maxCostUsd,
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
  maxCostUsd?: number;
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
  imageKey?: string;
  imageUrl?: string;
  durationSec?: number;
  negativePrompt?: string;
  seed?: number;
  profileId?: NovitaProfileId;
}): Promise<{ url: string; key: string; jobId: string; model: string; costUsd: number; billingReceipt: NovitaBillingReceipt }> {
  if (Boolean(args.imageKey) === Boolean(args.imageUrl)) {
    throw new Error("novita i2v requires exactly one of imageKey or imageUrl");
  }
  const profile = generationProfile(args.profileId ?? "production");
  const prefix = cleanPrefix(args.prefix);
  const id = safeId(args.id);
  const stillKey = args.imageKey ?? await persistRemoteStill({ imageUrl: args.imageUrl!, prefix, id });
  const shot = asShot({
    id,
    imagePrompt: args.prompt,
    motionPrompt: args.prompt,
    durationSec: args.durationSec ?? 5,
    negativePrompt: args.negativePrompt,
    seed: args.seed,
  }, profile.id, stillKey);
  const result = await renderVideo({
    prefix: `${prefix}/video`,
    shots: [shot],
    profile: toNovitaPhaseProfile(profile, "video"),
    nshard: 1,
    maxConcurrent: 1,
    jobs: "full",
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
