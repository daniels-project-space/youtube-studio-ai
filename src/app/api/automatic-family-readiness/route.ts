import { NextResponse } from "next/server";

import {
  assessAutomaticFamilyExecutionReadiness,
} from "@/engine/automaticFamilyExecutionReadiness";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { FAMILY_KEYS } from "@/engine/families";
import { authorizeStudioRoute } from "@/lib/operatorSession";

export const runtime = "nodejs";

/**
 * Owner-session endpoint for the creator UI. It exposes no credentials—only
 * whether an already-certified automatic family has its extra live renderer
 * stack available in the current execution environment.
 */
export async function GET(request: Request): Promise<Response> {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;

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
