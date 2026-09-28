import { createHash } from "node:crypto";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { headObjectMetadata } from "@/lib/storage";
import { assertStudioRetentionR2Destination } from "@/lib/youtubeR2Account";

/** Stable across worker retries for the same owned, content-addressed key. */
export function immutableR2ClaimId(input: { ownerId: string; channelId: string; runId: string; r2Key: string }): string {
  const hex = createHash("sha256").update(JSON.stringify([
    "studio-immutable-r2-claim/v1", input.ownerId, input.channelId, input.runId, input.r2Key,
  ])).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Keep a transactional writer fence until R2 has acknowledged exact bytes. */
export async function writeReservedImmutableR2Object(input: {
  ownerId: string;
  channelId: string;
  runId: string;
  r2Key: string;
  write: () => Promise<void>;
  verifyStoredBytes: () => Promise<void>;
}): Promise<void> {
  assertStudioRetentionR2Destination({
    bucket: process.env.R2_BUCKET, accountId: process.env.R2_ACCOUNT_ID,
    expectedAccountId: process.env.YOUTUBE_STUDIO_R2_ACCOUNT_ID,
    endpoint: process.env.R2_ENDPOINT,
  });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const convex = new StudioConvexHttpClient(url);
  const args = { ownerId: input.ownerId, channelId: input.channelId as Id<"channels">,
    runId: input.runId as Id<"runs">, r2Key: input.r2Key, claimId: immutableR2ClaimId(input) };
  const reservation = await convex.mutation(api.r2ImmutableWrites.begin, args);
  if (reservation.status === "finished") {
    await input.verifyStoredBytes();
    return;
  }
  try {
    await input.write();
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status !== 409 && status !== 412) throw error;
  }
  await input.verifyStoredBytes();
  const head = await headObjectMetadata(input.r2Key);
  if (!head?.etag || !head.lastModified || !head.contentLength) {
    throw new Error("immutable R2 write has no stored ETag, timestamp, or byte length");
  }
  await convex.mutation(api.r2ImmutableWrites.finish, {
    ...args, etag: head.etag, lastModifiedAt: head.lastModified.getTime(),
    byteLength: head.contentLength,
  });
}
