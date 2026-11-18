import { makeFunctionReference } from "convex/server";
import type { Id } from "../../../../convex/_generated/dataModel";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { issueStudioConvexToken } from "@/lib/studioConvexAuth";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

const list = makeFunctionReference<"query", { ownerId: string; channelId: Id<"channels">; designFingerprint: string }, unknown>("workshopReviewEvidence:list");
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireStudioActor(request);
    if (actor.authKind !== "session" || actor.role !== "owner" || process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1") throw new StudioAuthError("Private owner session required", 403);
    const channelId = new URL(request.url).searchParams.get("channelId");
    const designFingerprint = new URL(request.url).searchParams.get("designFingerprint");
    if (!channelId || channelId.length > 300 || channelId.trim() !== channelId) return Response.json({ error: "A channel is required" }, { status: 400, headers });
    if (!designFingerprint || !/^[a-f0-9]{64}$/.test(designFingerprint)) return Response.json({ error: "A design fingerprint is required" }, { status: 400, headers });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database unavailable");
    const token = issueStudioConvexToken({ role: "owner", ownerId: actor.ownerId }).token;
    const client = new StudioConvexHttpClient(url, { auth: token });
    return Response.json(await client.query(list, { ownerId: actor.ownerId, channelId: channelId as Id<"channels">, designFingerprint }), { headers });
  } catch (error) {
    if (error instanceof StudioAuthError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Review evidence is unavailable or could not be verified." }, { status: 503, headers });
  }
}
