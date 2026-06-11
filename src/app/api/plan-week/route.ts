import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";

/**
 * POST /api/plan-week  { channelId: string, count?: number }  → { id }
 * Fires the `plan-week-ahead` task (pre-builds upcoming topics + thumbnails +
 * descriptions into the contentPlan table). Server-only (Trigger SDK + secret).
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { channelId?: string; count?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const channelId = body.channelId?.trim();
  if (!channelId) {
    return NextResponse.json({ error: "missing channelId" }, { status: 400 });
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json(
      { error: "Planner not activated (no TRIGGER_SECRET_KEY).", inactive: true },
      { status: 503 },
    );
  }
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger("plan-week-ahead", {
      ownerId: OWNER_ID,
      channelId,
      count: Math.max(1, Math.min(12, body.count ?? 5)),
    });
    return NextResponse.json({ id: handle.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "trigger failed" },
      { status: 500 },
    );
  }
}
