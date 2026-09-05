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
import { createHash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";

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
 * Exchange an exact connector refresh token for a short-lived access token.
 * Global account fallback is deliberately forbidden for account isolation.
 */
export interface YouTubeAccessTokenGrant {
  accessToken: string;
  grantedScopes: string[];
  expiresIn?: number;
}

export async function refreshAccessTokenGrant(
  refreshToken: string,
): Promise<YouTubeAccessTokenGrant> {
  if (!refreshToken) {
    throw new YouTubeError(
      "a channel-bound YouTube refresh token is required; global fallback is disabled",
    );
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: reqEnv("YOUTUBE_CLIENT_ID"),
      client_secret: reqEnv("YOUTUBE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new YouTubeError(
      `token refresh failed: ${json.error ?? res.status} ${json.error_description ?? ""}`,
    );
  }
  return {
    accessToken: json.access_token,
    grantedScopes: (json.scope ?? "").split(/\s+/).filter(Boolean),
    expiresIn: json.expires_in,
  };
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  return (await refreshAccessTokenGrant(refreshToken)).accessToken;
}

/** OAuth scopes needed to upload + manage branding/captions/localizations. */
export const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

/** Minimal identity scope for replacing the old manual operations-key prompt. */
export const YT_OWNER_SESSION_SCOPES =
  "https://www.googleapis.com/auth/youtube.readonly";

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

/**
 * Build a no-password owner-verification consent URL. The access token is used
 * once to resolve the selected YouTube channel and is never persisted.
 */
export function getOwnerSessionConsentUrl(
  redirectUri: string,
  state: string,
): string {
  const p = new URLSearchParams({
    client_id: reqEnv("YOUTUBE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_OWNER_SESSION_SCOPES,
    access_type: "online",
    prompt: "select_account",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** Exchange an authorization code for tokens (returns the refresh token). */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; grantedScopes: string[] }> {
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
    refresh_token?: string;
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.refresh_token || !json.access_token) {
    throw new YouTubeError(
      `code exchange failed: ${json.error ?? res.status} ${json.error_description ?? ""} (codes are single-use; ensure access_type=offline + prompt=consent)`,
    );
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    grantedScopes: (json.scope ?? "").split(/\s+/).filter(Boolean),
  };
}

/** Exchange a one-use owner verification code without requiring a refresh token. */
export async function exchangeOwnerSessionCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; grantedScopes: string[] }> {
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
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new YouTubeError(
      `owner verification exchange failed: ${json.error ?? res.status} ${json.error_description ?? ""}`,
    );
  }
  return {
    accessToken: json.access_token,
    grantedScopes: (json.scope ?? "").split(/\s+/).filter(Boolean),
  };
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

/** Resolve the public channel owners of retained YouTube video ids, in bounded batches. */
export async function getVideoChannelIds(
  accessToken: string,
  videoIds: string[],
): Promise<string[]> {
  const ids = [...new Set(videoIds.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
  const channelIds = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = ids.slice(offset, offset + 50);
    const params = new URLSearchParams({ part: "snippet", id: batch.join(",") });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json()) as {
      items?: Array<{ snippet?: { channelId?: string } }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new YouTubeError(
        `video owner lookup failed: ${json.error?.message ?? res.status}`,
      );
    }
    for (const item of json.items ?? []) {
      if (item.snippet?.channelId) channelIds.add(item.snippet.channelId);
    }
  }
  return [...channelIds];
}

export type YouTubeVideoIdentity = Readonly<{
  id: string;
  channelId: string;
  title: string;
  privacyStatus?: string;
}>;

/** Resolve one exact video before a destructive channel-bound action. */
export async function getVideoIdentity(
  accessToken: string,
  videoId: string,
): Promise<YouTubeVideoIdentity | null> {
  const params = new URLSearchParams({
    part: "snippet,status",
    id: videoId,
  });
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = (await response.json()) as {
    items?: Array<{
      id?: string;
      snippet?: { channelId?: string; title?: string };
      status?: { privacyStatus?: string };
    }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new YouTubeError(
      `video identity lookup failed: ${json.error?.message ?? response.status}`,
    );
  }
  const item = json.items?.[0];
  if (!item?.id) return null;
  if (!item.snippet?.channelId) {
    throw new YouTubeError("video identity lookup omitted the owner channel");
  }
  return {
    id: item.id,
    channelId: item.snippet.channelId,
    title: item.snippet.title ?? "",
    privacyStatus: item.status?.privacyStatus,
  };
}

/**
 * Delete one YouTube video. Callers must first bind and verify its owner
 * channel; a 404 is safe idempotent reconciliation after a lost response.
 */
export async function deleteVideo(
  accessToken: string,
  videoId: string,
): Promise<"deleted" | "already_absent"> {
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (response.status === 404) return "already_absent";
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new YouTubeError(
      `video deletion failed: HTTP ${response.status} ${body.slice(0, 220)}`,
    );
  }
  return "deleted";
}

/**
 * Apply channel branding (description / country / default language / keywords +
 * optional banner) via the official API. Fetches current brandingSettings first
 * (PUT replaces), merges, then writes. Native — runs after the channel is linked.
 */
export async function updateChannelBranding(args: {
  refreshToken: string;
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
  refreshToken: string;
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
    // clampTags, not slice(0, 30): YouTube rejects on the TOTAL character
    // length of the tag list, not its count, and it also refuses "<" and ">".
    // The upload path has always clamped; this one only capped the count, so a
    // verbose tag list returned "invalidTags" and threw — taking the TITLE
    // rewrite down with it, since both travel in the same snippet PUT.
    ...(args.tags ? { tags: clampTags(args.tags) } : {}),
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
  refreshToken: string,
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
  /** Exact per-channel connector token. Global account fallback is forbidden. */
  refreshToken: string;
  /** Disclose realistic altered/synthetic media in the YouTube video status. */
  containsSyntheticMedia?: boolean;
  /** Audience declaration stored on status.selfDeclaredMadeForKids. */
  madeForKids?: boolean;
  /** Durable state loaded for this exact owner/channel/upload key. */
  resumeCheckpoint?: YouTubeUploadCheckpoint;
  /** Persist a newly-created session and every confirmed remote byte range. */
  onCheckpoint?: (checkpoint: YouTubeUploadCheckpoint) => Promise<void>;
  /** Mark an expired or identity-mismatched session before replacing it. */
  onCheckpointInvalidated?: (
    checkpoint: YouTubeUploadCheckpoint,
    reason: string,
  ) => Promise<void>;
  /** Must be a multiple of 256 KiB; defaults to 16 MiB. */
  chunkSizeBytes?: number;
  /** Test seam; production callers use global fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam; production callers exchange the exact connector refresh token. */
  accessTokenProvider?: () => Promise<string>;
}

export interface UploadVideoResult {
  videoId: string;
  watchUrl: string;
  privacyStatus: string;
}

export interface YouTubeUploadCheckpoint {
  sessionUrl: string;
  fileSize: number;
  fileSha256: string;
  metadataSha256: string;
  uploadedBytes: number;
  chunkSize: number;
  createdAt: number;
  expiresAt: number;
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
export function clampTags(tags: string[], maxTotal = 460): string[] {
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

const DEFAULT_UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024;
const HASH_READ_SIZE = 4 * 1024 * 1024;
const SESSION_SAFETY_LIFETIME_MS = 6 * 24 * 60 * 60 * 1000;

interface UploadApiVideo {
  id?: string;
  status?: { privacyStatus?: string };
  error?: { message?: string };
}

type SessionState =
  | { kind: "incomplete"; nextOffset: number; sessionUrl: string }
  | { kind: "complete"; result: UploadVideoResult }
  | { kind: "expired" };

function assertChunkSize(chunkSize: number): void {
  if (!Number.isSafeInteger(chunkSize)
      || chunkSize < 256 * 1024
      || chunkSize % (256 * 1024) !== 0) {
    throw new YouTubeError("upload chunk size must be a positive multiple of 256 KiB");
  }
}

function assertYouTubeSessionUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:"
      || url.hostname !== "www.googleapis.com"
      || !url.pathname.startsWith("/upload/youtube/v3/videos")) {
    throw new YouTubeError("resumable upload returned an untrusted session URL");
  }
  return url.toString();
}

export function nextUploadOffset(range: string | null, totalBytes: number): number {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range.trim());
  if (!match) throw new YouTubeError(`invalid resumable upload Range header: ${range}`);
  const lastByte = Number(match[1]);
  if (!Number.isSafeInteger(lastByte) || lastByte < 0 || lastByte >= totalBytes) {
    throw new YouTubeError(`resumable upload Range is outside the file: ${range}`);
  }
  return lastByte + 1;
}

async function sha256File(handle: FileHandle, fileSize: number): Promise<string> {
  const hash = createHash("sha256");
  let offset = 0;
  while (offset < fileSize) {
    const buffer = Buffer.allocUnsafe(Math.min(HASH_READ_SIZE, fileSize - offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (bytesRead < 1) throw new YouTubeError("video file ended while hashing");
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hash.digest("hex");
}

async function responseVideo(response: Response): Promise<UploadVideoResult> {
  const payload = (await response.json().catch(() => null)) as UploadApiVideo | null;
  if (!payload?.id) {
    throw new YouTubeError(
      `YouTube completed an upload without a video id: ${payload?.error?.message ?? "invalid response"}`,
    );
  }
  return {
    videoId: payload.id,
    watchUrl: `https://www.youtube.com/watch?v=${payload.id}`,
    privacyStatus: payload.status?.privacyStatus ?? "private",
  };
}

function retryDelayMs(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.min(60_000, Math.max(1_000, Number(retryAfter) * 1000));
  }
  return Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadPrivateDraft(
  args: UploadVideoArgs,
): Promise<UploadVideoResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const file = await open(args.filePath, "r");
  try {
    const fileStat = await file.stat();
    if (!fileStat.isFile() || !Number.isSafeInteger(fileStat.size) || fileStat.size < 1) {
      throw new YouTubeError("upload source must be a non-empty regular file");
    }
    const fileSize = fileStat.size;
    const requestedChunkSize = args.chunkSizeBytes ?? DEFAULT_UPLOAD_CHUNK_SIZE;
    assertChunkSize(requestedChunkSize);

    const metadata = {
      snippet: {
        title: args.title.slice(0, 100),
        description: args.description.slice(0, 5000),
        tags: clampTags(args.tags),
        categoryId: args.categoryId ?? "10",
      },
      status: {
        privacyStatus: args.publishAt ? "private" : (args.privacyStatus ?? "private"),
        ...(args.publishAt ? { publishAt: args.publishAt } : {}),
        selfDeclaredMadeForKids: args.madeForKids ?? false,
        containsSyntheticMedia: args.containsSyntheticMedia ?? true,
      },
    };
    const metadataBody = JSON.stringify(metadata);
    const metadataSha256 = createHash("sha256").update(metadataBody).digest("hex");
    const fileSha256 = await sha256File(file, fileSize);

    let accessToken = "";
    let tokenRefreshedAt = 0;
    async function token(force = false): Promise<string> {
      if (force || !accessToken || Date.now() - tokenRefreshedAt > 45 * 60 * 1000) {
        accessToken = args.accessTokenProvider
          ? await args.accessTokenProvider()
          : await getAccessToken(args.refreshToken);
        tokenRefreshedAt = Date.now();
      }
      return accessToken;
    }
    async function authorizedFetch(
      url: string,
      init: RequestInit,
      timeoutMs: number,
    ): Promise<Response> {
      for (let authAttempt = 0; authAttempt < 2; authAttempt += 1) {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${await token(authAttempt > 0)}`);
        const response = await fetchImpl(url, {
          ...init,
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status !== 401 || authAttempt > 0) return response;
      }
      throw new YouTubeError("YouTube authorization retry failed");
    }

    function checkpointMatches(value: YouTubeUploadCheckpoint): boolean {
      return value.fileSize === fileSize
        && value.fileSha256 === fileSha256
        && value.metadataSha256 === metadataSha256
        && value.expiresAt > Date.now()
        && value.uploadedBytes >= 0
        && value.uploadedBytes <= fileSize;
    }

    async function persist(checkpoint: YouTubeUploadCheckpoint): Promise<void> {
      await args.onCheckpoint?.(checkpoint);
    }

    async function initializeSession(chunkSize: number): Promise<YouTubeUploadCheckpoint> {
      const response = await authorizedFetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": String(fileSize),
          },
          body: metadataBody,
        },
        45_000,
      );
      if (!response.ok) {
        throw new YouTubeError(
          `resumable init failed HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
        );
      }
      const location = response.headers.get("location");
      if (!location) throw new YouTubeError("resumable init returned no Location header");
      const now = Date.now();
      const checkpoint: YouTubeUploadCheckpoint = {
        sessionUrl: assertYouTubeSessionUrl(location),
        fileSize,
        fileSha256,
        metadataSha256,
        uploadedBytes: 0,
        chunkSize,
        createdAt: now,
        expiresAt: now + SESSION_SAFETY_LIFETIME_MS,
      };
      await persist(checkpoint);
      return checkpoint;
    }

    async function probe(checkpoint: YouTubeUploadCheckpoint): Promise<SessionState> {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        let response: Response | undefined;
        try {
          response = await authorizedFetch(
            checkpoint.sessionUrl,
            {
              method: "PUT",
              headers: {
                "Content-Length": "0",
                "Content-Range": `bytes */${fileSize}`,
              },
            },
            30_000,
          );
        } catch (error) {
          if (attempt === 5) throw error;
          await delay(retryDelayMs(undefined, attempt));
          continue;
        }
        if (response.status === 308) {
          const moved = response.headers.get("location");
          return {
            kind: "incomplete",
            nextOffset: nextUploadOffset(response.headers.get("range"), fileSize),
            sessionUrl: moved ? assertYouTubeSessionUrl(moved) : checkpoint.sessionUrl,
          };
        }
        if (response.status === 200 || response.status === 201) {
          return { kind: "complete", result: await responseVideo(response) };
        }
        if (response.status === 404 || response.status === 410) return { kind: "expired" };
        if ([500, 502, 503, 504].includes(response.status) && attempt < 5) {
          await delay(retryDelayMs(response, attempt));
          continue;
        }
        throw new YouTubeError(
          `resumable status failed HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
        );
      }
      throw new YouTubeError("resumable status retry budget exhausted");
    }

    async function sendChunk(
      checkpoint: YouTubeUploadCheckpoint,
      offset: number,
      attempt: number,
    ): Promise<SessionState> {
      const length = Math.min(checkpoint.chunkSize, fileSize - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new YouTubeError("video file changed or ended during upload");
      let response: Response;
      try {
        response = await authorizedFetch(
          checkpoint.sessionUrl,
          {
            method: "PUT",
            headers: {
              "Content-Type": "video/mp4",
              "Content-Length": String(length),
              "Content-Range": `bytes ${offset}-${offset + length - 1}/${fileSize}`,
            },
            body: buffer,
          },
          5 * 60 * 1000,
        );
      } catch {
        await delay(retryDelayMs(undefined, attempt));
        return probe(checkpoint);
      }
      if (response.status === 308) {
        const moved = response.headers.get("location");
        return {
          kind: "incomplete",
          nextOffset: nextUploadOffset(response.headers.get("range"), fileSize),
          sessionUrl: moved ? assertYouTubeSessionUrl(moved) : checkpoint.sessionUrl,
        };
      }
      if (response.status === 200 || response.status === 201) {
        return { kind: "complete", result: await responseVideo(response) };
      }
      if (response.status === 404 || response.status === 410) return { kind: "expired" };
      if ([500, 502, 503, 504].includes(response.status)) {
        await delay(retryDelayMs(response, attempt));
        return probe(checkpoint);
      }
      throw new YouTubeError(
        `upload chunk failed HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }

    let checkpoint = args.resumeCheckpoint;
    if (checkpoint) {
      assertChunkSize(checkpoint.chunkSize);
      assertYouTubeSessionUrl(checkpoint.sessionUrl);
      if (!checkpointMatches(checkpoint)) {
        await args.onCheckpointInvalidated?.(checkpoint, "file, metadata, or session lifetime changed");
        checkpoint = undefined;
      }
    }

    let sessionReplacements = 0;
    for (;;) {
      if (!checkpoint) checkpoint = await initializeSession(requestedChunkSize);
      let state = await probe(checkpoint);
      if (state.kind === "complete") return state.result;
      if (state.kind === "expired") {
        await args.onCheckpointInvalidated?.(checkpoint, "YouTube session expired");
        checkpoint = undefined;
        sessionReplacements += 1;
        if (sessionReplacements > 1) {
          throw new YouTubeError("YouTube resumable session expired repeatedly");
        }
        continue;
      }

      let offset = state.nextOffset;
      if (offset < checkpoint.uploadedBytes) {
        throw new YouTubeError("YouTube reported fewer uploaded bytes than the durable checkpoint");
      }
      if (state.sessionUrl !== checkpoint.sessionUrl || offset !== checkpoint.uploadedBytes) {
        checkpoint = { ...checkpoint, sessionUrl: state.sessionUrl, uploadedBytes: offset };
        await persist(checkpoint);
      }

      let stalledAttempts = 0;
      while (offset < fileSize) {
        state = await sendChunk(checkpoint, offset, stalledAttempts);
        if (state.kind === "complete") return state.result;
        if (state.kind === "expired") break;
        if (state.nextOffset < offset) {
          throw new YouTubeError("YouTube resumable byte range regressed");
        }
        if (state.nextOffset === offset) {
          stalledAttempts += 1;
          if (stalledAttempts > 8) {
            throw new YouTubeError("YouTube resumable upload made no progress after repeated retries");
          }
        } else {
          stalledAttempts = 0;
        }
        offset = state.nextOffset;
        checkpoint = { ...checkpoint, sessionUrl: state.sessionUrl, uploadedBytes: offset };
        await persist(checkpoint);
      }
      if (state.kind === "expired") {
        await args.onCheckpointInvalidated?.(checkpoint, "YouTube session expired during upload");
        checkpoint = undefined;
        sessionReplacements += 1;
        if (sessionReplacements > 1) {
          throw new YouTubeError("YouTube resumable session expired repeatedly");
        }
      }
    }
  } finally {
    await file.close();
  }
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
  refreshToken: string,
): Promise<{ kind: string; itemCount: number }> {
  const accessToken = await getAccessToken(refreshToken);
  return setVideoThumbnailWithAccessToken(videoId, imageBytes, contentType, accessToken);
}

/** Apply one already-authorized thumbnail without refreshing the grant twice. */
export async function setVideoThumbnailWithAccessToken(
  videoId: string,
  imageBytes: Uint8Array,
  contentType: string,
  accessToken: string,
): Promise<{ kind: string; itemCount: number }> {
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
  const body = await res.json().catch(() => ({})) as {
    kind?: unknown;
    items?: unknown;
  };
  return {
    kind: typeof body.kind === "string" ? body.kind : "youtube#thumbnailSetResponse",
    itemCount: Array.isArray(body.items) ? body.items.length : 0,
  };
}

/** The authenticated channel's id (channels.list mine=true). */
export async function getMyChannelId(refreshToken: string): Promise<string | null> {
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
export async function getVideoPrivacy(videoId: string, refreshToken: string): Promise<string | null> {
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
  refreshToken: string,
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
export async function postComment(videoId: string, text: string, refreshToken: string): Promise<boolean> {
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
