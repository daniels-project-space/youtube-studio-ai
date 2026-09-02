import { NextResponse } from "next/server";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { requireStudioActor, StudioAuthError } from "@/lib/operatorSession";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
} from "@/lib/studioActionApproval";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  assertYoutubeThumbnailReplacementDispatch,
  youtubeThumbnailReplacementApprovalSubject,
  youtubeThumbnailReplacementTriggerRequest,
} from "@/lib/youtubeThumbnailReplacement";
import { youtubeThumbnailReplacementRuntimeApi } from "@/lib/youtubeThumbnailReplacementRuntime";

export const runtime = "nodejs";

function client(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function body(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Thumbnail acceptance request must be an object");
  }
  const input = value as Record<string, unknown>;
  const allowed = ["sourceRunId", "candidateRunId", "youtubeVideoId", "confirmYoutubeVideoId"];
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`Unrecognized thumbnail acceptance fields: ${unexpected.join(", ")}`);
  for (const key of ["sourceRunId", "candidateRunId"] as const) {
    if (typeof input[key] !== "string" || !/^[A-Za-z0-9_-]{8,256}$/.test(input[key])) {
      throw new Error(`Thumbnail acceptance ${key} is invalid`);
    }
  }
  if (
    typeof input.youtubeVideoId !== "string" ||
    !/^[A-Za-z0-9_-]{6,64}$/.test(input.youtubeVideoId) ||
    input.confirmYoutubeVideoId !== input.youtubeVideoId
  ) throw new Error("Confirm the exact YouTube video ID before replacing its thumbnail");
  return {
    sourceRunId: input.sourceRunId as string,
    candidateRunId: input.candidateRunId as string,
    youtubeVideoId: input.youtubeVideoId,
  };
}

export async function POST(request: Request) {
  try {
    const actor = await requireStudioActor(request);
    if (!process.env.TRIGGER_SECRET_KEY) {
      return NextResponse.json(
        { ok: false, error: "YouTube thumbnail worker is not deployed" },
        { status: 503 },
      );
    }
    const requested = body(await request.json());
    const convex = client();
    const shell = await convex.mutation(
      youtubeThumbnailReplacementRuntimeApi.createPlanShell,
      {
        ownerId: actor.ownerId,
        sourceRunId: requested.sourceRunId as Id<"runs">,
        candidateRunId: requested.candidateRunId as Id<"runs">,
        youtubeVideoId: requested.youtubeVideoId,
        now: Date.now(),
      } as never,
    ) as unknown as {
      replacementId: Id<"youtubeThumbnailReplacements">;
      channelId: Id<"channels">;
      sourceRunId: Id<"runs">;
      candidateRunId: Id<"runs">;
      youtubeVideoId: string;
      planFingerprint: string;
      dispatchKey: string;
      status: string;
    };
    if (["queued", "applied", "blocked"].includes(shell.status)) {
      return NextResponse.json({
        ok: shell.status !== "blocked",
        state: shell.status,
        replacementId: String(shell.replacementId),
        youtubeVideoId: shell.youtubeVideoId,
      }, {
        status: shell.status === "queued" ? 202 : shell.status === "blocked" ? 409 : 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    let raw = await convex.query(youtubeThumbnailReplacementRuntimeApi.getDispatch, {
      ownerId: actor.ownerId,
      replacementId: shell.replacementId,
    } as never) as unknown;
    if (!raw) {
      const approval = issueStudioActionApproval({
        action: "youtube-thumbnail-replacement",
        ownerId: actor.ownerId,
        subject: youtubeThumbnailReplacementApprovalSubject({
          replacementId: String(shell.replacementId),
          planFingerprint: shell.planFingerprint,
          dispatchKey: shell.dispatchKey,
        }),
        actor: `authenticated-operator:${actor.ownerId}`,
        evidence:
          `Owner accepted QA-passed thumbnail candidate ${shell.candidateRunId} for exact YouTube video ${shell.youtubeVideoId}`,
      });
      await convex.mutation(youtubeThumbnailReplacementRuntimeApi.claimApproval, {
        ownerId: actor.ownerId,
        replacementId: shell.replacementId,
        planFingerprint: shell.planFingerprint,
        approval,
        approvalFingerprint: studioActionApprovalFingerprint(approval),
        now: Date.now(),
      } as never);
      raw = await convex.query(youtubeThumbnailReplacementRuntimeApi.getDispatch, {
        ownerId: actor.ownerId,
        replacementId: shell.replacementId,
      } as never);
    }
    const dispatch = assertYoutubeThumbnailReplacementDispatch(raw);
    const triggerRequest = youtubeThumbnailReplacementTriggerRequest(dispatch);
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
      await convex.mutation(youtubeThumbnailReplacementRuntimeApi.markQueued, {
        ownerId: actor.ownerId,
        replacementId: shell.replacementId,
        triggerRunId: handle.id,
        attempt,
        now: Date.now(),
      } as never);
    } catch (error) {
      await convex.mutation(youtubeThumbnailReplacementRuntimeApi.recordFailure, {
        ownerId: actor.ownerId,
        replacementId: shell.replacementId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
        now: Date.now(),
      } as never);
    }
    return NextResponse.json({
      ok: true,
      state: "queued",
      replacementId: String(shell.replacementId),
      youtubeVideoId: shell.youtubeVideoId,
    }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StudioAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not apply the thumbnail";
    const status = /invalid|confirm|binding|candidate|reconnect|changed|unrecognized|requires/i.test(message)
      ? 422
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
