import { NextResponse } from "next/server";
import { MINIMAX_H3_PROFILE, MINIMAX_H3_RUNTIME_ID } from "@/lib/minimaxH3";
import { requireStudioActor } from "@/lib/operatorSession";

/**
 * This route intentionally does not render and does not hold Novita credentials.
 * Paid worker admission runs only in the authenticated Trigger child task, where
 * it has a frozen run identity, Convex lease, R2 manifest, and verified reaper.
 */
export const runtime = "nodejs";

const DIRECT_CONTROL_PLANE = {
  provider: "novita",
  execution: "minimax-h3-on-demand-trigger-only",
  gpuSku: "RTX 5090",
  gpuCountPerWorker: 1,
  concurrencyCeiling: 1,
  manualLaunch: "disabled",
  billingClosure: "provider deletion verification required",
  runtimeId: MINIMAX_H3_RUNTIME_ID,
  profile: MINIMAX_H3_PROFILE.id,
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
    architecturalGpuCeiling: 1,
    verifiedGpuQuota: null,
    effectiveGpuLimit: null,
    activeGpuCount: null,
    blockers: [
      "direct_trigger_attestation_unavailable_from_studio_route",
      "minimax_h3_rtx_5090_on_demand_worker_not_benchmarked",
    ],
    attestation: {
      source: "studio-static" as const,
      profileIdentity: null,
      exactMiniMaxH3Rtx5090: false,
    },
    contract: null,
    models: null,
    storage: null,
    controls: null,
    controlPlane: DIRECT_CONTROL_PLANE,
    note: "Studio does not hold provider credentials. The on-demand Trigger task verifies the exact MiniMax H3 R2 pack and Novita receipt immediately before accepting a paid clip.",
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
