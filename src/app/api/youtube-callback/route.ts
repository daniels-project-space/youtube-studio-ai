import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { OWNER_ID } from "@/lib/config";
import { hydrateEnv } from "@/lib/vault";
import { exchangeCode, getChannelMine } from "@/lib/youtube";

/**
 * GET /api/youtube-callback?code=&state=<channelId>
 * OAuth redirect target: exchanges the code for a refresh token, stores it for
 * the channel (youtubeAuth.set), records the linked YouTube channel id/title, and
 * activates the channel. Then bounces back to the channel page.
 */
export const runtime = "nodejs";

const BASE = process.env.OAUTH_REDIRECT_BASE ?? "https://youtube-studio-ai.vercel.app";
const REDIRECT_URI = `${BASE}/api/youtube-callback`;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const code = sp.get("code");
  const channelId = sp.get("state");
  const oauthErr = sp.get("error");
  if (oauthErr || !code || !channelId) {
    return NextResponse.redirect(`${BASE}/channels?yt=error`);
  }
  try {
    await hydrateEnv("youtube");
    const { refreshToken, accessToken } = await exchangeCode(code, REDIRECT_URI);
    const me = await getChannelMine(accessToken);

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
    const convex = new ConvexHttpClient(url);

    const ch = await convex.query(api.channels.getChannel, {
      channelId: channelId as Id<"channels">,
    });
    const slug = ch?.slug ?? "";

    // GUARD: if the agent recorded which YouTube channel was created for this app
    // channel, the grant MUST match it — otherwise the operator picked the wrong
    // channel at consent (e.g. left it on LO FI Kings). Refuse the mismatch so we
    // never silently link the wrong channel; tell them to switch + retry.
    const expected = ch?.youtubeCreated?.ytChannelId;
    if (expected && me?.id && me.id !== expected) {
      return NextResponse.redirect(
        `${BASE}/channels/${slug}?yt=wrongchannel&got=${encodeURIComponent(me.title ?? me.id)}`,
      );
    }

    await convex.mutation(api.youtubeAuth.set, {
      ownerId: OWNER_ID,
      channelId: channelId as Id<"channels">,
      refreshToken,
      ytChannelId: me?.id,
      ytTitle: me?.title,
      updatedAt: Date.now(),
    });
    // A connected channel is ready to publish → activate it.
    await convex.mutation(api.channels.updateChannel, {
      channelId: channelId as Id<"channels">,
      status: "active",
    });

    // Auto-apply the app channel's details to the YouTube channel (description,
    // country, language, banner) via the native API. Fire-and-forget.
    if (process.env.TRIGGER_SECRET_KEY) {
      try {
        const { tasks } = await import("@trigger.dev/sdk");
        await tasks.trigger("wire-youtube-branding", { channelId });
      } catch { /* branding is best-effort; the link itself succeeded */ }
    }

    return NextResponse.redirect(`${BASE}/channels/${slug}?yt=connected`);
  } catch (e) {
    return NextResponse.redirect(
      `${BASE}/channels?yt=error&msg=${encodeURIComponent(e instanceof Error ? e.message : "callback failed")}`,
    );
  }
}
