import assert from "node:assert/strict";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { listRunHistorySince } from "@/lib/runHistory";
import type { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

async function main() {
  const calls: Array<{ startedAfter: number; paginationOpts: { cursor: string | null; numItems: number } }> = [];
  const client = {
    query: async (_reference: unknown, args: {
      startedAfter: number;
      paginationOpts: { cursor: string | null; numItems: number };
    }) => {
      calls.push(args);
      if (args.paginationOpts.cursor === null) {
        return {
          page: [{ _id: "runs:1", startedAt: 200 }] as Doc<"runs">[],
          isDone: false,
          continueCursor: "page-2",
        };
      }
      return {
        page: [{ _id: "runs:2", startedAt: 100 }] as Doc<"runs">[],
        isDone: true,
        continueCursor: "done",
      };
    },
  } as unknown as StudioConvexHttpClient;

  const rows = await listRunHistorySince(
    client,
    "channels:test" as Id<"channels">,
    50,
    100,
  );
  assert.deepEqual(rows.map((row) => row._id), ["runs:1", "runs:2"]);
  assert.deepEqual(calls.map((call) => call.paginationOpts), [
    { cursor: null, numItems: 100 },
    { cursor: "page-2", numItems: 100 },
  ]);
  assert(calls.every((call) => call.startedAfter === 50));

  await assert.rejects(
    listRunHistorySince(client, "channels:test" as Id<"channels">, 0, 201),
    /between 1 and 200/,
  );
  assert.equal(calls.length, 2, "an oversized caller must be rejected before a Convex read");

  console.log("RUN HISTORY PAGINATION TESTS PASS");
}

void main();
