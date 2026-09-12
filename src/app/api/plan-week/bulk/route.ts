import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";
import { authorizeStudioRoute, requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { buildPlanWeekBulkOrder } from "@/lib/planWeekBulk";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../../../convex/_generated/api";

export const runtime = "nodejs";

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

/**
 * Read the owner-scoped parent handoff and live child progress without
 * exposing provider credentials or making the browser repeat an owner
 * verification ceremony. This endpoint never re-enqueues work.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const fingerprint = new URL(request.url).searchParams.get("fingerprint")?.trim().toLowerCase() ?? "";
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      return NextResponse.json({ ok: false, error: "fingerprint must be a 64-character SHA-256" }, { status: 400 });
    }
    const row = await convexClient().query(api.planWeekBulkOrders.getByFingerprint, {
      ownerId: actor.ownerId,
      fingerprint,
    });
    if (!row) return NextResponse.json({ ok: false, error: "bulk order not found" }, { status: 404 });
    const progress = row.children.reduce<Record<string, number>>((counts, child) => {
      counts[child.status] = (counts[child.status] ?? 0) + 1;
      return counts;
    }, {});
    return NextResponse.json({
      ok: true,
      orderId: String(row._id),
      ownerId: row.ownerId,
      requestKey: row.requestKey,
      fingerprint: row.fingerprint,
      contractVersion: row.contractVersion,
      status: row.status,
      channelCount: row.channelIds.length,
      totalItems: row.totalItems,
      reservedCostUsd: row.reservedCostUsd,
      progress: {
        pending: progress.pending ?? 0,
        queued: progress.queued ?? 0,
        running: progress.running ?? 0,
        succeeded: progress.succeeded ?? 0,
        failed: progress.failed ?? 0,
        completed: (progress.succeeded ?? 0) + (progress.failed ?? 0),
      },
      children: row.children.map((child) => ({
        channelId: String(child.channelId),
        requestKey: child.requestKey,
        count: child.count,
        status: child.status,
        triggerRunId: child.triggerRunId ?? null,
        startedAt: child.startedAt ?? null,
        finishedAt: child.finishedAt ?? null,
        error: child.error ?? null,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "could not read bulk planner status";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

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
      fingerprint: order.fingerprint,
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
