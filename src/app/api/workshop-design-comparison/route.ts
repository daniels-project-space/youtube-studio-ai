import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { channelOverviewEffectivePipeline } from "@/lib/channelOverviewEffectivePipeline";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { durationCandidateFamily } from "@/lib/durationCandidateFamily";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireStudioActor(request);
    if (actor.authKind !== "session" || actor.role !== "owner" || process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1") throw new StudioAuthError("Owner session required.", 403);
    const id = new URL(request.url).searchParams.get("channelId");
    if (!id || id.length > 300 || id.trim() !== id) return Response.json({ error: "A channel is required." }, { status: 400, headers });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database not configured");
    const client = new StudioConvexHttpClient(url);
    const channel = await client.query(api.channels.getChannel, { channelId: id as Id<"channels"> });
    if (!channel || channel.ownerId !== actor.ownerId) throw new StudioAuthError("Channel not found.", 403);
    let family: string | null = null;
    let familyWarning: string | null = null;
    try { family = durationCandidateFamily(channel); }
    catch { familyWarning = "The saved channel format could not be verified. Review its family and content lane before relying on this comparison."; }
    const comparisonPipeline = channelOverviewEffectivePipeline(channel.pipeline ?? [], channel.moduleConfig);
    const comparisonFingerprint = comparisonPipeline === null || familyWarning ? null : sha256Hex(canonicalJson({ family, comparisonPipeline }));
    return Response.json({ family, familyWarning, comparisonPipeline, comparisonFingerprint, baselineFingerprint: channelPipelineWriteFence(channel) }, { headers });
  } catch (error) {
    if (error instanceof StudioAuthError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Channel baseline is unavailable." }, { status: 503, headers });
  }
}
