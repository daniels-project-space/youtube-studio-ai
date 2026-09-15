import { NextResponse } from "next/server";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { assertMiniMaxH3SaladCapacity } from "@/lib/minimaxH3";
import { saladCloudClientFromVault, saladPriorityPolicyFromEnv } from "@/lib/saladCloud";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../../../convex/_generated/api";

export const runtime = "nodejs";

const MAX_H3_JOBS_PER_BATCH = 60;

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("H3 capacity admission requires Convex fleet lease visibility");
  return new StudioConvexHttpClient(url);
}

function parseLogicalLeaseSlots(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 3) return value;
  // A malformed lease response must never be interpreted as an empty fleet;
  // doing so could advertise paid 5090 capacity already owned by a live wave.
  throw new Error("H3 capacity admission received invalid Convex fleet lease occupancy");
}

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
    const policy = saladPriorityPolicyFromEnv();
    const [salad, logicalLease] = await Promise.all([
      saladCloudClientFromVault(),
      convexClient().query(api.saladFleetReservations.listActive, { now: Date.now() }),
    ]);
    const logicalReservedGpuSlots = parseLogicalLeaseSlots(logicalLease.occupiedGpuSlots);
    const capacity = await assertMiniMaxH3SaladCapacity(jobCount, {
      allowHighPriorityFallback: policy.highFallbackEnabled,
      mediumPriorityEnabled: policy.mediumEnabled,
      // The provider market is eventually consistent; combine it with the
      // same durable logical lease used by the weekly dispatcher so a probe
      // cannot advertise slots already owned by another in-flight wave.
      client: {
        listGpuClasses: () => salad.listGpuClasses(),
        getGpuAvailability: (resources, countryCodes) => salad.getGpuAvailability(resources, countryCodes),
        getOccupiedGpuSlots: async () => Math.max(await salad.getOccupiedGpuSlots(), logicalReservedGpuSlots),
      },
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
