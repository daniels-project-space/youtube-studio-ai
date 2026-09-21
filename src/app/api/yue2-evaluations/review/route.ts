import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { presignDownload } from "@/lib/storage";
import { getStudioPrivateBucket } from "@/lib/studioPrivateStorage";
import { readDurableYuE2Candidate } from "@/lib/yue2DurableEvaluation";
import type { YuE2CandidateReview } from "@/lib/yue2ReviewTypes";
import { validateYuE2Audition, YuE2AuditionSubmissionSchema, type YuE2AuditionRecord } from "@/engine/yue2Audition";

const auditionApi = (api as unknown as { yue2Auditions: { latest: never; record: never } }).yue2Auditions;

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const runIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u);

class AuditionBodyError extends Error {
  constructor(readonly status: 400 | 408 | 413) { super("Invalid audition request body"); }
}
async function readAuditionBody(request: Request): Promise<unknown> {
  const maximum = 64 * 1024;
  if (Number(request.headers.get("content-length")) > maximum) throw new AuditionBodyError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new AuditionBodyError(400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AuditionBodyError(408)), 10_000); });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new AuditionBodyError(413);
      chunks.push(value);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new AuditionBodyError(400); }
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const parsed = runIdSchema.safeParse(new URL(request.url).searchParams.get("runId"));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid runId" }, { status: 400, headers });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) return NextResponse.json({ ok: false, error: "Review service unavailable" }, { status: 503, headers });
    const convex = new StudioConvexHttpClient(url);
    const run = await convex.query(api.runs.getRun, { runId: parsed.data as Id<"runs"> });
    if (!run || run._id !== parsed.data || run.ownerId !== actor.ownerId) {
      return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404, headers });
    }
    const channel = await convex.query(api.channels.getChannel, { channelId: run.channelId });
    if (!channel || channel.ownerId !== actor.ownerId || channel._id !== run.channelId) {
      return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404, headers });
    }
    const material = await readDurableYuE2Candidate({ ownerId: actor.ownerId, channelId: run.channelId, runId: run._id });
    if (!material) return NextResponse.json({ ok: true, review: null }, { headers });
    const { candidate, candidateSha256, quality } = material;
    const audition = await convex.query(auditionApi.latest, { ownerId: actor.ownerId, channelId: run.channelId,
      runId: run._id, candidateSha256 } as never) as YuE2AuditionRecord | null;
    const nativeWavUrl = await presignDownload(material.listeningAudioKey, { bucket: getStudioPrivateBucket(), expiresIn: 600 });
    return NextResponse.json({ ok: true, review: {
      candidateSha256, audition, jobId: candidate.jobId, nativeWavUrl, nativeOutput: candidate.nativeOutput,
      arrangement: material.request.acceptedArrangement.arrangement,
      brief: {
        topic: material.request.acceptedArrangement.topic,
        sourceBriefFingerprint: material.request.acceptedArrangement.sourceBriefFingerprint,
        reviewContext: material.request.acceptedArrangement.reviewContext ?? null,
        contextRetained: material.request.acceptedArrangement.reviewContext !== undefined,
        channelPersonalityVerified: false,
      },
      allocation: {
        allocatedCostUsdMicros: candidate.executionAccounting.allocatedCostUsdMicros,
        providerBilledCostUsdMicros: null,
      },
      quality,
    } satisfies YuE2CandidateReview }, { headers });
  } catch (error) {
    const status = error instanceof StudioAuthError ? error.status : 503;
    return NextResponse.json({ ok: false, error: status === 503 ? "Review evidence unavailable or invalid" : "Authentication required" },
      { status, headers });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    if (actor.authKind !== "session") throw new StudioAuthError("Owner session required", 403);
    const body = await readAuditionBody(request);
    const parsed = z.object({ runId: runIdSchema, audition: YuE2AuditionSubmissionSchema }).strict().safeParse(body);
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid audition" }, { status: 400, headers });
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Review service unavailable");
    const convex = new StudioConvexHttpClient(url);
    const run = await convex.query(api.runs.getRun, { runId: parsed.data.runId as Id<"runs"> });
    if (!run || run._id !== parsed.data.runId || run.ownerId !== actor.ownerId) {
      return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404, headers });
    }
    const channel = await convex.query(api.channels.getChannel, { channelId: run.channelId });
    if (!channel || channel.ownerId !== actor.ownerId || channel._id !== run.channelId) {
      return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404, headers });
    }
    const material = await readDurableYuE2Candidate({ ownerId: actor.ownerId, channelId: run.channelId, runId: run._id });
    if (!material) return NextResponse.json({ ok: false, error: "Candidate unavailable" }, { status: 409, headers });
    let submission;
    try {
      submission = validateYuE2Audition(parsed.data.audition, { candidateSha256: material.candidateSha256,
        sectionIds: material.request.acceptedArrangement.arrangement.sections.map(section => section.id),
        technicallyBlocked: material.quality.status === "blocked",
        contextRetained: material.request.acceptedArrangement.reviewContext !== undefined });
    } catch {
      return NextResponse.json({ ok: false, error: "Audition does not match the verified candidate or is incomplete" }, { status: 409, headers });
    }
    const audition = await convex.mutation(auditionApi.record, { ownerId: actor.ownerId, channelId: run.channelId,
      runId: run._id, candidateSha256: material.candidateSha256, submission } as never);
    return NextResponse.json({ ok: true, audition }, { headers });
  } catch (error) {
    const status = error instanceof StudioAuthError || error instanceof AuditionBodyError ? error.status : 503;
    return NextResponse.json({ ok: false, error: error instanceof AuditionBodyError ? "Invalid, oversized or incomplete audition body"
      : status === 503 ? "Audition could not be saved; reload before retrying" : "Owner session required" }, { status, headers });
  }
}
