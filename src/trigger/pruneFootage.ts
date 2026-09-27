/**
 * Footage-prune — ongoing R2 cleanup for the render pipeline's intermediate clips.
 *
 * WHY: each video run writes raw generated clips to
 *   owner/<owner>/channel/<slug>/footage/run/<runId>/clip_*.mp4  (+ pre_overlay*.mp4)
 * These are PURE INTERMEDIATES — the deliverable `final.mp4` lives under a DIFFERENT
 * tree (`.../runs/<runId>/final.mp4`) and is NEVER matched here. Per-run cleanup
 * already clears completed runs; footage from failed/abandoned runs lingers and grows
 * (~8 GB reclaimed manually on 2026-07-08). This task keeps it swept.
 *
 * Legacy operator task is inventory-only. Its fixed-name clip writers can
 * replace bytes, so key-only R2 deletion cannot be made safe by an age check.
 */
import { task, logger } from "@trigger.dev/sdk/v3";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getR2Client, getBucket } from "../lib/storage";

const AGE_DAYS = 14; // conservative — footage older than this is definitively stale
const OWNER_PREFIX = "owner/";

async function pruneFootage() {
  const s3 = getR2Client();
  const Bucket = getBucket();
  const cutoff = Date.now() - AGE_DAYS * 86_400_000;
  const toDelete: { Key: string }[] = [];
  let scanned = 0;
  let bytes = 0;
  let token: string | undefined;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket, Prefix: OWNER_PREFIX, ContinuationToken: token }),
    );
    for (const o of out.Contents ?? []) {
      scanned++;
      const key = o.Key ?? "";
      const fn = key.split("/").pop() ?? "";
      const isFootage =
        key.includes("/footage/run/") &&
        (fn.startsWith("clip_") || fn.startsWith("pre_overlay"));
      if (isFootage && o.LastModified && o.LastModified.getTime() < cutoff) {
        toDelete.push({ Key: key });
        bytes += o.Size ?? 0;
      }
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  logger.info(
    `prune-footage inventory: scanned=${scanned} match=${toDelete.length} bytes=${bytes}`,
  );
  return { scanned, matched: toDelete.length, deleted: 0, bytes };
}

// Operator-triggered inventory only; enabling it cannot bypass retention fences.
export const pruneFootageSchedule = task({
  id: "prune-footage",
  run: async () => {
    if (process.env.ENABLE_FOOTAGE_PRUNE !== "true") {
      logger.info("prune-footage: disabled (set ENABLE_FOOTAGE_PRUNE=true to activate)");
      return { skipped: true as const };
    }
    return pruneFootage();
  },
});
