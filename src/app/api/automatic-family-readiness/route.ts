import { NextResponse } from "next/server";

import {
  assessAutomaticFamilyExecutionReadiness,
} from "@/engine/automaticFamilyExecutionReadiness";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { FAMILY_KEYS } from "@/engine/families";

export const runtime = "nodejs";

/**
 * Read-only creator preflight. It exposes no credentials or account data—only
 * whether an already-certified automatic family can currently start. Keeping
 * this readable before owner verification prevents the wizard from advertising
 * a route and then failing merely because its status check was gated.
 */
export async function GET(): Promise<Response> {
  const families = FAMILY_KEYS
    .filter((family) => certifiedFamilyAdmission(family).automatic)
    .map((family) => {
      try {
        return assessAutomaticFamilyExecutionReadiness(family);
      } catch (error) {
        return {
          family,
          ready: false,
          scope: "live_renderer_stack" as const,
          blockers: [
            `automatic execution capability check failed: ${error instanceof Error ? error.message : String(error)}`,
          ],
        };
      }
    });

  return NextResponse.json(
    { ok: true, families },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
