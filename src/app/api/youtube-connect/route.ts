import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { NextRequest, NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { hydrateEnv } from "@/lib/vault";
import { getConsentUrl } from "@/lib/youtube";
import { requireStudioActor } from "@/lib/operatorSession";
import {
  createYouTubeOAuthState,
  YOUTUBE_OAUTH_NONCE_COOKIE,
  YOUTUBE_OAUTH_STATE_TTL_MS,
} from "@/lib/youtubeOAuthState";

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

export async function GET(request: NextRequest) {
  const channelId = new URL(request.url).searchParams.get("channelId");
  if (!channelId) {
    return NextResponse.json({ error: "missing channelId" }, { status: 400 });
  }
  let actor;
  try {
    actor = await requireStudioActor(request);
  } catch {
    const next = `/api/youtube-connect?channelId=${encodeURIComponent(channelId)}`;
    return NextResponse.redirect(
      new URL(`/operator-login?next=${encodeURIComponent(next)}`, request.url),
    );
  }
  try {
    await hydrateEnv("youtube");
  } catch {
    /* hydrate is best-effort; reqEnv will throw a clear error if truly missing */
  }
  try {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
    const convex = new ConvexHttpClient(convexUrl);
    const channel = await convex.query(api.channels.getChannel, {
      channelId: channelId as Id<"channels">,
    });
    if (!channel || channel.ownerId !== actor.ownerId) {
      return NextResponse.json({ error: "channel not found" }, { status: 404 });
    }

    const { state, nonce } = createYouTubeOAuthState({
      channelId,
      ownerId: actor.ownerId,
    });
    const response = NextResponse.redirect(getConsentUrl(REDIRECT_URI, state));
    response.cookies.set(YOUTUBE_OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: new URL(BASE).protocol === "https:",
      sameSite: "lax",
      path: "/api/youtube-callback",
      maxAge: Math.floor(YOUTUBE_OAUTH_STATE_TTL_MS / 1000),
      priority: "high",
    });
    return response;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "consent url failed" },
      { status: 500 },
    );
  }
}
