import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";

/**
 * POST /api/research  { niche: string, channelId?: string }
 *
 * Fires the `refresh-niche-research` Trigger task (competitor-intelligence
 * engine) for a niche. This is the SEO page's "Research now" button.
 *
 * GRACEFUL-WHEN-INACTIVE: the intelligence engine is only live once Trigger.dev
 * is deployed AND the keys (TRIGGER_SECRET_KEY + YOUTUBE_DATA_API_KEY) are
 * provisioned. Until then this returns HTTP 503 with a clear message instead of
 * crashing, so the UI can show a toast rather than an unhandled error.
 *
 * Runs on the Node.js runtime (the Trigger SDK + Convex client need Node).
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { niche?: string; channelId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const niche = body.niche?.trim();
  if (!niche) {
    return NextResponse.json({ error: "missing niche" }, { status: 400 });
  }

  // Engine-not-activated guard: no Trigger secret → not deployed yet.
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json(
      {
        error:
          "Intelligence engine not activated. Deploy Trigger.dev and provision TRIGGER_SECRET_KEY + YOUTUBE_DATA_API_KEY to enable research.",
        inactive: true,
      },
      { status: 503 },
    );
  }

  try {
    // Lazy import so a missing/older SDK never breaks the build or other routes.
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger("refresh-niche-research", {
      ownerId: OWNER_ID,
      niche,
      channelId: body.channelId,
    });
    return NextResponse.json({ ok: true, handleId: handle.id, niche });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "failed to trigger research",
        inactive: true,
      },
      { status: 503 },
    );
  }
}
