import { NextResponse } from "next/server";

import {
  automaticFamilyCreatorReadiness,
} from "@/engine/automaticFamilyCreatorReadiness";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { FAMILY_KEYS } from "@/engine/families";

export const runtime = "nodejs";

/**
 * Read-only creator-contract preflight. Provider credentials live in Trigger,
 * not in this Vercel process, so this endpoint deliberately confirms only the
 * server-owned route/composition/inception contract. The execution worker
 * repeats its independent live-provider gate after secret hydration and before
 * any durable build or spend.
 */
export async function GET(): Promise<Response> {
  const families = FAMILY_KEYS
    .filter((family) => certifiedFamilyAdmission(family).automatic)
    .map((family) => {
      try {
        const admission = automaticFamilyCreatorReadiness(family);
        return {
          family,
          ready: admission.ready,
          scope: "creator_contract" as const,
          blockers: admission.blockers,
        };
      } catch (error) {
        return {
          family,
          ready: false,
          scope: "creator_contract" as const,
          blockers: [
            `automatic creator contract check failed: ${error instanceof Error ? error.message : String(error)}`,
          ],
        };
      }
    });

  return NextResponse.json(
    { ok: true, families },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
