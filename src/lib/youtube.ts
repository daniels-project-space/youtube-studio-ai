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

/** Exchange the stored refresh token for a fresh access token. */
export async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: reqEnv("YOUTUBE_CLIENT_ID"),
      client_secret: reqEnv("YOUTUBE_CLIENT_SECRET"),
      refresh_token: reqEnv("YOUTUBE_REFRESH_TOKEN"),
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

export interface UploadVideoArgs {
  /** Local path to the mp4 to upload. */
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  /** YouTube category id (default 10 = Music). */
  categoryId?: string;
  /** Forced private regardless — this param exists for clarity only. */
  privacyStatus?: "private";
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
export async function uploadPrivateDraft(
  args: UploadVideoArgs,
): Promise<UploadVideoResult> {
  const accessToken = await getAccessToken();
  const bytes = await readFile(args.filePath);

  const metadata = {
    snippet: {
      title: args.title.slice(0, 100),
      description: args.description.slice(0, 5000),
      tags: args.tags.slice(0, 30),
      categoryId: args.categoryId ?? "10",
    },
    status: {
      privacyStatus: "private", // hard-locked private (never public)
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
