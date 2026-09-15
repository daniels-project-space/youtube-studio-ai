import { NextResponse } from "next/server";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { readSaladCapacitySnapshot } from "@/lib/saladCapacity";
import { SALAD_BULK_MAX_GPUS, saladPriorityPolicyFromEnv } from "@/lib/saladCloud";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../../../convex/_generated/api";

export const runtime = "nodejs";

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Salad capacity snapshot requires Convex fleet lease visibility");
  return new StudioConvexHttpClient(url);
}

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
    const policy = saladPriorityPolicyFromEnv();
    const convex = convexClient();
    const snapshot = await readSaladCapacitySnapshot(undefined, {
      requiredWorkers: jobCount === undefined ? 1 : Math.min(SALAD_BULK_MAX_GPUS, jobCount),
      allowHighPriorityFallback: policy.highFallbackEnabled,
      mediumPriorityEnabled: policy.mediumEnabled,
      readLogicalOccupiedGpuSlots: async () => {
        const logicalLease = await convex.query(api.saladFleetReservations.listActive, { now: Date.now() });
        return logicalLease.occupiedGpuSlots;
      },
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
