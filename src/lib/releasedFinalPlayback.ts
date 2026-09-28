import { FINAL_VIDEO_RETENTION_MS, releasedFinalVideoKey } from "./r2AssetRetention";

export type ReleasedFinalPlaybackRow = {
  ownerId: string;
  channelId: string;
  runId: string;
  releaseAt: number;
  certificateKey: string;
  certificateFingerprint: string;
  sourceKey: string;
  sourceSha256: string;
  sourceByteLength: number;
  copyKey: string;
  status: "active" | "finished";
  finishedAt?: number;
  copyEtag?: string;
  copyLastModifiedAt?: number;
};

/** Keep the certified source separate from the copy used by released viewers. */
export function releasedFinalPlaybackKey(input: {
  ownerId: string;
  channelId: string;
  keyPrefix?: string;
  runId: string;
  certificateKey?: string;
  sourceKey: string | null;
  certifiedSourceKey?: string;
  rows: readonly ReleasedFinalPlaybackRow[];
  publicReleaseObserved: boolean;
  releaseAt?: number;
  now: number;
}): string | null {
  if (!input.sourceKey) return null;
  if (!input.publicReleaseObserved && input.rows.length === 0) return input.sourceKey;
  if (!input.certificateKey || input.certifiedSourceKey !== input.sourceKey ||
      !Number.isSafeInteger(input.now)) return null;

  const valid = input.rows.filter((row) => {
    if (row.status !== "finished" || row.ownerId !== input.ownerId ||
        row.releaseAt !== input.releaseAt ||
        row.channelId !== input.channelId || row.runId !== input.runId ||
        row.certificateKey !== input.certificateKey || row.sourceKey !== input.sourceKey ||
        !/^[a-f0-9]{64}$/u.test(row.certificateFingerprint) ||
        !Number.isSafeInteger(row.sourceByteLength) || row.sourceByteLength < 1 ||
        !Number.isSafeInteger(row.releaseAt) || row.releaseAt > input.now ||
        row.releaseAt + FINAL_VIDEO_RETENTION_MS <= input.now ||
        !Number.isSafeInteger(row.finishedAt) || !row.copyEtag ||
        !Number.isSafeInteger(row.copyLastModifiedAt)) return false;
    try {
      const prefix = input.keyPrefix;
      return Boolean(prefix?.startsWith(`owner/${input.ownerId}/channel/`)) &&
        row.sourceKey.startsWith(`${prefix}runs/${input.runId}/`) &&
        row.copyKey === releasedFinalVideoKey(prefix!, input.runId, row.releaseAt, row.sourceSha256);
    } catch {
      return false;
    }
  }).sort((a, b) => b.releaseAt - a.releaseAt);
  return valid[0]?.copyKey ?? null;
}
