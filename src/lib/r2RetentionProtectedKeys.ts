import { api } from "../../convex/_generated/api";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

/** Fetch every immutable revision; an incomplete inventory aborts all cleanup. */
export async function loadR2RetentionProtectedKeys(
  convex: StudioConvexHttpClient, ownerId: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const source of ["library", "reusable_media"] as const) {
    let cursor: string | null = null;
    do {
      const page: { page: string[]; isDone: boolean; continueCursor: string } = await convex.query(api.r2Retention.protectedKeysPage, {
        ownerId, source, paginationOpts: { cursor, numItems: 50 },
      });
      for (const key of page.page) keys.add(key);
      if (!page.isDone && page.continueCursor === cursor) throw new Error("R2 protected inventory did not advance");
      cursor = page.isDone ? null : page.continueCursor;
      if (page.isDone) break;
    } while (cursor);
  }
  return keys;
}
