/**
 * Trigger end-to-end driver: create a channel+run in Convex, then trigger the
 * `run-pipeline` task in the (already-running) `trigger.dev dev` worker. Prints
 * the run handle id; the dev worker executes the task, which drives the engine
 * runner + Convex sink. Evidence is then read back via scripts/check-stages.ts.
 *
 * Requires: NEXT_PUBLIC_CONVEX_URL + TRIGGER_SECRET_KEY (dev) in env, and a
 * `trigger.dev dev` worker running for the same project.
 */
import { ConvexHttpClient } from "convex/browser";
import { tasks } from "@trigger.dev/sdk";
import { api } from "../convex/_generated/api";

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL!;
  const convex = new ConvexHttpClient(url);
  const ownerId = "owner_trigger_e2e";

  const channelId = await convex.mutation(api.channels.createChannel, {
    ownerId,
    slug: `trig-${Date.now()}`,
    name: "Trigger E2E Channel",
    identity: {
      persona: "lofi",
      bannedWords: [],
      requiredCallbacks: [],
      styleGrammar: "warm grain",
      palette: ["#101018"],
      thumbnailTemplate: "default",
      topicPool: ["focus beats"],
      cadence: "daily",
    },
    template: "C",
    pipeline: [
      { block: "echo_seed", params: { topic: "trigger-e2e-topic" } },
      { block: "echo_sink" },
    ],
    budget: 1,
    status: "active",
  });
  const runId = await convex.mutation(api.runs.createRun, { ownerId, channelId });

  const handle = await tasks.trigger("run-pipeline", { channelId, runId });
  console.log(
    JSON.stringify({ channelId, runId, handleId: handle.id }, null, 2),
  );
}

main().catch((e) => {
  console.error("TRIGGER E2E DRIVER FAILED:", e);
  process.exit(1);
});
