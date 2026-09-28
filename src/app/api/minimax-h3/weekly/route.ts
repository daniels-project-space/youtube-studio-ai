import { NextResponse } from "next/server";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";

export const runtime = "nodejs";

/**
 * The former weekly provider dispatcher is intentionally retired. Weekly H3
 * requests are staged by the approved-plan worker through Render Engine.
 */
export async function POST(request: Request) {
  try {
    await requireStudioActor(request);
    return NextResponse.json({
      ok: false,
      state: "render-engine",
      error: "Weekly H3 requests are staged through Render Engine.",
    }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "Weekly H3 route is unavailable." }, { status: 503 });
  }
}
