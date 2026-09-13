import { NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { getObjectBytes } from "@/lib/storage";

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

type ReceiptSummary = {
  kind: "weekly" | "on-demand";
  requestCount: number;
  completedCount: number;
  totalCostUsd: number;
};

function summarizeReceipt(value: unknown): ReceiptSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("H3 receipt is malformed");
  }
  const receipt = value as Record<string, unknown>;
  if (receipt.schema === "minimax-h3-weekly-batch/v1") {
    const outputs = receipt.outputs;
    const requestKeys = receipt.requestKeys;
    const totalCostUsd = receipt.totalCostUsd;
    if (!Array.isArray(outputs) || !Array.isArray(requestKeys) || outputs.length !== requestKeys.length ||
        outputs.length < 1 || outputs.length > 60 || typeof totalCostUsd !== "number" ||
        !Number.isFinite(totalCostUsd) || totalCostUsd < 0) {
      throw new Error("H3 weekly receipt is malformed");
    }
    return {
      kind: "weekly",
      requestCount: requestKeys.length,
      completedCount: outputs.length,
      totalCostUsd,
    };
  }
  if (receipt.schema === "minimax-h3-on-demand/v1") {
    const output = receipt.output;
    if (!output || typeof output !== "object" || Array.isArray(output) ||
        typeof receipt.requestKey !== "string" || !receipt.requestKey ||
        typeof (output as Record<string, unknown>).r2Key !== "string" ||
        typeof (output as Record<string, unknown>).costUsd !== "number" ||
        !Number.isFinite((output as Record<string, unknown>).costUsd) ||
        Number((output as Record<string, unknown>).costUsd) < 0) {
      throw new Error("H3 on-demand receipt is malformed");
    }
    return {
      kind: "on-demand",
      requestCount: 1,
      completedCount: 1,
      totalCostUsd: Number((output as Record<string, unknown>).costUsd),
    };
  }
  throw new Error("H3 receipt schema is unsupported");
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
    let receipt: ReceiptSummary | undefined;
    let receiptState: "pending" | "complete" | "reconciliation_required" = "pending";
    try {
      const bytes = await getObjectBytes(receiptKey);
      receipt = summarizeReceipt(JSON.parse(new TextDecoder().decode(bytes)));
      receiptState = "complete";
    } catch (error) {
      if (!notFound(error)) {
        return NextResponse.json({ ok: false, error: "H3 receipt is malformed or unavailable" }, { status: 409 });
      }
      if (["COMPLETED", "FAILED", "CANCELED"].includes(String(run.status).toUpperCase())) {
        receiptState = "reconciliation_required";
      }
    }
    return NextResponse.json({
      ok: true,
      runId,
      triggerStatus: run.status,
      state: receiptState,
      receipt: receipt ?? null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "could not read H3 status" }, { status: 500 });
  }
}
