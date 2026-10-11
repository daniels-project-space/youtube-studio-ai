import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { GenericId } from "convex/values";

import { api } from "../../../../../../convex/_generated/api";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function equalSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function authorized(request: Request): boolean {
  const expected = process.env.STUDIO_RENDER_BATCH_BROKER_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  if (!expected || Buffer.byteLength(expected, "utf8") < 32 || !authorization.startsWith("Bearer ")) return false;
  return equalSecret(authorization.slice("Bearer ".length), expected);
}

function privateNoStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
}

/**
 * Narrow machine bridge for Render Engine. The bearer only authorizes this
 * read; Studio keeps its Convex signing key and service JWT inside this app.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "authentication required" }, { status: 401, headers: privateNoStore() });
  }

  const ownerId = process.env.STUDIO_RENDER_BATCH_OWNER_ID;
  if (!ownerId || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(ownerId)) {
    return NextResponse.json({ error: "Studio batch broker is not configured" }, { status: 503, headers: privateNoStore() });
  }
  const batchId = new URL(request.url).searchParams.get("batchId")?.trim();
  if (!batchId || batchId.length > 128 || /\s/.test(batchId)) {
    return NextResponse.json({ error: "valid batchId is required" }, { status: 400, headers: privateNoStore() });
  }

  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    return NextResponse.json({ error: "Studio batch broker is not configured" }, { status: 503, headers: privateNoStore() });
  }

  try {
    const client = new StudioConvexHttpClient(url);
    const handoff = await client.query(api.contentPlan.getPlanBatchRenderHandoff, {
      ownerId,
      batchId: batchId as GenericId<"planBatches">,
    });
    if (!handoff) {
      return NextResponse.json({ error: "handoff_not_ready" }, { status: 404, headers: privateNoStore() });
    }
    return NextResponse.json({ handoff }, { headers: privateNoStore() });
  } catch {
    return NextResponse.json({ error: "Studio batch handoff unavailable" }, { status: 503, headers: privateNoStore() });
  }
}
