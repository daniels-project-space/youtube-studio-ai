import type { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { decryptSecret, encryptSecret } from "@/lib/secretEnvelope";
import { requireInternalQuerySecret } from "@/lib/youtubeConnector";
import { youtubeUploadSessionAad } from "@/lib/youtubeUploadSession";
import {
  uploadPrivateDraft,
  type UploadVideoArgs,
  type UploadVideoResult,
  type YouTubeUploadCheckpoint,
} from "@/lib/youtube";

export type DurableUploadArgs = Omit<
  UploadVideoArgs,
  "resumeCheckpoint" | "onCheckpoint" | "onCheckpointInvalidated"
>;

export async function uploadDurableVideo(args: {
  convex: ConvexHttpClient;
  ownerId: string;
  channelId: Id<"channels">;
  uploadKey: string;
  upload: DurableUploadArgs;
  log?: (message: string) => void;
}): Promise<UploadVideoResult> {
  const log = args.log ?? (() => {});
  const internalSecret = requireInternalQuerySecret();
  const aad = youtubeUploadSessionAad(
    args.ownerId,
    String(args.channelId),
    args.uploadKey,
  );
  const stored = await args.convex.query(api.youtubeUploads.get, {
    secret: internalSecret,
    ownerId: args.ownerId,
    channelId: args.channelId,
    uploadKey: args.uploadKey,
  });

  if (stored?.status === "completed") {
    if (!stored.videoId) {
      throw new Error(
        `upload ${args.uploadKey}: completed durable state has no YouTube video id`,
      );
    }
    log(`upload ${args.uploadKey}: recovered completed video ${stored.videoId}`);
    return {
      videoId: stored.videoId,
      watchUrl: `https://www.youtube.com/watch?v=${stored.videoId}`,
      privacyStatus: stored.privacyStatus ?? "private",
    };
  }

  let resumeCheckpoint: YouTubeUploadCheckpoint | undefined;
  if (stored && stored.status !== "expired") {
    resumeCheckpoint = {
      sessionUrl: decryptSecret(stored.sessionUrlCiphertext, {
        envName: "YOUTUBE_TOKEN_ENCRYPTION_KEY",
        aad,
      }),
      fileSize: stored.fileSize,
      fileSha256: stored.fileSha256,
      metadataSha256: stored.metadataSha256,
      uploadedBytes: stored.uploadedBytes,
      chunkSize: stored.chunkSize,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt,
    };
    log(
      `upload ${args.uploadKey}: resuming at ${resumeCheckpoint.uploadedBytes}/${resumeCheckpoint.fileSize} bytes`,
    );
  }

  let activeCheckpoint = resumeCheckpoint;
  const save = async (
    checkpoint: YouTubeUploadCheckpoint,
    status: "initiated" | "uploading" | "completed" | "expired" | "failed",
    result?: UploadVideoResult,
    lastError?: string,
  ): Promise<void> => {
    await args.convex.mutation(api.youtubeUploads.save, {
      secret: internalSecret,
      ownerId: args.ownerId,
      channelId: args.channelId,
      uploadKey: args.uploadKey,
      sessionUrlCiphertext: encryptSecret(checkpoint.sessionUrl, {
        envName: "YOUTUBE_TOKEN_ENCRYPTION_KEY",
        aad,
      }),
      fileSize: checkpoint.fileSize,
      fileSha256: checkpoint.fileSha256,
      metadataSha256: checkpoint.metadataSha256,
      uploadedBytes:
        status === "completed" ? checkpoint.fileSize : checkpoint.uploadedBytes,
      chunkSize: checkpoint.chunkSize,
      status,
      videoId: result?.videoId,
      privacyStatus: result?.privacyStatus ?? args.upload.privacyStatus,
      publishAt: args.upload.publishAt,
      lastError: lastError?.slice(0, 500),
      createdAt: checkpoint.createdAt,
      updatedAt: Date.now(),
      expiresAt: checkpoint.expiresAt,
    });
  };

  try {
    const result = await uploadPrivateDraft({
      ...args.upload,
      containsSyntheticMedia: args.upload.containsSyntheticMedia ?? true,
      resumeCheckpoint,
      onCheckpoint: async (checkpoint) => {
        activeCheckpoint = checkpoint;
        await save(
          checkpoint,
          checkpoint.uploadedBytes > 0 ? "uploading" : "initiated",
        );
      },
      onCheckpointInvalidated: async (checkpoint, reason) => {
        activeCheckpoint = checkpoint;
        await save(checkpoint, "expired", undefined, reason);
      },
    });
    if (!activeCheckpoint) {
      throw new Error(`upload ${args.uploadKey}: completed without a durable checkpoint`);
    }
    await save(activeCheckpoint, "completed", result);
    return result;
  } catch (error) {
    if (activeCheckpoint) {
      try {
        await save(
          activeCheckpoint,
          "failed",
          undefined,
          error instanceof Error ? error.message : String(error),
        );
      } catch (checkpointError) {
        log(
          `upload ${args.uploadKey}: failed to persist failure: ${
            checkpointError instanceof Error
              ? checkpointError.message
              : checkpointError
          }`,
        );
      }
    }
    throw error;
  }
}
