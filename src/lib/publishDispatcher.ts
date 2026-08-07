import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ConvexHttpClient as ConvexHttpClientType } from "convex/browser";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { cleanupDir, makeRunTempDir } from "@/lib/files";
import { stableJson, YOUTUBE_UPLOAD_SCOPES } from "@/lib/publishingPolicy";
import { getObjectBytes, getObjectToFile } from "@/lib/storage";
import { setVideoThumbnail, type UploadVideoResult } from "@/lib/youtube";
import {
  requireInternalQuerySecret,
  requireYouTubeConnector,
} from "@/lib/youtubeConnector";
import { evaluateChannelPublishAction } from "@/lib/channelPublishPolicy";
import { uploadDurableVideo } from "@/lib/youtubeDurableUpload";
import {
  enqueueFailedPipelineResume,
  enqueuePublishIntentRetry,
} from "@/trigger/publishRetry";

export interface PublishMetadataIdentity {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: "private" | "public" | "unlisted";
  publishAt?: number;
  containsSyntheticMedia: boolean;
  madeForKids: boolean;
}

export function publishMetadataSha256(metadata: PublishMetadataIdentity): string {
  return createHash("sha256").update(stableJson(metadata)).digest("hex");
}

export function bytesSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function convexClient(): ConvexHttpClientType {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

async function handoffUploadedIntentToFailedPipeline(
  convex: ConvexHttpClientType,
  intent: {
    _id: Id<"publishIntents">;
    ownerId: string;
    channelId: Id<"channels">;
    runId?: Id<"runs">;
    status: string;
    videoArtifactId: string;
    youtubeVideoId?: string;
  },
  log: (message: string) => void,
): Promise<void> {
  if (!intent.runId) return;
  if (!intent.youtubeVideoId) {
    throw new Error(`uploaded publish intent ${intent._id} is missing its YouTube video id`);
  }
  const prepared = await convex.mutation(api.runs.preparePublishContinuation, {
    ownerId: intent.ownerId,
    channelId: intent.channelId,
    runId: intent.runId,
    intentId: intent._id,
    artifactId: intent.videoArtifactId,
    youtubeVideoId: intent.youtubeVideoId,
    preparedAt: Date.now(),
  });
  let resumed;
  try {
    resumed = await enqueueFailedPipelineResume(
      {
        ...intent,
        _id: String(intent._id),
        channelId: String(intent.channelId),
        runId: String(intent.runId),
      },
      prepared
        ? {
            ...prepared,
            _id: String(prepared._id),
            channelId: String(prepared.channelId),
            blockedPublishIntentId: prepared.blockedPublishIntentId
              ? String(prepared.blockedPublishIntentId)
              : undefined,
            publishContinuationIntentId: prepared.publishContinuationIntentId
              ? String(prepared.publishContinuationIntentId)
              : undefined,
            planItemId: prepared.planItemId ? String(prepared.planItemId) : undefined,
          }
        : prepared,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await convex.mutation(api.runs.recordPublishContinuationEnqueueFailure, {
        ownerId: intent.ownerId,
        channelId: intent.channelId,
        runId: intent.runId,
        intentId: intent._id,
        artifactId: intent.videoArtifactId,
        youtubeVideoId: intent.youtubeVideoId,
        error: message,
        failedAt: Date.now(),
      });
    } catch (stateError) {
      log(
        `publish ${intent._id}: continuation enqueue failure-state persistence failed: ${
          stateError instanceof Error ? stateError.message : String(stateError)
        }`,
      );
    }
    throw error;
  }
  if (resumed) {
    await convex.mutation(api.runs.markPublishContinuationQueued, {
      ownerId: intent.ownerId,
      channelId: intent.channelId,
      runId: intent.runId,
      intentId: intent._id,
      artifactId: intent.videoArtifactId,
      youtubeVideoId: intent.youtubeVideoId,
      triggerRunId: resumed.runId,
      queuedAt: Date.now(),
    });
    log(
      `publish ${intent._id}: failed pipeline continuation queued (${resumed.runId})`,
    );
  }
}

export type PublishDispatchResult =
  | ({ kind: "uploaded" } & UploadVideoResult)
  | { kind: "deferred"; reason: string; status: string };

export async function dispatchPublishIntent(args: {
  intentId: Id<"publishIntents">;
  workerId: string;
  preferredLocalFilePath?: string;
  log?: (message: string) => void;
}): Promise<PublishDispatchResult> {
  const log = args.log ?? (() => {});
  await bootstrapSecrets(log);
  const convex = convexClient();
  const secret = requireInternalQuerySecret();
  const claimed = await convex.mutation(api.publishIntents.claim, {
    secret,
    intentId: args.intentId,
    workerId: args.workerId,
    now: Date.now(),
  });
  if (!claimed.claimed) {
    if (
      claimed.reason === "already_uploaded" &&
      claimed.intent.youtubeVideoId &&
      claimed.intent.watchUrl
    ) {
      await handoffUploadedIntentToFailedPipeline(convex, claimed.intent, log);
      return {
        kind: "uploaded",
        videoId: claimed.intent.youtubeVideoId,
        watchUrl: claimed.intent.watchUrl,
        privacyStatus: claimed.intent.privacyStatus,
      };
    }
    if (claimed.reason === "not_due" && claimed.intent.status === "retry_wait") {
      const retry = await enqueuePublishIntentRetry({
        ...claimed.intent,
        _id: String(claimed.intent._id),
        channelId: String(claimed.intent.channelId),
      });
      if (retry) {
        log(
          `publish ${claimed.intent._id}: retry already queued for ${new Date(retry.scheduledFor).toISOString()} (${retry.runId})`,
        );
      }
    }
    return {
      kind: "deferred",
      reason: claimed.reason,
      status: claimed.intent.status,
    };
  }
  const intent = claimed.intent;
  if (!intent) throw new Error("publish dispatcher claimed an intent without a row");

  let tempDir: string | undefined;
  let localPath = args.preferredLocalFilePath;
  try {
    const externallyVisible =
      intent.privacyStatus !== "private" || intent.publishAt !== undefined;
    if (externallyVisible && intent.approvalKind !== "manual_intent") {
      const action =
        intent.publishAt !== undefined ? "youtube_scheduled" : "youtube_public";
      const decision = await evaluateChannelPublishAction({
        ownerId: intent.ownerId,
        channelId: intent.channelId,
        action,
        convex,
      });
      if (!decision.authorized) {
        const reason = `channel policy recheck failed: ${decision.reason}`;
        const blocked = await convex.mutation(api.publishIntents.requireReapproval, {
          secret,
          intentId: intent._id,
          workerId: args.workerId,
          reason,
          changedAt: Date.now(),
        });
        return {
          kind: "deferred",
          reason,
          status: blocked?.status ?? "awaiting_approval",
        };
      }
    }

    if (localPath) {
      const localStat = await stat(localPath).catch(() => null);
      if (!localStat?.isFile()) localPath = undefined;
    }
    if (!localPath) {
      tempDir = await makeRunTempDir(`publish-${String(intent._id)}`);
      localPath = join(tempDir, "video.mp4");
      log(`publish ${intent._id}: streaming ${intent.videoArtifactKey} from R2`);
      await getObjectToFile(intent.videoArtifactKey, localPath);
    }
    const actualSha256 = await fileSha256(localPath);
    if (actualSha256 !== intent.videoSha256) {
      throw new Error(
        `immutable video digest mismatch: expected ${intent.videoSha256}, got ${actualSha256}`,
      );
    }

    const connector = await requireYouTubeConnector(convex, {
      channelId: intent.channelId,
      ownerId: intent.ownerId,
      expectedConnectorId: intent.connectorId,
      expectedConnectorVersion: intent.connectorVersion,
      requiredScopes: YOUTUBE_UPLOAD_SCOPES,
    });
    const uploadKey = `publish-intent:${String(intent._id)}`;
    const result = await uploadDurableVideo({
      convex,
      ownerId: intent.ownerId,
      channelId: intent.channelId,
      uploadKey,
      log,
      upload: {
        filePath: localPath,
        title: intent.title,
        description: intent.description,
        tags: intent.tags,
        categoryId: intent.categoryId,
        privacyStatus: intent.privacyStatus,
        publishAt:
          intent.publishAt !== undefined
            ? new Date(intent.publishAt).toISOString()
            : undefined,
        containsSyntheticMedia: intent.containsSyntheticMedia,
        madeForKids: intent.madeForKids,
        refreshToken: connector.refreshToken,
      },
    });

    if (intent.thumbnailArtifactKey) {
      const thumbnail = await getObjectBytes(intent.thumbnailArtifactKey);
      const thumbnailSha256 = bytesSha256(thumbnail);
      if (!intent.thumbnailSha256 || thumbnailSha256 !== intent.thumbnailSha256) {
        throw new Error(
          `immutable thumbnail digest mismatch: expected ${intent.thumbnailSha256 ?? "missing"}, got ${thumbnailSha256}`,
        );
      }
      await setVideoThumbnail(
        result.videoId,
        thumbnail,
        "image/jpeg",
        connector.refreshToken,
      );
      log(`publish ${intent._id}: exact custom thumbnail applied`);
    }

    const completed = await convex.mutation(api.publishIntents.complete, {
      secret,
      intentId: intent._id,
      workerId: args.workerId,
      youtubeVideoId: result.videoId,
      watchUrl: result.watchUrl,
      completedAt: Date.now(),
    });
    if (!completed) throw new Error("publish intent completion was not persisted");
    await handoffUploadedIntentToFailedPipeline(convex, completed, log);
    return { kind: "uploaded", ...result };
  } catch (error) {
    let failedIntent: Awaited<ReturnType<typeof convex.mutation<typeof api.publishIntents.fail>>> | undefined;
    try {
      failedIntent = await convex.mutation(api.publishIntents.fail, {
        secret,
        intentId: intent._id,
        workerId: args.workerId,
        error: error instanceof Error ? error.message : String(error),
        failedAt: Date.now(),
      });
    } catch (stateError) {
      log(
        `publish ${intent._id}: failure-state persistence failed: ${
          stateError instanceof Error ? stateError.message : String(stateError)
        }`,
      );
    }
    if (failedIntent?.status === "retry_wait") {
      try {
        const retry = await enqueuePublishIntentRetry({
          ...failedIntent,
          _id: String(failedIntent._id),
          channelId: String(failedIntent.channelId),
        });
        if (retry) {
          log(
            `publish ${failedIntent._id}: transient failure retry queued for ${new Date(retry.scheduledFor).toISOString()} (${retry.runId})`,
          );
        }
        return {
          kind: "deferred",
          reason: failedIntent.lastError ?? "transient_failure_retry_scheduled",
          status: failedIntent.status,
        };
      } catch (scheduleError) {
        throw new AggregateError(
          [error, scheduleError],
          `publish ${intent._id}: failed and its durable retry could not be queued`,
        );
      }
    }
    throw error;
  } finally {
    if (tempDir) await cleanupDir(tempDir).catch(() => {});
  }
}
