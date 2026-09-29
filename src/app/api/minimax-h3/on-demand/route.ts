import { NextResponse } from "next/server";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { NOVITA_GENERATION_RETIRED } from "@/lib/novitaGenerationRetirement";

export const runtime = "nodejs";

/** The former direct H3 dispatcher is retired for new requests. */
export async function POST(request: Request) {
  try {
    await requireStudioActor(request);
    return NextResponse.json({
      ok: false,
      state: "render-engine",
      error: NOVITA_GENERATION_RETIRED,
    }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "H3 route is unavailable." }, { status: 503 });
  }
}
