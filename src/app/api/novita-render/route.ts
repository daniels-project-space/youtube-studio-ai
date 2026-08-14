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

/**
 * The Studio route deliberately has no Novita credentials, so it must never
 * present its architectural description as a live render admission. A future
 * Trigger-owned attestation adapter may replace this object, but only with an
 * exact profile-bound proof from the direct controller.
 */
function unattestedStudioHealth() {
  return {
    ok: true,
    ready: false,
    checkedAt: new Date().toISOString(),
    architecturalGpuCeiling: NOVITA_HARD_GPU_LIMIT,
    verifiedGpuQuota: null,
    effectiveGpuLimit: null,
    activeGpuCount: null,
    blockers: [
      "direct_trigger_attestation_unavailable_from_studio_route",
      "ltx_2_5_rtx_4090_x2_profile_not_benchmarked",
    ],
    attestation: {
      source: "studio-static" as const,
      profileIdentity: null,
      exactLtx25Rtx4090X2: false,
    },
    contract: null,
    models: null,
    storage: null,
    controls: null,
    controlPlane: DIRECT_CONTROL_PLANE,
    note: "Studio does not hold provider credentials. Trigger verifies the exact LTX 2.5 RTX 4090 x2 profile immediately before any paid worker is created.",
  };
}

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
      return NextResponse.json(unattestedStudioHealth(), { headers: { "cache-control": "no-store" } });
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
