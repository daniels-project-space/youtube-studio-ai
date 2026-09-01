import { NextResponse } from "next/server";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { LegacyVideoRetirementReason } from "@/lib/legacyVideoCleanup";
import { LEGACY_VIDEO_RETIREMENT_REASONS } from "@/lib/legacyVideoCleanup";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
} from "@/lib/studioActionApproval";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  assertYoutubeVideoRetirementDispatch,
  youtubeVideoRetirementApprovalSubject,
  youtubeVideoRetirementTriggerRequest,
} from "@/lib/youtubeVideoRetirement";
import { youtubeVideoRetirementRuntimeApi } from "@/lib/youtubeVideoRetirementRuntime";

export const runtime = "nodejs";

function client(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function body(value: unknown): {
  runId: string;
  youtubeVideoId: string;
  reason: LegacyVideoRetirementReason;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("YouTube retirement request must be an object");
  }
  const input = value as Record<string, unknown>;
  const expected = [
    "runId",
    "youtubeVideoId",
    "reason",
    "confirmPermanentDeletion",
  ];
  const unexpected = Object.keys(input).filter((key) => !expected.includes(key));
  if (unexpected.length) {
    throw new Error(`Unrecognized YouTube retirement fields: ${unexpected.join(", ")}`);
  }
  if (
    typeof input.runId !== "string" ||
    !/^[A-Za-z0-9_-]{8,256}$/.test(input.runId) ||
    typeof input.youtubeVideoId !== "string" ||
    !/^[A-Za-z0-9_-]{6,64}$/.test(input.youtubeVideoId) ||
    typeof input.reason !== "string" ||
    !LEGACY_VIDEO_RETIREMENT_REASONS.includes(
      input.reason as LegacyVideoRetirementReason,
    )
  ) throw new Error("YouTube retirement identity is invalid");
  if (input.confirmPermanentDeletion !== input.youtubeVideoId) {
    throw new Error("Confirm the exact YouTube video ID before permanent deletion");
  }
  return {
    runId: input.runId,
    youtubeVideoId: input.youtubeVideoId,
    reason: input.reason as LegacyVideoRetirementReason,
  };
}

/**
 * Permanently retire one server-classified legacy upload. Archiving remains a
 * separate reversible action; this route is exact-ID confirmation only.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json(
        { ok: false, error: "YouTube retirement worker is not deployed" },
        { status: 503 },
      );
    }
    const requested = body(await request.json());
    const convex = client();
    const shell = await convex.mutation(
      youtubeVideoRetirementRuntimeApi.createPlanShell,
      {
        ownerId: actor.ownerId,
        runId: requested.runId as Id<"runs">,
        youtubeVideoId: requested.youtubeVideoId,
        reason: requested.reason,
        now: Date.now(),
      } as never,
    ) as unknown as {
      retirementId: Id<"youtubeVideoRetirements">;
      channelId: Id<"channels">;
      runId: Id<"runs">;
      youtubeVideoId: string;
      reason: LegacyVideoRetirementReason;
      planFingerprint: string;
      dispatchKey: string;
      status: string;
    };
    if (["queued", "deleted", "blocked"].includes(shell.status)) {
      return NextResponse.json({
        ok: shell.status !== "blocked",
        state: shell.status,
        retirementId: String(shell.retirementId),
        youtubeVideoId: shell.youtubeVideoId,
      }, {
        status: shell.status === "queued" ? 202 : shell.status === "blocked" ? 409 : 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    let raw = await convex.query(youtubeVideoRetirementRuntimeApi.getDispatch, {
      ownerId: actor.ownerId,
      retirementId: shell.retirementId,
    } as never) as unknown;
    if (!raw) {
      const approval = issueStudioActionApproval({
        action: "youtube-video-retire",
        ownerId: actor.ownerId,
        subject: youtubeVideoRetirementApprovalSubject({
          retirementId: String(shell.retirementId),
          planFingerprint: shell.planFingerprint,
          dispatchKey: shell.dispatchKey,
        }),
        actor: `authenticated-operator:${actor.ownerId}`,
        evidence:
          `Owner confirmed permanent deletion of exact legacy YouTube video ${shell.youtubeVideoId}; ` +
          `reason=${shell.reason}`,
      });
      await convex.mutation(youtubeVideoRetirementRuntimeApi.claimApproval, {
        ownerId: actor.ownerId,
        retirementId: shell.retirementId,
        planFingerprint: shell.planFingerprint,
        approval,
        approvalFingerprint: studioActionApprovalFingerprint(approval),
        now: Date.now(),
      } as never);
      raw = await convex.query(youtubeVideoRetirementRuntimeApi.getDispatch, {
        ownerId: actor.ownerId,
        retirementId: shell.retirementId,
      } as never);
    }
    const dispatch = assertYoutubeVideoRetirementDispatch(raw);
    const triggerRequest = youtubeVideoRetirementTriggerRequest(dispatch);
    const attempt = dispatch.dispatchAttempt + 1;
    try {
      const { idempotencyKeys, tasks } = await import("@trigger.dev/sdk");
      const idempotencyKey = await idempotencyKeys.create(
        triggerRequest.idempotencySeed,
        { scope: "global" },
      );
      const handle = await tasks.trigger(
        triggerRequest.taskId,
        triggerRequest.payload,
        {
          concurrencyKey: triggerRequest.concurrencyKey,
          idempotencyKey,
        },
      );
      await convex.mutation(youtubeVideoRetirementRuntimeApi.markQueued, {
        ownerId: actor.ownerId,
        retirementId: shell.retirementId,
        triggerRunId: handle.id,
        attempt,
        now: Date.now(),
      } as never);
    } catch (error) {
      await convex.mutation(youtubeVideoRetirementRuntimeApi.recordFailure, {
        ownerId: actor.ownerId,
        retirementId: shell.retirementId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
        now: Date.now(),
      } as never);
    }
    return NextResponse.json({
      ok: true,
      state: "queued",
      retirementId: String(shell.retirementId),
      youtubeVideoId: shell.youtubeVideoId,
      permanent: true,
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    const message = error instanceof Error
      ? error.message
      : "Could not retire the YouTube video";
    const status = /invalid|confirm|binding|candidate|reconnect|changed|unrecognized/i.test(message)
      ? 422
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
