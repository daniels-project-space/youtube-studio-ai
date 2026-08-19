import { NextResponse } from "next/server";
import { authorizeStudioRoute } from "@/lib/operatorSession";

/**
 * Retired until every language sibling can pass a separately admitted inception
 * plan with its own identity, localisation QA, budget reservation, and lifecycle.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  return NextResponse.json(
    {
      error:
        "Multilingual sibling creation is temporarily unavailable. Create each language channel through an admitted channel-inception plan with its own identity, localisation QA, and budget reservation.",
      retired: true,
    },
    { status: 410 },
  );
}
