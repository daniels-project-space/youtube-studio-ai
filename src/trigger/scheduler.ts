/**
 * `generation-scheduler` (Phase 6) — the spine of autonomous operation. On a
 * cron, it triggers a new video run for each ACTIVE, opted-in channel that is
 * due per its cadence (daily/weekly/biweekly/monthly).
 *
 * OPT-IN by design (no surprise auto-spend): a channel only auto-runs if its
 * slug or id is listed in the STUDIO_AUTO_CHANNELS env var (comma-separated).
 * Empty list → the scheduler does nothing. Set it on the Trigger env when ready.
 *
 * Publish behaviour is per-channel via the upload_draft `publishMode` param
 * (draft|scheduled|public) — this scheduler only kicks off GENERATION.
 */
import { schedules, tasks } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";

const DAY = 86_400_000;
function cadenceMs(c?: string): number {
  switch (c) {
    case "daily":
      return DAY;
    case "biweekly":
      return 14 * DAY;
    case "monthly":
      return 30 * DAY;
    case "weekly":
    default:
      return 7 * DAY;
  }
}

interface ChannelRow {
  _id: Id<"channels">;
  name: string;
  slug: string;
  status?: string;
  identity?: { cadence?: string };
}
interface RunRow {
  status?: string;
  startedAt?: number;
}

export const generationScheduler = schedules.task({
  id: "generation-scheduler",
  // Every 6h; the per-channel cadence + due-check decides what actually fires.
  cron: "0 */6 * * *",
  run: async () => {
    await bootstrapSecrets((m) => console.log(`[scheduler] ${m}`));
    const owner = process.env.STUDIO_OWNER_ID ?? "owner_daniel";
    const allow = (process.env.STUDIO_AUTO_CHANNELS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allow.length === 0) {
      console.log("[scheduler] STUDIO_AUTO_CHANNELS empty — auto-run disabled (opt-in). Nothing to do.");
      return { triggered: 0, enabled: 0 };
    }
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const channels = (await convex.query(api.channels.listChannels, {
      ownerId: owner,
    })) as ChannelRow[];
    let triggered = 0;
    let enabled = 0;
    for (const ch of channels) {
      const isOn = ch.status === "active" && (allow.includes(ch.slug) || allow.includes(ch._id));
      if (!isOn) continue;
      enabled++;

      const runs = (await convex.query(api.runs.listRunsByChannel, {
        channelId: ch._id,
      })) as RunRow[];
      if (runs.some((r) => r.status === "queued" || r.status === "running")) {
        console.log(`[scheduler] ${ch.name}: a run is already in progress — skip`);
        continue;
      }
      const last = runs.reduce((m, r) => Math.max(m, r.startedAt ?? 0), 0);
      const interval = cadenceMs(ch.identity?.cadence);
      // Due if never run, or at least (interval - 1h slack for the 6h cron grain).
      if (last && Date.now() - last < interval - 3_600_000) continue;

      const runId = await convex.mutation(api.runs.createRun, {
        ownerId: owner,
        channelId: ch._id,
      });
      await tasks.trigger("run-pipeline", { channelId: ch._id, runId });
      triggered++;
      console.log(`[scheduler] triggered run for "${ch.name}" (cadence=${ch.identity?.cadence ?? "weekly"})`);
    }
    console.log(`[scheduler] done — ${enabled} enabled, ${triggered} run(s) triggered`);
    return { triggered, enabled };
  },
});
