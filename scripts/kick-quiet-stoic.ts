import { ConvexHttpClient } from "convex/browser";
import { tasks, configure } from "@trigger.dev/sdk";
import { api } from "../convex/_generated/api";

async function main() {
  const url = "https://astute-camel-689.convex.cloud";
  const convex = new ConvexHttpClient(url);
  configure({ secretKey: process.env.TRIGGER_SECRET_KEY! });
  const chans = (await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" })) as Array<any>;
  const ch = chans.find((c) => /quiet stoic/i.test(c.name));
  if (!ch) throw new Error("Quiet Stoic channel not found");
  const channelId = ch._id;
  const runId = await convex.mutation(api.runs.createRun, { ownerId: "owner_daniel", channelId, status: "running" });
  const handle = await tasks.trigger("run-pipeline", { channelId, runId });
  console.log(JSON.stringify({ channelId, runId, handleId: handle.id }));
}
main().catch((e) => { console.error("KICK FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
