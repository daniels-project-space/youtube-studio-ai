import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { buildWeeklyOperationsDigest } from "@/lib/automaticOperations";

export const runtime = "nodejs";

/** Owner-only, read-only weekly digest for the automatic production fleet. */
export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const url = new URL(request.url);
    const now = Date.now();
    const weekEnd = Number(url.searchParams.get("weekEnd") ?? now);
    const weekStart = Number(url.searchParams.get("weekStart") ?? (weekEnd - 7 * 24 * 60 * 60_000));
    if (!Number.isSafeInteger(weekStart) || !Number.isSafeInteger(weekEnd) || weekStart < 0 || weekEnd < weekStart || weekEnd > now + 7 * 24 * 60 * 60_000) {
      return NextResponse.json({ ok: false, error: "weekStart/weekEnd must be a bounded millisecond range" }, { status: 400 });
    }
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new StudioConvexHttpClient(convexUrl);
    const recent = await convex.query(api.runs.listRecent, { ownerId: actor.ownerId, limit: 200 });
    const runs = recent.filter((run) => (run.startedAt ?? 0) >= weekStart && (run.startedAt ?? 0) <= weekEnd);
    return NextResponse.json({ ok: true, digest: buildWeeklyOperationsDigest({ weekStart, weekEnd, runs }) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof StudioAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "operations digest failed" }, { status: 503 });
  }
}
