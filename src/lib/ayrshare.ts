/**
 * Ayrshare — one API to cross-post a finished video to TikTok / Instagram Reels /
 * etc. (Phase 8 growth). Posts from a public media URL (our R2 video URL), so it
 * works for any rendered clip. Key: AYRSHARE_API_KEY (vault service "ayrshare").
 * Absent → callers degrade (no cross-post). Requires the social accounts to be
 * connected in the Ayrshare dashboard.
 */
const BASE = "https://app.ayrshare.com/api";

export function hasAyrshareKey(): boolean {
  return Boolean(process.env.AYRSHARE_API_KEY);
}

export interface CrosspostResult {
  ok: boolean;
  ids: string[];
  errors?: string[];
}

export async function crosspost(args: {
  mediaUrl: string;
  caption: string;
  platforms: string[]; // e.g. ["tiktok","instagram","facebook"]
  timeoutMs?: number;
}): Promise<CrosspostResult> {
  const key = process.env.AYRSHARE_API_KEY;
  if (!key) return { ok: false, ids: [], errors: ["no AYRSHARE_API_KEY"] };
  try {
    const res = await fetch(`${BASE}/post`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        post: args.caption.slice(0, 2200),
        platforms: args.platforms,
        mediaUrls: [args.mediaUrl],
        isVideo: true,
      }),
      signal: AbortSignal.timeout(args.timeoutMs ?? 120_000),
    });
    const j = (await res.json()) as {
      status?: string;
      postIds?: { platform?: string; id?: string }[];
      errors?: unknown[];
    };
    if (!res.ok) return { ok: false, ids: [], errors: [`HTTP ${res.status}`] };
    const ids = (j.postIds ?? []).map((p) => `${p.platform}:${p.id}`).filter(Boolean);
    return { ok: j.status === "success", ids, errors: j.errors?.map(String) };
  } catch (e) {
    return { ok: false, ids: [], errors: [e instanceof Error ? e.message : String(e)] };
  }
}
