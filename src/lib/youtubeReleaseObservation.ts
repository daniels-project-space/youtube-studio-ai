import type { RunArtifactReleaseObservation } from "@/lib/runArtifactRetention";

/** One bounded read of exact YouTube IDs; no provider writes. */
export async function fetchRunArtifactReleaseObservations(args: {
  accessToken: string;
  videoIds: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<Map<string, RunArtifactReleaseObservation>> {
  const ids = [...new Set(args.videoIds)];
  if (!ids.length) return new Map();
  if (ids.length > 50 || ids.some((id) => !/^[a-zA-Z0-9_-]{11}$/.test(id))) {
    throw new Error("YouTube release observation requires 1–50 exact video IDs");
  }
  const params = new URLSearchParams({
    part: "snippet,status", id: ids.join(","),
    fields: "items(id,snippet(channelId,publishedAt),status(privacyStatus,uploadStatus))",
  });
  const response = await (args.fetchImpl ?? fetch)(
    `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
    { headers: { Authorization: `Bearer ${args.accessToken}` }, signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`YouTube release observation HTTP ${response.status}`);
  const body = await response.json() as { items?: Array<{
    id?: string;
    snippet?: { channelId?: string; publishedAt?: string };
    status?: { privacyStatus?: string; uploadStatus?: string };
  }> };
  if (!Array.isArray(body.items)) throw new Error("YouTube release observation response is malformed");
  const output = new Map<string, RunArtifactReleaseObservation>();
  for (const item of body.items) {
    if (!item.id || !ids.includes(item.id) || output.has(item.id)) {
      throw new Error("YouTube release observation returned an unexpected or duplicate video");
    }
    output.set(item.id, {
      videoId: item.id, channelId: item.snippet?.channelId ?? "",
      ...(item.snippet?.publishedAt === undefined ? {} : { publishedAt: item.snippet.publishedAt }),
      ...(item.status?.privacyStatus === undefined ? {} : { privacyStatus: item.status.privacyStatus }),
      ...(item.status?.uploadStatus === undefined ? {} : { uploadStatus: item.status.uploadStatus }),
    });
  }
  return output;
}
