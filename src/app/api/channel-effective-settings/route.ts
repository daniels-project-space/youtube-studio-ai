import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { channelOverviewEffectivePipeline } from "@/lib/channelOverviewEffectivePipeline";
import { channelOverviewVoiceSetup } from "@/lib/channelOverviewSetup";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const actor = await requireStudioActor(request);
    const id = new URL(request.url).searchParams.get("channelId");
    if (!id || id.length > 300) return NextResponse.json({ error: "Invalid channel." }, { status: 400, headers });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database not configured");
    const channel = await new StudioConvexHttpClient(url).query(api.channels.getChannel, { channelId: id as Id<"channels"> });
    if (!channel || channel.ownerId !== actor.ownerId) return NextResponse.json({ error: "Channel not found." }, { status: 404, headers });
    const pipeline = channelOverviewEffectivePipeline(channel.pipeline ?? [], channel.moduleConfig);
    if (!pipeline) return NextResponse.json({ error: "Saved module settings could not be resolved." }, { status: 422, headers });
    const number = (block: string, key: string) => {
      const value = pipeline.find(entry => entry.block === block)?.params?.[key];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    return NextResponse.json({
      durationSource: pipeline.some(entry => entry.block === "assemble") ? "assembly" : pipeline.some(entry => entry.block === "script_gen") ? "script_maximum" : null,
      targetSeconds: pipeline.some(entry => entry.block === "assemble")
        ? number("assemble", "durationSec")
        : number("script_gen", "maxSeconds"),
      minimumSeconds: number("length_check", "minSeconds"),
      maximumSeconds: number("length_check", "maxSeconds"),
      tailSeconds: number("timeline_assemble", "tailSec"),
      maxQuotes: number("quote_overlays", "maxQuotes"),
      voiceConfigured: channelOverviewVoiceSetup([...pipeline], undefined, channel.identity?.voiceId),
    }, { headers });
  } catch (error) {
    if (error instanceof StudioAuthError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return NextResponse.json({ error: "Effective settings are unavailable." }, { status: 500, headers });
  }
}
