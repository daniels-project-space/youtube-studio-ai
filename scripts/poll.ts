import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";

async function main() {
  const c = new ConvexHttpClient("https://astute-camel-689.convex.cloud");
  const rid = process.argv[2];
  if (!rid) throw new Error("usage: poll.ts <runId>");
  const runId = rid as Id<"runs">;
  const stages = await c.query(api.runStages.listRunStages, { runId });
  const run = await c.query(api.runs.getRun, { runId });
  const last = stages.at(-1);
  console.log(`status=${run?.status} stages=${stages.length} lastBlock=${last?.block} lastStatus=${last?.status}`);
  console.log(`blocks: ${stages.map((stage) => `${stage.block}:${stage.status}`).join(" ")}`);
  if (run?.error) console.log(`ERROR: ${run.error}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
