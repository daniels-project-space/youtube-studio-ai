import { NextResponse } from "next/server";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import {
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
  miniMaxH3RequestKey,
} from "@/lib/minimaxH3";
import { assertMiniMaxH3WeeklyBatchArgs } from "@/trigger/minimaxH3WeeklyBatch";

export const runtime = "nodejs";

function ownedBy(ownerId: string, key: string): boolean {
  return key.startsWith(`owner/${ownerId}/`) &&
    !key.includes("\\") && !/(?:^|\/)\.\.?($|\/)/u.test(key);
}

/** Queue one authenticated, owner-scoped weekly Salad H3 batch. */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
    }
    const payload = assertMiniMaxH3WeeklyBatchArgs(body);
    if (!ownedBy(actor.ownerId, payload.receiptKey) || payload.jobs.some((job) =>
      !ownedBy(actor.ownerId, job.firstFrame.r2Key) || !ownedBy(actor.ownerId, job.output.r2Key)) ||
      (payload.preparedFootage !== undefined && (
        payload.preparedFootage.ownerId !== actor.ownerId ||
        !ownedBy(actor.ownerId, payload.preparedFootage.manifestKey)
      ))) {
      return NextResponse.json({ ok: false, error: "all H3 paths must be inside the signed-in owner namespace" }, { status: 403 });
    }
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: "H3 rendering is not activated (no TRIGGER_SECRET_KEY).", inactive: true }, { status: 503 });
    }
    const requestKeys = payload.jobs.map((job) => miniMaxH3RequestKey({
      ...job,
      provider: "salad",
      execution: "weekly-batch",
    }));
    const idempotencyKey = await idempotencyKeys.create(
      `minimax-h3-weekly:${actor.ownerId}:${payload.orderKey}:${requestKeys.join(",")}`,
      { scope: "global" },
    );
    const handle = await tasks.trigger("minimax-h3-weekly-batch", payload, {
      concurrencyKey: `minimax-h3-weekly:${actor.ownerId}`,
      idempotencyKey,
    });
    return NextResponse.json({
      ok: true,
      state: "queued",
      provider: "salad",
      execution: "weekly-batch",
      runtimeId: MINIMAX_H3_RUNTIME_ID,
      profile: MINIMAX_H3_PROFILE,
      jobCount: payload.jobs.length,
      requestKeys,
      triggerRunId: handle.id,
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "could not queue weekly H3 render";
    const status = /invalid|must |required|owner-scoped|safe/i.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
