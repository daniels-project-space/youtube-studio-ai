import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { makeFunctionReference } from "convex/server";
import { familyDurationContract, familyEpisodeLengthError } from "@/engine/families";
import { durationCandidateFamily } from "@/lib/durationCandidateFamily";
import { durationCandidateProposal } from "@/lib/durationCandidateProposal";
import { channelOverviewEffectivePipeline } from "@/lib/channelOverviewEffectivePipeline";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";
import { verifiedDurationCandidate, verifiedRetainedEvidence } from "@/lib/durationCandidateEvidenceReview";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const createCandidate = makeFunctionReference<"mutation", { ownerId: string; channelId: Id<"channels">; baselineFingerprint: string; requestedSeconds: number; pipeline: { block: string; version?: string; params?: unknown }[] }, { id: string; fingerprint: string; reused: boolean }>("durationDraftCandidates:create");
const listCandidates = makeFunctionReference<"query", { ownerId: string; channelId: Id<"channels"> }, Array<{ baselineFingerprint: string } & Record<string, unknown>>>("durationDraftCandidates:list");
const listEvidence = makeFunctionReference<"query", { ownerId: string; channelId: Id<"channels"> }, unknown[]>("retainedPipelineCandidates:list");

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireStudioActor(request);
    if (actor.authKind !== "session" || actor.role !== "owner" || process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1") throw new StudioAuthError("Owner session required.", 403);
    const channelId = new URL(request.url).searchParams.get("channelId");
    if (!channelId || channelId.length > 300 || channelId.trim() !== channelId) return Response.json({ error: "Invalid channel." }, { status: 400, headers });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database not configured");
    const client = new StudioConvexHttpClient(url);
    const channel = await client.query(api.channels.getChannel, { channelId: channelId as Id<"channels"> });
    if (!channel || channel.ownerId !== actor.ownerId) throw new StudioAuthError("Channel not found.", 403);
    const [candidates, retained] = await Promise.all([
      client.query(listCandidates, { ownerId: actor.ownerId, channelId: channelId as Id<"channels"> }),
      client.query(listEvidence, { ownerId: actor.ownerId, channelId: channelId as Id<"channels"> }).catch(() => null),
    ]);
    const currentFingerprint = channelPipelineWriteFence(channel);
    const evidence = (retained ?? []).map(row => verifiedRetainedEvidence(row, actor.ownerId, channelId)).filter(row => row !== null);
    return Response.json({ candidates: candidates.map(candidate => {
      const verified = verifiedDurationCandidate(candidate, actor.ownerId, channelId);
      const effectivePipeline = verified ? channelOverviewEffectivePipeline(verified.pipeline, verified.moduleConfig) : null;
      return { ...candidate, baselineCurrent: candidate.baselineFingerprint === currentFingerprint, effectivePipeline };
    }), evidence, evidenceAvailable: retained !== null, evidenceUnavailableCount: (retained?.length ?? 0) - evidence.length }, { headers });
  } catch (error) {
    if (error instanceof StudioAuthError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Candidates could not be loaded." }, { status: 503, headers });
  }
}
async function readBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Preview or retain an untested candidate; never updates a channel or creates evidence. */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStudioActor(request);
    if (actor.authKind !== "session" || actor.role !== "owner" || process.env.YOUTUBE_AUTOMATION_PRIVATE !== "1") throw new StudioAuthError("Owner session required.", 403);
    const raw = await readBody(request);
    if (raw === null) return Response.json({ error: "Request is missing or too large." }, { status: 400, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid request." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid request." }, { status: 400, headers });
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !["channelId", "requestedSeconds", "save", "baselineFingerprint"].includes(key)) || typeof input.channelId !== "string" || !input.channelId || input.channelId.length > 300 || input.channelId.trim() !== input.channelId || typeof input.requestedSeconds !== "number" || !Number.isSafeInteger(input.requestedSeconds) || input.requestedSeconds <= 0 || (input.save !== undefined && typeof input.save !== "boolean") || (input.save === true && (typeof input.baselineFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.baselineFingerprint))) || (input.save !== true && input.baselineFingerprint !== undefined)) return Response.json({ error: "Provide a channel and a positive whole number of seconds." }, { status: 400, headers });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database not configured");
    const client = new StudioConvexHttpClient(url);
    const channel = await client.query(api.channels.getChannel, { channelId: input.channelId as Id<"channels"> });
    if (!channel || channel.ownerId !== actor.ownerId) throw new StudioAuthError("Channel not found.", 403);
    let family;
    try { family = durationCandidateFamily(channel); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The channel format could not be verified." }, { status: 422, headers }); }
    if (family !== "music_loop" && family !== "narrated_stock") return Response.json({ error: "Duration candidates are not yet supported for this format." }, { status: 422, headers });
    const durationError = familyEpisodeLengthError(family, input.requestedSeconds / 60);
    if (durationError) return Response.json({ error: durationError }, { status: 422, headers });
    const pipeline = channelOverviewEffectivePipeline(channel.pipeline ?? [], channel.moduleConfig);
    if (!pipeline) return Response.json({ error: "Saved channel settings could not be resolved." }, { status: 422, headers });
    const baselineFingerprint = channelPipelineWriteFence(channel);
    if (input.save === true && input.baselineFingerprint !== baselineFingerprint) return Response.json({ error: "Channel changed since preview; recalculate before saving." }, { status: 409, headers });
    let proposal;
    try { proposal = durationCandidateProposal(channel, input.requestedSeconds); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid duration candidate." }, { status: 422, headers }); }
    const source = pipeline.some(entry => entry.block === "assemble") ? "assembly" : pipeline.some(entry => entry.block === "script_gen") ? "script_maximum" : null;
    const field = source === "assembly" ? pipeline.find(entry => entry.block === "assemble")?.params?.durationSec : source === "script_maximum" ? pipeline.find(entry => entry.block === "script_gen")?.params?.maxSeconds : null;
    const savedSeconds = typeof field === "number" && Number.isFinite(field) ? field : null;
    const contract = familyDurationContract(family);
    let retained;
    if (input.save === true) {
      try { retained = await client.mutation(createCandidate, { ownerId: actor.ownerId, channelId: input.channelId as Id<"channels">, baselineFingerprint, requestedSeconds: input.requestedSeconds, pipeline: proposal.pipeline }); }
      catch { return Response.json({ error: "Candidate was not saved. The channel may have changed or a channel or module may be locked; review and recalculate." }, { status: 409, headers }); }
    }
    return Response.json({ version: "channel-duration-draft/v1", channelId: input.channelId, family, requestedSeconds: input.requestedSeconds, saved: { source, seconds: savedSeconds }, deltaSeconds: source === "assembly" && savedSeconds !== null ? input.requestedSeconds - savedSeconds : null, formatRange: { minimumSeconds: contract.minimumSeconds, maximumSeconds: contract.maximumSeconds }, baselineFingerprint, baselinePipeline: channel.pipeline, baselineModuleConfig: channel.moduleConfig ?? {}, pipeline: proposal.pipeline, moduleConfig: proposal.moduleConfig, changes: proposal.changed, savedToAccount: !!retained, ...(retained ? { candidate: retained } : {}) }, { headers });
  } catch (error) {
    if (error instanceof StudioAuthError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Duration draft could not be computed." }, { status: 503, headers });
  }
}
