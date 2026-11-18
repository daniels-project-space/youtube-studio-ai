import { makeFunctionReference } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { issueStudioConvexToken } from "@/lib/studioConvexAuth";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { parseWorkshopDesignTransport } from "@/lib/workshopDesignTransport";
import { compareWorkshopDesign } from "@/lib/compareWorkshopDesign";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const imports = makeFunctionReference<"query", { ownerId: string }, Array<{ _id: string; ownerId: string; design: unknown }>>("workshopDesignImports:list");
const candidates = makeFunctionReference<"query", { ownerId: string; channelId: Id<"channels"> }, Array<{ ownerId: string; channelId: string; fingerprint: string; createdAt: number; candidate: { ownerId: string; channelId: string; sourceRunId: string; entries: Array<{ block: string; version?: string; params?: unknown }>; workerDeployment?: { version?: string } } }>>("retainedPipelineCandidates:list");

/** Read-only evidence comparison; it does not link, qualify, approve or run a design. */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireStudioActor(request);
    if (process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1" || actor.authKind !== "session" || actor.role !== "owner") throw new StudioAuthError("Owner session required.", 403);
    const params = new URL(request.url).searchParams;
    const channelId = params.get("channelId"), designId = params.get("designId");
    if (!channelId || !designId || [channelId, designId].some(id => id.length > 300 || id.trim() !== id)) return Response.json({ error: "A channel and imported design are required." }, { status: 400, headers });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database not configured");
    const token = issueStudioConvexToken({ role: "owner", ownerId: actor.ownerId }).token;
    const client = new StudioConvexHttpClient(url, { auth: token });
    const id = channelId as Id<"channels">;
    const channel = await client.query(api.channels.getChannel, { channelId: id });
    if (!channel || channel.ownerId !== actor.ownerId) throw new StudioAuthError("Channel not found.", 403);
    const imported = (await client.query(imports, { ownerId: actor.ownerId })).find(row => row._id === designId && row.ownerId === actor.ownerId);
    if (!imported) throw new StudioAuthError("Imported design not found.", 403);
    const design = parseWorkshopDesignTransport(imported.design);
    const rows = await client.query(candidates, { ownerId: actor.ownerId, channelId: id });
    const evidence = rows.map(row => {
      if (row.ownerId !== actor.ownerId || String(row.channelId) !== channelId || row.candidate?.ownerId !== actor.ownerId || row.candidate?.channelId !== channelId || !Array.isArray(row.candidate.entries) || row.candidate.entries.some(entry => !entry || typeof entry.block !== "string") || sha256Hex(canonicalJson(row.candidate)) !== row.fingerprint) throw new Error("Invalid retained evidence");
      return { fingerprint: row.fingerprint, createdAt: row.createdAt, sourceRunId: row.candidate.sourceRunId, workerVersion: row.candidate.workerDeployment?.version ?? null, comparison: compareWorkshopDesign(row.candidate.entries, design.entries) };
    });
    return Response.json({ designFingerprint: design.fingerprint, evidence }, { headers });
  } catch (error) {
    if (error instanceof StudioAuthError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Evidence comparison is unavailable." }, { status: 503, headers });
  }
}
