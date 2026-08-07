import { createHash } from "node:crypto";
import { generationProfile, type GenerationProfile } from "@/engine/generationProfiles";
import {
  renderImages,
  renderVideo,
  toNovitaPhaseProfile,
  type NovitaRenderResult,
  type NovitaBillingReceipt,
  type Shot,
} from "@/lib/novitaRenderFarm";
import { presignDownload, putObject } from "@/lib/storage";

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
  profileId?: NovitaProfileId;
}): Promise<{ url: string; key: string; jobId: string; model: string; costUsd: number; billingReceipt: NovitaBillingReceipt }> {
  const profile = generationProfile(args.profileId ?? "production");
  const id = safeId(args.id);
  const shot = asShot({
    id,
    imagePrompt: args.prompt,
    motionPrompt: "subtle natural motion",
    durationSec: 5,
    negativePrompt: args.negativePrompt,
  }, profile.id);
  const result = await renderImages({
    prefix: `${cleanPrefix(args.prefix)}/images`,
    shots: [shot],
    profile: toNovitaPhaseProfile(profile, "image"),
    nshard: 1,
    maxConcurrent: 1,
    jobs: "full",
  });
  const key = exactCandidateByShot(result, [id]).get(id)!;
  return {
    url: await presignDownload(key),
    key,
    jobId: result.raw.jobId,
    model: `${profile.image.model}@${profile.image.revision}`,
    costUsd: result.costUsd,
    billingReceipt: result.billingReceipt,
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
