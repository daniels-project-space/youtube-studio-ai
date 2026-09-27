import { schedules } from "@trigger.dev/sdk";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { parseFinalMasterReleaseCertificateBytes, retainedFinalMasterReleaseObjectKeys } from "@/lib/finalMasterReleaseCertificate";
import { ASSET_RETENTION_MS, assertYouTubeStudioR2Account, assertYouTubeStudioR2Bucket,
  hasImmutableAtlasCropProof, selectExpiredRunObjects,
  YOUTUBE_STUDIO_R2_BUCKET, type RunR2RetentionScope } from "@/lib/r2AssetRetention";
import { loadR2RetentionProtectedKeys } from "@/lib/r2RetentionProtectedKeys";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { deleteObjects, getObjectBytes, headObjectMetadata, listObjectRecords } from "@/lib/storage";
import type { ListedR2Object } from "@/lib/r2AssetRetention";
import { requireYouTubeConnector } from "@/lib/youtubeConnector";
import { getAccessToken } from "@/lib/youtube";
import { fetchRunArtifactReleaseObservations } from "@/lib/youtubeReleaseObservation";
import { RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS,
  type RunArtifactReleaseObservation } from "@/lib/runArtifactRetention";

const MAX_SCOPES = 3_000;
const MAX_DELETIONS = 100;

function client(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new StudioConvexHttpClient(url);
}

/** Deletes only certificate-bound run keys. Everything outside that namespace is reported separately. */
export async function sweepR2AssetRetention(input: {
  ownerId?: string; now?: number; dryRun?: boolean;
} = {}): Promise<{ scannedScopes: number; expiredAssets: number; expiredFinals: number; expiredFootage: number; deleted: number; skippedScopes: number }> {
  await bootstrapSecrets((message) => console.log(`[r2-retention] ${message}`), {
    services: ["cloudflare", "youtube"],
    required: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "STUDIO_CONVEX_JWT_PRIVATE_KEY"],
  });
  assertYouTubeStudioR2Bucket(process.env.R2_BUCKET);
  assertYouTubeStudioR2Account({ accountId: process.env.R2_ACCOUNT_ID,
    expectedAccountId: process.env.YOUTUBE_STUDIO_R2_ACCOUNT_ID, endpoint: process.env.R2_ENDPOINT });
  const ownerId = input.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  if (!/^[A-Za-z0-9_-]+$/u.test(ownerId)) throw new Error("R2 retention owner ID is not a safe namespace segment");
  const now = input.now ?? Date.now();
  const convex = client();
  const observations = new Map<string, { connectorId: Id<"youtubeAuth">; connectorVersion: number;
    observedAt: number; observation: RunArtifactReleaseObservation }>();
  const observeRelease = async (runId: string, channelId: string, videoId: string) => {
    const cached = observations.get(runId);
    if (cached && Date.now() - cached.observedAt < RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS / 2) return cached;
    const connector = await requireYouTubeConnector(convex, { ownerId, channelId: channelId as Id<"channels"> });
    const observed = await fetchRunArtifactReleaseObservations({
      accessToken: await getAccessToken(connector.refreshToken), videoIds: [videoId],
    });
    const observation = observed.get(videoId);
    if (!observation) throw new Error("bound YouTube video is unavailable");
    const result = { connectorId: connector.connectorId, connectorVersion: connector.tokenVersion,
      observedAt: Date.now(), observation };
    observations.set(runId, result);
    return result;
  };
  const protectedKeys = await loadR2RetentionProtectedKeys(convex, ownerId);
  if (!input.dryRun) {
    let pendingCursor: string | null = null;
    do {
      const pending: { page: Array<{ id: Id<"r2AssetExpirations">; r2Key: string;
        etag: string; lastModifiedAt: number; preparedAt: number }>;
        isDone: boolean; continueCursor: string } = await convex.query(api.r2Retention.pendingExpirationsPage, {
        ownerId, paginationOpts: { cursor: pendingCursor, numItems: 50 },
      });
      for (const row of pending.page) {
        if (Date.now() - row.preparedAt < 10 * 60_000) continue;
        const current = await headObjectMetadata(row.r2Key, YOUTUBE_STUDIO_R2_BUCKET);
        if (!current) {
          await convex.mutation(api.r2Retention.confirmExpiration, { ownerId, expirationId: row.id });
        } else if (current.etag !== row.etag || current.lastModified?.getTime() !== row.lastModifiedAt) {
          throw new Error("pending R2 expiration key was replaced; manual reconciliation required");
        }
        // A timed-out delete can still complete later. Keep the intent and its
        // promotion/lock fences until R2 absence is confirmed.
      }
      if (!pending.isDone && pending.continueCursor === pendingCursor) throw new Error("R2 pending expiration inventory did not advance");
      pendingCursor = pending.isDone ? null : pending.continueCursor;
      if (pending.isDone) break;
    } while (pendingCursor);
  }

  const expire = async (record: ListedR2Object, runId: string, channelId: string,
    videoId: string, kind: "asset" | "final_video" | "footage") => {
    if (kind !== "asset") return false; // mutable writers have no delete-safe proof
    const head = await headObjectMetadata(record.key, YOUTUBE_STUDIO_R2_BUCKET);
    if (!head || !head.lastModified || !head.etag || head.lastModified.getTime() !== record.lastModified?.getTime() ||
        !record.etag || head.etag !== record.etag || !hasImmutableAtlasCropProof(record.key, head.metadata)) return false;
    const intent = await convex.mutation(api.r2Retention.prepareExpiration, {
      ownerId, runId: runId as Id<"runs">, r2Key: record.key,
      kind, lastModifiedAt: head.lastModified.getTime(), etag: head.etag,
    });
    if (intent.status === "expired" || intent.reused) return false;
    try {
      await convex.mutation(api.r2Retention.authorizeExpirationDelete, {
        ownerId, expirationId: intent.id, ...(await observeRelease(runId, channelId, videoId)),
      });
      const current = await headObjectMetadata(record.key, YOUTUBE_STUDIO_R2_BUCKET);
      if (!current || !current.lastModified || current.lastModified.getTime() !== head.lastModified.getTime() ||
          !record.etag || !current.etag || current.etag !== record.etag ||
          !hasImmutableAtlasCropProof(record.key, current.metadata)) {
        throw new Error("R2 object identity changed before deletion");
      }
      await deleteObjects([record.key], YOUTUBE_STUDIO_R2_BUCKET);
      await convex.mutation(api.r2Retention.confirmExpiration, { ownerId, expirationId: intent.id });
      return true;
    } catch (error) {
      // The provider request may still complete after a timeout. Never clear
      // this fence based on a HEAD that temporarily still sees the object.
      throw error;
    }
  };
  let cursor: string | null = null;
  let scannedScopes = 0;
  let expiredAssets = 0;
  let expiredFinals = 0;
  let expiredFootage = 0;
  let deleted = 0;
  let skippedScopes = 0;
  do {
    const page: { page: RunR2RetentionScope[]; isDone: boolean; continueCursor: string } = await convex.query(api.r2Retention.runScopesPage, {
      ownerId, paginationOpts: { cursor, numItems: 20 },
    });
    for (const scope of page.page as RunR2RetentionScope[]) {
      scannedScopes++;
      if (scannedScopes > MAX_SCOPES) throw new Error("R2 retention scope cap reached; later scopes were not inspected");
      if (!["ok", "failed", "canceled"].includes(scope.runStatus) || !scope.finishedAt || scope.channelLocked ||
          scope.retentionStatus !== "completed" || !scope.releaseAt || !scope.retainUntil || scope.retainUntil > now) {
        skippedScopes++;
        continue;
      }
      try {
        const evidenceKeys = new Set<string>();
        const finalVideoKeys = new Set<string>(scope.assets
          .filter((asset) => asset.kind === "video" || asset.kind === "derived_short")
          .map((asset) => asset.r2Key));
        for (const certificateKey of [scope.certificateKey, ...scope.additionalCertificateKeys]) {
          const certificate = parseFinalMasterReleaseCertificateBytes(await getObjectBytes(certificateKey, YOUTUBE_STUDIO_R2_BUCKET));
          finalVideoKeys.add(certificate.finalMaster.r2Key);
          for (const key of retainedFinalMasterReleaseObjectKeys({
            keyPrefix: scope.keyPrefix, runId: scope.runId, certificateKey, certificate,
          })) evidenceKeys.add(key);
        }
        for (const key of scope.retainedReleaseEvidence) evidenceKeys.add(key);
        for (const key of finalVideoKeys) evidenceKeys.delete(key);
        const prefix = `${scope.keyPrefix}runs/${scope.runId}/`;
        if ([...finalVideoKeys, ...evidenceKeys].some((key) => !key.startsWith(prefix))) {
          throw new Error("R2 retention protection key escaped the run namespace");
        }
        const records = await listObjectRecords(prefix, YOUTUBE_STUDIO_R2_BUCKET);
        const selection = selectExpiredRunObjects({ scope, records, protectedKeys, evidenceKeys, finalVideoKeys, now });
        expiredAssets += selection.expiredAssets.length;
        expiredFinals += selection.expiredFinals.length;
        if (input.dryRun) continue;
        for (const [kind, group] of [["asset", selection.expiredAssets], ["final_video", selection.expiredFinals]] as const) {
          for (const record of group) {
          if (deleted >= MAX_DELETIONS) break;
          if (!scope.channelId || !scope.releaseVideoId) throw new Error("release scope lacks channel/video identity");
          if (await expire(record, scope.runId, scope.channelId, scope.releaseVideoId, kind)) deleted++;
          }
        }
      } catch (error) {
        skippedScopes++;
        console.error(`[r2-retention] skipped run ${scope.runId}:`, error);
      }
    }
    if (!page.isDone && page.continueCursor === cursor) throw new Error("R2 run inventory did not advance");
    cursor = page.isDone ? null : page.continueCursor;
    if (page.isDone) break;
  } while (cursor);

  // Older generated footage lives beside runs rather than inside runs/<id>/.
  // Its Convex run and channel must both match the exact path before deletion.
  const footageRoot = `owner/${ownerId}/channel/`;
  const footageRecords = await listObjectRecords(footageRoot, YOUTUBE_STUDIO_R2_BUCKET);
  const runStates = new Map<string, Promise<{ status: string; finishedAt?: number; channelLocked: boolean;
    retentionStatus?: string; releaseAt?: number; retainUntil?: number;
    channelId?: string; releaseVideoId?: string } | null>>();
  for (const record of footageRecords) {
    const relative = record.key.slice(footageRoot.length);
    const match = /^([^/]+)\/footage\/run\/([^/]+)\/clip_[0-9]+\.mp4$/u.exec(relative);
    if (!match || protectedKeys.has(record.key)) continue;
    const modified = record.lastModified?.getTime();
    if (!Number.isFinite(modified) || modified! > now - ASSET_RETENTION_MS) continue;
    const [, channelSlug, runId] = match;
    const stateKey = `${channelSlug}/${runId}`;
    let statePromise = runStates.get(stateKey);
    if (!statePromise) {
      statePromise = convex.query(api.r2Retention.footageRunScope, { ownerId, channelSlug, runId });
      runStates.set(stateKey, statePromise);
    }
    const state = await statePromise;
    if (!state || state.channelLocked || !["ok", "failed", "canceled"].includes(state.status) ||
        !state.finishedAt || state.finishedAt > now - ASSET_RETENTION_MS ||
        state.retentionStatus !== "completed" || !state.releaseAt || !state.channelId || !state.releaseVideoId ||
        state.releaseAt > now - ASSET_RETENTION_MS || !state.retainUntil || state.retainUntil > now) continue;
    expiredFootage++;
    if (input.dryRun || deleted >= MAX_DELETIONS) continue;
    if (await expire(record, runId, state.channelId, state.releaseVideoId, "footage")) deleted++;
  }
  return { scannedScopes, expiredAssets, expiredFinals, expiredFootage, deleted, skippedScopes };
}

export const r2AssetRetentionSweeper = schedules.task({
  id: "r2-asset-retention-sweeper",
  cron: "43 3 * * *",
  maxDuration: 3_600,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async () => sweepR2AssetRetention(),
});
