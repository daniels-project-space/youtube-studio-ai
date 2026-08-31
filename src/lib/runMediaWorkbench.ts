/**
 * Presentation-safe helpers for the durable media registry. They only reason
 * about media that a run has already persisted; they do not infer rendering
 * progress from an expected pipeline shape.
 */
export type RunMediaAsset = {
  _id: string;
  _creationTime: number;
  kind: string;
  r2Key: string;
  meta?: unknown;
};

export type RunStageReceipt = {
  block: string;
  status: string;
};

export type MediaType = "image" | "video" | "audio" | "file";

const INITIAL_MEDIA_LIMIT = 12;

export function orderRunMedia(assets: readonly RunMediaAsset[]): RunMediaAsset[] {
  return [...assets].sort((left, right) => right._creationTime - left._creationTime);
}

export function selectedRunMaster(
  assets: readonly RunMediaAsset[],
  selectedVideoAssetId?: string,
): RunMediaAsset | undefined {
  if (selectedVideoAssetId) {
    const selected = assets.find((asset) => asset._id === selectedVideoAssetId);
    if (selected && mediaType(selected) === "video") return selected;
  }

  return orderRunMedia(assets).find((asset) => mediaType(asset) === "video");
}

export function visibleRunMedia(
  ordered: readonly RunMediaAsset[],
  selectedMaster: RunMediaAsset | undefined,
  showAll: boolean,
): RunMediaAsset[] {
  if (showAll) return [...ordered];

  const initial = ordered.slice(0, INITIAL_MEDIA_LIMIT);
  if (!selectedMaster || initial.some((asset) => asset._id === selectedMaster._id)) {
    return initial;
  }

  return [selectedMaster, ...initial.slice(0, Math.max(0, INITIAL_MEDIA_LIMIT - 1))];
}

export function mediaType(asset: Pick<RunMediaAsset, "kind" | "r2Key">): MediaType {
  const kind = asset.kind.toLowerCase();
  const extension = asset.r2Key.split(".").at(-1)?.toLowerCase();

  if (
    ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(extension ?? "") ||
    ["thumbnail", "keyframe", "upscaled", "image", "still", "scene"].includes(kind)
  ) {
    return "image";
  }
  if (
    ["mp4", "webm", "mov", "m4v"].includes(extension ?? "") ||
    ["video", "clip", "loop_unit", "derived_short"].includes(kind)
  ) {
    return "video";
  }
  if (
    ["mp3", "wav", "m4a", "aac", "ogg"].includes(extension ?? "") ||
    ["audio", "music", "narration", "voiceover"].includes(kind)
  ) {
    return "audio";
  }
  return "file";
}

export function assetLabel(kind: string): string {
  return kind
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function fileName(r2Key: string): string {
  return r2Key.split("/").filter(Boolean).at(-1) ?? r2Key;
}

export function mediaFacts(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const record = meta as Record<string, unknown>;
  const facts: string[] = [];
  const duration = scalar(record.durationSec);
  if (duration !== undefined) facts.push(`Duration ${duration}s`);

  const resolution = scalar(record.resolution);
  const width = scalar(record.width);
  const height = scalar(record.height);
  if (resolution !== undefined) facts.push(`Resolution ${resolution}`);
  else if (width !== undefined && height !== undefined) facts.push(`${width} × ${height}`);

  for (const [label, key] of [
    ["Engine", "engine"],
    ["Model", "model"],
    ["Provider", "provider"],
    ["Frames", "frames"],
    ["Panels", "panels"],
    ["Shots", "shots"],
    ["Chapters", "chapters"],
    ["Tracks", "tracks"],
    ["Cues", "cues"],
  ] as const) {
    const value = scalar(record[key]);
    if (value !== undefined) facts.push(`${label} ${value}`);
    if (facts.length >= 4) break;
  }

  return facts.slice(0, 4);
}

export function summarizeStageReceipts(stages: readonly RunStageReceipt[] | undefined): {
  verifiedLabel: string;
  activeLabel: string;
  tone: "neutral" | "active" | "attention" | "complete";
} {
  if (stages === undefined) {
    return { verifiedLabel: "…", activeLabel: "Loading", tone: "neutral" };
  }

  const verified = stages.filter((stage) => stage.status === "ok" || stage.status === "skipped").length;
  const active = stages.find((stage) => stage.status === "running");
  const failed = stages.find((stage) => stage.status === "failed");

  if (active) {
    return {
      verifiedLabel: `${verified}/${stages.length}`,
      activeLabel: assetLabel(active.block),
      tone: "active",
    };
  }
  if (failed) {
    return {
      verifiedLabel: `${verified}/${stages.length}`,
      activeLabel: "Needs attention",
      tone: "attention",
    };
  }
  if (stages.length > 0 && verified === stages.length) {
    return {
      verifiedLabel: `${verified}/${stages.length}`,
      activeLabel: "No active stage",
      tone: "complete",
    };
  }
  return {
    verifiedLabel: `${verified}/${stages.length}`,
    activeLabel: "Awaiting receipt",
    tone: "neutral",
  };
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}
