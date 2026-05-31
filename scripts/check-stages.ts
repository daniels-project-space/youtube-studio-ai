/**
 * Read back runStages + run status from Convex for a given runId. Used after a
 * Trigger e2e run to prove the task wrote stages to Convex.
 *
 * Usage: NEXT_PUBLIC_CONVEX_URL=… npx tsx scripts/check-stages.ts <runId>
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) throw new Error("usage: check-stages.ts <runId>");
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

  const run = await convex.query(api.runs.getRun, { runId: runId as Id<"runs"> });
  const stages = await convex.query(api.runStages.listRunStages, {
    runId: runId as Id<"runs">,
  });
  console.log(JSON.stringify({ run, stages }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
