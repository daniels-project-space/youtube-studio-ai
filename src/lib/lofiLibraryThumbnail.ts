import { LOFI_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION } from "@/lib/thumbnailRefreshInventory";

type UnknownRecord = Record<string, unknown>;

export type LofiLibraryThumbnailAsset = Readonly<{
  runId: string;
  r2Key: string;
  meta?: unknown;
}>;

export type LofiLibraryThumbnailCandidate = Readonly<{
  status: string;
  finishedAt?: number;
  startedAt?: number;
  thumbnail?: LofiLibraryThumbnailAsset | null;
}>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** A channel family is authoritative; content-lane values cover older rows. */
export function isLofiChannel(input: {
  family?: unknown;
  contentLane?: unknown;
}): boolean {
  if (input.family === "music_loop") return true;
  const lane = record(input.contentLane);
  return lane?.family === "music_loop" || lane?.key === "music_loop";
}

/**
 * Accept only a thumbnail whose own sealed evidence binds it to this exact
 * retained final master. A lookalike legacy thumbnail is never presented as a
 * Lo-Fi rendered-frame image merely because its filename or channel matches.
 */
export function isVerifiedLofiRenderedFrameThumbnail(input: {
  ownerId: string;
  channelId: string;
  sourceVideoKey: string | null;
  asset: LofiLibraryThumbnailAsset | null | undefined;
}): input is {
  ownerId: string;
  channelId: string;
  sourceVideoKey: string;
  asset: LofiLibraryThumbnailAsset;
} {
  if (!input.sourceVideoKey || !input.asset?.r2Key || !input.asset.runId) return false;
  const evidence = record(record(input.asset.meta)?.thumbnailCurrentCandidateEvidence);
  return evidence?.version === LOFI_THUMBNAIL_CURRENT_CANDIDATE_EVIDENCE_VERSION &&
    evidence.ownerId === input.ownerId &&
    evidence.channelId === input.channelId &&
    evidence.runId === input.asset.runId &&
    evidence.r2Key === input.asset.r2Key &&
    evidence.generatorModule === "thumbnail_gen" &&
    evidence.contractVersion === "lofi-nano-banana-reference-thumbnail/v1" &&
    evidence.sideLane === "nano-banana-lofi-video-reference" &&
    evidence.sourceVideoKey === input.sourceVideoKey &&
    evidence.sourceFrameTimeSec === 15 &&
    evidence.sourceWidth === 3840 &&
    evidence.sourceHeight === 2160 &&
    evidence.publishable === true &&
    evidence.reviewState === "candidate_only" &&
    isSha256(evidence.artifactSha256) &&
    isSha256(evidence.sourceFrameSha256) &&
    isSha256(evidence.providerRequestSha256) &&
    isSha256(evidence.providerResponseSha256);
}

/**
 * A completed source-frame refresh is newer presentation material than the
 * source run's own thumbnail, but it stays a private Library preview until a
 * separate owner-confirmed YouTube replacement is applied.
 */
export function selectLofiLibraryThumbnail(input: {
  ownerId: string;
  channelId: string;
  sourceVideoKey: string | null;
  sourceThumbnail?: LofiLibraryThumbnailAsset | null;
  refreshCandidates?: readonly LofiLibraryThumbnailCandidate[];
}): LofiLibraryThumbnailAsset | null {
  const current = (input.refreshCandidates ?? [])
    .filter((candidate) => candidate.status === "ok" && Boolean(candidate.thumbnail))
    .sort((left, right) =>
      (right.finishedAt ?? right.startedAt ?? 0) - (left.finishedAt ?? left.startedAt ?? 0),
    )
    .map((candidate) => candidate.thumbnail!)
    .find((asset) => isVerifiedLofiRenderedFrameThumbnail({
      ownerId: input.ownerId,
      channelId: input.channelId,
      sourceVideoKey: input.sourceVideoKey,
      asset,
    }));
  if (current) return current;

  const sourceThumbnail = input.sourceThumbnail ?? null;
  if (!sourceThumbnail || !isVerifiedLofiRenderedFrameThumbnail({
    ownerId: input.ownerId,
    channelId: input.channelId,
    sourceVideoKey: input.sourceVideoKey,
    asset: sourceThumbnail,
  })) return null;
  return sourceThumbnail;
}
