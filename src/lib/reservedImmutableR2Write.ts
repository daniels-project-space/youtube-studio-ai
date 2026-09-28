import { randomUUID } from "node:crypto";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { headObjectMetadata } from "@/lib/storage";

/** Keep a transactional writer fence until R2 has acknowledged exact bytes. */
export async function writeReservedImmutableR2Object(input: {
  ownerId: string;
  channelId: string;
  runId: string;
  r2Key: string;
  write: () => Promise<void>;
  verifyStoredBytes: () => Promise<void>;
}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const convex = new StudioConvexHttpClient(url);
  const args = { ownerId: input.ownerId, channelId: input.channelId as Id<"channels">,
    runId: input.runId as Id<"runs">, r2Key: input.r2Key, claimId: randomUUID() };
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
