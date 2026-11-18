import { NextResponse } from "next/server";
import { privateTriggerRequestOptions, PrivateTriggerTargetError } from "@/lib/privateTriggerTarget";
import { OWNER_ID } from "@/lib/config";
import { authorizeStudioRoute } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { assertResearchChannel, parseResearchInput, readResearchBody, ResearchChannelError } from "@/lib/nicheResearchAdmission";

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
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  let body: ReturnType<typeof parseResearchInput>;
  try {
    body = parseResearchInput(await readResearchBody(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid research request";
    return NextResponse.json({ error: message }, { status: message === "research request is too large" ? 413 : 400 });
  }

  const { niche, channelId } = body;
  if (channelId) {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) return NextResponse.json({ error: "channel verification unavailable" }, { status: 503 });
    try {
      const channel = await new StudioConvexHttpClient(url).query(api.channels.getChannel, { channelId: channelId as Id<"channels"> });
      assertResearchChannel(channel, OWNER_ID, niche);
    } catch (error) {
      if (error instanceof ResearchChannelError) return NextResponse.json({ error: error.message }, { status: error.message === "channel not found" ? 404 : 409 });
      if (error instanceof Error && /Studio resource (?:access denied|not found)/.test(error.message)) return NextResponse.json({ error: "channel not found" }, { status: 404 });
      return NextResponse.json({ error: "channel verification unavailable" }, { status: 503 });
    }
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
    const requestOptions = privateTriggerRequestOptions(process.env);
    // Lazy import so a missing/older SDK never breaks the build or other routes.
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger("refresh-niche-research", {
      ownerId: OWNER_ID,
      niche,
      channelId,
    }, undefined, requestOptions);
    return NextResponse.json({ ok: true, handleId: handle.id, niche });
  } catch (err) {
    if (err instanceof PrivateTriggerTargetError) return NextResponse.json({ error: err.message, inactive: true }, { status: 503 });
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
