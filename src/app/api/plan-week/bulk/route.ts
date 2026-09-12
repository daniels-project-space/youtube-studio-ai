import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";
import { authorizeStudioRoute } from "@/lib/operatorSession";
import { buildPlanWeekBulkOrder } from "@/lib/planWeekBulk";

export const runtime = "nodejs";

/**
 * POST /api/plan-week/bulk
 * { channelIds: string[], count: number, requestKey: string, budgetCapUsd?: number }
 * Queues one bounded, idempotent owner/week fan-out. Provider work remains in
 * each child plan-week-ahead task and is never performed by this HTTP handler.
 */
export async function POST(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("plan-week bulk request must be an object");
    }
    const body = input as Record<string, unknown>;
    const order = buildPlanWeekBulkOrder({
      ownerId: OWNER_ID,
      channelIds: body.channelIds as string[],
      count: body.count as number,
      requestKey: body.requestKey as string,
      ...(body.budgetCapUsd === undefined ? {} : { budgetCapUsd: body.budgetCapUsd as number }),
    });
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json(
        { ok: false, error: "Planner not activated (no TRIGGER_SECRET_KEY).", inactive: true },
        { status: 503 },
      );
    }
    const { idempotencyKeys, tasks } = await import("@trigger.dev/sdk");
    const idempotencyKey = await idempotencyKeys.create(
      `plan-week-bulk:${order.ownerId}:${order.requestKey}:${order.fingerprint}`,
      { scope: "global" },
    );
    const handle = await tasks.trigger("plan-week-bulk", {
      ownerId: order.ownerId,
      channelIds: order.channels.map((channel) => channel.channelId),
      count: order.count,
      requestKey: order.requestKey,
      ...(body.budgetCapUsd === undefined ? {} : { budgetCapUsd: body.budgetCapUsd as number }),
    }, {
      concurrencyKey: `plan-week-bulk:${order.ownerId}`,
      idempotencyKey,
    });
    return NextResponse.json({
      ok: true,
      state: "queued",
      orderFingerprint: order.fingerprint,
      channelCount: order.channels.length,
      totalItems: order.totalItems,
      reservedCostUsd: order.reservedCostUsd,
      triggerRunId: handle.id,
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not queue bulk planner";
    const status = /required|invalid|must |cannot exceed|exceeds caller cap|identifiers|unique|object/i.test(message)
      ? 422
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
