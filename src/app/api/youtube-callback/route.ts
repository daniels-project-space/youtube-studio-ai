import { NextRequest, NextResponse } from "next/server";
import { replaceChannelPublishPolicy } from "@/lib/channelPublishPolicy";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { hydrateEnv } from "@/lib/vault";
import { exchangeCode, getChannelMine, YT_SCOPES } from "@/lib/youtube";
import { encryptSecret } from "@/lib/secretEnvelope";
import {
  verifyYouTubeOAuthState,
  YOUTUBE_OAUTH_NONCE_COOKIE,
} from "@/lib/youtubeOAuthState";
import {
  requireInternalQuerySecret,
  youtubeConnectorAad,
} from "@/lib/youtubeConnector";

/**
 * GET /api/youtube-callback?code=&state=<signed browser-bound payload>
 * OAuth redirect target: exchanges the code for a refresh token, stores it for
 * the channel (youtubeAuth.set), records the linked YouTube channel id/title, and
 * activates the channel. Then bounces back to the channel page.
 */
export const runtime = "nodejs";

const BASE = process.env.OAUTH_REDIRECT_BASE ?? "https://youtube-studio-ai.vercel.app";
const REDIRECT_URI = `${BASE}/api/youtube-callback`;

function redirectAndClearNonce(url: string): NextResponse {
  const response = NextResponse.redirect(url);
  response.cookies.set(YOUTUBE_OAUTH_NONCE_COOKIE, "", {
    httpOnly: true,
    secure: new URL(BASE).protocol === "https:",
    sameSite: "lax",
    path: "/api/youtube-callback",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const oauthErr = sp.get("error");
  if (oauthErr || !code || !state) {
    return redirectAndClearNonce(`${BASE}/channels?yt=error`);
  }
  try {
    await hydrateEnv("youtube");
    const oauthState = verifyYouTubeOAuthState({
      state,
      nonce: request.cookies.get(YOUTUBE_OAUTH_NONCE_COOKIE)?.value,
    });
    const channelId = oauthState.channelId;
    const ownerId = oauthState.ownerId;
    const { refreshToken, accessToken, grantedScopes } = await exchangeCode(code, REDIRECT_URI);
    const me = await getChannelMine(accessToken);

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
    const convex = new ConvexHttpClient(url);

    const ch = await convex.query(api.channels.getChannel, {
      channelId: channelId as Id<"channels">,
    });
    if (!ch || ch.ownerId !== ownerId) {
      throw new Error("OAuth channel owner mismatch");
    }
    const slug = ch?.slug ?? "";

    // GUARD: if the agent recorded which YouTube channel was created for this app
    // channel, the grant MUST match it — otherwise the operator picked the wrong
    // channel at consent (e.g. left it on LO FI Kings). Refuse the mismatch so we
    // never silently link the wrong channel; tell them to switch + retry.
    const expected = ch?.youtubeCreated?.ytChannelId;
    if (expected && me?.id && me.id !== expected) {
      return redirectAndClearNonce(
        `${BASE}/channels/${slug}?yt=wrongchannel&got=${encodeURIComponent(me.title ?? me.id)}`,
      );
    }

    const refreshTokenCiphertext = encryptSecret(refreshToken, {
      envName: "YOUTUBE_TOKEN_ENCRYPTION_KEY",
      aad: youtubeConnectorAad(ownerId, channelId),
    });
    await convex.mutation(api.youtubeAuth.set, {
      secret: requireInternalQuerySecret(),
      ownerId,
      channelId: channelId as Id<"channels">,
      refreshTokenCiphertext,
      ytChannelId: me?.id,
      ytTitle: me?.title,
      grantedScopes,
      scopeHealth:
        grantedScopes.length === 0
          ? "unknown"
          : YT_SCOPES.split(" ").every((scope) => grantedScopes.includes(scope))
            ? "healthy"
            : "partial",
      updatedAt: Date.now(),
    });
    // A new/rotated destination always invalidates prior channel-level publish
    // authority. Keep the channel paused until the operator approves this exact
    // connector/configuration combination from Settings.
    await replaceChannelPublishPolicy({
      ownerId,
      channelId: channelId as Id<"channels">,
      channel: ch,
      allowedActions: [],
      actor: `oauth-connector:${ownerId}`,
      evidence: "YouTube connector created or rotated; explicit publish reapproval required",
      convex,
    });
    await convex.mutation(api.channels.updateChannel, {
      channelId: channelId as Id<"channels">,
      status: "paused",
    });

    // Auto-apply the app channel's details to the YouTube channel (description,
    // country, language, banner) via the native API. Fire-and-forget.
    if (process.env.TRIGGER_SECRET_KEY) {
      try {
        const { tasks } = await import("@trigger.dev/sdk");
        await tasks.trigger("wire-youtube-branding", { channelId });
      } catch { /* branding is best-effort; the link itself succeeded */ }
    }

    return redirectAndClearNonce(`${BASE}/channels/${slug}?yt=connected`);
  } catch (e) {
    return redirectAndClearNonce(
      `${BASE}/channels?yt=error&msg=${encodeURIComponent(e instanceof Error ? e.message : "callback failed")}`,
    );
  }
}
