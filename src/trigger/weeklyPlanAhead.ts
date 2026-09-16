import { idempotencyKeys, schedules, tasks } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import { STUDIO_AUTOMATION_GATES, studioAutomationGate } from "@/lib/automationGate";
import {
  chunkWeeklyPlanChannels,
  currentUtcWeekStart,
  parseWeeklyPlanCount,
} from "@/lib/weeklyPlanAhead";

type ChannelRow = { _id: string; slug: string; status?: string };

function allowedChannel(channel: ChannelRow, allow: readonly string[]): boolean {
  return allow.length === 0 || allow.includes(channel.slug) || allow.includes(channel._id);
}

/** Automatically freeze the next weekly slate before cadence runs need it. */
export const weeklyPlanAheadSchedule = schedules.task({
  id: "weekly-plan-ahead",
  cron: "0 5 * * 1",
  run: async () => {
    const gate = studioAutomationGate(STUDIO_AUTOMATION_GATES.autopilot);
    if (!gate.enabled) return { skipped: true, reason: "STUDIO_AUTOPILOT is not on" };
    await bootstrapSecrets(() => undefined);
    const ownerId = process.env.STUDIO_OWNER_ID ?? "owner_daniel";
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("weekly plan-ahead: NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new StudioConvexHttpClient(url);
    const allow = (process.env.STUDIO_AUTO_CHANNELS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const channels = await convex.query(api.channels.listChannels, { ownerId }) as ChannelRow[];
    const eligible = channels.filter((channel) => channel.status === "active" && allowedChannel(channel, allow));
    const chunks = chunkWeeklyPlanChannels(eligible.map((channel) => channel._id));
    const count = parseWeeklyPlanCount(process.env.STUDIO_WEEKLY_PLAN_COUNT);
    const weekStart = currentUtcWeekStart(Date.now());
    const children: Array<{ chunk: number; triggerRunId: string; channelCount: number }> = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const channelIds = chunks[index]!;
      const requestKey = `automatic-week:${weekStart}:batch:${index + 1}`;
      const idempotencyKey = await idempotencyKeys.create(`weekly-plan-ahead:${ownerId}:${requestKey}`, { scope: "global" });
      const handle = await tasks.trigger("plan-week-bulk", {
        ownerId,
        channelIds,
        count,
        requestKey,
      }, {
        concurrencyKey: `weekly-plan-ahead:${ownerId}`,
        idempotencyKey,
      });
      children.push({ chunk: index + 1, triggerRunId: handle.id, channelCount: channelIds.length });
    }
    return { ok: true, weekStart, count, eligibleChannels: eligible.length, children };
  },
});
