import { NextResponse } from "next/server";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { minimaxH3Readiness, assertMiniMaxH3R2ModelManifest } from "@/lib/minimaxH3";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";

export const runtime = "nodejs";

type Lane = {
  provider: "salad" | "novita";
  state: "ready" | "hold";
  reasons: string[];
};

function readableBlocker(blocker: string): string {
  if (blocker.includes("WORKER_URL") || blocker.includes("WORKER_TOKEN")) return "Worker endpoint is not configured.";
  if (blocker.includes("QUALIFICATION_RECEIPT")) return "A reviewed route qualification receipt is required.";
  if (blocker.includes("_QUALIFIED")) return "Route quality has not been approved.";
  if (blocker.includes("HIGH_PRIORITY_FALLBACK")) return "High-priority fallback is disabled.";
  if (blocker.includes("MEDIUM_PRIORITY")) return "Medium-priority weekly capacity is disabled.";
  return "Route admission needs attention.";
}

function lane(provider: "salad" | "novita"): Lane {
  const readiness = minimaxH3Readiness(provider);
  return {
    provider,
    state: readiness.admitted ? "ready" : "hold",
    reasons: [...new Set(readiness.blockers.map(readableBlocker))],
  };
}

/**
 * Owner-only, read-only runtime gate for the H3 console.
 *
 * Market capacity is deliberately checked on a separate endpoint. This check
 * answers the earlier boundary: whether the sealed worker and model artifact
 * are actually admissible before anybody considers a paid request.
 */
export async function GET(request: Request) {
  try {
    await requireStudioActor(request);
    await bootstrapSecrets(undefined, { services: ["cloudflare", "novita", "salad"] });
    const lanes = [lane("salad"), lane("novita")];
    let modelPack: { state: "verified" | "integrity_hold" | "unavailable"; reason?: string };
    try {
      await assertMiniMaxH3R2ModelManifest();
      modelPack = { state: "verified" };
    } catch (error) {
      // Do not turn a transient R2 error into a false integrity diagnosis.
      // Nor surface hashes or storage/provider internals to the browser.
      const message = error instanceof Error ? error.message : "";
      modelPack = message.includes("digest does not match")
        ? {
            state: "integrity_hold",
            reason: "The R2 model manifest no longer matches the sealed runtime. Reseal and verify the model pack before enabling H3.",
          }
        : {
            state: "unavailable",
            reason: "The R2 model manifest could not be verified. H3 remains held until its integrity can be confirmed.",
          };
    }
    return NextResponse.json({
      ok: true,
      checkedAt: Date.now(),
      paidRequestStarted: false,
      lanes,
      modelPack,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "H3 runtime readiness could not be checked", paidRequestStarted: false }, { status: 503 });
  }
}
