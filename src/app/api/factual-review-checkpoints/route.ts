import { NextResponse } from "next/server";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { presignDownload } from "@/lib/storage";

export const runtime = "nodejs";

// Keep fresh-codegen looseness at one server-only seam. The browser never
// names source packs, route/profile state, artifact hashes, or raw ledger data.
const factualReviewCheckpointsApi = (api as unknown as {
  readonly factualReviewCheckpoints: {
    readonly getReviewForRun: never;
    readonly approve: never;
    readonly reject: never;
  };
}).factualReviewCheckpoints;

class FactualReviewRequestError extends Error {}

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500) {
    throw new FactualReviewRequestError(`${label} is required`);
  }
  return value;
}

function requiredActionBody(value: unknown): { action: "approve" | "reject"; checkpointId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FactualReviewRequestError("request body must be an object");
  }
  const body = value as Record<string, unknown>;
  const unexpected = Object.keys(body).filter((key) => key !== "action" && key !== "checkpointId");
  if (unexpected.length) {
    throw new FactualReviewRequestError(
      `factual review accepts only action and checkpointId; unrecognized ${unexpected.join(", ")}`,
    );
  }
  if (body.action !== "approve" && body.action !== "reject") {
    throw new FactualReviewRequestError("action must be approve or reject");
  }
  return { action: body.action, checkpointId: requiredId(body.checkpointId, "checkpointId") };
}

function responseError(error: unknown) {
  if (error instanceof StudioAuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof FactualReviewRequestError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Factual review workflow failed";
  const status = /factual review|checkpoint|awaiting|retained|approval|rejection/i.test(message) ? 422 : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

function publicCheckpoint(checkpoint: Record<string, unknown>) {
  // Deliberately omit immutable artifact bindings and source authority: the
  // owner sees the server-derived review materials, never a browser-supplied
  // evidence or artifact handoff that could change what is later resumed.
  return {
    id: String(checkpoint._id ?? ""),
    decision: checkpoint.decision,
    createdAt: checkpoint.createdAt,
    reviewerId: checkpoint.reviewerId,
    approvedAt: checkpoint.approvedAt,
    rejectedAt: checkpoint.rejectedAt,
    blockedAt: checkpoint.blockedAt,
    blockedReason: checkpoint.blockedReason,
  };
}

/**
 * The Convex mutations intentionally return their full durable receipt to
 * server callers for idempotency/reconciliation.  The browser only needs to
 * know whether its decision was accepted; do not echo source authority or
 * content-addressed artifact bindings back through this owner desk.
 */
function publicDecision(result: unknown) {
  const value = result && typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown>
    : {};
  return {
    kind: typeof value.kind === "string" ? value.kind : "unknown",
    reused: value.reused === true,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

/**
 * Owner-only factual review desk. GET returns a server-derived frozen review
 * projection; POST accepts a decision only. It does no provider, browser, or
 * render work and cannot introduce an unreviewed source authority.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const runId = requiredId(new URL(request.url).searchParams.get("runId"), "runId");
    const reviewResult = await convexClient().query(factualReviewCheckpointsApi.getReviewForRun, {
      ownerId: actor.ownerId,
      runId: runId as Id<"runs">,
    } as never) as unknown as {
      checkpoint: Record<string, unknown>;
      review?: Record<string, unknown>;
      integrityError?: string;
    } | null;
    if (!reviewResult) return NextResponse.json({ ok: true, checkpoint: null }, { headers: { "Cache-Control": "no-store" } });

    const narrationKey = reviewResult.review?.narrationKey;
    const ownedPrefix = `owner/${actor.ownerId}/`;
    const narrationAudioUrl =
      typeof narrationKey === "string" && narrationKey.startsWith(ownedPrefix) && !narrationKey.includes("..")
        ? await presignDownload(narrationKey, { expiresIn: 600 })
        : undefined;
    const review = reviewResult.review
      ? {
          ...reviewResult.review,
          // Keep the R2 locator out of browser state. The short-lived URL is
          // enough for auditioning the exact approved narration.
          narrationKey: undefined,
          narrationAudioUrl,
        }
      : undefined;
    return NextResponse.json(
      {
        ok: true,
        checkpoint: publicCheckpoint(reviewResult.checkpoint),
        ...(review ? { review } : {}),
        ...(reviewResult.integrityError ? { integrityError: reviewResult.integrityError } : {}),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const { action, checkpointId } = requiredActionBody(await request.json());
    const convex = convexClient();
    const result = action === "approve"
      ? await convex.mutation(factualReviewCheckpointsApi.approve, {
          ownerId: actor.ownerId,
          checkpointId: checkpointId as Id<"factualReviewCheckpoints">,
          reviewerId: actor.ownerId,
          now: Date.now(),
        } as never)
      : await convex.mutation(factualReviewCheckpointsApi.reject, {
          ownerId: actor.ownerId,
          checkpointId: checkpointId as Id<"factualReviewCheckpoints">,
          reviewerId: actor.ownerId,
          now: Date.now(),
        } as never);
    return NextResponse.json(
      { ok: true, result: publicDecision(result) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseError(error);
  }
}
