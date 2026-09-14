import { NextResponse } from "next/server";
import { idempotencyKeys, tasks, runs } from "@trigger.dev/sdk";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { getObjectBytes } from "@/lib/storage";
import {
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
  miniMaxH3RequestKey,
  miniMaxH3WeeklyRequestPacketKey,
} from "@/lib/minimaxH3";
import { isMiniMaxH3CapacityHoldError } from "@/lib/minimaxH3Status";
import { assertMiniMaxH3WeeklyBatchArgs, type PersistedWeeklyRequestPacket } from "@/trigger/minimaxH3WeeklyBatch";

export const runtime = "nodejs";

function ownerPath(ownerId: string, value: string): boolean {
  return value.startsWith(`owner/${ownerId}/`) &&
    value.length <= 1_000 &&
    !value.includes("\\") &&
    !/(?:^|\/)\.\.?($|\/)/u.test(value);
}

function ownerReceiptKey(ownerId: string, value: string): boolean {
  return ownerPath(ownerId, value) && value.endsWith(".json");
}

function triggerRunId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

function notFound(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return candidate?.name === "NoSuchKey" || candidate?.name === "NotFound" ||
    candidate?.$metadata?.httpStatusCode === 404;
}

function isTerminal(status: unknown): boolean {
  return ["COMPLETED", "FAILED", "CANCELED"].includes(String(status).toUpperCase());
}

function validPacket(value: unknown): value is PersistedWeeklyRequestPacket {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const packet = value as Record<string, unknown>;
  return packet.schema === "minimax-h3-weekly-request/v1" &&
    typeof packet.orderKey === "string" && packet.orderKey.length > 0 &&
    Array.isArray(packet.requestKeys) && packet.requestKeys.length >= 1 && packet.requestKeys.length <= 60 &&
    packet.requestKeys.every((key) => typeof key === "string" && key.length > 0) &&
    Array.isArray(packet.jobs) && packet.jobs.length === packet.requestKeys.length &&
    Number.isSafeInteger(packet.createdAt) && Number(packet.createdAt) > 0;
}

/**
 * Re-queues only a frozen, pre-provider Salad capacity hold. The browser sends
 * no jobs: the task payload is reconstructed from the immutable R2 packet.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "runId and owner-scoped receiptKey are required" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const runId = typeof input.runId === "string" ? input.runId.trim() : "";
    const receiptKey = typeof input.receiptKey === "string" ? input.receiptKey.trim() : "";
    if (!triggerRunId(runId) || !ownerReceiptKey(actor.ownerId, receiptKey)) {
      return NextResponse.json({ ok: false, error: "runId and owner-scoped receiptKey are required" }, { status: 400 });
    }
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: "H3 retry is not activated (no TRIGGER_SECRET_KEY).", inactive: true }, { status: 503 });
    }

    const run = await runs.retrieve(runId);
    if (run.taskIdentifier !== "minimax-h3-weekly-batch") {
      return NextResponse.json({ ok: false, error: "only weekly Salad H3 runs can be retried here" }, { status: 409 });
    }
    if (!isTerminal(run.status) || !isMiniMaxH3CapacityHoldError(run.error)) {
      return NextResponse.json({ ok: false, error: "run is not a verified pre-provider capacity hold" }, { status: 409 });
    }

    // A receipt may have appeared after the progress poll. Never dispatch if
    // any durable receipt bytes exist, even if the JSON is malformed.
    try {
      await getObjectBytes(receiptKey);
      return NextResponse.json({ ok: false, error: "H3 receipt already exists; reconcile instead of retrying" }, { status: 409 });
    } catch (error) {
      if (!notFound(error)) throw error;
    }

    let packet: unknown;
    try {
      packet = JSON.parse(new TextDecoder().decode(await getObjectBytes(miniMaxH3WeeklyRequestPacketKey(receiptKey)))) as unknown;
    } catch (error) {
      if (notFound(error)) {
        return NextResponse.json({ ok: false, error: "frozen H3 request packet is missing" }, { status: 409 });
      }
      return NextResponse.json({ ok: false, error: "frozen H3 request packet is unavailable or invalid" }, { status: 409 });
    }
    if (!validPacket(packet)) {
      return NextResponse.json({ ok: false, error: "frozen H3 request packet is invalid" }, { status: 409 });
    }

    let payload;
    try {
      payload = assertMiniMaxH3WeeklyBatchArgs({ ...packet, ownerId: actor.ownerId });
    } catch {
      return NextResponse.json({ ok: false, error: "frozen H3 request packet failed validation" }, { status: 409 });
    }
    if (!payload.jobs.every((job) =>
      ownerPath(actor.ownerId, job.firstFrame.r2Key) && ownerPath(actor.ownerId, job.output.r2Key)) ||
      (payload.preparedFootage !== undefined && payload.preparedFootage.ownerId !== actor.ownerId)) {
      return NextResponse.json({ ok: false, error: "frozen H3 request packet is outside the signed-in owner namespace" }, { status: 403 });
    }
    const requestKeys = payload.jobs.map((job) => miniMaxH3RequestKey({
      ...job,
      provider: "salad",
      execution: "weekly-batch",
    }));
    if (requestKeys.length !== packet.requestKeys.length || requestKeys.some((key, index) => key !== packet.requestKeys[index])) {
      return NextResponse.json({ ok: false, error: "frozen H3 request identities do not match the packet" }, { status: 409 });
    }

    const idempotencyKey = await idempotencyKeys.create(
      `minimax-h3-weekly-capacity-retry:${actor.ownerId}:${runId}`,
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
      retryOfRunId: runId,
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "could not retry H3 render" }, { status: 500 });
  }
}
