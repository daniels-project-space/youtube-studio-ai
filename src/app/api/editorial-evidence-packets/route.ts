import { NextResponse } from "next/server";

import { api } from "../../../../convex/_generated/api";
import {
  assertEditorialEvidencePacket,
  createEditorialEvidencePacket,
  type EditorialEvidenceClaim,
  type EditorialEvidenceSource,
} from "@/engine/editorialEvidencePacket";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

export const runtime = "nodejs";

class EditorialEvidenceRequestError extends Error {}

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EditorialEvidenceRequestError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new EditorialEvidenceRequestError(`${name} is required`);
  }
  return value;
}

function reviewDraft(value: unknown) {
  const review = object(value, "review");
  return {
    reviewerId: string(review.reviewerId, "review.reviewerId"),
    reviewId: string(review.reviewId, "review.reviewId"),
    reviewedAt: string(review.reviewedAt, "review.reviewedAt"),
  };
}

/** Builds the exact immutable, human-review-only packet before it can be saved. */
function buildPacket(body: Record<string, unknown>, now: number) {
  if (!Array.isArray(body.sources)) throw new EditorialEvidenceRequestError("sources must be an array");
  if (!Array.isArray(body.claims)) throw new EditorialEvidenceRequestError("claims must be an array");
  return createEditorialEvidencePacket({
    subject: string(body.subject, "subject"),
    // The engine's strict schemas validate these values — no UI shape is a
    // substitute for the server-side source/claim/fingerprint checks.
    sources: body.sources as EditorialEvidenceSource[],
    claims: body.claims as EditorialEvidenceClaim[],
    review: reviewDraft(body.review),
    now,
  });
}

function responseError(error: unknown) {
  if (error instanceof StudioAuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof EditorialEvidenceRequestError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Editorial evidence workflow failed";
  const status = /editorial evidence|review|source|claim|packet/i.test(message) ? 422 : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Private factual-evidence desk API. It is intentionally provider-free and
 * cannot build a channel, dispatch a render, spend, or publish. `validate`
 * creates a reviewed packet in memory; only `admit` persists it immutably.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const body = object(await request.json(), "request body");
    const action = string(body.action, "action");
    const now = Date.now();

    if (action === "validate") {
      return NextResponse.json({ ok: true, packet: buildPacket(body, now) });
    }
    if (action === "admit") {
      if (body.reviewerConfirmed !== true) {
        throw new EditorialEvidenceRequestError("reviewer confirmation is required before saving a private evidence packet");
      }
      // Re-check on the write request rather than trusting an earlier preview:
      // a caller cannot swap sources, claims, fingerprint, or review binding
      // between `validate` and `admit`.
      const packet = assertEditorialEvidencePacket(object(body.packet, "packet"), now);
      const convex = convexClient();
      const saved = await convex.mutation(api.editorialEvidencePackets.admit, {
        ownerId: actor.ownerId,
        packet,
        now,
      });
      return NextResponse.json({ ok: true, packet: saved });
    }
    throw new EditorialEvidenceRequestError("unknown editorial evidence action");
  } catch (error) {
    return responseError(error);
  }
}

export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const packetId = new URL(request.url).searchParams.get("packetId");
    const convex = convexClient();
    if (packetId) {
      const packet = await convex.query(api.editorialEvidencePackets.get, {
        ownerId: actor.ownerId,
        packetId: packetId as never,
      });
      return NextResponse.json({ ok: true, packet });
    }
    const packets = await convex.query(api.editorialEvidencePackets.listForOwner, {
      ownerId: actor.ownerId,
    });
    return NextResponse.json({ ok: true, packets });
  } catch (error) {
    return responseError(error);
  }
}
