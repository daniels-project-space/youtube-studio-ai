import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { planWeekPreparedFootageKey } from "@/lib/planWeekPreparation";

export const runtime = "nodejs";

/** Explicitly copy completed, verified Engine footage; this never releases GPU work. */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "payload must be an object" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const allowed = ["channelSlug", "batchId", "itemId"];
    if (Object.keys(input).some((key) => !allowed.includes(key)) ||
        !allowed.every((key) => typeof input[key] === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(input[key] as string))) {
      return NextResponse.json({ ok: false, error: "invalid footage materialization scope" }, { status: 422 });
    }
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json({ ok: false, inactive: true, error: "footage materialization is not activated" }, { status: 503 });
    }
    const scope = { ownerId: actor.ownerId, channelSlug: input.channelSlug as string, batchId: input.batchId as string, itemId: input.itemId as string };
    // Each manual retry gets a new run: a previous run may have observed unfinished Engine jobs.
    // The materializer itself verifies immutable receipts and performs create-only R2 writes.
    const handle = await tasks.trigger("render-engine-h3-materialize-prepared-footage", scope);
    return NextResponse.json({ ok: true, state: "queued", triggerRunId: handle.id, sidecarKey: planWeekPreparedFootageKey(scope) },
      { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: "could not queue footage materialization" }, { status: 500 });
  }
}
