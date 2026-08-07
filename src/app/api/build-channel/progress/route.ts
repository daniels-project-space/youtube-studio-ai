import { NextResponse } from "next/server";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { authorizeStudioRoute } from "@/lib/operatorSession";
import { OWNER_ID } from "@/lib/config";
import type { ChannelInceptionLedgerState } from "@/engine/channelInceptionLedger";
import { api } from "../../../../../convex/_generated/api";

export const runtime = "nodejs";

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new ConvexHttpClient(url);
}

export async function GET(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim();
  const requestKey = url.searchParams.get("requestKey")?.trim();
  if (!slug || !requestKey) {
    return NextResponse.json({ error: "slug and requestKey are required" }, { status: 400 });
  }

  try {
    const channel = await convexClient().query(api.channels.getChannelBySlug, {
      ownerId: OWNER_ID,
      slug,
    });
    if (!channel) return NextResponse.json({ found: false }, { status: 404 });

    const inception = channel.inception as ChannelInceptionLedgerState | undefined;
    if (!inception || inception.requestSnapshot?.sourceRevision !== requestKey) {
      return NextResponse.json({ error: "channel build identity mismatch" }, { status: 409 });
    }

    const stages = Object.values(inception.stages).map((stage) => ({
      moduleKey: stage.moduleKey,
      status: stage.status,
      attempts: stage.attempts,
      executionPhase: stage.executionPhase,
      startedAt: stage.startedAt,
      finishedAt: stage.finishedAt,
      error: stage.error,
    }));
    return NextResponse.json({
      found: true,
      channelId: channel._id,
      slug: channel.slug,
      channelStatus: channel.status,
      inceptionStatus: inception.status,
      updatedAt: inception.updatedAt,
      executionAuthorized: inception.admission.executionAuthorized,
      probeAuthorized: inception.admission.probeAuthorized,
      stages,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "could not load build progress" },
      { status: 500 },
    );
  }
}
