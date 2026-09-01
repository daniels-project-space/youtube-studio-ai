import { randomBytes } from "node:crypto";
import { schedules } from "@trigger.dev/sdk";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { parseFinalMasterReleaseCertificateBytes } from "@/lib/finalMasterReleaseCertificate";
import { pruneRunObjectsWithVerifiedFinalMasterEvidence } from "@/lib/runArtifactPrune";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  deleteObjects,
  getObjectBytes,
  getObjectIntegrity,
  listObjects,
} from "@/lib/storage";

const CLEANUP_BATCH_LIMIT = 3;

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
      if (!pruning.cleaned) {
        throw new Error(pruning.error ?? "release evidence could not be revalidated");
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
      removedObjects += pruning.removedObjects;
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
      log(`preserved ${retention.runId}: ${message}`);
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
