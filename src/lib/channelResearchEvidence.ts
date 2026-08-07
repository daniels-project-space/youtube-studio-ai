import { channelInceptionContentSha256 } from "@/engine/channelInceptionPlan";

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

interface ResearchNicheRow {
  ownerId?: string;
  niche?: string;
  refreshedAt?: number;
}

interface ResearchCompetitorRow {
  ownerId?: string;
  niche?: string;
  channelName?: string;
  refreshedAt?: number;
  topVideos?: Array<{
    youtubeVideoId?: string;
    videoId?: string;
    title?: string;
    views?: number;
  }>;
}

export interface ChannelResearchEvidence {
  version: "channel-research-evidence/v1";
  ownerId: string;
  niche: string;
  refreshedAt: number;
  competitorCount: number;
  videoCount: number;
  sampleFingerprint: string;
}

export function validateChannelResearchEvidence(args: {
  ownerId: string;
  niche: string;
  nicheIntel: ResearchNicheRow | null | undefined;
  competitors: ResearchCompetitorRow[];
  now?: number;
  maximumAgeMs?: number;
}): ChannelResearchEvidence | undefined {
  const now = args.now ?? Date.now();
  const maximumAgeMs = args.maximumAgeMs ?? DEFAULT_MAX_AGE_MS;
  const niche = args.niche.trim();
  const refreshedAt = Number(args.nicheIntel?.refreshedAt);
  if (
    !args.ownerId.trim() ||
    !niche ||
    args.nicheIntel?.ownerId !== args.ownerId ||
    args.nicheIntel?.niche !== niche ||
    !Number.isFinite(refreshedAt) ||
    refreshedAt > now + MAX_FUTURE_SKEW_MS ||
    now - refreshedAt > maximumAgeMs
  ) {
    return undefined;
  }

  const competitors = args.competitors.filter((competitor) =>
    competitor.ownerId === args.ownerId &&
    competitor.niche === niche &&
    Boolean(competitor.channelName?.trim()) &&
    Number.isFinite(competitor.refreshedAt) &&
    Number(competitor.refreshedAt) <= now + MAX_FUTURE_SKEW_MS &&
    now - Number(competitor.refreshedAt) <= maximumAgeMs
  );
  if (competitors.length < 1) return undefined;

  const videos = competitors.flatMap((competitor) => competitor.topVideos ?? [])
    .filter((video) =>
      Boolean((video.youtubeVideoId ?? video.videoId)?.trim()) &&
      Boolean(video.title?.trim()) &&
      Number.isFinite(video.views) &&
      Number(video.views) >= 0
    )
    .map((video) => ({
      videoId: (video.youtubeVideoId ?? video.videoId)!.trim(),
      title: video.title!.trim(),
      views: Number(video.views),
    }));
  if (new Set(videos.map((video) => video.videoId)).size < 3) return undefined;

  const sample = competitors.map((competitor) => ({
    channelName: competitor.channelName!.trim(),
    refreshedAt: competitor.refreshedAt,
    topVideos: (competitor.topVideos ?? []).map((video) => ({
      videoId: (video.youtubeVideoId ?? video.videoId ?? "").trim(),
      title: video.title?.trim() ?? "",
      views: Number(video.views ?? 0),
    })),
  }));
  return {
    version: "channel-research-evidence/v1",
    ownerId: args.ownerId,
    niche,
    refreshedAt: Math.min(
      refreshedAt,
      ...competitors.map((competitor) => Number(competitor.refreshedAt)),
    ),
    competitorCount: competitors.length,
    videoCount: new Set(videos.map((video) => video.videoId)).size,
    sampleFingerprint: channelInceptionContentSha256(sample),
  };
}

export function channelResearchEvidenceFingerprint(
  evidence: ChannelResearchEvidence,
): string {
  return channelInceptionContentSha256(evidence);
}
