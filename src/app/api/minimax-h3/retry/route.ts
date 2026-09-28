import { NextResponse } from "next/server";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";

export const runtime = "nodejs";

/** A retired provider retry cannot re-open a stale weekly batch. */
export async function POST(request: Request) {
  try {
    await requireStudioActor(request);
    return NextResponse.json({
      ok: false,
      state: "render-engine",
      error: "Weekly H3 retries are handled by Render Engine.",
    }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "Weekly H3 retry route is unavailable." }, { status: 503 });
  }
}
