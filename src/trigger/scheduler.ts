/**
 * `generation-scheduler` (Phase 6) — the spine of autonomous operation. On a
 * cron, it triggers a new video run for each ACTIVE, opted-in channel that is
 * due per its cadence (daily/weekly/biweekly/monthly).
 *
 * CONTROL = the channel's ACTIVE toggle (no surprise auto-spend): new channels are
 * created "paused", so the scheduler ignores them until the operator flips them on.
 * Safety valves: only STUDIO_AUTOPILOT="on" enables scheduled generation; if
 * STUDIO_AUTO_CHANNELS is set (comma-separated slugs/ids) it acts as an extra
 * allow-LIST filter, but when empty ALL active channels are eligible (the toggle is
 * the control). Uploads are PRIVATE-first via the upload_draft `publishMode` param
 * (draft|scheduled|public) — this scheduler only kicks off GENERATION.
 */
import { idempotencyKeys, schedules, tasks } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  STUDIO_AUTOMATION_GATES,
  studioAutomationGate,
} from "@/lib/automationGate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import type { ChannelSchedulePolicy } from "@/lib/publishingPolicy";
import { parsePlanGenerationLeadMs } from "@/lib/scheduledPlanRuntime";

interface ChannelRow {
  _id: Id<"channels">;
  name: string;
  slug: string;
  status?: string;
  identity?: { cadence?: string };
  schedule?: ChannelSchedulePolicy;
}
export const generationScheduler = schedules.task({
  id: "generation-scheduler",
  // Every 6h; the per-channel cadence + due-check decides what actually fires.
  cron: "0 */6 * * *",
  run: async () => {
    const gate = studioAutomationGate(STUDIO_AUTOMATION_GATES.autopilot);
    if (!gate.enabled) return gate;

    await bootstrapSecrets((m) => console.log(`[scheduler] ${m}`));
    const owner = process.env.STUDIO_OWNER_ID ?? "owner_daniel";
    // Optional extra allow-list FILTER. Empty → every active channel is eligible
    // (the per-channel Active toggle is the real control).
    const allow = (process.env.STUDIO_AUTO_CHANNELS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const channels = (await convex.query(api.channels.listChannels, {
      ownerId: owner,
    })) as ChannelRow[];
    const leadMs = parsePlanGenerationLeadMs(process.env.STUDIO_PLAN_GENERATION_LEAD_HOURS);
    let triggered = 0;
    let enabled = 0;
    for (const ch of channels) {
      const isOn = ch.status === "active" && (allow.length === 0 || allow.includes(ch.slug) || allow.includes(ch._id));
      if (!isOn) continue;
      enabled++;

      const admitted = await convex.mutation(api.contentPlan.claimNextPlanRun, {
        ownerId: owner,
        channelId: ch._id,
        dueBefore: Date.now() + leadMs,
      });
      if (admitted.state === "busy" || admitted.state === "disabled" || admitted.state === "not_due") {
        continue;
      }
      if (admitted.state === "blocked") {
        console.error(
          `[scheduler] ${ch.name}: ${admitted.reason} — ` +
            (admitted.runId ? "manual same-run recovery required" : "manual plan repair required"),
        );
        continue;
      }
      if (admitted.state === "finalized") {
        console.log(`[scheduler] ${ch.name}: repaired completed plan item ${admitted.planItemId}`);
        continue;
      }

      const runId = admitted.runId;
      const scheduledPlan = admitted.state === "claimed"
        ? {
            planItemId: String(admitted.planItemId),
            topic: admitted.topic,
            title: admitted.title,
            thumbnailKey: admitted.thumbnailKey,
            ...(admitted.scheduledAt !== undefined ? { scheduledAt: admitted.scheduledAt } : {}),
          }
        : undefined;
      const idempotencyKey = await idempotencyKeys.create(`generation-scheduler:${runId}`);
      // concurrencyKey: one render at a time PER CHANNEL; channels in parallel.
      await tasks.trigger(
        "run-pipeline",
        { channelId: ch._id, runId, ...(scheduledPlan ? { scheduledPlan } : {}) },
        { concurrencyKey: String(ch._id), idempotencyKey },
      );
      triggered++;
      console.log(
        `[scheduler] ${admitted.reused ? "reattached" : "triggered"} ${scheduledPlan ? `plan ${scheduledPlan.planItemId}` : "cadence run"} ` +
          `for "${ch.name}" (lead=${Math.round(leadMs / 3_600_000)}h)`,
      );
    }
    console.log(`[scheduler] done — ${enabled} enabled, ${triggered} run(s) triggered`);
    return { triggered, enabled };
  },
});
