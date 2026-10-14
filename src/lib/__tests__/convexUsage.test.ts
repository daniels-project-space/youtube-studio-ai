import assert from "node:assert/strict";

import { createConvexUsageScope, recordConvexHttpRequest } from "@/lib/convexUsage";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

recordConvexHttpRequest("https://studio.convex.cloud/api/query");

async function main(): Promise<void> {
  const first = createConvexUsageScope();
  const second = createConvexUsageScope();
  let releaseFirst!: () => void;
  let firstReady!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise<void>((resolve) => { firstReady = resolve; });

  const firstRun = first.run(async () => {
    recordConvexHttpRequest("https://studio.convex.cloud/api/query");
    firstReady();
    await firstGate;
    recordConvexHttpRequest(new URL("https://studio.convex.cloud/api/mutation"));
  });
  await firstStarted;
  await second.run(async () => {
    recordConvexHttpRequest("https://studio.convex.cloud/api/query_ts");
    recordConvexHttpRequest("https://studio.convex.cloud/api/query_at_ts");
    recordConvexHttpRequest("https://studio.convex.cloud/api/mutation");
    recordConvexHttpRequest("https://studio.convex.cloud/api/action");
  });
  releaseFirst();
  await firstRun;

  assert.deepEqual(first.snapshot(), { reads: 1, writes: 1 });
  assert.deepEqual(second.snapshot(), { reads: 2, writes: 1 });

  const clientScope = createConvexUsageScope();
  const paths: string[] = [];
  const client = new StudioConvexHttpClient("https://studio.convex.cloud", {
    auth: "fixture-token",
    fetch: async (input) => {
      paths.push(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname);
      return Response.json({ status: "success", value: null });
    },
  });
  await clientScope.run(async () => {
    await client.query("usageFixture:read" as never, {});
    await client.mutation("usageFixture:write" as never, {});
  });
  assert.deepEqual(paths, ["/api/query", "/api/mutation"]);
  assert.deepEqual(clientScope.snapshot(), { reads: 1, writes: 1 });

  console.log("Convex per-module usage scope tests passed");
}

void main();
