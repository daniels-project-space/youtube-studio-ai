import { idempotencyKeys, tasks } from "@trigger.dev/sdk";

import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX,
} from "@/lib/studioActionApprovalContract";
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
import { thumbnailRefreshRuntimeApi } from "@/lib/thumbnailRefreshRuntime";

export type AutomaticThumbnailReplacementCandidate = Readonly<{
  sourceRunId: Id<"runs">;
  candidateRunId: Id<"runs">;
  youtubeVideoId: string;
}>;

type ReplacementShell = Readonly<{
  replacementId: Id<"youtubeThumbnailReplacements">;
  sourceRunId: Id<"runs">;
  candidateRunId: Id<"runs">;
  youtubeVideoId: string;
  planFingerprint: string;
  dispatchKey: string;
  status: "awaiting_approval" | "pending" | "queued" | "applied" | "blocked";
}>;

type AutomaticThumbnailConvex = Pick<StudioConvexHttpClient, "query" | "mutation">;

function client(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("automatic thumbnail replacement: Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

/**
 * Move one production-QA candidate into the exact recorded YouTube slot.
 * Browser identity is intentionally absent: the signed Studio policy replaces
 * the old repetitive owner dialog, while the downstream worker still verifies
 * candidate bytes, connector version, YouTube channel and video ownership.
 */
export async function queueAutomaticThumbnailReplacement(input: {
  ownerId: string;
  candidate: AutomaticThumbnailReplacementCandidate;
  convex?: AutomaticThumbnailConvex;
}): Promise<"queued" | "already_queued" | "already_applied"> {
  await bootstrapSecrets(() => {}, {
    required: ["STUDIO_CONVEX_JWT_PRIVATE_KEY"],
  });
  const convex = input.convex ?? client();
  const item = input.candidate;
  const shell = await convex.mutation(
    youtubeThumbnailReplacementRuntimeApi.createPlanShell,
    {
      ownerId: input.ownerId,
      sourceRunId: item.sourceRunId,
      candidateRunId: item.candidateRunId,
      youtubeVideoId: item.youtubeVideoId,
      now: Date.now(),
    } as never,
  ) as unknown as ReplacementShell;
  if (
    shell.sourceRunId !== item.sourceRunId ||
    shell.candidateRunId !== item.candidateRunId ||
    shell.youtubeVideoId !== item.youtubeVideoId
  ) throw new Error("automatic thumbnail replacement plan changed from its source binding");
  if (shell.status === "applied") return "already_applied";
  if (shell.status === "queued") return "already_queued";
  if (shell.status === "blocked") {
    throw new Error("automatic thumbnail replacement is blocked; inspect its durable receipt");
  }

  if (shell.status === "awaiting_approval") {
    const approval = issueStudioActionApproval({
      action: "youtube-thumbnail-replacement",
      ownerId: input.ownerId,
      subject: youtubeThumbnailReplacementApprovalSubject({
        replacementId: String(shell.replacementId),
        planFingerprint: shell.planFingerprint,
        dispatchKey: shell.dispatchKey,
      }),
      actor: `${AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX}${input.ownerId}`,
      evidence:
        `Automatic Studio policy admitted production-QA candidate ${item.candidateRunId} ` +
        `for its exact recorded YouTube video ${item.youtubeVideoId}.`,
    });
    await convex.mutation(youtubeThumbnailReplacementRuntimeApi.claimApproval, {
      ownerId: input.ownerId,
      replacementId: shell.replacementId,
      planFingerprint: shell.planFingerprint,
      approval,
      approvalFingerprint: studioActionApprovalFingerprint(approval),
      now: Date.now(),
    } as never);
  }

  const raw = await convex.query(youtubeThumbnailReplacementRuntimeApi.getDispatch, {
    ownerId: input.ownerId,
    replacementId: shell.replacementId,
  } as never);
  const dispatch = assertYoutubeThumbnailReplacementDispatch(raw);
  const request = youtubeThumbnailReplacementTriggerRequest(dispatch);
  const attempt = dispatch.dispatchAttempt + 1;
  try {
    const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, {
      scope: "global",
    });
    const handle = await tasks.trigger(request.taskId, request.payload, {
      concurrencyKey: request.concurrencyKey,
      idempotencyKey,
    });
    await convex.mutation(youtubeThumbnailReplacementRuntimeApi.markQueued, {
      ownerId: input.ownerId,
      replacementId: shell.replacementId,
      triggerRunId: handle.id,
      attempt,
      now: Date.now(),
    } as never);
  } catch (error) {
    await convex.mutation(youtubeThumbnailReplacementRuntimeApi.recordFailure, {
      ownerId: input.ownerId,
      replacementId: shell.replacementId,
      attempt,
      error: error instanceof Error ? error.message : String(error),
      now: Date.now(),
    } as never);
    throw error;
  }
  return "queued";
}

export async function dispatchAutomaticThumbnailReplacements(input?: {
  ownerId?: string;
  convex?: AutomaticThumbnailConvex;
  queue?: typeof queueAutomaticThumbnailReplacement;
}): Promise<{ due: number; queued: number; failed: number }> {
  await bootstrapSecrets(() => {}, {
    required: ["STUDIO_CONVEX_JWT_PRIVATE_KEY"],
  });
  const ownerId = input?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const convex = input?.convex ?? client();
  const due = await convex.query(
    thumbnailRefreshRuntimeApi.listAutomaticReplacementCandidates,
    { ownerId, limit: 10 } as never,
  ) as unknown as AutomaticThumbnailReplacementCandidate[];
  let queued = 0;
  let failed = 0;
  for (const candidate of due) {
    try {
      await (input?.queue ?? queueAutomaticThumbnailReplacement)({ ownerId, candidate, convex });
      queued++;
    } catch (error) {
      failed++;
      console.error("[automatic-thumbnail-replacement] candidate handoff failed", {
        candidateRunId: String(candidate.candidateRunId),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { due: due.length, queued, failed };
}
