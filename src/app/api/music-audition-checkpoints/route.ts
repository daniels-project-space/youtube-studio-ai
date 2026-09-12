import { NextResponse } from "next/server";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { presignDownload } from "@/lib/storage";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

export const runtime = "nodejs";

const musicAuditionApi = (api as unknown as {
  readonly musicAuditionCheckpoints: { readonly getReviewForRun: never; readonly reject: never };
}).musicAuditionCheckpoints;

function client(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function runId(value: string | null): string {
  if (!value || !value.trim() || value.length > 500) throw new Error("runId is required");
  return value;
}

export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const result = await client().query(musicAuditionApi.getReviewForRun, {
      ownerId: actor.ownerId,
      runId: runId(new URL(request.url).searchParams.get("runId")) as Id<"runs">,
    } as never) as unknown as {
      checkpoint: Record<string, unknown>;
      review: { nativeWavKey: string; durationSec: number; sampleRateHz: number; channels: number; programFingerprint: string };
    } | null;
    if (!result) return NextResponse.json({ ok: true, checkpoint: null }, { headers: { "Cache-Control": "no-store" } });
    const prefix = `owner/${actor.ownerId}/`;
    if (!result.review.nativeWavKey.startsWith(prefix) || result.review.nativeWavKey.includes("..")) {
      throw new Error("music audition native WAV ownership validation failed");
    }
    const nativeWavUrl = await presignDownload(result.review.nativeWavKey, { expiresIn: 600 });
    return NextResponse.json({
      ok: true,
      checkpoint: result.checkpoint,
      review: { ...result.review, nativeWavKey: undefined, nativeWavUrl },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Music audition review failed";
    const status = error instanceof StudioAuthError ? error.status : /runId|required|ownership|checkpoint|audition/i.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== "reject" || typeof body.checkpointId !== "string" || !body.checkpointId.trim() || Object.keys(body).some((key) => key !== "action" && key !== "checkpointId")) {
      throw new Error("music audition accepts only reject and checkpointId");
    }
    const result = await client().mutation(musicAuditionApi.reject, {
      ownerId: actor.ownerId, checkpointId: body.checkpointId, reviewerId: actor.ownerId, now: Date.now(),
    } as never);
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Music audition rejection failed";
    const status = error instanceof StudioAuthError ? error.status : /accepts|checkpoint|audition|rejection/i.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
