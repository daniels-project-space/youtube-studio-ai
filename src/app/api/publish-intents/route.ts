import { NextResponse } from "next/server";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import {
  requireStudioActor,
  StudioAuthError,
} from "@/lib/operatorSession";
import { hydrateEnv } from "@/lib/vault";
import { requireInternalQuerySecret } from "@/lib/youtubeConnector";
import { isPublishIntentDispatchDue } from "@/lib/publishTiming";

export const runtime = "nodejs";

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function errorResponse(error: unknown): NextResponse {
  const status = error instanceof StudioAuthError ? error.status : 400;
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : "request failed" },
    { status },
  );
}

export async function GET(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    await hydrateEnv("youtube");
    const rows = await convexClient().query(api.publishIntents.listForOwner, {
      secret: requireInternalQuerySecret(),
      ownerId: actor.ownerId,
      limit: 200,
    });
    return NextResponse.json({ ok: true, intents: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    await hydrateEnv("youtube");
    const body = (await request.json()) as {
      action?: "approve" | "cancel";
      intentId?: string;
      evidence?: string;
    };
    if (
      !body.intentId ||
      (body.action !== "approve" && body.action !== "cancel")
    ) {
      return NextResponse.json(
        { ok: false, error: "intentId and a valid action are required" },
        { status: 400 },
      );
    }
    const convex = convexClient();
    const secret = requireInternalQuerySecret();
    const intentId = body.intentId as Id<"publishIntents">;
    const actionAt = Date.now();
    const intent =
      body.action === "approve"
        ? await convex.mutation(api.publishIntents.approve, {
            secret,
            ownerId: actor.ownerId,
            intentId,
            approvedBy: `${actor.authKind}:${actor.ownerId}`,
            evidence: body.evidence?.trim() || "operator approval",
            approvedAt: actionAt,
          })
        : await convex.mutation(api.publishIntents.cancel, {
            secret,
            ownerId: actor.ownerId,
            intentId,
            cancelledAt: actionAt,
          });
    let dispatchTaskId: string | undefined;
    if (
      body.action === "approve" &&
      intent &&
      isPublishIntentDispatchDue(intent, actionAt)
    ) {
      const { tasks } = await import("@trigger.dev/sdk");
      const handle = await tasks.trigger(
        "dispatch-publish-intent",
        { intentId: String(intent._id) },
        { concurrencyKey: `publish:${String(intent.channelId)}` },
      );
      dispatchTaskId = handle.id;
    }
    return NextResponse.json({ ok: true, intent, dispatchTaskId });
  } catch (error) {
    return errorResponse(error);
  }
}
