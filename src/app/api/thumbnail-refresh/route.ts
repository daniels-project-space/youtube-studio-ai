import { NextResponse } from "next/server";

import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import { presignDownload } from "@/lib/storage";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { listThumbnailRefreshInventory } from "@/lib/thumbnailRefreshRuntime";

export const runtime = "nodejs";

function convexClient(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

/**
 * Browser-safe inventory of thumbnail provenance. The Convex record may carry
 * an internal R2 key; this projection intentionally reduces it to presence so
 * an operator can review status without gaining a storage locator.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const inventory = await listThumbnailRefreshInventory({
      client: convexClient(),
      ownerId: actor.ownerId,
    });
    const previewRunId = new URL(request.url).searchParams.get("previewRunId");
    if (previewRunId !== null) {
      // The browser may ask only for the opaque run identity it already owns.
      // Resolve the R2 key server-side from the owner-scoped inventory; never
      // let a client supply or receive a storage locator.
      if (!/^[A-Za-z0-9_-]{8,256}$/.test(previewRunId)) {
        return NextResponse.json({ ok: false, error: "invalid thumbnail preview request" }, { status: 400 });
      }
      const item = inventory.find((candidate) => String(candidate.runId) === previewRunId);
      if (!item?.thumbnailKey || item.thumbnailKey.includes("..")) {
        return NextResponse.json({ ok: false, error: "retained thumbnail preview unavailable" }, { status: 404 });
      }
      return NextResponse.json(
        {
          ok: true,
          preview: {
            url: await presignDownload(item.thumbnailKey, { expiresIn: 300 }),
          },
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        inventory: inventory.map((item) => ({
          runId: item.runId,
          channelId: item.channelId,
          channelName: item.channelName,
          channelSlug: item.channelSlug,
          title: item.title,
          createdAt: item.createdAt,
          status: item.status,
          youtubeVideoId: item.youtubeVideoId ?? null,
          thumbnailPresent: Boolean(item.thumbnailKey),
          thumbnailEvidenceStatus: item.thumbnailEvidenceStatus,
          refreshAction: item.refreshAction,
          evidenceReason: item.evidenceReason,
          releaseEvidenceStatus: item.releaseEvidenceStatus,
          thumbnailReplayStatus: item.thumbnailReplayStatus,
          thumbnailReplayReason: item.thumbnailReplayReason,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: "Could not load thumbnail review inventory" },
      { status: 500 },
    );
  }
}
