import { randomBytes } from "node:crypto";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { task } from "@trigger.dev/sdk/v3";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { deleteObjects, getBucket, getR2Client } from "@/lib/storage";

type Claim = {
  retentionId: Id<"studioR2AssetRetentions">;
  r2Key: string;
  leaseToken: string;
  createdAt: number;
};

/** Explicitly invoked, bounded cleanup. No deployment or scheduler runs this task. */
export async function sweepStudioR2AssetRetentions(ownerId: string, limit = 3): Promise<{
  claimed: number; deleted: number; deferred: number;
}> {
  if (!ownerId || limit < 1 || limit > 3 || !Number.isInteger(limit)) throw new Error("invalid R2 retention sweep scope");
  await bootstrapSecrets(() => undefined, { services: ["cloudflare"], required: [
    "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "STUDIO_CONVEX_JWT_PRIVATE_KEY",
  ] });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("Studio Convex URL is missing");
  const convex = new StudioConvexHttpClient(url);
  const inventory = await convex.query(api.studioR2AssetRetentions.dueInventory, { ownerId, now: Date.now() });
  if (!inventory.due) return { claimed: 0, deleted: 0, deferred: 0 };
  let claimed = 0; let deleted = 0; let deferred = 0;
  for (let index = 0; index < Math.min(limit, inventory.due); index++) {
    const leaseToken = randomBytes(32).toString("hex");
    const claim = await convex.mutation(api.studioR2AssetRetentions.claimDue, {
      ownerId, now: Date.now(), leaseToken,
    }) as Claim | null;
    if (!claim) break;
    claimed++;
    try {
      // A later overwrite can replace a run-local key. R2 exposes the object
      // modification time; an unversioned or newer object is held for review.
      let modifiedAt: number | undefined;
      let objectFound = false;
      try {
        const head = await getR2Client().send(new HeadObjectCommand({ Bucket: getBucket(), Key: claim.r2Key }));
        objectFound = true;
        modifiedAt = head.LastModified?.getTime();
      } catch (error) {
        // A prior attempt may have deleted the object before its Convex
        // completion timed out. Exact DeleteObjects acknowledgement is still
        // required to finish that retry.
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
      }
      if (objectFound && (!Number.isSafeInteger(modifiedAt) || modifiedAt! > claim.createdAt + 1_000)) {
        throw new Error("R2 object version changed or has no modification time");
      }
      const acknowledged = await deleteObjects([claim.r2Key], undefined, {
        beforeBatch: () => convex.mutation(api.studioR2AssetRetentions.authorizeDeletion, {
          ownerId, retentionId: claim.retentionId, leaseToken, now: Date.now(),
        }),
      });
      if (acknowledged !== 1) throw new Error("R2 did not acknowledge exact object deletion");
      await convex.mutation(api.studioR2AssetRetentions.complete, {
        ownerId, retentionId: claim.retentionId, leaseToken, now: Date.now(),
        deletedKey: claim.r2Key, acknowledged: true,
      });
      deleted++;
    } catch (error) {
      deferred++;
      await convex.mutation(api.studioR2AssetRetentions.release, {
        ownerId, retentionId: claim.retentionId, leaseToken, now: Date.now(),
        error: error instanceof Error ? error.message.slice(0, 200) : "cleanup failed",
      });
    }
  }
  return { claimed, deleted, deferred };
}

export const studioR2AssetRetentionSweeper = task({
  id: "studio-r2-asset-retention-sweeper",
  maxDuration: 300,
  run: async (payload: { ownerId: string; limit?: number }) =>
    sweepStudioR2AssetRetentions(payload.ownerId, payload.limit ?? 3),
});
