import { schedules } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import {
  buildWeeklyOperationsDigest,
  previousUtcWeekWindow,
} from "@/lib/automaticOperations";
import { studioAutomationGate, STUDIO_AUTOMATION_GATES } from "@/lib/automationGate";

const automaticOperationsDigestsApi = (api as unknown as {
  readonly automaticOperationsDigests: { readonly record: never };
}).automaticOperationsDigests;

/** Snapshot the completed UTC week without making provider calls or changing runs. */
export const weeklyOperationsDigestSchedule = schedules.task({
  id: "weekly-operations-digest",
  cron: "15 6 * * 1",
  run: async () => {
    const gate = studioAutomationGate(STUDIO_AUTOMATION_GATES.autopilot);
    if (!gate.enabled) return { skipped: true, reason: "STUDIO_AUTOPILOT is not on" };
    await bootstrapSecrets(() => undefined);
    const ownerId = process.env.STUDIO_OWNER_ID ?? "owner_daniel";
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("weekly operations digest: NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new StudioConvexHttpClient(url);
    const { weekStart, weekEnd } = previousUtcWeekWindow(Date.now());
    const recent = await convex.query(api.runs.listRecent, { ownerId, limit: 200 });
    const runs = recent.filter((run) => (run.startedAt ?? 0) >= weekStart && (run.startedAt ?? 0) <= weekEnd);
    const digest = buildWeeklyOperationsDigest({ weekStart, weekEnd, runs });
    const receipt = await convex.mutation(automaticOperationsDigestsApi.record, {
      ownerId,
      weekStart,
      weekEnd,
      fingerprint: digest.fingerprint,
      digest,
      createdAt: Date.now(),
    } as never) as { reused: boolean };
    return { ok: true, weekStart, weekEnd, fingerprint: digest.fingerprint, reused: receipt.reused };
  },
});
