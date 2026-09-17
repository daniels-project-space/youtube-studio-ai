import { NextResponse } from "next/server";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { assertPlanWeekPreparedMusicArgs } from "@/trigger/planWeekPreparedMusic";
import { planWeekPreparedMusicAudioKey, planWeekPreparedMusicKey } from "@/lib/planWeekPreparation";

export const runtime = "nodejs";

function ownedBy(ownerId: string, key: string): boolean {
  return key.startsWith(`owner/${ownerId}/`) && !key.includes("\\") && !/(?:^|\/)\.\.?($|\/)/u.test(key);
}

/** Queue one authenticated, receipt-backed weekly music preparation. */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "payload must be an object" }, { status: 400 });
    const payload = assertPlanWeekPreparedMusicArgs({ ...(body as Record<string, unknown>), ownerId: actor.ownerId });
    if (!ownedBy(actor.ownerId, payload.manifestKey)) return NextResponse.json({ ok: false, error: "weekly music manifest is outside the signed-in owner namespace" }, { status: 403 });
    if (!process.env.TRIGGER_SECRET_KEY) return NextResponse.json({ ok: false, error: "weekly music preparation is not activated (no TRIGGER_SECRET_KEY)", inactive: true }, { status: 503 });
    const idempotencyKey = await idempotencyKeys.create(`plan-week-music:${actor.ownerId}:${payload.manifestSha256}`, { scope: "global" });
    const handle = await tasks.trigger("plan-week-prepared-music", payload, {
      concurrencyKey: `plan-week-music:${actor.ownerId}:${payload.channelId}`,
      idempotencyKey,
    });
    const scope = { ownerId: payload.ownerId, channelSlug: payload.channelSlug, batchId: payload.batchId, itemId: payload.itemId };
    return NextResponse.json({
      ok: true,
      state: "queued",
      triggerRunId: handle.id,
      sidecarKey: planWeekPreparedMusicKey(scope),
      audioKey: planWeekPreparedMusicAudioKey(scope),
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : "could not queue weekly music preparation";
    return NextResponse.json({ ok: false, error: message }, { status: /invalid|must |outside|canonical/u.test(message) ? 422 : 500 });
  }
}
