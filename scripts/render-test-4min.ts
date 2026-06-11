/**
 * Short (~4 min) TEST render of The Quiet Stoic to eyeball the new chapter cards
 * + pacing (slower quote blur, "Chapter N:" read-out with 3s pre/post fade, +0.5s
 * sentence gaps). Uses run-pipeline's pipelineOverride so the channel's real
 * 15-35 min config is NEVER touched. Produces a private YouTube draft (deletable).
 */
import { ConvexHttpClient } from "convex/browser";
import { tasks, configure } from "@trigger.dev/sdk";
import { api } from "../convex/_generated/api";
import type { PipelineEntry } from "@/engine/types";

async function main() {
  const c = new ConvexHttpClient("https://astute-camel-689.convex.cloud");
  configure({ secretKey: process.env.TRIGGER_SECRET_KEY! });
  const chans = (await c.query(api.channels.listChannels, { ownerId: "owner_daniel" })) as any[];
  const ch = chans.find((x) => /quiet stoic/i.test(x.name));
  if (!ch) throw new Error("Quiet Stoic channel not found");

  // One-off short override: ~4-min script + widened length gate. Everything else
  // (chapter cards, quote overlays, 15s outro, qa_refine) stays as configured.
  const targetSec = Number(process.argv[2] ?? 240); // e.g. `npx tsx scripts/render-test-4min.ts 180`
  const pipelineOverride = (ch.pipeline as PipelineEntry[]).map((e) => {
    if (e.block === "script_gen") return { ...e, params: { ...(e.params || {}), maxSeconds: targetSec } };
    if (e.block === "length_check") return { ...e, params: { ...(e.params || {}), minSeconds: Math.round(targetSec * 0.6), maxSeconds: targetSec * 2.5 } };
    return e;
  });

  const runId = await c.mutation(api.runs.createRun, {
    ownerId: "owner_daniel",
    channelId: ch._id,
    status: "running",
  });
  const h = await tasks.trigger("run-pipeline", { channelId: ch._id, runId, pipelineOverride });
  console.log(JSON.stringify({ runId, handle: h.id }));
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
