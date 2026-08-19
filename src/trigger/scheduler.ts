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
import { researchCase } from "@/engine/casefileCaseResearcher";
import {
  casefileResearchDayKey,
  dispatchCasefileAutoResearch,
  parseCasefileAutoResearchDailyLimit,
} from "@/engine/casefileAutoResearchDispatch";
import { resolveContentLane } from "@/engine/contentLane";

interface ChannelRow {
  _id: Id<"channels">;
  name: string;
  slug: string;
  status?: string;
  identity?: { cadence?: string; niche?: string };
  schedule?: ChannelSchedulePolicy;
  // Strictly opt-in signal for the automatic Casefile real-case research
  // path (see casefileAutoResearchDispatch.ts). Unset/false = unchanged
  // behavior for every existing channel, including cinematic_ai ones.
  casefileAutoResearchEnabled?: boolean;
  // Needed only to re-resolve the durable content lane for the Casefile
  // spend gate; the pipeline itself is resolved inside run-pipeline.
  contentLane?: unknown;
  family?: unknown;
  pipeline?: unknown;
}

/**
 * Resolve a channel's durable lane defensively. A row whose lane cannot be
 * resolved is reported as an unknown key, which the Casefile dispatch treats
 * as ineligible — never as "assume cinematic_ai".
 */
function channelLaneKey(ch: ChannelRow): string {
  try {
    return resolveContentLane({
      stored: ch.contentLane,
      family: ch.family,
      pipeline: Array.isArray(ch.pipeline) ? ch.pipeline : [],
    }).key;
  } catch {
    return "unresolved";
  }
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
    // Fleet-wide daily ceiling for the one spend path that runs BEFORE
    // run-pipeline (and therefore outside invocation.budgetUsd). Parsed once
    // per cycle; a malformed value throws here rather than being ignored.
    const casefileResearchLimit = parseCasefileAutoResearchDailyLimit(
      process.env.STUDIO_CASEFILE_RESEARCH_MAX_ATTEMPTS_PER_DAY,
    );
    const casefileResearchDay = casefileResearchDayKey();
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

      if (ch.casefileAutoResearchEnabled === true) {
        // Strictly opt-in per channel: only channels with the flag set ever
        // reach dispatchCasefileAutoResearch, so researchCase() is never
        // called for an ordinary channel. The lane gate and the fleet-wide
        // daily ceiling are both enforced inside the dispatch, before any
        // billable call.
        const dispatched = await dispatchCasefileAutoResearch(
          {
            channelId: String(ch._id),
            channelName: ch.name,
            niche: ch.identity?.niche,
            casefileAutoResearchEnabled: true,
            contentLaneKey: channelLaneKey(ch),
          },
          {
            researchCase,
            maxResearchAttemptsPerDay: casefileResearchLimit,
            countResearchAttemptsToday: async () =>
              (await convex.query(api.casefileResearchAttempts.countForDay, {
                ownerId: owner,
                day: casefileResearchDay,
              })) as number,
            recordResearchAttempt: async (channelId) => {
              await convex.mutation(api.casefileResearchAttempts.recordAttempt, {
                ownerId: owner,
                channelId: channelId as Id<"channels">,
                day: casefileResearchDay,
              });
            },
            listExcludedCaseIds: async (channelId) => {
              const rows = (await convex.query(api.topicMemory.listForChannel, {
                channelId: channelId as Id<"channels">,
              })) as Array<{ key: string }>;
              return rows.map((row) => row.key);
            },
            recordCaseId: async (channelId, caseId) => {
              await convex.mutation(api.topicMemory.recordTopic, {
                ownerId: owner,
                channelId: channelId as Id<"channels">,
                key: caseId,
              });
            },
            triggerPipeline: async ({ casefileSourcePacketInput }) => {
              // concurrencyKey: one render at a time PER CHANNEL; channels in parallel.
              await tasks.trigger(
                "run-pipeline",
                {
                  channelId: ch._id,
                  runId,
                  ...(scheduledPlan ? { scheduledPlan } : {}),
                  casefileSourcePacketInput,
                },
                { concurrencyKey: String(ch._id), idempotencyKey },
              );
            },
            log: (message) => console.log(`[scheduler] ${message}`),
          },
        );
        if (dispatched.outcome !== "researched_and_triggered") {
          // Every non-success outcome is expected/normal and NEVER alertable:
          //  - research_failed        researchCase()'s fail-closed design —
          //                           no real, well-sourced case converged.
          //  - daily_ceiling_reached  the fleet-wide spend guard did its job.
          //  - ineligible             lane gate rejected an opted-in channel.
          // In all three the already-claimed run/plan slot is left exactly
          // as-is; it stays "queued" and claimNextPlanRun safely reattaches
          // to it on the NEXT due cycle (bounded by the 6h cron — no tight
          // retry, and no fallback to non-Casefile content).
          const detail = dispatched.outcome === "daily_ceiling_reached"
            ? `daily research ceiling reached (${dispatched.attemptsToday}/${dispatched.limit})`
            : dispatched.outcome === "ineligible"
              ? "channel is opted in but not on the cinematic_ai lane"
              : "found no admissible case this cycle";
          console.log(`[scheduler] ${ch.name}: Casefile auto-research skipped — ${detail}`);
          continue;
        }
        // "researched_and_triggered" falls through to the shared
        // recoveryDispatch/triggered bookkeeping below.
      } else {
        // concurrencyKey: one render at a time PER CHANNEL; channels in parallel.
        await tasks.trigger(
          "run-pipeline",
          { channelId: ch._id, runId, ...(scheduledPlan ? { scheduledPlan } : {}) },
          { concurrencyKey: String(ch._id), idempotencyKey },
        );
      }
      if ("recoveryDispatch" in admitted && admitted.recoveryDispatch === true) {
        await convex.mutation(api.runs.markLeaseRecoveryDispatched, {
          ownerId: owner,
          channelId: ch._id,
          runId,
        });
      }
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
