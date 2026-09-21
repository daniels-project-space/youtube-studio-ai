/**
 * Paid weekly image producer.
 *
 * The planner freezes editorial inputs; this task is the explicit visual data
 * plane that turns an approved shot packet into receipt-backed, canonical R2
 * stills.  It is deliberately create-only and replayable: a retry reuses a
 * fully verified sidecar and never submits the same image wave twice.
 */
import { idempotencyKeys, task, tasks } from "@trigger.dev/sdk";
import { assertWeeklyPreparationVersionsSupported } from "@/lib/weeklyPreparationVersionAdmission";
import { generationProfile, isProductionQualityGenerationProfile, type GenerationProfile } from "@/engine/generationProfiles";
import { StillRenderManifestSchema, type StillRenderManifest } from "@/engine/renderArtifacts";
import {
  assertPlanWeekPreparedImagesBinding,
  assertPlanWeekPreparationManifestBinding,
  normalizePlanWeekPreparationManifest,
  planWeekPreparedImageKey,
  planWeekPreparedImagesKey,
  planWeekPreparedFootageClipKey,
  planWeekPreparedH3FirstFrameKey,
  planWeekPreparationKey,
  planWeekPreparationManifestSha256,
  PLAN_WEEK_PREPARATION_VERSION,
  type PlanWeekPreparedImages,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import {
  buildMiniMaxH3SceneRequest,
  type MiniMaxH3RenderRequest,
} from "@/lib/minimaxH3";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { getObjectBytes } from "@/lib/storage";
import { persistPreparedResult } from "@/lib/preparedResultStorage";
import { PREPARED_METADATA_READ, decodePreparedMetadata, preparedObjectAbsent as objectNotFound } from "@/lib/preparedMediaStorage";
import { forEachPreparedMedia } from "@/lib/preparedMediaBatch";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { claimPreparedGeneration } from "@/lib/preparedGenerationClaim";
import { renderImages, toNovitaPhaseProfile, type Shot } from "@/lib/novitaRenderFarm";

export interface PlanWeekPreparedImageShot {
  id: string;
  prompt: string;
  negative?: string;
  seed?: number;
  candidateCount?: number;
  cameraMove?: Shot["cameraMove"];
  shotScale?: Shot["shotScale"];
  lens?: string;
  seconds?: number;
  motion?: string;
}

export interface PlanWeekPreparedImagesArgs {
  ownerId: string;
  channelId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
  manifestKey: string;
  manifestSha256: string;
  shots: PlanWeekPreparedImageShot[];
  generationProfile?: "production" | "hero";
  style?: string;
  negative?: string;
  director?: string;
  maxCostUsd: number;
}

type PreparedH3Batch = {
  orderKey: string;
  receiptKey: string;
  jobs: Array<Omit<MiniMaxH3RenderRequest, "provider" | "execution">>;
  sceneIds: string[];
  firstFrames: Array<{ sourceKey: string; destinationKey: string; sha256: string; byteLength: number }>;
};

function safePart(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)) {
    throw new Error(`weekly prepared images ${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value.trim().toLowerCase())) {
    throw new Error(`weekly prepared images ${label} is invalid`);
  }
  return value.trim().toLowerCase();
}

const CAMERA_MOVES = new Set<Shot["cameraMove"]>([
  "static", "dolly_push", "dolly_pull", "crane_up", "crane_down", "orbit_left", "orbit_right",
  "truck_left", "truck_right", "handheld_drift",
]);
const SHOT_SCALES = new Set<Shot["shotScale"]>(["wide", "medium", "close", "extreme_close", "establishing"]);

function generationIdentity(profile: GenerationProfile): StillRenderManifest["generation"] {
  return {
    contractVersion: profile.contractVersion,
    profileId: profile.id,
    model: profile.image.model,
    revision: profile.image.revision,
    checkpoint: profile.image.checkpoint,
    precision: profile.image.precision,
    width: profile.image.width,
    height: profile.image.height,
    steps: profile.image.steps,
    allowFallback: false,
  };
}

function canonicalScope(payload: PlanWeekPreparedImagesArgs) {
  return {
    ownerId: payload.ownerId,
    channelSlug: payload.channelSlug,
    batchId: payload.batchId,
    itemId: payload.itemId,
  };
}

export function hasGeneratedFootageStage(manifest: PlanWeekPreparationManifest): boolean {
  return manifest.execution.pipeline.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    const block = record.block ?? record.id;
    return block === "gen_footage" || block === "minimax_h3_video" || block === "signature_clips";
  });
}

/**
 * Translate the exact still packet into the existing weekly H3 request
 * contract. Candidate zero is the approved conditioning frame for each shot;
 * alternative image candidates remain available to the scheduled QA path but
 * are never accidentally rendered as duplicate video scenes.
 */
export function buildPreparedH3Batch(args: {
  payload: PlanWeekPreparedImagesArgs;
  prepared: PlanWeekPreparedImages;
  manifestSha256: string;
  maxCostUsd: number;
}): PreparedH3Batch {
  if (!Number.isFinite(args.maxCostUsd) || args.maxCostUsd <= 0 || args.maxCostUsd > 100) {
    throw new Error("weekly prepared H3 maxCostUsd must be greater than zero and no more than 100");
  }
  if (args.payload.shots.length < 1 || args.payload.shots.length > 60) {
    throw new Error("weekly prepared H3 requires 1..60 shot jobs");
  }
  const candidateZeroByShot = new Map(
    args.prepared.items
      .filter((item) => item.candidateIndex === 0)
      .map((item) => [item.shotId, item]),
  );
  if (candidateZeroByShot.size !== args.payload.shots.length) {
    throw new Error("weekly prepared H3 requires exactly one candidate-zero still for every shot");
  }
  const scope = canonicalScope(args.payload);
  const jobs: PreparedH3Batch["jobs"] = [];
  const firstFrames: PreparedH3Batch["firstFrames"] = [];
  const sceneIds: string[] = [];
  for (const [index, shot] of args.payload.shots.entries()) {
    const still = candidateZeroByShot.get(shot.id);
    if (!still) throw new Error(`weekly prepared H3 is missing candidate-zero still for ${shot.id}`);
    const firstFrame = {
      r2Key: planWeekPreparedH3FirstFrameKey({ ...scope, index }),
      sha256: still.sha256,
    };
    const output = {
      r2Key: planWeekPreparedFootageClipKey({ ...scope, index }),
    };
    const request = buildMiniMaxH3SceneRequest({
      provider: "salad",
      execution: "weekly-batch",
      prompt: shot.prompt,
      motionPrompt: shot.motion,
      negativePrompt: shot.negative,
      seed: shot.seed ?? 100_000 + index,
      firstFrame,
      output,
      maxCostUsd: args.maxCostUsd,
    });
    jobs.push({
      prompt: request.prompt,
      seed: request.seed,
      firstFrame: request.firstFrame,
      output: request.output,
      maxCostUsd: request.maxCostUsd,
    });
    sceneIds.push(shot.id);
    firstFrames.push({ sourceKey: still.stillKey, destinationKey: firstFrame.r2Key, sha256: still.sha256, byteLength: still.byteLength });
  }
  return {
    orderKey: `plan-week-h3-${args.manifestSha256.slice(0, 48)}`,
    receiptKey: `owner/${args.payload.ownerId}/weekly-h3/${args.payload.channelSlug}/${args.payload.batchId}/${args.payload.itemId}.json`,
    jobs,
    sceneIds,
    firstFrames,
  };
}

export function assertPlanWeekPreparedImagesArgs(value: unknown): PlanWeekPreparedImagesArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared images payload is invalid");
  const raw = value as Record<string, unknown>;
  const ownerId = safePart(raw.ownerId, "owner id");
  const channelId = safePart(raw.channelId, "channel id");
  const channelSlug = safePart(raw.channelSlug, "channel slug");
  const batchId = safePart(raw.batchId, "batch id");
  const itemId = safePart(raw.itemId, "item id");
  const manifestSha256 = digest(raw.manifestSha256, "manifest digest");
  const manifestKey = typeof raw.manifestKey === "string" ? raw.manifestKey : "";
  const expectedManifestKey = planWeekPreparationKey({ ownerId, channelSlug, batchId, itemId });
  if (manifestKey !== expectedManifestKey) throw new Error("weekly prepared images manifest key is not canonical");
  if (!Array.isArray(raw.shots) || raw.shots.length < 1 || raw.shots.length > 240) {
    throw new Error("weekly prepared images requires 1..240 approved shots");
  }
  const shots = raw.shots.map((candidate, index): PlanWeekPreparedImageShot => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`weekly prepared image shot ${index + 1} is invalid`);
    const shot = candidate as Record<string, unknown>;
    const id = safePart(shot.id, `shot ${index + 1} id`);
    const prompt = typeof shot.prompt === "string" ? shot.prompt.trim() : "";
    if (!prompt || prompt.length > 12_000) throw new Error(`weekly prepared image shot ${id} prompt is invalid`);
    const candidateCount = shot.candidateCount === undefined ? undefined : shot.candidateCount;
    if (candidateCount !== undefined && (!Number.isInteger(candidateCount) || Number(candidateCount) < 1 || Number(candidateCount) > 4)) {
      throw new Error(`weekly prepared image shot ${id} candidate count is invalid`);
    }
    const seed = shot.seed === undefined ? undefined : shot.seed;
    if (seed !== undefined && (!Number.isSafeInteger(seed) || Number(seed) < 0)) throw new Error(`weekly prepared image shot ${id} seed is invalid`);
    if (shot.cameraMove !== undefined && (typeof shot.cameraMove !== "string" || !CAMERA_MOVES.has(shot.cameraMove as Shot["cameraMove"]))) {
      throw new Error(`weekly prepared image shot ${id} camera move is invalid`);
    }
    if (shot.shotScale !== undefined && (typeof shot.shotScale !== "string" || !SHOT_SCALES.has(shot.shotScale as Shot["shotScale"]))) {
      throw new Error(`weekly prepared image shot ${id} shot scale is invalid`);
    }
    if (shot.seconds !== undefined && (typeof shot.seconds !== "number" || !Number.isFinite(shot.seconds) || shot.seconds <= 0 || shot.seconds > 300)) {
      throw new Error(`weekly prepared image shot ${id} seconds is invalid`);
    }
    return {
      id,
      prompt,
      ...(typeof shot.negative === "string" && shot.negative.trim() ? { negative: shot.negative.trim() } : {}),
      ...(seed === undefined ? {} : { seed: Number(seed) }),
      ...(candidateCount === undefined ? {} : { candidateCount: Number(candidateCount) }),
      ...(typeof shot.cameraMove === "string" ? { cameraMove: shot.cameraMove as Shot["cameraMove"] } : {}),
      ...(typeof shot.shotScale === "string" ? { shotScale: shot.shotScale as Shot["shotScale"] } : {}),
      ...(typeof shot.lens === "string" && shot.lens.trim() ? { lens: shot.lens.trim() } : {}),
      ...(shot.seconds === undefined ? {} : { seconds: Number(shot.seconds) }),
      ...(typeof shot.motion === "string" ? { motion: shot.motion } : {}),
    };
  });
  if (new Set(shots.map((shot) => shot.id)).size !== shots.length) throw new Error("weekly prepared image shot ids must be unique");
  const profileId = raw.generationProfile === undefined ? "production" : raw.generationProfile;
  if (profileId !== "production" && profileId !== "hero") throw new Error("weekly prepared images require a production or hero profile");
  const maxCostUsd = raw.maxCostUsd;
  if (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 1_000) {
    throw new Error("weekly prepared images maxCostUsd must be greater than zero and no more than 1000");
  }
  const profile = generationProfile(profileId);
  const expanded = shots.reduce((sum, shot) => sum + (shot.candidateCount ?? profile.image.candidates), 0);
  if (expanded > 240) throw new Error("weekly prepared images expanded candidate count exceeds 240");
  return {
    ownerId, channelId, channelSlug, batchId, itemId, manifestKey, manifestSha256, shots,
    generationProfile: profileId,
    ...(typeof raw.style === "string" && raw.style.trim() ? { style: raw.style.trim() } : {}),
    ...(typeof raw.negative === "string" && raw.negative.trim() ? { negative: raw.negative.trim() } : {}),
    ...(typeof raw.director === "string" && raw.director.trim() ? { director: raw.director.trim() } : {}),
    maxCostUsd,
  };
}

async function readPreparationManifest(payload: PlanWeekPreparedImagesArgs): Promise<PlanWeekPreparationManifest> {
  const manifestBytes = await getObjectBytes(payload.manifestKey, undefined, PREPARED_METADATA_READ);
  if (sha256BytesHex(manifestBytes) !== payload.manifestSha256) throw new Error("weekly prepared images manifest digest mismatch");
  const parsed = decodePreparedMetadata(manifestBytes);
  const normalized = normalizePlanWeekPreparationManifest(parsed);
  return assertPlanWeekPreparationManifestBinding({
    manifest: normalized,
    pointer: { version: PLAN_WEEK_PREPARATION_VERSION, manifestKey: payload.manifestKey, manifestSha256: payload.manifestSha256 },
    ownerId: payload.ownerId,
    channelId: payload.channelId,
    batchId: payload.batchId,
    itemId: payload.itemId,
    itemKey: normalized.itemKey,
    requestKey: normalized.requestKey,
    channelSlug: payload.channelSlug,
    topic: normalized.plan.topic,
    title: normalized.plan.title,
    thumbnailKey: normalized.plan.thumbnailKey,
    thumbnailSource: normalized.plan.thumbnailSource,
  });
}

export async function verifyStoredSidecar(key: string, manifest: PlanWeekPreparationManifest): Promise<PlanWeekPreparedImages | null> {
  let bytes: Uint8Array;
  try { bytes = await getObjectBytes(key, undefined, PREPARED_METADATA_READ); } catch (error) { if (objectNotFound(error)) return null; throw error; }
  const prepared = assertPlanWeekPreparedImagesBinding({ prepared: decodePreparedMetadata(bytes), manifest });
  await forEachPreparedMedia(prepared.items, async (item) => {
    const media = await getObjectBytes(item.stillKey, undefined, { maxBytes: item.byteLength, timeoutMs: 300_000 });
    if (media.byteLength !== item.byteLength || sha256BytesHex(media) !== item.sha256) {
      throw new Error(`weekly prepared image ${item.stillKey} failed its retained-byte integrity check`);
    }
  });
  return prepared;
}

async function persistMediaCreateOnly(key: string, bytes: Uint8Array): Promise<void> {
  await persistPreparedResult(key, bytes, "image/png", {});
}

export async function dispatchPreparedFootage(
  manifest: PlanWeekPreparationManifest,
  payload: PlanWeekPreparedImagesArgs,
  prepared: PlanWeekPreparedImages,
): Promise<string | undefined> {
  if (!hasGeneratedFootageStage(manifest)) return undefined;
  const maxCostUsd = Number(process.env.PLAN_WEEK_PREPARED_H3_MAX_COST_USD ?? "0.4");
  const batch = buildPreparedH3Batch({
    payload,
    prepared,
    manifestSha256: payload.manifestSha256,
    maxCostUsd,
  });
  // H3's weekly worker only admits canonical first-frame keys. Copying the
  // verified still bytes into that namespace is create-only and idempotent;
  // a changed winner fails before Salad capacity admission.
  await forEachPreparedMedia(batch.firstFrames, async (frame) => {
    const bytes = await getObjectBytes(frame.sourceKey, undefined, { maxBytes: frame.byteLength, timeoutMs: 300_000 });
    if (bytes.byteLength !== frame.byteLength || sha256BytesHex(bytes) !== frame.sha256) {
      throw new Error(`weekly prepared H3 source frame ${frame.sourceKey} failed its image receipt check`);
    }
    await persistMediaCreateOnly(frame.destinationKey, bytes);
  });
  const h3Payload = {
    ownerId: payload.ownerId,
    orderKey: batch.orderKey,
    receiptKey: batch.receiptKey,
    jobs: batch.jobs,
    capacityHoldStartedAt: Date.now(),
    preparedFootage: {
      ownerId: payload.ownerId,
      channelSlug: payload.channelSlug,
      batchId: payload.batchId,
      itemId: payload.itemId,
      manifestKey: payload.manifestKey,
      manifestSha256: payload.manifestSha256,
      sceneIds: batch.sceneIds,
    },
  };
  const idempotencyKey = await idempotencyKeys.create(
    `plan-week-h3:${payload.ownerId}:${payload.manifestSha256}`,
    { scope: "global" },
  );
  const handle = await tasks.trigger("minimax-h3-weekly-batch", h3Payload, {
    concurrencyKey: `plan-week-h3:${manifest.ownerId}:${manifest.channelId}`,
    idempotencyKey,
  });
  return handle.id;
}

export const planWeekPreparedImagesTask = task({
  id: "plan-week-prepared-images",
  maxDuration: 3_600,
  // Completed waves/handoffs can recover; an incomplete claimed generation
  // requires reconciliation instead of buying another image wave.
  retry: { maxAttempts: 2, minTimeoutInMs: 10_000, maxTimeoutInMs: 120_000, factor: 2 },
  queue: { concurrencyLimit: 1 },
  run: async (rawPayload: PlanWeekPreparedImagesArgs) => {
    const payload = assertPlanWeekPreparedImagesArgs(rawPayload);
    await bootstrapSecrets(() => undefined, {
      services: ["cloudflare"],
      required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
    });
    const manifest = await readPreparationManifest(payload);
    assertWeeklyPreparationVersionsSupported(manifest.execution.pipeline, "plan-week-prepared-images");
    const sidecarKey = planWeekPreparedImagesKey(canonicalScope(payload));
    const prior = await verifyStoredSidecar(sidecarKey, manifest);
    if (prior) {
      const h3TriggerRunId = await dispatchPreparedFootage(manifest, payload, prior);
      return { ok: true, reused: true, sidecarKey, outputs: prior.items.length, h3TriggerRunId, costUsd: 0, manifestSha256: prior.manifestSha256 };
    }
    const profile = generationProfile(payload.generationProfile);
    if (!isProductionQualityGenerationProfile(profile.id)) throw new Error("weekly prepared images rejected a non-production profile");
    const shots: Shot[] = payload.shots.map((shot) => ({
      id: shot.id,
      prompt: shot.prompt,
      cameraMove: shot.cameraMove ?? "static",
      shotScale: shot.shotScale ?? "medium",
      lens: shot.lens ?? "50mm",
      seconds: shot.seconds ?? 1,
      motion: shot.motion ?? "",
      ...(shot.negative ? { negative: shot.negative } : {}),
      ...(shot.seed === undefined ? {} : { seed: shot.seed }),
      ...(shot.candidateCount === undefined ? {} : { candidateCount: shot.candidateCount }),
    }));
    await bootstrapSecrets(() => undefined, { services: ["novita"] });
    await claimPreparedGeneration("images", manifest, { payload, shots, profile });
    const result = await renderImages({
      prefix: `${sidecarKey.slice(0, -".json".length)}/render`,
      shots,
      profile: toNovitaPhaseProfile(profile, "image"),
      ...(payload.style ? { style: payload.style } : {}),
      ...(payload.negative ? { negative: payload.negative } : {}),
      ...(payload.director ? { director: payload.director } : {}),
      maxCostUsd: payload.maxCostUsd,
      lifecycle: { ownerId: payload.ownerId, channelId: payload.channelId, runId: `plan-week-images-${payload.batchId}-${payload.itemId}`, blockId: "plan_week_prepared_images" },
    });
    const candidates = result.candidates ?? [];
    const expected = payload.shots.reduce((sum, shot) => sum + (shot.candidateCount ?? profile.image.candidates), 0);
    if (candidates.length !== expected) throw new Error(`weekly prepared images returned ${candidates.length} candidates; expected ${expected}`);
    const shotOrder = new Map(payload.shots.map((shot, index) => [shot.id, index]));
    const ordered = [...candidates].sort((a, b) => (shotOrder.get(a.shotId)! - shotOrder.get(b.shotId)!) || (a.candidateIndex - b.candidateIndex));
    const seen = new Set<string>();
    const items = [] as PlanWeekPreparedImages["items"];
    const stillItems = [] as StillRenderManifest["items"];
    for (const [index, candidate] of ordered.entries()) {
      const identity = `${candidate.shotId}:${candidate.candidateIndex}`;
      if (seen.has(identity)) throw new Error(`weekly prepared images returned duplicate candidate ${identity}`);
      seen.add(identity);
      const source = await getObjectBytes(candidate.key, undefined, { maxBytes: 50 * 1024 * 1024, timeoutMs: 300_000 });
      const stillKey = planWeekPreparedImageKey({ ...canonicalScope(payload), index });
      await persistMediaCreateOnly(stillKey, source);
      const sha256 = sha256BytesHex(source);
      items.push({ shotId: candidate.shotId, candidateIndex: candidate.candidateIndex, stillKey, sha256, byteLength: source.byteLength });
      stillItems.push({ shotId: candidate.shotId, candidateIndex: candidate.candidateIndex, outputId: candidate.outputId, stillKey });
    }
    const expectedIdentities = new Set(
      payload.shots.flatMap((shot) => Array.from({ length: shot.candidateCount ?? profile.image.candidates }, (_, candidateIndex) => `${shot.id}:${candidateIndex}`)),
    );
    if (seen.size !== expectedIdentities.size || [...expectedIdentities].some((identity) => !seen.has(identity))) {
      throw new Error("weekly prepared images returned an incomplete shot/candidate mapping");
    }
    const stillRenderManifest = StillRenderManifestSchema.parse({ version: "1.0.0", generation: generationIdentity(profile), items: stillItems });
    const prepared: PlanWeekPreparedImages = {
      version: "plan-week-prepared-images/v1",
      manifestSha256: planWeekPreparationManifestSha256(manifest),
      ownerId: manifest.ownerId,
      channelId: manifest.channelId,
      batchId: manifest.batchId,
      itemId: manifest.itemId,
      requestKey: manifest.requestKey,
      topic: manifest.plan.topic,
      stillRenderManifest,
      stillRenderManifestSha256: sha256Hex(canonicalJson(stillRenderManifest)),
      items,
      createdAt: Date.now(),
    };
    assertPlanWeekPreparedImagesBinding({ prepared, manifest });
    const body = new TextEncoder().encode(canonicalJson(prepared));
    await persistPreparedResult(sidecarKey, body, "application/json", { "plan-week-prepared-images": "v1" });
    const h3TriggerRunId = await dispatchPreparedFootage(manifest, payload, prepared);
    return { ok: true, reused: false, sidecarKey, outputs: items.length, h3TriggerRunId, costUsd: result.costUsd, manifestSha256: prepared.manifestSha256 };
  },
});
