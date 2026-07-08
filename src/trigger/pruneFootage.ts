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
 * SAFETY: matches ONLY keys containing `/footage/run/` whose filename starts with
 * `clip_` or `pre_overlay`, older than AGE_DAYS. Gated OFF by default — set env
 * `ENABLE_FOOTAGE_PRUNE=true` in the Trigger project to activate. Until then it is a
 * scheduled no-op (safe to ship inert).
 */
import { schedules, logger } from "@trigger.dev/sdk/v3";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getR2Client, getBucket } from "../lib/storage";

const AGE_DAYS = 14; // conservative — footage older than this is definitively stale
const OWNER_PREFIX = "owner/";

async function pruneFootage(dryRun: boolean) {
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
    `prune-footage: scanned=${scanned} match=${toDelete.length} bytes=${bytes} dryRun=${dryRun}`,
  );
  if (!dryRun) {
    for (let i = 0; i < toDelete.length; i += 1000) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket,
          Delete: { Objects: toDelete.slice(i, i + 1000), Quiet: true },
        }),
      );
    }
  }
  return { scanned, matched: toDelete.length, deleted: dryRun ? 0 : toDelete.length, bytes };
}

// Scheduled daily at 05:40, but a NO-OP unless ENABLE_FOOTAGE_PRUNE=true.
export const pruneFootageSchedule = schedules.task({
  id: "prune-footage",
  cron: "40 5 * * *",
  run: async () => {
    if (process.env.ENABLE_FOOTAGE_PRUNE !== "true") {
      logger.info("prune-footage: disabled (set ENABLE_FOOTAGE_PRUNE=true to activate)");
      return { skipped: true as const };
    }
    return pruneFootage(false);
  },
});
