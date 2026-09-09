import { randomBytes } from "node:crypto";
import { schedules } from "@trigger.dev/sdk";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { parseFinalMasterReleaseCertificateBytes } from "@/lib/finalMasterReleaseCertificate";
import { pruneRunObjectsWithVerifiedFinalMasterEvidence } from "@/lib/runArtifactPrune";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { type RunArtifactReleaseObservation } from "@/lib/runArtifactRetention";
import { requireYouTubeConnector } from "@/lib/youtubeConnector";
import { getAccessToken } from "@/lib/youtube";
import {
  deleteObjects,
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

/** One bounded read for this channel, with no provider writes or public API key. */
export async function fetchRunArtifactReleaseObservations(args: {
  accessToken: string;
  videoIds: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<Map<string, RunArtifactReleaseObservation>> {
  const ids = [...new Set(args.videoIds)];
  if (!ids.length) return new Map();
  if (ids.length > 50 || ids.some((id) => !/^[a-zA-Z0-9_-]{11}$/.test(id))) {
    throw new Error("YouTube release observation requires 1–50 exact video IDs");
  }
  const params = new URLSearchParams({
    part: "snippet,status",
    id: ids.join(","),
    fields: "items(id,snippet(channelId,publishedAt),status(privacyStatus,uploadStatus))",
  });
  const response = await (args.fetchImpl ?? fetch)(
    `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
    { headers: { Authorization: `Bearer ${args.accessToken}` }, signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`YouTube release observation HTTP ${response.status}`);
  const body = await response.json() as { items?: Array<{
    id?: string;
    snippet?: { channelId?: string; publishedAt?: string };
    status?: { privacyStatus?: string; uploadStatus?: string };
  }> };
  if (!Array.isArray(body.items)) throw new Error("YouTube release observation response is malformed");
  const output = new Map<string, RunArtifactReleaseObservation>();
  for (const item of body.items) {
    if (!item.id || !ids.includes(item.id) || output.has(item.id)) {
      throw new Error("YouTube release observation returned an unexpected or duplicate video");
    }
    output.set(item.id, {
      videoId: item.id,
      channelId: item.snippet?.channelId ?? "",
      ...(item.snippet?.publishedAt === undefined ? {} : { publishedAt: item.snippet.publishedAt }),
      ...(item.status?.privacyStatus === undefined ? {} : { privacyStatus: item.status.privacyStatus }),
      ...(item.status?.uploadStatus === undefined ? {} : { uploadStatus: item.status.uploadStatus }),
    });
  }
  return output;
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
      const certificate = parseFinalMasterReleaseCertificateBytes(
        await getObjectBytes(retention.certificateKey),
      );
      const additionalCertificates = await Promise.all(
        retention.additionalCertificateKeys.map(async (certificateKey) => ({
          certificateKey,
          certificate: parseFinalMasterReleaseCertificateBytes(await getObjectBytes(certificateKey)),
        })),
      );
      const pruning = await pruneRunObjectsWithVerifiedFinalMasterEvidence({
        keyPrefix: retention.keyPrefix,
        runId: String(retention.runId),
        certificateKey: retention.certificateKey,
        certificate,
        additionalCertificates,
        keepNames: retention.keepNames,
        getObjectBytes,
        getObjectIntegrity,
        listObjects,
        deleteObjects,
      });
      removedObjects += pruning.removedObjects;
      if (!pruning.cleaned) {
        throw new Error(`${pruning.removedObjects} deletion(s) confirmed; ${pruning.error ?? "release evidence could not be revalidated"}`);
      }
      await convex.mutation(api.assets.pruneRun, {
        runId: retention.runId,
        keepKinds: ["video", "thumbnail", "derived_short"],
      });
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
      log(`completed ${retention.runId}: removed ${pruning.removedObjects} intermediate object(s)`);
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
  cron: "17 * * * *",
  maxDuration: 3_600,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async () => sweepDueRunArtifactRetentions(),
});
