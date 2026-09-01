import { task } from "@trigger.dev/sdk";

import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { hasAnyScope, YOUTUBE_WRITE_SCOPES } from "@/lib/publishingPolicy";
import {
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
  type StudioActionApprovalReceipt,
} from "@/lib/studioActionApproval";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  deleteVideo,
  getVideoIdentity,
  refreshAccessTokenGrant,
} from "@/lib/youtube";
import {
  requireYouTubeConnector,
} from "@/lib/youtubeConnector";
import {
  assertYoutubeVideoRetirementDispatch,
  youtubeVideoRetirementApprovalSubject,
  type YouTubeVideoRetirementDispatch,
} from "@/lib/youtubeVideoRetirement";
import { youtubeVideoRetirementRuntimeApi } from "@/lib/youtubeVideoRetirementRuntime";

type Payload = Readonly<{
  ownerId: string;
  channelId: string;
  runId: string;
  retirementId: string;
  planFingerprint: string;
}>;

type Execution = Readonly<{
  _id: Id<"youtubeVideoRetirements">;
  ownerId: string;
  channelId: Id<"channels">;
  runId: Id<"runs">;
  youtubeVideoId: string;
  connectorId: Id<"youtubeAuth">;
  connectorVersion: number;
  expectedYoutubeChannelId: string;
  planFingerprint: string;
  status: "awaiting_approval" | "pending" | "queued" | "deleted" | "blocked";
  dispatchAttempts: number;
}>;

function client(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("YouTube retirement: Convex URL is not configured");
  return new ConvexHttpClient(url);
}

function bindDispatch(raw: unknown, payload: Payload): YouTubeVideoRetirementDispatch {
  const dispatch = assertYoutubeVideoRetirementDispatch(raw);
  if (
    dispatch.ownerId !== payload.ownerId ||
    dispatch.channelId !== payload.channelId ||
    dispatch.runId !== payload.runId ||
    dispatch.retirementId !== payload.retirementId ||
    dispatch.planFingerprint !== payload.planFingerprint
  ) throw new Error("YouTube retirement task payload changed from its durable plan");
  const approval = dispatch.approval as StudioActionApprovalReceipt;
  const subject = youtubeVideoRetirementApprovalSubject({
    retirementId: dispatch.retirementId,
    planFingerprint: dispatch.planFingerprint,
    dispatchKey: dispatch.dispatchKey,
  });
  if (
    studioActionApprovalFingerprint(approval) !== dispatch.approvalFingerprint ||
    !verifyStudioActionApproval(approval, {
      action: "youtube-video-retire",
      ownerId: dispatch.ownerId,
      subject,
      persistedReceiptFingerprint: dispatch.approvalFingerprint,
    })
  ) throw new Error("YouTube retirement owner approval is invalid or changed");
  return dispatch;
}

export async function executeYoutubeVideoRetirement(payload: Payload) {
  const convex = client();
  const raw = await convex.query(youtubeVideoRetirementRuntimeApi.getDispatch, {
    ownerId: payload.ownerId,
    retirementId: payload.retirementId as Id<"youtubeVideoRetirements">,
  } as never);
  const dispatch = bindDispatch(raw, payload);
  const execution = await convex.query(youtubeVideoRetirementRuntimeApi.getExecution, {
    ownerId: payload.ownerId,
    retirementId: payload.retirementId as Id<"youtubeVideoRetirements">,
  } as never) as unknown as Execution | null;
  if (!execution) throw new Error("YouTube retirement execution is unavailable");
  if (execution.status === "deleted") {
    return { ok: true, state: "already_completed", youtubeVideoId: dispatch.youtubeVideoId };
  }
  if (
    String(execution.channelId) !== dispatch.channelId ||
    String(execution.runId) !== dispatch.runId ||
    String(execution.connectorId) !== dispatch.connectorId ||
    execution.connectorVersion !== dispatch.connectorVersion ||
    execution.expectedYoutubeChannelId !== dispatch.expectedYoutubeChannelId ||
    execution.youtubeVideoId !== dispatch.youtubeVideoId ||
    execution.planFingerprint !== dispatch.planFingerprint
  ) throw new Error("YouTube retirement execution changed from its signed plan");

  await bootstrapSecrets(() => {}, {
    required: [
      "YOUTUBE_CLIENT_ID",
      "YOUTUBE_CLIENT_SECRET",
      "YOUTUBE_TOKEN_ENCRYPTION_KEY",
      "INTERNAL_QUERY_SECRET",
    ],
  });
  try {
    const connector = await requireYouTubeConnector(convex, {
      ownerId: dispatch.ownerId,
      channelId: execution.channelId,
      expectedConnectorId: execution.connectorId,
      expectedConnectorVersion: execution.connectorVersion,
    });
    if (connector.ytChannelId !== dispatch.expectedYoutubeChannelId) {
      throw new Error("YouTube retirement connector account changed");
    }
    const grant = await refreshAccessTokenGrant(connector.refreshToken);
    if (!hasAnyScope(grant.grantedScopes, YOUTUBE_WRITE_SCOPES)) {
      throw new Error("YouTube retirement connector lacks a live video-management scope");
    }
    const before = await getVideoIdentity(grant.accessToken, dispatch.youtubeVideoId);
    if (before && (
      before.id !== dispatch.youtubeVideoId ||
      before.channelId !== dispatch.expectedYoutubeChannelId
    )) {
      throw new Error("YouTube retirement refused a video owned by another channel");
    }
    const providerOutcome = before
      ? await deleteVideo(grant.accessToken, dispatch.youtubeVideoId)
      : "already_absent" as const;
    const after = await getVideoIdentity(grant.accessToken, dispatch.youtubeVideoId);
    if (after) throw new Error("YouTube retirement could not verify provider-side absence");
    const absenceVerifiedAt = Date.now();
    await convex.mutation(youtubeVideoRetirementRuntimeApi.completeDeletion, {
      ownerId: dispatch.ownerId,
      retirementId: execution._id,
      planFingerprint: dispatch.planFingerprint,
      providerVideoChannelId: before?.channelId,
      providerPrivacyStatus: before?.privacyStatus,
      providerOutcome,
      absenceVerifiedAt,
    } as never);
    return {
      ok: true,
      state: "deleted",
      youtubeVideoId: dispatch.youtubeVideoId,
      providerOutcome,
      absenceVerifiedAt,
    };
  } catch (error) {
    await convex.mutation(youtubeVideoRetirementRuntimeApi.recordFailure, {
      ownerId: dispatch.ownerId,
      retirementId: execution._id,
      attempt: execution.dispatchAttempts,
      error: error instanceof Error ? error.message : String(error),
      now: Date.now(),
    } as never);
    throw error;
  }
}

export const youtubeVideoRetirementTask = task({
  id: "youtube-video-retirement",
  machine: "small-1x",
  maxDuration: 180,
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 20_000,
    factor: 2,
  },
  queue: { concurrencyLimit: 1 },
  run: async (payload: Payload) => executeYoutubeVideoRetirement(payload),
});
