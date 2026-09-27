import { randomBytes } from "node:crypto";
import { schedules } from "@trigger.dev/sdk";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { parseFinalMasterReleaseCertificateBytes } from "@/lib/finalMasterReleaseCertificate";
import { loadR2RetentionProtectedKeys } from "@/lib/r2RetentionProtectedKeys";
import { pruneRunObjectsWithVerifiedFinalMasterEvidence } from "@/lib/runArtifactPrune";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  type RunArtifactReleaseObservation,
  RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS,
  runArtifactCleanupBinding,
} from "@/lib/runArtifactRetention";
import { requireYouTubeConnector } from "@/lib/youtubeConnector";
import { getAccessToken } from "@/lib/youtube";
import { fetchRunArtifactReleaseObservations } from "@/lib/youtubeReleaseObservation";
export { fetchRunArtifactReleaseObservations } from "@/lib/youtubeReleaseObservation";
import {
  getObjectBytes,
  getObjectIntegrity,
  listObjects,
} from "@/lib/storage";

const CLEANUP_BATCH_LIMIT = 3;

export interface RunArtifactReleaseCheck {
  retentionId: Id<"runArtifactRetentions">;
  channelId: Id<"channels">;
  runId: Id<"runs">;
  videoId?: string;
}

export interface RunArtifactObservedRelease {
  retentionId: Id<"runArtifactRetentions">;
  connectorId?: Id<"youtubeAuth">;
  connectorVersion?: number;
  error?: string;
  observation: RunArtifactReleaseObservation | null;
}

/** Shared production/test coordinator: group by connector, persist every outcome. */
export async function reconcileRunArtifactReleaseChecks(args: {
  checks: readonly RunArtifactReleaseCheck[];
  observeChannel: (channelId: Id<"channels">, videoIds: string[]) => Promise<{
    connectorId: Id<"youtubeAuth">;
    connectorVersion: number;
    videos: Map<string, RunArtifactReleaseObservation>;
  }>;
  record: (observations: RunArtifactObservedRelease[], observedAt: number) => Promise<{
    confirmed: number; deferred: number;
  }>;
  now?: () => number;
}): Promise<{ confirmed: number; deferred: number }> {
  const groups = new Map<Id<"channels">, RunArtifactReleaseCheck[]>();
  for (const check of args.checks) {
    const rows = groups.get(check.channelId) ?? [];
    rows.push(check);
    groups.set(check.channelId, rows);
  }
  let confirmed = 0;
  let deferred = 0;
  for (const [channelId, checks] of groups) {
    let observations: RunArtifactObservedRelease[];
    try {
      const videoIds = [...new Set(checks.flatMap((check) => check.videoId ? [check.videoId] : []))];
      const result = videoIds.length ? await args.observeChannel(channelId, videoIds) : undefined;
      observations = checks.map((check) => ({
        retentionId: check.retentionId,
        ...(result ? { connectorId: result.connectorId, connectorVersion: result.connectorVersion } : {}),
        ...(!check.videoId ? { error: "The saved run has no YouTube video ID" } : {}),
        observation: check.videoId && result ? (result.videos.get(check.videoId) ?? null) : null,
      }));
    } catch (error) {
      observations = checks.map((check) => ({
        retentionId: check.retentionId,
        error: `Release check unavailable: ${error instanceof Error ? error.message : "provider lookup failed"}`.slice(0, 1_000),
        observation: null,
      }));
    }
    // A failed commit stops cleanup; it cannot be mistaken for no due work.
    const result = await args.record(observations, (args.now ?? Date.now)());
    confirmed += result.confirmed;
    deferred += result.deferred;
  }
  return { confirmed, deferred };
}

type ClaimedRetention = {
  _id: Id<"runArtifactRetentions">;
  ownerId: string;
  channelId: Id<"channels">;
  runId: Id<"runs">;
  keyPrefix: string;
  certificateKey: string;
  additionalCertificateKeys: string[];
  keepNames: string[];
  leaseToken: string;
  releaseVideoId?: string;
  releaseYouTubeChannelId?: string;
};

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

export async function sweepDueRunArtifactRetentions(input?: {
  ownerId?: string;
  now?: number;
  limit?: number;
}): Promise<{ claimed: number; completed: number; blocked: number; removedObjects: number }> {
  const log = (message: string, extra?: Record<string, unknown>) =>
    console.log(`[run-artifact-retention] ${message}`, extra ?? "");
  await bootstrapSecrets(log, {
    services: ["cloudflare", "youtube"],
    required: [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
      "STUDIO_CONVEX_JWT_PRIVATE_KEY",
    ],
  });
  const ownerId = input?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const limit = Math.max(1, Math.min(CLEANUP_BATCH_LIMIT, Math.floor(input?.limit ?? CLEANUP_BATCH_LIMIT)));
  const convex = convexClient();
  let protectedKeysPromise: Promise<Set<string>> | undefined;
  const releaseChecks = await convex.query(api.runArtifactRetentions.listReleaseChecks, {
    ownerId, now: input?.now ?? Date.now(),
  }) as RunArtifactReleaseCheck[];
  const releases = await reconcileRunArtifactReleaseChecks({
    checks: releaseChecks,
    observeChannel: async (channelId, videoIds) => {
      const connector = await requireYouTubeConnector(convex, { ownerId, channelId });
      if (!connector.ytChannelId) throw new Error("YouTube connector has no bound channel identity");
      const accessToken = await getAccessToken(connector.refreshToken);
      return {
        connectorId: connector.connectorId,
        connectorVersion: connector.tokenVersion,
        videos: await fetchRunArtifactReleaseObservations({ accessToken, videoIds }),
      };
    },
    record: (observations, observedAt) => convex.mutation(api.runArtifactRetentions.recordReleaseObservations, {
      ownerId, observedAt, observations,
    }),
  });
  if (releaseChecks.length) log("release checks complete", releases);
  let claimed = 0;
  let completed = 0;
  let blocked = 0;
  let removedObjects = 0;

  for (let index = 0; index < limit; index++) {
    const leaseToken = randomBytes(32).toString("hex");
    const retention = await convex.mutation(api.runArtifactRetentions.claimDue, {
      ownerId,
      now: input?.now ?? Date.now(),
      leaseToken,
    }) as ClaimedRetention | null;
    if (!retention) break;
    claimed++;
    try {
      if (retention.leaseToken !== leaseToken) {
        throw new Error("claimed artifact retention returned a mismatched lease token");
      }
      const binding = runArtifactCleanupBinding(retention);
      let deletionObservation: {
        connectorId: Id<"youtubeAuth">; connectorVersion: number; observedAt: number;
        observation: RunArtifactReleaseObservation | null;
      } | undefined;
      const authorizeNextBatch = async (): Promise<{ expiresAt: number }> => {
        if (!deletionObservation || Date.now() - deletionObservation.observedAt >= RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS / 2) {
          if (!retention.releaseVideoId) throw new Error("claimed cleanup has no bound released video");
          const connector = await requireYouTubeConnector(convex, { ownerId, channelId: retention.channelId });
          const videos = await fetchRunArtifactReleaseObservations({
            accessToken: await getAccessToken(connector.refreshToken), videoIds: [retention.releaseVideoId],
          });
          deletionObservation = {
            connectorId: connector.connectorId, connectorVersion: connector.tokenVersion,
            observedAt: Date.now(), observation: videos.get(retention.releaseVideoId) ?? null,
          };
        }
        return convex.mutation(api.runArtifactRetentions.authorizeDeletion, {
          ownerId, retentionId: retention._id, leaseToken, binding, ...deletionObservation,
        });
      };
      const certificate = parseFinalMasterReleaseCertificateBytes(
        await getObjectBytes(retention.certificateKey),
      );
      const additionalCertificates = await Promise.all(
        retention.additionalCertificateKeys.map(async (certificateKey) => ({
          certificateKey,
          certificate: parseFinalMasterReleaseCertificateBytes(await getObjectBytes(certificateKey)),
        })),
      );
      const protectedKeys = await (protectedKeysPromise ??= loadR2RetentionProtectedKeys(convex, ownerId));
      const pruning = await pruneRunObjectsWithVerifiedFinalMasterEvidence({
        keyPrefix: retention.keyPrefix,
        runId: String(retention.runId),
        certificateKey: retention.certificateKey,
        certificate,
        additionalCertificates,
        keepNames: retention.keepNames,
        keepKeys: [...protectedKeys].filter((key) => key.startsWith(`${retention.keyPrefix}runs/${retention.runId}/`)),
        getObjectBytes,
        getObjectIntegrity,
        listObjects,
      });
      removedObjects += pruning.removedObjects;
      if (!pruning.cleaned) {
        throw new Error(`${pruning.removedObjects} deletion(s) confirmed; ${pruning.error ?? "release evidence could not be revalidated"}`);
      }
      // Evidence verification and live release authority seal this ledger.
      // No key-only R2 deletion or asset-row pruning occurs on the hourly path.
      await authorizeNextBatch();
      await convex.mutation(api.runArtifactRetentions.complete, {
        ownerId,
        retentionId: retention._id,
        leaseToken,
        completedAt: Date.now(),
        removedObjects: pruning.removedObjects,
        retainedObjectCount: pruning.retainedObjectCount,
        retainedReleaseEvidence: pruning.retainedReleaseEvidence,
      });
      completed++;
      log(`sealed ${retention.runId}: retained ${pruning.retainedObjectCount} object(s) for guarded retention`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await convex.mutation(api.runArtifactRetentions.fail, {
        ownerId,
        retentionId: retention._id,
        leaseToken,
        failedAt: Date.now(),
        error: message,
      });
      if (failed?.status === "blocked") blocked++;
      log(`cleanup incomplete ${retention.runId}: ${message}`);
    }
  }

  return { claimed, completed, blocked, removedObjects };
}

/**
 * Retention cleanup is maintenance for already-authorized releases, so it is
 * intentionally independent of the content-generation automation gate.
 */
export const runArtifactRetentionSweeper = schedules.task({
  id: "run-artifact-retention-sweeper",
  // Production cadence is frozen; see docs/trigger-schedule-freeze-20260927.md.
  maxDuration: 3_600,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async () => sweepDueRunArtifactRetentions(),
});
