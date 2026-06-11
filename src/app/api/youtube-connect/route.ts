import { NextResponse } from "next/server";
import { hydrateEnv } from "@/lib/vault";
import { getConsentUrl } from "@/lib/youtube";

/**
 * GET /api/youtube-connect?channelId=<id>
 * Redirects to Google's consent screen to link a YouTube channel to this app
 * channel. The account chooser lets the operator pick the Brand Account; the
 * callback stores the per-channel refresh token. The redirect URI below MUST be
 * registered on the OAuth client in Google Cloud.
 */
export const runtime = "nodejs";

const BASE = process.env.OAUTH_REDIRECT_BASE ?? "https://youtube-studio-ai.vercel.app";
export const REDIRECT_URI = `${BASE}/api/youtube-callback`;

export async function GET(request: Request) {
  const channelId = new URL(request.url).searchParams.get("channelId");
  if (!channelId) {
    return NextResponse.json({ error: "missing channelId" }, { status: 400 });
  }
  try {
    await hydrateEnv("youtube");
  } catch {
    /* hydrate is best-effort; reqEnv will throw a clear error if truly missing */
  }
  try {
    return NextResponse.redirect(getConsentUrl(REDIRECT_URI, channelId));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "consent url failed" },
      { status: 500 },
    );
  }
}
