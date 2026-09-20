import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { presignDownload } from "@/lib/storage";
import { readDurableYuE2Candidate } from "@/lib/yue2DurableEvaluation";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const runIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u);

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
    const nativeWavUrl = await presignDownload(candidate.audioKey, { expiresIn: 600 });
    return NextResponse.json({ ok: true, review: {
      candidateSha256, jobId: candidate.jobId, nativeWavUrl, nativeOutput: candidate.nativeOutput,
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
    } }, { headers });
  } catch (error) {
    const status = error instanceof StudioAuthError ? error.status : 503;
    return NextResponse.json({ ok: false, error: status === 503 ? "Review evidence unavailable or invalid" : "Authentication required" },
      { status, headers });
  }
}
