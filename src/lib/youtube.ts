/**
 * YouTube Data API v3 uploader — unattended PRIVATE-draft upload via a stored
 * refresh token (MASTER-PLAN cross-cutting: OAuth + publish).
 *
 *   YOUTUBE_CLIENT_ID
 *   YOUTUBE_CLIENT_SECRET
 *   YOUTUBE_REFRESH_TOKEN
 *   (all vault-hydrated; never hardcoded)
 *
 * Flow:
 *   1. refresh_token grant -> short-lived access_token.
 *   2. POST videos?uploadType=resumable&part=snippet,status with the metadata
 *      body -> returns an upload session URL in the `location` header.
 *   3. PUT the video bytes to that URL -> returns the created video resource.
 *
 * privacyStatus is forced to "private" — this never publishes publicly.
 */
import { readFile } from "node:fs/promises";

export class YouTubeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeError";
  }
}

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new YouTubeError(`${name} is not configured`);
  return v;
}

/**
 * Exchange a refresh token for a fresh access token. Pass a per-channel token to
 * upload to that channel's YouTube; omit to use the global YOUTUBE_REFRESH_TOKEN.
 */
export async function getAccessToken(refreshToken?: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: reqEnv("YOUTUBE_CLIENT_ID"),
      client_secret: reqEnv("YOUTUBE_CLIENT_SECRET"),
      refresh_token: refreshToken || reqEnv("YOUTUBE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new YouTubeError(
      `token refresh failed: ${json.error ?? res.status} ${json.error_description ?? ""}`,
    );
  }
  return json.access_token;
}

/** OAuth scopes needed to upload + manage branding/captions/localizations. */
export const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
].join(" ");

/**
 * Build the Google consent URL for connecting a channel. `state` carries our
 * channelId back to the callback; `redirectUri` MUST be registered on the OAuth
 * client in Google Cloud. access_type=offline + prompt=consent → a refresh token,
 * and the account chooser lets the operator pick the Brand Account channel.
 */
export function getConsentUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: reqEnv("YOUTUBE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_SCOPES,
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** Exchange an authorization code for tokens (returns the refresh token). */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: reqEnv("YOUTUBE_CLIENT_ID"),
      client_secret: reqEnv("YOUTUBE_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as {
    refresh_token?: string; access_token?: string; error?: string; error_description?: string;
  };
  if (!res.ok || !json.refresh_token || !json.access_token) {
    throw new YouTubeError(
      `code exchange failed: ${json.error ?? res.status} ${json.error_description ?? ""} (codes are single-use; ensure access_type=offline + prompt=consent)`,
    );
  }
  return { refreshToken: json.refresh_token, accessToken: json.access_token };
}

/** The authenticated user's selected YouTube channel (id + title). */
export async function getChannelMine(
  accessToken: string,
): Promise<{ id: string; title: string } | null> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = (await res.json()) as { items?: { id: string; snippet?: { title?: string } }[] };
  const item = json.items?.[0];
  return item ? { id: item.id, title: item.snippet?.title ?? "" } : null;
}

/**
 * Apply channel branding (description / country / default language / keywords +
 * optional banner) via the official API. Fetches current brandingSettings first
 * (PUT replaces), merges, then writes. Native — runs after the channel is linked.
 */
export async function updateChannelBranding(args: {
  refreshToken?: string;
  ytChannelId: string;
  description?: string;
  country?: string;
  defaultLanguage?: string;
  keywords?: string;
  bannerExternalUrl?: string;
}): Promise<void> {
  const at = await getAccessToken(args.refreshToken);
  const cur = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=brandingSettings&id=${args.ytChannelId}`,
    { headers: { Authorization: `Bearer ${at}` } },
  );
  const curJson = (await cur.json()) as { items?: { brandingSettings?: Record<string, unknown> }[] };
  const bs = (curJson.items?.[0]?.brandingSettings ?? {}) as {
    channel?: Record<string, unknown>; image?: Record<string, unknown>;
  };
  bs.channel = {
    ...(bs.channel ?? {}),
    ...(args.description != null ? { description: args.description } : {}),
    ...(args.country ? { country: args.country } : {}),
    ...(args.defaultLanguage ? { defaultLanguage: args.defaultLanguage } : {}),
    ...(args.keywords ? { keywords: args.keywords } : {}),
  };
  if (args.bannerExternalUrl) bs.image = { ...(bs.image ?? {}), bannerExternalUrl: args.bannerExternalUrl };
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=brandingSettings", {
    method: "PUT",
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: args.ytChannelId, brandingSettings: bs }),
  });
  if (!res.ok) throw new YouTubeError(`branding update failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/**
 * Update an EXISTING video's title / tags / description via videos.update. Fetches
 * the current snippet first (categoryId is required on update) and merges. Used by
 * the SEO re-optimizer to fix underperforming titles without re-uploading.
 */
export async function updateVideoMetadata(args: {
  refreshToken?: string;
  videoId: string;
  title?: string;
  tags?: string[];
  description?: string;
}): Promise<void> {
  const at = await getAccessToken(args.refreshToken);
  const cur = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${args.videoId}`,
    { headers: { Authorization: `Bearer ${at}` } },
  );
  const curJson = (await cur.json()) as { items?: { snippet?: Record<string, unknown> }[] };
  const sn = curJson.items?.[0]?.snippet;
  if (!sn) throw new YouTubeError(`video ${args.videoId} not found for metadata update`);
  const snippet = {
    ...sn,
    ...(args.title ? { title: args.title.slice(0, 100) } : {}),
    ...(args.tags ? { tags: args.tags.slice(0, 30) } : {}),
    ...(args.description != null ? { description: args.description.slice(0, 4900) } : {}),
  };
  const res = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet", {
    method: "PUT",
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: args.videoId, snippet }),
  });
  if (!res.ok) throw new YouTubeError(`video metadata update failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** Upload a banner image; returns the bannerExternalUrl for brandingSettings.image. */
export async function uploadChannelBanner(
  refreshToken: string | undefined,
  imageBytes: Uint8Array,
  contentType = "image/png",
): Promise<string> {
  const at = await getAccessToken(refreshToken);
  const res = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/channelBanners/insert?uploadType=media",
    { method: "POST", headers: { Authorization: `Bearer ${at}`, "Content-Type": contentType }, body: imageBytes as BodyInit },
  );
  const j = (await res.json()) as { url?: string };
  if (!res.ok || !j.url) throw new YouTubeError(`banner upload failed: ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.url;
}

export interface UploadVideoArgs {
  /** Local path to the mp4 to upload. */
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  /** YouTube category id (default 10 = Music). */
  categoryId?: string;
  /** Privacy (default "private"). Auto-publish channels may use public/unlisted. */
  privacyStatus?: "private" | "public" | "unlisted";
  /**
   * ISO 8601 timestamp to SCHEDULE publish. When set, the video is uploaded
   * private and YouTube flips it public at this time (drip-publishing).
   */
  publishAt?: string;
  /** Per-channel refresh token; falls back to the global env token when omitted. */
  refreshToken?: string;
}

export interface UploadVideoResult {
  videoId: string;
  watchUrl: string;
  privacyStatus: string;
}

/**
 * Upload a local mp4 as a PRIVATE draft via the resumable endpoint. Returns the
 * created videoId + watch URL.
 */
/**
 * YouTube rejects tags ("invalidTags") when the TOTAL exceeds ~500 chars (tags
 * with spaces are counted with surrounding quotes, +2 each). Strip invalid
 * characters and greedily keep tags until the effective total hits a safe cap.
 */
function clampTags(tags: string[], maxTotal = 460): string[] {
  const out: string[] = [];
  let total = 0;
  for (const raw of tags) {
    const t = raw.replace(/[<>]/g, "").trim().slice(0, 60);
    if (!t) continue;
    const cost = t.length + (t.includes(" ") ? 2 : 0) + 1; // +quotes for spaces, +separator
    if (total + cost > maxTotal) break;
    out.push(t);
    total += cost;
  }
  return out;
}

export async function uploadPrivateDraft(
  args: UploadVideoArgs,
): Promise<UploadVideoResult> {
  const accessToken = await getAccessToken(args.refreshToken);
  const bytes = await readFile(args.filePath);

  const metadata = {
    snippet: {
      title: args.title.slice(0, 100),
      description: args.description.slice(0, 5000),
      tags: clampTags(args.tags),
      categoryId: args.categoryId ?? "10",
    },
    status: {
      // Scheduling requires the video be uploaded private with a publishAt; it
      // flips public at that time. Otherwise honour the requested privacy.
      privacyStatus: args.publishAt ? "private" : (args.privacyStatus ?? "private"),
      ...(args.publishAt ? { publishAt: args.publishAt } : {}),
      selfDeclaredMadeForKids: false,
    },
  };

  // Step 1: open a resumable session.
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(bytes.byteLength),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!initRes.ok) {
    const text = await initRes.text();
    throw new YouTubeError(
      `resumable init failed HTTP ${initRes.status}: ${text.slice(0, 300)}`,
    );
  }
  const sessionUrl = initRes.headers.get("location");
  if (!sessionUrl) {
    throw new YouTubeError("resumable init returned no Location header");
  }

  // Step 2: upload the bytes in a single PUT (fine for short M1 videos).
  const putRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(bytes.byteLength),
    },
    body: bytes,
  });
  const putJson = (await putRes.json()) as {
    id?: string;
    status?: { privacyStatus?: string };
    error?: { message?: string };
  };
  if (!putRes.ok || !putJson.id) {
    throw new YouTubeError(
      `upload PUT failed HTTP ${putRes.status}: ${putJson.error?.message ?? JSON.stringify(putJson).slice(0, 300)}`,
    );
  }
  return {
    videoId: putJson.id,
    watchUrl: `https://www.youtube.com/watch?v=${putJson.id}`,
    privacyStatus: putJson.status?.privacyStatus ?? "private",
  };
}

/**
 * Set a custom thumbnail on a video (thumbnails.set). Requires the channel to be
 * eligible for custom thumbnails (phone-verified) — a 403 means "not verified",
 * which the caller should treat as non-fatal (the video still uploaded).
 */
export async function setVideoThumbnail(
  videoId: string,
  imageBytes: Uint8Array,
  contentType = "image/jpeg",
  refreshToken?: string,
): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);
  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
        "Content-Length": String(imageBytes.byteLength),
      },
      body: Buffer.from(imageBytes),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new YouTubeError(`thumbnails.set HTTP ${res.status}: ${t.slice(0, 220)}`);
  }
}

/** The authenticated channel's id (channels.list mine=true). */
export async function getMyChannelId(refreshToken?: string): Promise<string | null> {
  try {
    const token = await getAccessToken(refreshToken);
    const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { items?: { id?: string }[] };
    return j.items?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Current privacy status of a video (private|unlisted|public), or null. */
export async function getVideoPrivacy(videoId: string, refreshToken?: string): Promise<string | null> {
  try {
    const token = await getAccessToken(refreshToken);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(videoId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { items?: { status?: { privacyStatus?: string } }[] };
    return j.items?.[0]?.status?.privacyStatus ?? null;
  } catch {
    return null;
  }
}

/** True when the given channel already has a top-level comment on the video. */
export async function hasChannelComment(
  videoId: string,
  channelId: string,
  refreshToken?: string,
): Promise<boolean> {
  try {
    const token = await getAccessToken(refreshToken);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(videoId)}&maxResults=50`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return false;
    const j = (await res.json()) as {
      items?: { snippet?: { topLevelComment?: { snippet?: { authorChannelId?: { value?: string } } } } }[];
    };
    return (j.items ?? []).some(
      (it) => it.snippet?.topLevelComment?.snippet?.authorChannelId?.value === channelId,
    );
  } catch {
    return false;
  }
}

/**
 * Post a top-level OWNER comment (the "hook question" engagement device).
 * NOTE: PINNING has no public API - pin manually in Studio if desired.
 */
export async function postComment(videoId: string, text: string, refreshToken?: string): Promise<boolean> {
  const token = await getAccessToken(refreshToken);
  const res = await fetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      snippet: {
        videoId,
        topLevelComment: { snippet: { textOriginal: text.slice(0, 800) } },
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`commentThreads.insert HTTP ${res.status}: ${detail.slice(0, 180)}`);
  }
  return true;
}
