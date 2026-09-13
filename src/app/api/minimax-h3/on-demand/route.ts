import { NextResponse } from "next/server";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import {
  assertMiniMaxH3OnDemandArgs,
} from "@/trigger/minimaxH3OnDemand";
import {
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
  miniMaxH3RequestKey,
} from "@/lib/minimaxH3";

export const runtime = "nodejs";

function ownedBy(ownerId: string, key: string): boolean {
  return key.startsWith(`owner/${ownerId}/`) &&
    !key.includes("\\") && !/(?:^|\/)\.\.?($|\/)/u.test(key);
}

/** Queue one authenticated, owner-scoped H3 repair/interactive render. */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
    }
    const payload = assertMiniMaxH3OnDemandArgs(body);
    if (!ownedBy(actor.ownerId, payload.receiptKey) ||
        !ownedBy(actor.ownerId, payload.request.firstFrame.r2Key) ||
        !ownedBy(actor.ownerId, payload.request.output.r2Key)) {
      return NextResponse.json({ ok: false, error: "all H3 paths must be inside the signed-in owner namespace" }, { status: 403 });
    }
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: "H3 rendering is not activated (no TRIGGER_SECRET_KEY).", inactive: true }, { status: 503 });
    }
    const requestKey = miniMaxH3RequestKey({
      ...payload.request,
      provider: "novita",
      execution: "on-demand",
    });
    const idempotencyKey = await idempotencyKeys.create(
      `minimax-h3-on-demand:${actor.ownerId}:${payload.orderKey}:${requestKey}`,
      { scope: "global" },
    );
    const handle = await tasks.trigger("minimax-h3-on-demand", payload, {
      concurrencyKey: `minimax-h3-on-demand:${actor.ownerId}`,
      idempotencyKey,
    });
    return NextResponse.json({
      ok: true,
      state: "queued",
      provider: "novita",
      execution: "on-demand",
      runtimeId: MINIMAX_H3_RUNTIME_ID,
      profile: MINIMAX_H3_PROFILE,
      requestKey,
      triggerRunId: handle.id,
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "could not queue H3 on-demand render";
    const status = /invalid|must |required|owner-scoped|safe/i.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
