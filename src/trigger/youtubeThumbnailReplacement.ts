import { createHash } from "node:crypto";

import { task } from "@trigger.dev/sdk";

import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { hasAnyScope, YOUTUBE_WRITE_SCOPES } from "@/lib/publishingPolicy";
import { getObjectBytes } from "@/lib/storage";
import {
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
  type StudioActionApprovalReceipt,
} from "@/lib/studioActionApproval";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  getVideoIdentity,
  refreshAccessTokenGrant,
  setVideoThumbnailWithAccessToken,
} from "@/lib/youtube";
import { requireYouTubeConnector } from "@/lib/youtubeConnector";
import {
  assertYoutubeThumbnailReplacementDispatch,
  youtubeThumbnailReplacementApprovalSubject,
  type YouTubeThumbnailReplacementDispatch,
} from "@/lib/youtubeThumbnailReplacement";
import { youtubeThumbnailReplacementRuntimeApi } from "@/lib/youtubeThumbnailReplacementRuntime";

type Payload = Readonly<{
  ownerId: string;
  channelId: string;
  sourceRunId: string;
  candidateRunId: string;
  replacementId: string;
  planFingerprint: string;
}>;

type Execution = Readonly<{
  _id: Id<"youtubeThumbnailReplacements">;
  ownerId: string;
  channelId: Id<"channels">;
  sourceRunId: Id<"runs">;
  candidateRunId: Id<"runs">;
  youtubeVideoId: string;
  connectorId: Id<"youtubeAuth">;
  connectorVersion: number;
  expectedYoutubeChannelId: string;
  candidateThumbnailKey: string;
  candidateArtifactSha256: string;
  planFingerprint: string;
  status: "awaiting_approval" | "pending" | "queued" | "applied" | "blocked";
  dispatchAttempts: number;
}>;

function client(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("YouTube thumbnail replacement: Convex URL is not configured");
  return new ConvexHttpClient(url);
}

function bindDispatch(raw: unknown, payload: Payload): YouTubeThumbnailReplacementDispatch {
  const dispatch = assertYoutubeThumbnailReplacementDispatch(raw);
  if (
    dispatch.ownerId !== payload.ownerId ||
    dispatch.channelId !== payload.channelId ||
    dispatch.sourceRunId !== payload.sourceRunId ||
    dispatch.candidateRunId !== payload.candidateRunId ||
    dispatch.replacementId !== payload.replacementId ||
    dispatch.planFingerprint !== payload.planFingerprint
  ) throw new Error("YouTube thumbnail replacement task changed from its durable plan");
  const approval = dispatch.approval as StudioActionApprovalReceipt;
  const subject = youtubeThumbnailReplacementApprovalSubject({
    replacementId: dispatch.replacementId,
    planFingerprint: dispatch.planFingerprint,
    dispatchKey: dispatch.dispatchKey,
  });
  if (
    studioActionApprovalFingerprint(approval) !== dispatch.approvalFingerprint ||
    !verifyStudioActionApproval(approval, {
      action: "youtube-thumbnail-replacement",
      ownerId: dispatch.ownerId,
      subject,
      persistedReceiptFingerprint: dispatch.approvalFingerprint,
    })
  ) throw new Error("YouTube thumbnail replacement owner approval is invalid or changed");
  return dispatch;
}

export async function executeYoutubeThumbnailReplacement(payload: Payload) {
  const convex = client();
  const raw = await convex.query(youtubeThumbnailReplacementRuntimeApi.getDispatch, {
    ownerId: payload.ownerId,
    replacementId: payload.replacementId as Id<"youtubeThumbnailReplacements">,
  } as never);
  const dispatch = bindDispatch(raw, payload);
  const execution = await convex.query(youtubeThumbnailReplacementRuntimeApi.getExecution, {
    ownerId: payload.ownerId,
    replacementId: payload.replacementId as Id<"youtubeThumbnailReplacements">,
  } as never) as unknown as Execution | null;
  if (!execution) throw new Error("YouTube thumbnail replacement execution is unavailable");
  if (execution.status === "applied") {
    return { ok: true, state: "already_applied", youtubeVideoId: execution.youtubeVideoId };
  }
  if (
    String(execution.channelId) !== dispatch.channelId ||
    String(execution.sourceRunId) !== dispatch.sourceRunId ||
    String(execution.candidateRunId) !== dispatch.candidateRunId ||
    String(execution.connectorId) !== dispatch.connectorId ||
    execution.connectorVersion !== dispatch.connectorVersion ||
    execution.expectedYoutubeChannelId !== dispatch.expectedYoutubeChannelId ||
    execution.youtubeVideoId !== dispatch.youtubeVideoId ||
    execution.candidateThumbnailKey !== dispatch.candidateThumbnailKey ||
    execution.candidateArtifactSha256 !== dispatch.candidateArtifactSha256 ||
    execution.planFingerprint !== dispatch.planFingerprint
  ) throw new Error("YouTube thumbnail replacement execution changed from its signed plan");

  await bootstrapSecrets(() => {}, {
    required: [
      "YOUTUBE_CLIENT_ID",
      "YOUTUBE_CLIENT_SECRET",
      "YOUTUBE_TOKEN_ENCRYPTION_KEY",
      "INTERNAL_QUERY_SECRET",
    ],
  });
  try {
    const candidateBytes = Buffer.from(await getObjectBytes(dispatch.candidateThumbnailKey));
    const candidateSha256 = createHash("sha256").update(candidateBytes).digest("hex");
    if (candidateSha256 !== dispatch.candidateArtifactSha256) {
      throw new Error("YouTube thumbnail replacement object bytes do not match their reviewed candidate");
    }
    const connector = await requireYouTubeConnector(convex, {
      ownerId: dispatch.ownerId,
      channelId: execution.channelId,
      expectedConnectorId: execution.connectorId,
      expectedConnectorVersion: execution.connectorVersion,
    });
    if (connector.ytChannelId !== dispatch.expectedYoutubeChannelId) {
      throw new Error("YouTube thumbnail replacement connector account changed");
    }
    const grant = await refreshAccessTokenGrant(connector.refreshToken);
    if (!hasAnyScope(grant.grantedScopes, YOUTUBE_WRITE_SCOPES)) {
      throw new Error("YouTube thumbnail replacement connector lacks a live video-management scope");
    }
    const video = await getVideoIdentity(grant.accessToken, dispatch.youtubeVideoId);
    if (!video || video.channelId !== dispatch.expectedYoutubeChannelId) {
      throw new Error("YouTube thumbnail replacement refused a missing or differently owned video");
    }
    const contentType = dispatch.candidateThumbnailKey.endsWith(".png")
      ? "image/png"
      : "image/jpeg";
    const provider = await setVideoThumbnailWithAccessToken(
      dispatch.youtubeVideoId,
      candidateBytes,
      contentType,
      grant.accessToken,
    );
    const appliedAt = Date.now();
    await convex.mutation(youtubeThumbnailReplacementRuntimeApi.completeApplication, {
      ownerId: dispatch.ownerId,
      replacementId: execution._id,
      planFingerprint: dispatch.planFingerprint,
      providerKind: provider.kind,
      providerItemCount: provider.itemCount,
      appliedAt,
    } as never);
    return {
      ok: true,
      state: "applied",
      youtubeVideoId: dispatch.youtubeVideoId,
      candidateArtifactSha256: dispatch.candidateArtifactSha256,
      appliedAt,
    };
  } catch (error) {
    await convex.mutation(youtubeThumbnailReplacementRuntimeApi.recordFailure, {
      ownerId: dispatch.ownerId,
      replacementId: execution._id,
      attempt: execution.dispatchAttempts,
      error: error instanceof Error ? error.message : String(error),
      now: Date.now(),
    } as never);
    throw error;
  }
}

export const youtubeThumbnailReplacementTask = task({
  id: "youtube-thumbnail-replacement",
  machine: "small-1x",
  maxDuration: 180,
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 20_000, factor: 2 },
  queue: { concurrencyLimit: 1 },
  run: async (payload: Payload) => executeYoutubeThumbnailReplacement(payload),
});
