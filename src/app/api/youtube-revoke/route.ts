import { NextResponse } from "next/server";
import { replaceChannelPublishPolicy } from "@/lib/channelPublishPolicy";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import {
  requireStudioActor,
  StudioAuthError,
} from "@/lib/operatorSession";
import { hydrateEnv } from "@/lib/vault";
import { getAccessToken } from "@/lib/youtube";
import {
  requireInternalQuerySecret,
  requireYouTubeConnector,
} from "@/lib/youtubeConnector";

export const runtime = "nodejs";

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    await hydrateEnv("youtube");
    const body = (await request.json()) as { channelId?: string; reason?: string };
    if (!body.channelId) {
      return NextResponse.json(
        { ok: false, error: "channelId is required" },
        { status: 400 },
      );
    }
    const convex = convexClient();
    const channelId = body.channelId as Id<"channels">;
    const channel = await convex.query(api.channels.getChannel, { channelId });
    if (!channel || channel.ownerId !== actor.ownerId) {
      return NextResponse.json(
        { ok: false, error: "channel not found" },
        { status: 404 },
      );
    }

    let providerWarning: string | undefined;
    try {
      const connector = await requireYouTubeConnector(convex, {
        channelId,
        ownerId: actor.ownerId,
      });
      const accessToken = await getAccessToken(connector.refreshToken);
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: accessToken }),
      });
      if (!response.ok) providerWarning = `Google revoke returned HTTP ${response.status}`;
    } catch (error) {
      providerWarning = error instanceof Error ? error.message : String(error);
    }

    const result = await convex.mutation(api.youtubeAuth.revoke, {
      secret: requireInternalQuerySecret(),
      ownerId: actor.ownerId,
      channelId,
      revokedAt: Date.now(),
      reason: body.reason?.trim() || "revoked by authenticated operator",
    });
    await replaceChannelPublishPolicy({
      ownerId: actor.ownerId,
      channelId,
      channel,
      allowedActions: [],
      actor: `${actor.authKind}:${actor.ownerId}`,
      evidence: "YouTube connector revoked; all channel publish authority removed",
      convex,
    });
    await convex.mutation(api.channels.updateChannel, {
      channelId,
      status: "paused",
    });
    return NextResponse.json({
      ok: true,
      result,
      dataPolicy: "credentials and resumable capabilities deleted; aggregate history retained",
      ...(providerWarning ? { providerWarning } : {}),
    });
  } catch (error) {
    const status = error instanceof StudioAuthError ? error.status : 400;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "revoke failed" },
      { status },
    );
  }
}
