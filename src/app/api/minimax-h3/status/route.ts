import { NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { getObjectBytes } from "@/lib/storage";
import { miniMaxH3RequestKey, miniMaxH3WeeklyRequestPacketKey } from "@/lib/minimaxH3";
import { assertMiniMaxH3WeeklyBatchArgs, reconcileWeeklyOrderRejections, type PersistedWeeklyRequestPacket } from "@/trigger/minimaxH3WeeklyBatch";
import { projectH3ReceiptState, type H3RequestPacketState } from "@/lib/h3StatusProjection";
import {
  isMiniMaxH3CapacityHoldError,
  summarizeMiniMaxH3Receipt,
  type MiniMaxH3ReceiptSummary,
} from "@/lib/minimaxH3Status";

export const runtime = "nodejs";

function ownerReceiptKey(ownerId: string, value: string): boolean {
  return value.startsWith(`owner/${ownerId}/`) &&
    value.endsWith(".json") &&
    value.length <= 1_000 &&
    !value.includes("\\") &&
    !/(?:^|\/)\.\.?($|\/)/u.test(value);
}

function notFound(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return candidate?.name === "NoSuchKey" || candidate?.name === "NotFound" ||
    candidate?.$metadata?.httpStatusCode === 404;
}

function triggerRunId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

function validWeeklyRequestPacket(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const packet = value as Record<string, unknown>;
  const requestKeys = packet.requestKeys;
  return packet.schema === "minimax-h3-weekly-request/v1" &&
    typeof packet.orderKey === "string" && packet.orderKey.length > 0 &&
    Array.isArray(requestKeys) && requestKeys.length >= 1 && requestKeys.length <= 60 &&
    requestKeys.every((key) => typeof key === "string" && key.length > 0) &&
    Array.isArray(packet.jobs) && packet.jobs.length === requestKeys.length &&
    Number.isSafeInteger(packet.createdAt) && Number(packet.createdAt) > 0;
}

/**
 * Owner-scoped progress for a queued H3 task. Trigger status is the live
 * control-plane signal; the create-only R2 receipt is the durable completion
 * signal. The endpoint never exposes provider credentials or receipt bodies.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const params = new URL(request.url).searchParams;
    const runId = params.get("runId")?.trim() ?? "";
    const receiptKey = params.get("receiptKey")?.trim() ?? "";
    if (!triggerRunId(runId) || !ownerReceiptKey(actor.ownerId, receiptKey)) {
      return NextResponse.json({ ok: false, error: "runId and owner-scoped receiptKey are required" }, { status: 400 });
    }
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: "H3 status is not activated (no TRIGGER_SECRET_KEY).", inactive: true }, { status: 503 });
    }

    const run = await runs.retrieve(runId);
    let receipt: MiniMaxH3ReceiptSummary | undefined;
    let receiptBody: Record<string, unknown> | undefined;
    let requestPacketState: H3RequestPacketState = "not-applicable";
    let rejected: Awaited<ReturnType<typeof reconcileWeeklyOrderRejections>> = [];
    try {
      const bytes = await getObjectBytes(receiptKey);
      receiptBody = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      receipt = summarizeMiniMaxH3Receipt(receiptBody, actor.ownerId);
    } catch (error) {
      if (!notFound(error)) {
        return NextResponse.json({ ok: false, error: "H3 receipt is malformed or unavailable" }, { status: 409 });
      }
    }
    // Weekly lineage must be checked whether or not the aggregate exists:
    // a rejected paid shot and a completed aggregate are conflicting proofs.
    if (receipt?.kind === "weekly" || !receipt) {
      try {
        const packet = JSON.parse(new TextDecoder().decode(await getObjectBytes(miniMaxH3WeeklyRequestPacketKey(receiptKey))));
        requestPacketState = validWeeklyRequestPacket(packet) ? "frozen" : "invalid";
        if (requestPacketState === "frozen") {
          const frozen = packet as PersistedWeeklyRequestPacket;
          const payload = assertMiniMaxH3WeeklyBatchArgs({
            ownerId: actor.ownerId, orderKey: frozen.orderKey, receiptKey, jobs: frozen.jobs,
          });
          const requestKeys = payload.jobs.map((job) => miniMaxH3RequestKey({ ...job, provider: "salad", execution: "weekly-batch" }));
          const aggregateRequestKeys = Array.isArray(receiptBody?.sourceRequestKeys)
            ? receiptBody.sourceRequestKeys : receiptBody?.requestKeys;
          const aggregateOutputs = receiptBody?.outputs;
          const aggregateMatchesPacket = !receiptBody || (
            receiptBody.orderKey === payload.orderKey &&
            Array.isArray(aggregateRequestKeys) &&
            aggregateRequestKeys.length === requestKeys.length &&
            requestKeys.every((key, index) => key === aggregateRequestKeys[index]) &&
            Array.isArray(aggregateOutputs) && aggregateOutputs.length === payload.jobs.length &&
            payload.jobs.every((job, index) => (aggregateOutputs[index] as { r2Key?: unknown } | undefined)?.r2Key === job.output.r2Key)
          );
          if (requestKeys.some((key, index) => key !== frozen.requestKeys[index]) || !aggregateMatchesPacket) {
            requestPacketState = "invalid";
          } else {
            rejected = await reconcileWeeklyOrderRejections({
              receiptKey, orderKey: payload.orderKey, jobs: payload.jobs,
            });
          }
        }
      } catch (packetError) {
        requestPacketState = notFound(packetError) ? "missing" : "invalid";
      }
    }
    const projection = projectH3ReceiptState({
      triggerStatus: String(run.status),
      aggregateKind: receipt?.kind ?? null,
      packetState: requestPacketState,
      rejectedCount: rejected.length,
      capacityHold: isMiniMaxH3CapacityHoldError(run.error),
    });
    return NextResponse.json({
      ok: true,
      runId,
      triggerStatus: run.status,
      state: projection.state,
      requestPacketState,
      receipt: receipt ?? null,
      ...(rejected.length > 0 ? { rejected } : {}),
      ...(projection.state === "repair_required" ? { repairDisposition: "owner_review_new_order_required" as const } : {}),
      ...(projection.lineageConflict ? { lineageConflict: "aggregate_and_rejected_shot" as const } : {}),
      ...(projection.paidRequestStarted === undefined ? {} : { paidRequestStarted: projection.paidRequestStarted }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "could not read H3 status" }, { status: 500 });
  }
}
