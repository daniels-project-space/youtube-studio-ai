import { NextResponse } from "next/server";
import { NOVITA_HARD_GPU_LIMIT, NOVITA_REQUIRED_GPU_SKU } from "@/lib/novitaFleet";
import { requireStudioActor } from "@/lib/operatorSession";

/**
 * This route intentionally does not render and does not hold Novita credentials.
 * Paid worker admission runs only in the authenticated Trigger child task, where
 * it has a frozen run identity, Convex lease, R2 manifest, and verified reaper.
 */
export const runtime = "nodejs";

const DIRECT_CONTROL_PLANE = {
  provider: "novita",
  execution: "trigger-cloud-only",
  gpuSku: NOVITA_REQUIRED_GPU_SKU,
  gpuCountPerWorker: 1,
  concurrencyCeiling: NOVITA_HARD_GPU_LIMIT,
  manualLaunch: "disabled",
  billingClosure: "provider deletion verification required",
} as const;

function disabledResponse(): NextResponse {
  return NextResponse.json({
    ok: false,
    error: "Direct Novita rendering is admitted only by an automatic Trigger pipeline stage.",
    controlPlane: DIRECT_CONTROL_PLANE,
  }, { status: 410, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    await requireStudioActor(request);
    const { searchParams } = new URL(request.url);
    if (searchParams.get("health") === "1") {
      // Vercel intentionally cannot inspect provider credentials or capacity.
      // The Trigger task/reaper performs that live check before any paid create.
      return NextResponse.json({
        ok: true,
        ready: "trigger-evaluated",
        checkedAt: new Date().toISOString(),
        controlPlane: DIRECT_CONTROL_PLANE,
        note: "Provider capacity, 4090 SKU, model-volume, and prewarm admission are evaluated inside Trigger immediately before worker creation.",
      }, { headers: { "cache-control": "no-store" } });
    }
    return disabledResponse();
  } catch (error) {
    const message = error instanceof Error ? error.message : "studio authentication failed";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await requireStudioActor(request);
    return disabledResponse();
  } catch (error) {
    const message = error instanceof Error ? error.message : "studio authentication failed";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}
