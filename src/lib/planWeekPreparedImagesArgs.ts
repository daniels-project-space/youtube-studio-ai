import { planWeekPreparationKey } from "@/lib/planWeekPreparation";
import { generationProfile } from "@/engine/generationProfiles";
import type { Shot } from "@/lib/novitaRenderFarm";

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
