export const ASSET_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const FINAL_VIDEO_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
export const YOUTUBE_STUDIO_R2_BUCKET = "youtube-studio-ai";

export type ReleasedOrdinaryClass = "lofi-clip" | "lofi-loop-unit";

export function isLoFiOrdinarySource(
  kind: ReleasedOrdinaryClass, keyPrefix: string, runId: string, sourceKey: string,
): boolean {
  const prefix = `${keyPrefix}runs/${runId}/`;
  if (!/^owner\/[^/]+\/channel\/[^/]+\/$/u.test(keyPrefix) || !/^[^/]+$/u.test(runId) ||
      !sourceKey.startsWith(prefix)) return false;
  const name = sourceKey.slice(prefix.length);
  return kind === "lofi-clip" ? name === "loopraw.mp4" : /^loopunit_(?:2k|4k|1080p)\.mp4$/u.test(name);
}

export function releasedOrdinaryAssetKey(
  keyPrefix: string, runId: string, kind: ReleasedOrdinaryClass,
  assetId: string, releaseAt: number, sha256: string,
): string {
  if (!/^owner\/[^/]+\/channel\/[^/]+\/$/u.test(keyPrefix) || !/^[^/]+$/u.test(runId) ||
      !/^[A-Za-z0-9_-]+$/u.test(assetId) || !Number.isSafeInteger(releaseAt) || releaseAt < 0 ||
      !/^[a-f0-9]{64}$/u.test(sha256) || !["lofi-clip", "lofi-loop-unit"].includes(kind)) {
    throw new Error("released ordinary asset needs an owned row, class, release time, and SHA-256");
  }
  return `released-ordinary/v2/${keyPrefix}runs/${runId}/${kind}/${assetId}/${releaseAt}-${sha256}.mp4`;
}

export function releasedOrdinaryAssetIdentity(key: string): {
  kind: ReleasedOrdinaryClass; assetId: string; releaseAt: number; sha256: string;
} | null {
  const match = /^released-ordinary\/v2\/owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/(lofi-clip|lofi-loop-unit)\/([A-Za-z0-9_-]+)\/([0-9]+)-([a-f0-9]{64})\.mp4$/u.exec(key);
  if (!match) return null;
  const releaseAt = Number(match[3]);
  return Number.isSafeInteger(releaseAt) && releaseAt >= 0
    ? { kind: match[1] as ReleasedOrdinaryClass, assetId: match[2], releaseAt, sha256: match[4] } : null;
}

/** Delivery boundary also checks the encoded release deadline, independent of cron. */
export function classedReleaseCopyExpiresAt(key: string): number | undefined {
  if (key.startsWith("released-ordinary/v2/") && key.includes("/lofi-keyframe/")) {
    const identity = releasedKeyframeIdentity(key);
    return identity ? identity.releaseAt + ASSET_RETENTION_MS : 0;
  }
  if (key.startsWith("released-ordinary/v2/")) {
    const identity = releasedOrdinaryAssetIdentity(key);
    return identity ? identity.releaseAt + ASSET_RETENTION_MS : 0;
  }
  if (key.startsWith("released-final/v2/")) {
    const identity = releasedFinalVideoIdentity(key);
    return identity ? identity.releaseAt + FINAL_VIDEO_RETENTION_MS : 0;
  }
  // Preserve the deadline of exact pre-v2 receipts. These nested keys never
  // participate in the root-prefix lifecycle rule or any new writer.
  if (key.includes("/released-keyframe/v1/")) {
    const match = /^owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/released-keyframe\/v1\/([0-9]+)-[a-f0-9]{64}\.png$/u.exec(key);
    const releaseAt = Number(match?.[1]);
    return match && Number.isSafeInteger(releaseAt) ? releaseAt + ASSET_RETENTION_MS : 0;
  }
  if (key.includes("/released-ordinary/v1/")) {
    const match = /^owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/released-ordinary\/v1\/(?:lofi-clip|lofi-loop-unit)\/[A-Za-z0-9_-]+\/([0-9]+)-[a-f0-9]{64}\.mp4$/u.exec(key);
    const releaseAt = Number(match?.[1]);
    return match && Number.isSafeInteger(releaseAt) ? releaseAt + ASSET_RETENTION_MS : 0;
  }
  if (key.includes("/released-final/v1/")) {
    const match = /^owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/released-final\/v1\/([0-9]+)-[a-f0-9]{64}\.mp4$/u.exec(key);
    const releaseAt = Number(match?.[1]);
    return match && Number.isSafeInteger(releaseAt) ? releaseAt + FINAL_VIDEO_RETENTION_MS : 0;
  }
  return undefined;
}

export function classedReleaseCopyIsReadable(key: string, now: number): boolean {
  const expiresAt = classedReleaseCopyExpiresAt(key);
  return expiresAt === undefined || Number.isSafeInteger(expiresAt) && Number.isSafeInteger(now) && now < expiresAt;
}

/** The root lifecycle namespaces still require an exact owner and key parser at delivery. */
export function isOwnedReleasedCopyKey(key: string, ownerId: string): boolean {
  if (key.startsWith("released-ordinary/v2/")) {
    if (!key.startsWith(`released-ordinary/v2/owner/${ownerId}/`)) return false;
    return releasedKeyframeIdentity(key) !== null || releasedOrdinaryAssetIdentity(key) !== null;
  }
  return key.startsWith(`released-final/v2/owner/${ownerId}/`) && releasedFinalVideoIdentity(key) !== null;
}

export type ScheduledClassedExpiration = {
  r2Key: string; etag: string; lastModifiedAt: number; expiresAt: number;
  classedProof: {
    class: "lofi-keyframe" | ReleasedOrdinaryClass; assetId: string;
    sourceKey: string; sourceEtag: string; sha256: string;
    byteLength: number; releaseAt: number;
  };
};

/** Read-only candidate proof. R2 has no atomic ETag-conditional delete for this path. */
export function hasExactScheduledClassedProof(
  row: ScheduledClassedExpiration,
  head: { etag?: string; lastModified?: Date; contentLength?: number; metadata: Record<string, string> } | null,
  now: number,
): boolean {
  const proof = row.classedProof;
  const match = /^released-ordinary\/v2\/owner\/[^/]+\/channel\/[^/]+\/runs\/([^/]+)\//u.exec(row.r2Key);
  const keyPrefix = /^released-ordinary\/v2\/(owner\/[^/]+\/channel\/[^/]+\/)runs\//u.exec(row.r2Key)?.[1];
  if (!match || !keyPrefix || !head?.etag || !head.lastModified || !proof ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(row.expiresAt) ||
      now < row.expiresAt || now < row.lastModifiedAt + ASSET_RETENTION_MS ||
      head.etag !== row.etag || head.lastModified.getTime() !== row.lastModifiedAt ||
      head.contentLength !== proof.byteLength ||
      proof.releaseAt + ASSET_RETENTION_MS !== row.expiresAt ||
      !/^[a-f0-9]{64}$/u.test(proof.sha256) ||
      !/^[A-Za-z0-9_-]+$/u.test(proof.assetId)) return false;
  const runId = match[1];
  let expectedKey: string;
  try {
    expectedKey = proof.class === "lofi-keyframe"
      ? releasedKeyframeKey(keyPrefix, runId, proof.releaseAt, proof.sha256)
      : releasedOrdinaryAssetKey(keyPrefix, runId, proof.class, proof.assetId, proof.releaseAt, proof.sha256);
  } catch {
    return false;
  }
  const sourceAllowed = proof.class === "lofi-keyframe"
    ? isLoFiKeyframeSource(keyPrefix, runId, proof.sourceKey)
    : isLoFiOrdinarySource(proof.class, keyPrefix, runId, proof.sourceKey);
  if (!sourceAllowed || row.r2Key !== expectedKey) return false;
  const metadata = Object.fromEntries(Object.entries(head.metadata).map(([key, value]) => [key.toLowerCase(), value]));
  return metadata.retentionwriter === "released-ordinary/v2" &&
    metadata[proof.class === "lofi-keyframe" ? "retentionkeyframesha256" : "retentionassetsha256"] === proof.sha256 &&
    metadata.retentionsourcekey === proof.sourceKey &&
    metadata.retentionsourceetag === proof.sourceEtag &&
    metadata.retentionassetid === proof.assetId &&
    metadata.retentionreleaseat === String(proof.releaseAt) &&
    metadata.retentionexpiresat === String(row.expiresAt) &&
    (proof.class === "lofi-keyframe" || metadata.retentionassetclass === proof.class);
}

/** The only eligible ordinary copy source is a marked Lo-Fi still in its own run. */
export function isLoFiKeyframeSource(keyPrefix: string, runId: string, sourceKey: string): boolean {
  return sourceKey.startsWith(`${keyPrefix}runs/${runId}/lofi-keyframe/images/`) &&
    /^owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/lofi-keyframe\/images\/[^/]+\.png$/u.test(sourceKey);
}

export function releasedKeyframeKey(keyPrefix: string, runId: string, releaseAt: number, sha256: string): string {
  if (!/^owner\/[^/]+\/channel\/[^/]+\/$/u.test(keyPrefix) || !/^[^/]+$/u.test(runId) ||
      !Number.isSafeInteger(releaseAt) || releaseAt < 0 || !/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error("released keyframe needs an owned run, release time, and SHA-256");
  }
  return `released-ordinary/v2/${keyPrefix}runs/${runId}/lofi-keyframe/${releaseAt}-${sha256}.png`;
}

export function releasedKeyframeIdentity(key: string): { releaseAt: number; sha256: string } | null {
  const match = /^released-ordinary\/v2\/owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/lofi-keyframe\/([0-9]+)-([a-f0-9]{64})\.png$/u.exec(key);
  if (!match) return null;
  const releaseAt = Number(match[1]);
  return Number.isSafeInteger(releaseAt) && releaseAt >= 0 ? { releaseAt, sha256: match[2] } : null;
}

/** Release copies are separate from the certificate's immutable source master. */
export function releasedFinalVideoKey(keyPrefix: string, runId: string, releaseAt: number, sha256: string): string {
  if (!/^owner\/[^/]+\/channel\/[^/]+\/$/u.test(keyPrefix) || !/^[^/]+$/u.test(runId) ||
      !Number.isSafeInteger(releaseAt) || releaseAt < 0 || !/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error("released final video needs an owned run, release time, and SHA-256");
  }
  return `released-final/v2/${keyPrefix}runs/${runId}/${releaseAt}-${sha256}.mp4`;
}

export function releasedFinalVideoIdentity(key: string): { releaseAt: number; sha256: string } | null {
  const match = /^released-final\/v2\/owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/([0-9]+)-([a-f0-9]{64})\.mp4$/u.exec(key);
  if (!match) return null;
  const releaseAt = Number(match[1]);
  return Number.isSafeInteger(releaseAt) && releaseAt >= 0 ? { releaseAt, sha256: match[2] } : null;
}

/** Reusable bytes live outside run expiry scopes and bind their full content digest. */
export function permanentReusableMediaKey(keyPrefix: string, sha256: string): string {
  if (!/^owner\/[^/]+\/channel\/[^/]+\/$/u.test(keyPrefix) || !/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error("permanent reusable media needs an owned channel prefix and SHA-256");
  }
  return `${keyPrefix}library/reusable-media/v1/${sha256}.mp4`;
}

export function permanentReusableMediaDigest(key: string): string | null {
  return /^owner\/[^/]+\/channel\/[^/]+\/library\/reusable-media\/v1\/([a-f0-9]{64})\.mp4$/u.exec(key)?.[1] ?? null;
}

/** This exact family has one create-only writer; all other run media remain report-only. */
export function isImmutableAtlasCropKey(key: string): boolean {
  return /^owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/novita\/atlas-crops\/[^/]+\/c[0-9]{2}-[a-f0-9]{12}-[a-f0-9]{16}-[^/]+\.png$/u.test(key);
}

export function hasImmutableAtlasCropProof(key: string, metadata: Record<string, string>): boolean {
  const normalized = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k.toLowerCase(), v]));
  const digest = immutableAtlasCropDigest(key);
  return digest !== null && normalized.cropsha256 === digest &&
    normalized.retentionwriter === "atlas-crop/v1" && Boolean(normalized.atlasruntime && normalized.atlasplan);
}

/** New crop keys carry the complete derivative digest; older crop names stay report-only. */
export function immutableAtlasCropDigest(key: string): string | null {
  return /^owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/novita\/atlas-crops\/[^/]+\/c[0-9]{2}-[a-f0-9]{12}-[a-f0-9]{16}-[^/]+-([a-f0-9]{64})\.png$/u.exec(key)?.[1] ?? null;
}

/** Future quiz masters have a single create-only file writer and digest-bearing key. */
export function immutableQuizFinalDigest(key: string): string | null {
  const match = /^owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/(quiz-year|quiz-short)\/\1-([a-f0-9]{64})\.mp4$/u.exec(key);
  return match?.[2] ?? null;
}

export function hasImmutableQuizFinalProof(key: string, metadata: Record<string, string>): boolean {
  const digest = immutableQuizFinalDigest(key);
  const normalized = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k.toLowerCase(), v]));
  return digest !== null && normalized.retentionfinalsha256 === digest && normalized.retentionwriter === "quiz-final/v1";
}

export function immutableIntroCardDigest(key: string): string | null {
  return /^owner\/[^/]+\/channel\/[^/]+\/runs\/[^/]+\/introcard-([a-f0-9]{64})\.mp4$/u.exec(key)?.[1] ?? null;
}

export function hasImmutableIntroCardProof(key: string, metadata: Record<string, string>): boolean {
  const digest = immutableIntroCardDigest(key);
  const normalized = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k.toLowerCase(), v]));
  return digest !== null && normalized.retentionintrosha256 === digest && normalized.retentionwriter === "intro-card/v1";
}

export function isManagedRetentionKey(key: string): boolean {
  return immutableIntroCardDigest(key) !== null || immutableQuizFinalDigest(key) !== null ||
    immutableAtlasCropDigest(key) !== null;
}

export function assertYouTubeStudioR2Bucket(bucket: string | undefined): typeof YOUTUBE_STUDIO_R2_BUCKET {
  if (bucket !== YOUTUBE_STUDIO_R2_BUCKET) {
    throw new Error("R2 retention requires the exact YouTube Studio bucket");
  }
  return YOUTUBE_STUDIO_R2_BUCKET;
}

export type ListedR2Object = { key: string; lastModified?: Date; etag?: string; size?: number };
export type RetentionObjectHead = { lastModified?: Date; etag?: string; metadata: Record<string, string> };

/** Exact read-only identity and writer proof required before an object can expire. */
export function hasExactImmutableRetentionProof(
  record: ListedR2Object,
  head: RetentionObjectHead | null,
  kind: "asset" | "final_video" | "footage",
): boolean {
  if (kind === "footage" || !head?.lastModified || !head.etag || !record.lastModified || !record.etag ||
      head.lastModified.getTime() !== record.lastModified.getTime() || head.etag !== record.etag) return false;
  return kind === "asset"
    ? hasImmutableIntroCardProof(record.key, head.metadata) || hasImmutableAtlasCropProof(record.key, head.metadata)
    : hasImmutableQuizFinalProof(record.key, head.metadata);
}

export type RunR2RetentionScope = {
  runId: string;
  channelId?: string;
  releaseVideoId?: string;
  keyPrefix: string;
  runStatus: string;
  retentionStatus?: string;
  releaseAt?: number;
  retainUntil?: number;
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
      scope.retentionStatus !== "completed" ||
      !Number.isSafeInteger(scope.releaseAt) ||
      scope.releaseAt! > now - ASSET_RETENTION_MS ||
      !Number.isSafeInteger(scope.retainUntil) ||
      scope.retainUntil! > now ||
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
    if (args.finalVideoKeys.has(record.key) || /(?:^|\/)final[^/]*\.mp4$/iu.test(record.key)) {
      if (age! <= now - FINAL_VIDEO_RETENTION_MS && scope.releaseAt! <= now - FINAL_VIDEO_RETENTION_MS) {
        expiredFinals.push(record);
      } else skipped++;
    } else if (age! <= now - ASSET_RETENTION_MS &&
        (immutableIntroCardDigest(record.key) || immutableAtlasCropDigest(record.key))) {
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
