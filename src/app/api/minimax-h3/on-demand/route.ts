import { NextResponse } from "next/server";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";

export const runtime = "nodejs";

/** Direct H3 rendering is retired until Render Engine has a Final-qualified route. */
export async function POST(request: Request) {
  try {
    await requireStudioActor(request);
    return NextResponse.json({
      ok: false,
      error: "H3 on-demand rendering requires a qualified Render Engine workflow.",
      provider: "render-engine",
    }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "H3 on-demand rendering is unavailable";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
