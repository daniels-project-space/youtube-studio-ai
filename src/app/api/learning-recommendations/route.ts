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
    const convex = convexClient();
    const secret = requireInternalQuerySecret();
    const [rows, showBibleClaims] = await Promise.all([
      convex.query(api.learningGovernance.listForOwner, {
        secret,
        ownerId: actor.ownerId,
      }),
      convex.query(api.learningGovernance.listShowBibleClaims, {
        secret,
        ownerId: actor.ownerId,
      }),
    ]);
    return NextResponse.json({ ok: true, recommendations: rows, showBibleClaims });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    const body = (await request.json()) as {
      action?: "approve_and_activate" | "reject" | "rearm_show_bible_no_dispatch";
      recommendationId?: string;
      claimId?: string;
      reason?: string;
      evidence?: string;
      verifiedNoDispatch?: boolean;
    };
    if (body.action === "rearm_show_bible_no_dispatch") {
      if (actor.authKind !== "session" || actor.role !== "owner") {
        throw new StudioAuthError("an interactive owner session is required to rearm a Show Bible claim", 403);
      }
      if (
        !body.claimId ||
        typeof body.reason !== "string" ||
        typeof body.evidence !== "string" ||
        body.verifiedNoDispatch !== true
      ) {
        return NextResponse.json(
          { ok: false, error: "claimId, reason, evidence, and verifiedNoDispatch=true are required" },
          { status: 400 },
        );
      }
      // Reject service callers before touching the vault or Convex. This keeps
      // the recovery control owner-session-only even when an internal worker
      // has a valid service credential.
      await hydrateEnv("youtube");
      const convex = convexClient();
      const secret = requireInternalQuerySecret();
      const now = Date.now();
      const showBibleClaim = await convex.mutation(
        api.learningGovernance.resolveShowBibleProviderStartedNoDispatch,
        {
          secret,
          ownerId: actor.ownerId,
          claimId: body.claimId as Id<"showBibleProposalClaims">,
          actor: `${actor.authKind}:${actor.ownerId}`,
          reason: body.reason,
          evidence: body.evidence,
          verifiedNoDispatch: true,
          attestedAt: now,
          now,
        },
      );
      return NextResponse.json({ ok: true, showBibleClaim });
    }
    await hydrateEnv("youtube");
    const convex = convexClient();
    const secret = requireInternalQuerySecret();
    if (
      !body.recommendationId ||
      (body.action !== "approve_and_activate" && body.action !== "reject")
    ) {
      return NextResponse.json(
        { ok: false, error: "recommendationId and a valid action are required" },
        { status: 400 },
      );
    }
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
