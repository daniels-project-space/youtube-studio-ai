import { makeFunctionReference } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { verifiedDurationCandidate } from "@/lib/durationCandidateEvidenceReview";
import { durationCandidatePreflight, historicalWorkerEvidence } from "@/lib/durationCandidatePreflight";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const listCandidates = makeFunctionReference<"query", { ownerId: string; channelId: Id<"channels"> }, Array<Record<string, unknown>>>("durationDraftCandidates:list");
const listEvidence = makeFunctionReference<"query", { ownerId: string; channelId: Id<"channels"> }, unknown[]>("retainedPipelineCandidates:list");
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 300 && value.trim() === value;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
async function boundedBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 100000) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStudioActor(request);
    if (actor.authKind !== "session" || actor.role !== "owner" || process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1") throw new StudioAuthError("Owner session required.", 403);
    const raw = await boundedBody(request);
    if (raw === null) return Response.json({ error: "Invalid request." }, { status: 400, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid request." }, { status: 400, headers }); }
    if (!record(body) || Object.keys(body).some(key => !["channelId", "candidateId", "maximumCostUsd", "evidenceFingerprint", "plannerOptions"].includes(key)) || !id(body.channelId) || !id(body.candidateId) || typeof body.maximumCostUsd !== "number" || !Number.isFinite(body.maximumCostUsd) || body.maximumCostUsd <= 0 || body.maximumCostUsd > 10000 || (body.plannerOptions !== undefined && !record(body.plannerOptions)) || (body.evidenceFingerprint !== undefined && (typeof body.evidenceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.evidenceFingerprint)))) return Response.json({ error: "Provide a candidate and a positive bounded budget ceiling." }, { status: 400, headers });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database not configured");
    const client = new StudioConvexHttpClient(url);
    const channelId = body.channelId as Id<"channels">;
    const channel = await client.query(api.channels.getChannel, { channelId });
    if (!channel || channel.ownerId !== actor.ownerId) throw new StudioAuthError("Channel not found.", 403);
    const rows = await client.query(listCandidates, { ownerId: actor.ownerId, channelId });
    const candidate = rows.find(row => String(row._id) === body.candidateId);
    const verified = verifiedDurationCandidate(candidate, actor.ownerId, body.channelId);
    if (!candidate || !verified || typeof candidate.family !== "string" || typeof candidate.fingerprint !== "string" || typeof candidate.baselineFingerprint !== "string" || typeof candidate.requestedSeconds !== "number" || !Number.isSafeInteger(candidate.requestedSeconds) || candidate.requestedSeconds <= 0) return Response.json({ error: "Candidate is unavailable or its frozen settings could not be verified." }, { status: 409, headers });
    let worker = null;
    if (body.evidenceFingerprint !== undefined) {
      const evidence = await client.query(listEvidence, { ownerId: actor.ownerId, channelId });
      const selected = evidence.find(row => record(row) && row.fingerprint === body.evidenceFingerprint);
      worker = historicalWorkerEvidence(selected, actor.ownerId, body.channelId);
      if (!worker) return Response.json({ error: "Selected historical worker evidence could not be verified." }, { status: 422, headers });
    }
    const result = durationCandidatePreflight({ ownerId: actor.ownerId, channelId: body.channelId, channel: { ...channel, pipeline: channel.pipeline ?? [] }, candidate: { fingerprint: candidate.fingerprint, baselineFingerprint: candidate.baselineFingerprint, family: candidate.family, requestedSeconds: candidate.requestedSeconds, ...verified }, maximumCostUsd: body.maximumCostUsd, worker, plannerOptions: body.plannerOptions });
    return Response.json({ ...result, localReceipt: null }, { headers });
  } catch (error) {
    if (error instanceof StudioAuthError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Candidate preflight could not be completed." }, { status: 503, headers });
  }
}
