import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** The archived 30-image trial batch cannot authorize new candidate imports. */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "The reviewed ERNIE trial batch has been retired" },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}
