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

type WeeklyPlanDispatchMode = "scheduled" | "recovery";

/**
 * Freeze (or re-dispatch) the next weekly slate. The Convex request key is
 * intentionally stable for the UTC week, so recovery can safely replay a
 * failed Trigger delivery without reserving a second week or buying a second
 * thumbnail. The Trigger idempotency key includes the bounded recovery slot
 * so a genuinely failed parent task can be admitted again.
 */
async function dispatchWeeklyPlanAhead(mode: WeeklyPlanDispatchMode, now = Date.now()) {
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
    const weekStart = currentUtcWeekStart(now);
    const recoverySlot = Math.floor(now / (6 * 60 * 60 * 1_000));
    const children: Array<{ chunk: number; triggerRunId: string; channelCount: number }> = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const channelIds = chunks[index]!;
      const requestKey = `automatic-week:${weekStart}:batch:${index + 1}`;
      if (mode === "recovery") {
        const existing = await convex.query(api.planWeekBulkOrders.getByRequestKey, {
          ownerId,
          requestKey,
        });
        const childStates = Array.isArray(existing?.children)
          ? existing.children.map((child) => String(child.status))
          : [];
        const needsRecovery = !existing || existing.status === "failed" ||
          childStates.length === 0 || childStates.some((status) => status === "pending" || status === "failed");
        if (!needsRecovery) continue;
      }
      const idempotencyKey = await idempotencyKeys.create(
        `weekly-plan-ahead:${mode}:${ownerId}:${requestKey}:${mode === "recovery" ? recoverySlot : "scheduled"}`,
        { scope: "global" },
      );
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
}

/** Automatically freeze the next weekly slate before cadence runs need it. */
export const weeklyPlanAheadSchedule = schedules.task({
  id: "weekly-plan-ahead",
  cron: "0 5 * * 1",
  run: async () => await dispatchWeeklyPlanAhead("scheduled"),
});

/**
 * Bounded unattended recovery for a missed Monday or failed parent/child
 * handoff. It runs every six hours, reuses the exact owner/week order, and
 * therefore remains storage/idempotency work until the original order needs
 * a retry. It never widens the channel allow-list or the weekly reservation.
 */
export const weeklyPlanAheadRecoverySchedule = schedules.task({
  id: "weekly-plan-ahead-recovery",
  cron: "0 */6 * * *",
  run: async () => await dispatchWeeklyPlanAhead("recovery"),
});
