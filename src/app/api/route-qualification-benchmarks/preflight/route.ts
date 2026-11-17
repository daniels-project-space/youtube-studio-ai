import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { privateBenchmarkPreflight } from "@/lib/privateBenchmarkPreflight";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const channelId = new URL(request.url).searchParams.get("channelId");
    if (!channelId || channelId.length > 300) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database not configured");
    const client = new StudioConvexHttpClient(url);
    const channel = await client.query(api.channels.getChannel, { channelId: channelId as Id<"channels"> });
    if (!channel || channel.ownerId !== actor.ownerId) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    return NextResponse.json(privateBenchmarkPreflight(channel), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not check this channel's private benchmark configuration." }, { status: 500 });
  }
}
