export const STUDIO_R2_ASSET_RETENTION_VERSION = "studio-r2-asset-retention/v1" as const;
export const ORDINARY_ASSET_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const FINAL_VIDEO_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
export const ASSET_RETENTION_LEASE_MS = 5 * 60 * 1_000;

/** Only new, explicitly indexed run-local objects receive automatic expiry. */
export function classifyStudioR2Asset(input: {
  ownerId: string;
  channelSlug: string;
  runId?: string;
  kind: string;
  r2Key: string;
}): "ordinary" | "final_video" | null {
  const { ownerId, channelSlug, runId, kind, r2Key } = input;
  if (!runId || !ownerId || !channelSlug ||
      [ownerId, channelSlug, runId].some((part) => part.includes("/") || part.includes("\\") || part === "." || part === "..")) return null;
  const prefix = `owner/${ownerId}/channel/${channelSlug}/runs/${runId}/`;
  if (!r2Key.startsWith(prefix) || r2Key.length <= prefix.length || r2Key.includes("\\") ||
      r2Key.split("/").some((part) => !part || part === "." || part === "..")) return null;
  if (kind === "video" || kind === "derived_short") {
    return r2Key.endsWith(".mp4") ? "final_video" : null;
  }
  if (!kind || kind.length > 80 || /[\u0000-\u001f]/.test(kind)) return null;
  return "ordinary";
}

export function studioR2AssetExpiresAt(classification: "ordinary" | "final_video", createdAt: number): number {
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error("invalid asset creation time");
  return createdAt + (classification === "final_video" ? FINAL_VIDEO_RETENTION_MS : ORDINARY_ASSET_RETENTION_MS);
}
