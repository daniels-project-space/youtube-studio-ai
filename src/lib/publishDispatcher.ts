import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ConvexHttpClient as ConvexHttpClientType } from "convex/browser";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { parseChannelProgramRouteRunSeed } from "@/engine/channelProgramRoute";
import {
  assertScenarioVisualTreatmentThumbnailProvenanceForRoute,
} from "@/engine/scenarioVisualTreatment";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { cleanupDir, makeRunTempDir } from "@/lib/files";
import { stableJson, YOUTUBE_UPLOAD_SCOPES } from "@/lib/publishingPolicy";
import {
  getObjectBytes,
  getObjectIntegrity,
  getObjectToFile,
  headObjectMetadata,
} from "@/lib/storage";
import { parseFinalMasterReleaseCertificateBytes } from "@/lib/finalMasterReleaseCertificate";
import {
  PublishReleaseEvidenceError,
  verifyPublishIntentReleaseEvidence,
} from "@/lib/publishReleaseEvidence";
import { videoReleaseProvenanceClaimFromCertificate } from "@/lib/videoReleaseProvenance";
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
import {
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { publishPipelineResumeEnqueueAttempt } from "@/lib/publishRetrySchedule";
import type { RunExecutionLeaseFence } from "@/lib/runLease";

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

type UploadedPublishIntent = {
  _id: Id<"publishIntents">;
  ownerId: string;
  channelId: Id<"channels">;
  runId?: Id<"runs">;
  status: string;
  videoArtifactId: string;
  videoSha256: string;
  youtubeVideoId?: string;
};

interface PublishIntentThumbnailTreatmentFields {
  runId?: Id<"runs">;
  ownerId: string;
  channelId: Id<"channels">;
  thumbnailArtifactKey?: string;
  thumbnailSha256?: string;
  thumbnailScenarioVisualTreatmentProvenance?: unknown;
  thumbnailScenarioVisualTreatmentProvenanceFingerprint?: string;
}

/**
 * A publish intent can outlive the originating worker. Re-read the frozen run
 * route at dispatch time so a pre-treatment fictional seed cannot be
 * reclassified as generic package art by a delayed retry. Current fictional
 * route intents additionally carry the exact byte-bound thumbnail proof that
 * upload_draft admitted before creating the intent.
 */
async function assertPublishIntentThumbnailScenarioVisualTreatment(
  convex: ConvexHttpClientType,
  intent: PublishIntentThumbnailTreatmentFields,
): Promise<void> {
  if (!intent.runId) return;
  const run = await convex.query(api.runs.getRun, { runId: intent.runId });
  if (!run || run.ownerId !== intent.ownerId || run.channelId !== intent.channelId) {
    throw new Error("publish dispatcher: intent run identity is missing or mismatched");
  }
  // Snapshot-less rows predate route receipts; retain their historical
  // readability rather than guessing fictional intent from mutable channel
  // settings. Route-bearing snapshots below are always strict.
  if (run.pipelineInvocationSnapshot === undefined) return;
  let snapshot: PipelineInvocationSnapshot;
  try {
    snapshot = normalizePipelineInvocationSnapshot(
      run.pipelineInvocationSnapshot as PipelineInvocationSnapshot,
    );
  } catch (error) {
    throw new Error(
      `publish dispatcher: frozen run snapshot is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const route = snapshot.seedStore["channelProgramRoute"];
  if (route === undefined) return;
  // Parse before the provenance call so a malformed route cannot silently
  // downgrade an intent to legacy/nonfiction behavior.
  parseChannelProgramRouteRunSeed(route);
  const provenance = assertScenarioVisualTreatmentThumbnailProvenanceForRoute({
    provenance: intent.thumbnailScenarioVisualTreatmentProvenance,
    route,
    thumbnailArtifactSha256: intent.thumbnailSha256,
    consumer: "publish dispatcher",
    operation: "publish thumbnail package art",
  });
  if (!provenance) return;
  if (!intent.thumbnailArtifactKey || !intent.thumbnailSha256) {
    throw new Error("publish dispatcher: fictional route requires an exact thumbnail artifact and digest");
  }
  if (
    intent.thumbnailScenarioVisualTreatmentProvenanceFingerprint !==
    provenance.fingerprint
  ) {
    throw new Error("publish dispatcher: thumbnail treatment provenance fingerprint is missing or mismatched");
  }
}

/**
 * Attach the one immutable, certificate-backed provenance row after the run
 * has durably recorded its exact uploaded YouTube id. A legacy or pre-binding
 * release remains explicitly unlinked; this never infers a quality claim.
 */
async function recordUploadedReleaseProvenance(
  convex: ConvexHttpClientType,
  secret: string,
  intent: UploadedPublishIntent,
  log: (message: string) => void,
): Promise<void> {
  if (!intent.runId || !intent.youtubeVideoId) return;

  const existing = await convex.query(api.videoReleaseProvenance.get, {
    ownerId: intent.ownerId,
    channelId: intent.channelId,
    youtubeVideoId: intent.youtubeVideoId,
  });
  if (existing) {
    if (
      existing.runId !== intent.runId ||
      existing.publishIntentId !== intent._id
    ) {
      throw new Error(
        `uploaded video ${intent.youtubeVideoId} already has conflicting release provenance`,
      );
    }
    return;
  }

  const run = await convex.query(api.runs.getRun, { runId: intent.runId });
  if (
    !run ||
    run.ownerId !== intent.ownerId ||
    run.channelId !== intent.channelId ||
    run.youtubeVideoId !== intent.youtubeVideoId
  ) {
    throw new Error("uploaded release provenance run identity mismatch");
  }
  if (
    run.releaseEvidenceStatus !== "release_evidence_recorded" ||
    !run.releaseEvidenceCertificateKey ||
    !run.releaseEvidenceCertificateFingerprint
  ) {
    log(
      `publish ${intent._id}: uploaded video remains unlinked to release provenance (no recorded release certificate)`,
    );
    return;
  }

  const certificate = parseFinalMasterReleaseCertificateBytes(
    await getObjectBytes(run.releaseEvidenceCertificateKey),
  );
  if (
    certificate.certificateFingerprint !== run.releaseEvidenceCertificateFingerprint
  ) {
    throw new Error("uploaded release provenance certificate fingerprint mismatch");
  }
  const claim = videoReleaseProvenanceClaimFromCertificate({
    certificate,
    releaseCertificateKey: run.releaseEvidenceCertificateKey,
    expectedFinalMasterSha256: intent.videoSha256,
  });
  if (!claim) {
    log(
      `publish ${intent._id}: uploaded video remains unlinked to quality provenance (certificate predates the shared binding)`,
    );
    return;
  }

  await convex.mutation(api.videoReleaseProvenance.record, {
    secret,
    ownerId: intent.ownerId,
    channelId: intent.channelId,
    runId: intent.runId,
    publishIntentId: intent._id,
    youtubeVideoId: intent.youtubeVideoId,
    ...claim,
  });
  log(
    `publish ${intent._id}: immutable release provenance recorded (${claim.qualityBindingFingerprint.slice(0, 12)})`,
  );
}

async function handoffUploadedIntentToFailedPipeline(
  convex: ConvexHttpClientType,
  intent: UploadedPublishIntent,
  log: (message: string) => void,
  executionLease?: RunExecutionLeaseFence,
  afterPrepared?: () => Promise<void>,
): Promise<void> {
  if (!intent.runId) return;
  if (!intent.youtubeVideoId) {
    throw new Error(`uploaded publish intent ${intent._id} is missing its YouTube video id`);
  }
  // The scheduler can discover an upload that completed after its originating
  // run terminally failed. It has no pipeline lease, so make that exceptional
  // handoff explicit; Convex only accepts it for the exact immutable uploaded
  // intent on a lease-free failed run.
  const continuationFence = executionLease ?? {
    externalUploadedFailedRunHandoff: "uploaded_failed_run" as const,
  };
  const prepared = await convex.mutation(api.runs.preparePublishContinuation, {
    ownerId: intent.ownerId,
    channelId: intent.channelId,
    runId: intent.runId,
    intentId: intent._id,
    artifactId: intent.videoArtifactId,
    youtubeVideoId: intent.youtubeVideoId,
    preparedAt: Date.now(),
    ...continuationFence,
  });
  // `preparePublishContinuation` is the durable point where the run has the
  // exact uploaded YouTube id. Record release provenance before a Trigger
  // enqueue, whose retryable failure must not erase the successful upload's
  // audit linkage.
  await afterPrepared?.();
  let resumed;
  let enqueueAttempt: number | undefined;
  try {
    if (prepared && prepared.publishContinuationState !== "manual_recovery_required") {
      enqueueAttempt = publishPipelineResumeEnqueueAttempt(prepared);
    }
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
      if (enqueueAttempt !== undefined) {
        await convex.mutation(api.runs.recordPublishContinuationEnqueueFailure, {
          ownerId: intent.ownerId,
          channelId: intent.channelId,
          runId: intent.runId,
          intentId: intent._id,
          artifactId: intent.videoArtifactId,
          youtubeVideoId: intent.youtubeVideoId,
          error: message,
          failedAt: Date.now(),
          enqueueAttempt,
          ...continuationFence,
        });
      }
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
      enqueueAttempt: resumed.enqueueAttempt,
      ...continuationFence,
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
  executionLease?: RunExecutionLeaseFence;
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
      await handoffUploadedIntentToFailedPipeline(
        convex,
        claimed.intent,
        log,
        args.executionLease,
        () => recordUploadedReleaseProvenance(convex, secret, claimed.intent, log),
      );
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

    await assertPublishIntentThumbnailScenarioVisualTreatment(
      convex,
      intent as typeof intent & PublishIntentThumbnailTreatmentFields,
    );

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
      throw new PublishReleaseEvidenceError(
        `immutable video digest mismatch: expected ${intent.videoSha256}, got ${actualSha256}`,
      );
    }

    // This must stay after the exact local upload source exists but before any
    // connector or YouTube call. A delayed retry is not grandfathered by the
    // first attempt: it must prove the same certificate, final master, receipt,
    // and retained review frames again.
    const releaseEvidence = await verifyPublishIntentReleaseEvidence({
      intent,
      getRun: async (runId) =>
        await convex.query(api.runs.getRun, { runId }),
      getObjectBytes,
      getObjectIntegrity,
      headObjectMetadata,
      localFilePath: localPath,
    });
    log(
      `publish ${intent._id}: revalidated release evidence (${releaseEvidence.binding.certificateFingerprint.slice(0, 12)})`,
    );

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
    await handoffUploadedIntentToFailedPipeline(
      convex,
      completed,
      log,
      args.executionLease,
      () => recordUploadedReleaseProvenance(convex, secret, completed, log),
    );
    return { kind: "uploaded", ...result };
  } catch (error) {
    if (error instanceof PublishReleaseEvidenceError) {
      // Never turn a missing/tampered final-master proof into a provider retry.
      // The lease-bound terminal write is also the audit signal for a human
      // recovery decision; no automatic path can revive this intent.
      const blocked = await convex.mutation(api.publishIntents.blockReleaseEvidence, {
        secret,
        intentId: intent._id,
        workerId: args.workerId,
        reason: error.message,
        blockedAt: Date.now(),
      });
      log(`publish ${intent._id}: terminally blocked — ${error.message}`);
      return {
        kind: "deferred",
        reason: error.message,
        status: blocked?.status ?? "dead_letter",
      };
    }
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
