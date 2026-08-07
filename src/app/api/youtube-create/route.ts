import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";
import { authorizeStudioRoute } from "@/lib/operatorSession";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  issueStudioActionApproval,
  youtubeChannelApprovalSubject,
  youtubeChannelCreationRequestKey,
  type StudioActionApprovalReceipt,
} from "@/lib/studioActionApproval";
import {
  normalizeYoutubeChannelName,
  normalizeYoutubeHandle,
  suggestYoutubeHandle,
} from "@/lib/youtubeChannelCreationClaim";

/**
 * POST /api/youtube-create  { name: string, channelId: string }
 * Fires the `youtube-create-channel` Trigger task (Browserbase + Stagehand, cloud
 * browser — never runs on a local machine). Best-effort headless Brand Account
 * creation; returns the run id to poll. The assisted Connect button is the
 * fallback when Google blocks headless creation.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  let body: {
    name?: string;
    channelId?: string;
    intentKey?: string;
    confirmedCreateNewChannel?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const name = normalizeYoutubeChannelName(body.name ?? "");
  if (!name) return NextResponse.json({ error: "missing name" }, { status: 400 });
  const channelId = body.channelId?.trim();
  if (!channelId) return NextResponse.json({ error: "missing channelId" }, { status: 400 });
  if (body.confirmedCreateNewChannel !== true) {
    return NextResponse.json(
      { error: "explicit YouTube channel creation confirmation is required" },
      { status: 400 },
    );
  }
  const intentKey = body.intentKey?.trim();
  if (!intentKey || !/^[A-Za-z0-9:_-]{16,200}$/.test(intentKey)) {
    return NextResponse.json({ error: "invalid YouTube creation intentKey" }, { status: 400 });
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json({ error: "Engine not activated.", inactive: true }, { status: 503 });
  }
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!convexUrl) {
      return NextResponse.json({ error: "Convex claim store is unavailable" }, { status: 503 });
    }
    const convex = new StudioConvexHttpClient(convexUrl);
    const existing = await convex.query(api.youtubeCreationClaims.getForChannel, {
      ownerId: OWNER_ID,
      channelId: channelId as Id<"channels">,
    });
    const resumeExisting = existing && existing.status !== "pre_provider_failed";
    const requestedName = resumeExisting
      ? normalizeYoutubeChannelName(existing.name)
      : name;
    const requestedHandle = resumeExisting
      ? normalizeYoutubeHandle(existing.requestedHandle)
      : suggestYoutubeHandle(requestedName);
    const requestKey = resumeExisting
      ? existing.requestKey
      : youtubeChannelCreationRequestKey({
          ownerId: OWNER_ID,
          channelId,
          intentKey,
          name: requestedName,
          handle: requestedHandle,
        });
    const approval = resumeExisting
      ? existing.approvalReceipt as StudioActionApprovalReceipt
      : issueStudioActionApproval({
          action: "youtube-channel-create",
          ownerId: OWNER_ID,
          subject: youtubeChannelApprovalSubject({
            ownerId: OWNER_ID,
            channelId,
            requestKey,
            name: requestedName,
            handle: requestedHandle,
          }),
          actor: `authenticated-operator:${OWNER_ID}`,
          evidence: `explicit confirmed Create-new-YouTube-channel control (${intentKey})`,
        });
    // Convex, not Trigger delivery, owns exactly-once semantics. A later click
    // with this same requestKey can reconcile an ambiguous provider result.
    const handle = await tasks.trigger("youtube-create-channel", {
      name: requestedName,
      handle: requestedHandle,
      channelId,
      ownerId: OWNER_ID,
      requestKey,
      approval,
    });
    return NextResponse.json({ id: handle.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "trigger failed" },
      { status: 500 },
    );
  }
}
