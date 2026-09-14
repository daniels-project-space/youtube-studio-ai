import { NextResponse } from "next/server";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { assertMiniMaxH3SaladCapacity } from "@/lib/minimaxH3";

export const runtime = "nodejs";

const MAX_H3_JOBS_PER_BATCH = 60;

/** Read-only Salad admission for the weekly H3 render desk. */
export async function GET(request: Request) {
  try {
    await requireStudioActor(request);
    const rawJobCount = new URL(request.url).searchParams.get("jobCount") ?? "";
    const jobCount = Number(rawJobCount);
    if (!Number.isSafeInteger(jobCount) || jobCount < 1 || jobCount > MAX_H3_JOBS_PER_BATCH) {
      return NextResponse.json(
        { ok: false, error: `jobCount must be an integer from 1 to ${MAX_H3_JOBS_PER_BATCH}` },
        { status: 400 },
      );
    }
    const capacity = await assertMiniMaxH3SaladCapacity(jobCount, {
      allowHighPriorityFallback: process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK !== "0",
      mediumPriorityEnabled: process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY === "1",
    });
    return NextResponse.json({
      ok: true,
      state: "admitted",
      provider: "salad",
      execution: "weekly-batch",
      jobCount,
      checkedAt: Date.now(),
      capacity,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Salad capacity is unavailable";
    if (/capacity|slot|GPU class|priced|priority/i.test(message)) {
      return NextResponse.json({
        ok: true,
        state: "held",
        provider: "salad",
        execution: "weekly-batch",
        reason: message,
        paidRequestStarted: false,
      }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ ok: false, error: "Salad capacity could not be checked", paidRequestStarted: false }, { status: 503 });
  }
}
