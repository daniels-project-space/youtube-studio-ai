import { makeFunctionReference } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { channelOverviewEffectivePipeline } from "@/lib/channelOverviewEffectivePipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const retain = makeFunctionReference<"mutation", {
  ownerId: string; channelId: Id<"channels">; runId: Id<"runs">;
  receiptId: Id<"productionRouteQualificationReceipts">;
}, { id: Id<"retainedPipelineCandidates">; fingerprint: string; reused: boolean }>("retainedPipelineCandidates:retain");
const list = makeFunctionReference<"query", { ownerId: string; channelId: Id<"channels"> }, unknown[]>("retainedPipelineCandidates:list");
const headers = { "Cache-Control": "no-store" };
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 300 && value.trim() === value;

async function scopedClient(request: Request, channelId: string) {
  const actor = await requireStudioActor(request);
  if (process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1") throw new StudioAuthError("Private Automation mode is required.", 403);
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Database not configured");
  const client = new StudioConvexHttpClient(url);
  const id = channelId as Id<"channels">;
  const channel = await client.query(api.channels.getChannel, { channelId: id });
  if (!channel || channel.ownerId !== actor.ownerId) throw new StudioAuthError("Channel not found.", 403);
  return { client, ownerId: actor.ownerId, channelId: id, channel };
}

function failure(error: unknown): Response {
  if (error instanceof StudioAuthError) return Response.json({ error: error.message }, { status: error.status, headers });
  return Response.json({ error: "Candidate evidence could not be verified or retrieved. Check the benchmark and qualification receipt." }, { status: 503, headers });
}

/** Returns retained evidence, not executable releases or approval. */
export async function GET(request: Request): Promise<Response> {
  try {
    const channelId = new URL(request.url).searchParams.get("channelId");
    if (!validId(channelId)) return Response.json({ error: "A channel is required." }, { status: 400, headers });
    const { client, ownerId, channelId: id, channel } = await scopedClient(request, channelId);
    const candidates = await client.query(list, { ownerId, channelId: id });
    const comparisonPipeline = channelOverviewEffectivePipeline(channel.pipeline ?? [], channel.moduleConfig);
    return Response.json({ evidenceOnly: true, candidates, comparisonPipeline }, { headers });
  } catch (error) { return failure(error); }
}

/** Retains evidence for an existing completed benchmark; it does not run or activate it. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid request." }, { status: 400, headers });
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !["channelId", "runId", "receiptId"].includes(key)) || !validId(input.channelId) || !validId(input.runId) || !validId(input.receiptId)) {
      return Response.json({ error: "A channel, completed run and qualification receipt are required." }, { status: 400, headers });
    }
    const { client, ownerId, channelId } = await scopedClient(request, input.channelId);
    const candidate = await client.mutation(retain, { ownerId, channelId, runId: input.runId as Id<"runs">, receiptId: input.receiptId as Id<"productionRouteQualificationReceipts"> });
    return Response.json({ evidenceOnly: true, ...candidate }, { headers });
  } catch (error) { return failure(error); }
}
