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
  casefileAutoResearchRouteAdmission,
  dispatchCasefileAutoResearch,
  parseCasefileAutoResearchDailyLimit,
} from "@/engine/casefileAutoResearchDispatch";
import { resolveContentLane } from "@/engine/contentLane";
import { sourceDataStorySchedulerAdmission } from "@/engine/dataStorySchedulerAdmission";
import { automaticCreatorBriefAdmission } from "@/engine/automaticCreatorBriefAdmission";
import { automaticFamilyExecutionReadinessAdmission } from "@/engine/automaticFamilyExecutionReadiness";
import {
  productionRouteQualificationReceiptAdmission,
  productionRouteQualificationRequirement,
} from "@/engine/productionRouteQualificationAdmission";
import {
  admitNarrativeSeriesSchedulerRun,
  narrativeSeriesSchedulerRequirement,
} from "@/engine/narrativeSeriesSchedulerAdmission";

// Keep the fresh Convex module boundary narrow until the normal generated API
// declaration refresh. This is a read-only current-head lookup; the scheduler
// never writes a qualification, creates a route, or dispatches a benchmark.
const productionRouteQualificationStateApi = (api as unknown as {
  readonly productionRouteQualificationState: {
    readonly getCurrentRouteQualificationReceipt: never;
  };
}).productionRouteQualificationState;

const narrativeSeriesStateApi = (api as unknown as {
  readonly narrativeSeriesState: {
    readonly getSeriesPlan: never;
  };
}).narrativeSeriesState;

interface ChannelRow {
  _id: Id<"channels">;
  name: string;
  slug: string;
  status?: string;
  identity?: {
    cadence?: string;
    niche?: string;
    programBrief?: unknown;
    programRoute?: unknown;
    showProfile?: unknown;
    productionRouteQualificationRequirement?: unknown;
  };
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
    let bootstrapped = false;
    const ensureSchedulerBootstrap = async () => {
      if (bootstrapped) return;
      await bootstrapSecrets((m) => console.log(`[scheduler] ${m}`));
      bootstrapped = true;
    };
    for (const ch of channels) {
      const isOn = ch.status === "active" && (allow.length === 0 || allow.includes(ch.slug) || allow.includes(ch._id));
      if (!isOn) continue;
      enabled++;

      // Source-attributed Data Story is intentionally supervised while its
      // automation admission is false. This happens before credentials,
      // content-plan leasing, Casefile research, or Trigger dispatch so a
      // cadence tick cannot turn a missing reviewed pack into a failed plan.
      const dataStoryAdmission = sourceDataStorySchedulerAdmission({
        identity: ch.identity,
        contentLane: ch.contentLane,
        family: ch.family,
        pipeline: ch.pipeline,
      });
      if (!dataStoryAdmission.automatic) {
        console.log(
          `[scheduler] ${ch.name}: Source-attributed Data Story skipped without bootstrap, ` +
            `plan claim, provider work, or failure mutation — ${dataStoryAdmission.reason}`,
        );
        continue;
      }

      // Fresh creation rechecks this same Brief preflight, but active channels
      // may predate a new source/supervision rule. Stop such rows before
      // credentials, calendar-plan leasing, or any provider-capable path.
      const creatorBriefAdmission = automaticCreatorBriefAdmission({
        family: ch.family,
        identity: ch.identity,
      });
      if (!creatorBriefAdmission.automatic) {
        console.log(
          `[scheduler] ${ch.name}: creator Brief manual gate; ` +
            `skipping without bootstrap, plan claim, provider work, or failure mutation — ` +
            creatorBriefAdmission.reason,
        );
        continue;
      }

      // Shared-unlock families and explicitly marked new routes are held at a
      // receipt-only manual gate until their exact immutable binding has a
      // current release qualification. This runs before bootstrap, plan
      // leasing, Casefile research, or Trigger dispatch. The five existing
      // catalog-certified automatic families retain their historical cadence
      // unless an explicit versioned marker opts them into this new gate.
      const routeQualificationRequirement = productionRouteQualificationRequirement({
        path: "normal_cadence",
        identity: ch.identity,
        contentLane: ch.contentLane,
        family: ch.family,
        pipeline: ch.pipeline,
      });
      let routeQualificationAdmission = productionRouteQualificationReceiptAdmission({
        requirement: routeQualificationRequirement,
        row: null,
        ownerId: owner,
        channelId: String(ch._id),
      });
      if (routeQualificationRequirement.requiresReceipt && routeQualificationRequirement.binding) {
        try {
          const row = await convex.query(
            productionRouteQualificationStateApi.getCurrentRouteQualificationReceipt,
            {
              ownerId: owner,
              channelId: ch._id,
              level: routeQualificationRequirement.level,
              bindingFingerprint: routeQualificationRequirement.binding.bindingFingerprint,
            } as never,
          );
          routeQualificationAdmission = productionRouteQualificationReceiptAdmission({
            requirement: routeQualificationRequirement,
            row,
            ownerId: owner,
            channelId: String(ch._id),
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.log(
            `[scheduler] ${ch.name}: production-route qualification receipt could not be read; ` +
              `skipping without bootstrap, plan claim, provider work, or failure mutation — ${detail}`,
          );
          continue;
        }
      }
      if (!routeQualificationAdmission.automatic) {
        console.log(
          `[scheduler] ${ch.name}: production-route qualification manual gate; ` +
            `skipping without bootstrap, plan claim, provider work, or failure mutation — ` +
            routeQualificationAdmission.reason,
        );
        continue;
      }

      // Serialized programs do not consume generic calendar topics. Inception
      // stored a bounded, research-grounded horizon; reload it owner-scoped and
      // derive its compact route selector before a cadence run is claimed.
      // Missing/stale data is a manual gate, never a fallback to generic topic
      // planning or a provider-capable run.
      const narrativeRequirement = narrativeSeriesSchedulerRequirement({
        ownerId: owner,
        channelId: String(ch._id),
        identity: ch.identity,
      });
      let narrativeSeriesSelector: unknown;
      if (narrativeRequirement.status === "blocked") {
        console.log(
          `[scheduler] ${ch.name}: narrative series manual gate; ` +
            `skipping without bootstrap, plan claim, provider work, or failure mutation — ` +
            narrativeRequirement.reason,
        );
        continue;
      }
      if (narrativeRequirement.status === "plan_required") {
        try {
          const row = await convex.query(narrativeSeriesStateApi.getSeriesPlan, {
            ownerId: owner,
            channelId: ch._id,
            fingerprint: narrativeRequirement.planFingerprint,
          } as never) as { plan?: unknown } | null;
          const admission = admitNarrativeSeriesSchedulerRun({
            requirement: narrativeRequirement,
            plan: row?.plan,
          });
          if (admission.status !== "eligible") {
            console.log(
              `[scheduler] ${ch.name}: narrative series manual gate; ` +
                `skipping without bootstrap, plan claim, provider work, or failure mutation — ` +
                (admission.status === "blocked"
                  ? admission.reason
                  : "serialized-plan admission unexpectedly became non-serialized"),
            );
            continue;
          }
          narrativeSeriesSelector = admission.selector;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.log(
            `[scheduler] ${ch.name}: narrative series plan could not be read; ` +
              `skipping without bootstrap, plan claim, provider work, or failure mutation — ${detail}`,
          );
          continue;
        }
      }

      await ensureSchedulerBootstrap();

      // Channel setup may have succeeded with a different provider state. A
      // cadence run must re-check the now-hydrated live stack before claiming
      // a plan or reaching any provider-capable path.
      const automaticRuntimeAdmission = automaticFamilyExecutionReadinessAdmission(ch.family);
      if (!automaticRuntimeAdmission.automatic) {
        console.log(
          `[scheduler] ${ch.name}: automatic execution stack manual gate; ` +
            `skipping without plan claim, provider work, or failure mutation — ` +
            automaticRuntimeAdmission.reason,
        );
        continue;
      }

      // This is the only path that spends before run-pipeline has frozen an
      // invocation. Check immutable route/profile admission before even
      // leasing a plan slot, let alone ledgering or starting Browserbase/LLM
      // case research. Today no Program Route opts into autonomous Casefile
      // research, so private-review Casefile channels stop here cleanly.
      if (ch.casefileAutoResearchEnabled === true) {
        const routeAdmission = casefileAutoResearchRouteAdmission({
          identity: ch.identity,
          contentLane: ch.contentLane,
          family: ch.family,
          pipeline: ch.pipeline,
        });
        if (!routeAdmission.eligible) {
          console.log(
            `[scheduler] ${ch.name}: Casefile auto-research skipped without spending — ${routeAdmission.reason}`,
          );
          continue;
        }
      }

      const admitted = await convex.mutation(api.contentPlan.claimNextPlanRun, {
        ownerId: owner,
        channelId: ch._id,
        dueBefore: Date.now() + leadMs,
        ...(narrativeSeriesSelector === undefined ? {} : { narrativeSeriesSelector }),
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
        // called for an ordinary channel. Immutable route/profile admission
        // happened before the run lease above; the dispatch repeats its lane
        // gate and atomically CLAIMS the fleet-wide daily spend slot before
        // any billable call.
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
            claimResearchAttempt: async (channelId, limit) =>
              await convex.mutation(api.casefileResearchAttempts.claimAttemptUnderDailyCap, {
                ownerId: owner,
                channelId: channelId as Id<"channels">,
                day: casefileResearchDay,
                limit,
              }),
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
                  ...(narrativeSeriesSelector === undefined ? {} : { narrativeSeriesSelector }),
                  casefileSourcePacketInput,
                },
                { concurrencyKey: String(ch._id), idempotencyKey },
              );
            },
            log: (message) => console.log(`[scheduler] ${message}`),
          },
        );
        if (dispatched.outcome !== "researched_and_triggered") {
          // Every non-success outcome is expected/normal and never gets a
          // tight retry or a fallback to unrelated content. For a scheduled
          // plan, persist the outcome before returning: failures get only a
          // finite requeue budget and a queued plan that ages out becomes
          // visibly manual-required rather than silently reattaching forever.
          //
          // Outcomes:
          //  - research_failed        researchCase()'s fail-closed design —
          //                           no real, well-sourced case converged.
          //  - daily_ceiling_reached  the fleet-wide spend guard did its job.
          //  - ineligible             lane gate rejected an opted-in channel.
          const detail = dispatched.outcome === "daily_ceiling_reached"
            ? `daily research ceiling reached (${dispatched.attemptsToday}/${dispatched.limit})`
            : dispatched.outcome === "ineligible"
              ? "channel is opted in but not on the cinematic_ai lane"
              : "found no admissible case this cycle";
          if (scheduledPlan) {
            try {
              const deferral = await convex.mutation(api.contentPlan.recordCasefileResearchDeferral, {
                ownerId: owner,
                channelId: ch._id,
                itemId: scheduledPlan.planItemId as Id<"contentPlan">,
                runId: runId as Id<"runs">,
                outcome: dispatched.outcome,
                reason: detail,
              });
              if (deferral.state === "blocked") {
                console.error(`[scheduler] ${ch.name}: Casefile auto-research stopped — ${deferral.reason}`);
                continue;
              }
            } catch (error) {
              // Do not throw after a fail-closed research result: a Trigger
              // retry could immediately buy another attempt. The daily claim
              // has already recorded any spend; leave the queued plan intact
              // and surface the durable-write outage for the next cron.
              console.error(
                `[scheduler] ${ch.name}: could not persist Casefile research deferral; ` +
                  `not retrying in this scheduler invocation: ${error instanceof Error ? error.message : String(error)}`,
              );
              continue;
            }
          }
          console.log(`[scheduler] ${ch.name}: Casefile auto-research skipped — ${detail}`);
          continue;
        }
        // "researched_and_triggered" falls through to the shared
        // recoveryDispatch/triggered bookkeeping below.
      } else {
        // concurrencyKey: one render at a time PER CHANNEL; channels in parallel.
        await tasks.trigger(
          "run-pipeline",
          {
            channelId: ch._id,
            runId,
            ...(scheduledPlan ? { scheduledPlan } : {}),
            ...(narrativeSeriesSelector === undefined ? {} : { narrativeSeriesSelector }),
          },
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
