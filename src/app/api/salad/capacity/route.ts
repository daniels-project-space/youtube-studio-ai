import { NextResponse } from "next/server";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { readSaladCapacitySnapshot } from "@/lib/saladCapacity";

export const runtime = "nodejs";

/**
 * Owner-only, read-only fleet visibility.  This route deliberately has no
 * Salad lifecycle methods in its call graph: it can inform a dispatch choice
 * without reserving or starting paid capacity.
 */
export async function GET(request: Request) {
  try {
    await requireStudioActor(request);
    const snapshot = await readSaladCapacitySnapshot();
    return NextResponse.json({ ok: true, provider: "salad", ...snapshot }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "Salad capacity could not be read", paidRequestStarted: false }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
