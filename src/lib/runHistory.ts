import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  RUN_HISTORY_PAGE_LIMIT,
  validatedReadLimit,
} from "@/lib/boundedConvexReads";

const MAX_HISTORY_PAGES = 100;

/**
 * Consume a server-bounded indexed cursor only when a worker genuinely needs
 * complete history. UI queries stay single-page and cheap.
 */
export async function listRunHistorySince(
  convex: StudioConvexHttpClient,
  channelId: Id<"channels">,
  startedAfter: number,
  requestedPageSize: number = RUN_HISTORY_PAGE_LIMIT.defaultLimit,
): Promise<Doc<"runs">[]> {
  const numItems = validatedReadLimit(requestedPageSize, RUN_HISTORY_PAGE_LIMIT);
  if (!Number.isFinite(startedAfter) || startedAfter < 0) {
    throw new Error("run history start must be a non-negative timestamp");
  }

  const rows: Doc<"runs">[] = [];
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < MAX_HISTORY_PAGES; pageNumber++) {
    const page: {
      page: Doc<"runs">[];
      isDone: boolean;
      continueCursor: string;
    } = await convex.query(api.runs.listRunsByChannelSincePage, {
      channelId,
      startedAfter,
      paginationOpts: { cursor, numItems },
    });
    rows.push(...page.page);
    if (page.isDone) return rows;
    if (!page.continueCursor || page.continueCursor === cursor) {
      throw new Error("run history cursor did not advance");
    }
    cursor = page.continueCursor;
  }
  throw new Error(
    `run history exceeded ${MAX_HISTORY_PAGES * numItems} rows; narrow the time window`,
  );
}
