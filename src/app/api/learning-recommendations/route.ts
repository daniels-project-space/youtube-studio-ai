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
    const rows = await convexClient().query(
      api.learningGovernance.listForOwner,
      {
        secret: requireInternalQuerySecret(),
        ownerId: actor.ownerId,
      },
    );
    return NextResponse.json({ ok: true, recommendations: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    await hydrateEnv("youtube");
    const body = (await request.json()) as {
      action?: "approve_and_activate" | "reject";
      recommendationId?: string;
    };
    if (
      !body.recommendationId ||
      (body.action !== "approve_and_activate" && body.action !== "reject")
    ) {
      return NextResponse.json(
        { ok: false, error: "recommendationId and a valid action are required" },
        { status: 400 },
      );
    }
    const convex = convexClient();
    const secret = requireInternalQuerySecret();
    const recommendationId =
      body.recommendationId as Id<"learningRecommendations">;
    const recommendation =
      body.action === "approve_and_activate"
        ? await convex.mutation(api.learningGovernance.approveAndActivate, {
            secret,
            ownerId: actor.ownerId,
            recommendationId,
            approvedBy: `${actor.authKind}:${actor.ownerId}`,
            approvedAt: Date.now(),
          })
        : await convex.mutation(api.learningGovernance.reject, {
            secret,
            ownerId: actor.ownerId,
            recommendationId,
            rejectedAt: Date.now(),
          });
    return NextResponse.json({ ok: true, recommendation });
  } catch (error) {
    return errorResponse(error);
  }
}
