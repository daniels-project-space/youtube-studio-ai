import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const c = new ConvexHttpClient("https://astute-camel-689.convex.cloud");
  const rid = process.argv[2];
  if (!rid) throw new Error("usage: watch.ts <runId> [iterations] [intervalMs]");
  const runId = rid as Id<"runs">;
  const iters = Number(process.argv[3] || 80);
  const everyMs = Number(process.argv[4] || 20000);
  for (let i = 0; i < iters; i++) {
    try {
      const run = await c.query(api.runs.getRun, { runId });
      const stages = await c.query(api.runStages.listRunStages, { runId });
      const last = stages.at(-1);
      console.log(`${new Date().toISOString().slice(11, 19)} status=${run?.status} last=${last?.block}:${last?.status}`);
      if (run?.status && run.status !== "running") {
        console.log(`DONE status=${run.status}`);
        console.log(`blocks: ${stages.map((stage) => `${stage.block}:${stage.status}`).join(" ")}`);
        if (run.error) console.log(`ERROR: ${run.error}`);
        return;
      }
    } catch (error) {
      console.log(`poll err: ${error instanceof Error ? error.message : error}`);
    }
    await sleep(everyMs);
  }
  console.log("TIMEOUT still running");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
