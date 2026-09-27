export const ASSET_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const FINAL_VIDEO_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;

export type ListedR2Object = { key: string; lastModified?: Date; etag?: string; size?: number };
export type RunR2RetentionScope = {
  runId: string;
  keyPrefix: string;
  runStatus: string;
  channelLocked?: boolean;
  finishedAt?: number;
  certificateKey: string;
  additionalCertificateKeys: string[];
  keepNames: string[];
  retainedReleaseEvidence: string[];
  assets: Array<{ kind: string; r2Key: string }>;
};

/** Conservative, exact-key selection; the caller separately reloads certificates. */
export function selectExpiredRunObjects(args: {
  scope: RunR2RetentionScope;
  records: readonly ListedR2Object[];
  protectedKeys: ReadonlySet<string>;
  evidenceKeys: ReadonlySet<string>;
  finalVideoKeys: ReadonlySet<string>;
  now: number;
}): { expiredAssets: ListedR2Object[]; expiredFinals: ListedR2Object[]; skipped: number } {
  const { scope, now } = args;
  const prefix = `${scope.keyPrefix}runs/${scope.runId}/`;
  if (!/^owner\/[^/]+\/channel\/[^/]+\/$/u.test(scope.keyPrefix) ||
      !["ok", "failed", "canceled"].includes(scope.runStatus) ||
      scope.channelLocked ||
      !Number.isSafeInteger(scope.finishedAt) || scope.finishedAt! > now - ASSET_RETENTION_MS ||
      !Number.isSafeInteger(now) || now < 0) {
    return { expiredAssets: [], expiredFinals: [], skipped: args.records.length };
  }
  if (args.records.some((item) => !item.key.startsWith(prefix) || item.key === prefix) ||
      new Set(args.records.map((item) => item.key)).size !== args.records.length) {
    throw new Error("R2 retention listing escaped or duplicated its run scope");
  }
  const thumbnails = new Set(scope.assets.filter((asset) => asset.kind === "thumbnail").map((asset) => asset.r2Key));
  const keepNames = new Set(scope.keepNames.map((name) => `${prefix}${name.replace(/^\/+/, "")}`));
  const expiredAssets: ListedR2Object[] = [];
  const expiredFinals: ListedR2Object[] = [];
  let skipped = 0;
  for (const record of args.records) {
    const age = record.lastModified?.getTime();
    if (!Number.isFinite(age) || age! < 0 || age! > now ||
        args.protectedKeys.has(record.key) || args.evidenceKeys.has(record.key) ||
        (keepNames.has(record.key) && !args.finalVideoKeys.has(record.key)) || thumbnails.has(record.key) ||
        /(?:^|\/)thumbnail(?:s|-checkpoints)?(?:\/|[._-])/iu.test(record.key)) {
      skipped++;
      continue;
    }
    if (args.finalVideoKeys.has(record.key)) {
      if (age! <= now - FINAL_VIDEO_RETENTION_MS && scope.finishedAt! <= now - FINAL_VIDEO_RETENTION_MS) {
        expiredFinals.push(record);
      } else skipped++;
    } else if (age! <= now - ASSET_RETENTION_MS) {
      expiredAssets.push(record);
    } else skipped++;
  }
  return { expiredAssets, expiredFinals, skipped };
}

/** Other observed media families are reported until their ownership is proven. */
export function classifyUnboundR2Key(key: string): "generated_media" | "final_video" | "evidence" | "outside" {
  if (/^owner\/[^/]+\/channel\/[^/]+\/footage\/run\/[^/]+\/clip_[0-9]+\.mp4$/u.test(key) ||
      /^lustig\/film\/clips\/[^/]+\.mp4$/u.test(key) ||
      /^imagecraft\/[^/]+\/img[0-9]+\.(?:png|jpe?g|webp)$/u.test(key)) return "generated_media";
  if (/^(?:videocraft\/[^/]+\/(?:v[0-9]+\/)?final_2k|lustig-short\/final_2k|validation\/(?:inked-histories|netflix-blockbuster)\/[^/]+\/final)\.mp4$/u.test(key)) return "final_video";
  if (/^validation\/(?:inked-histories|netflix-blockbuster)\/[^/]+\/runs\/[^/]+\/visual-review\//u.test(key)) return "evidence";
  return "outside";
}
