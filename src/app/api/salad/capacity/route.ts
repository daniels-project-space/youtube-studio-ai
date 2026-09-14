import { NextResponse } from "next/server";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { readSaladCapacitySnapshot } from "@/lib/saladCapacity";
import { SALAD_BULK_MAX_GPUS } from "@/lib/saladCloud";

export const runtime = "nodejs";

/**
 * Owner-only, read-only fleet visibility.  This route deliberately has no
 * Salad lifecycle methods in its call graph: it can inform a dispatch choice
 * without reserving or starting paid capacity.
 */
export async function GET(request: Request) {
  try {
    await requireStudioActor(request);
    const rawJobCount = new URL(request.url).searchParams.get("jobCount");
    const jobCount = rawJobCount === null ? undefined : Number(rawJobCount);
    if (jobCount !== undefined && (!Number.isSafeInteger(jobCount) || jobCount < 1 || jobCount > 60)) {
      return NextResponse.json({ ok: false, error: "jobCount must be an integer from 1 to 60" }, { status: 400 });
    }
    const snapshot = await readSaladCapacitySnapshot(undefined, {
      requiredWorkers: jobCount === undefined ? 1 : Math.min(SALAD_BULK_MAX_GPUS, jobCount),
      allowHighPriorityFallback: process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK !== "0",
      mediumPriorityEnabled: process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY === "1",
    });
    return NextResponse.json({
      ok: true,
      provider: "salad",
      ...(jobCount === undefined ? {} : { jobCount }),
      ...snapshot,
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "Salad capacity could not be read", paidRequestStarted: false }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
