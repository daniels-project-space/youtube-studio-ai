/**
 * `title-ctr-swap` — native-test proposal half of the title loop.
 *
 * Metacraft has always produced a runner-up title, judged it, stored it in
 * `titleAlternate` and then never used it. This finds published videos whose
 * click-through trails their own channel and prepares the runner-up for a
 * native YouTube Studio test. It never renames a video itself: a sequential
 * rename is not a concurrent test and our ledger does not contain YouTube's
 * watch-time-share verdict.
 *
 * WHY THIS DOES NOT WRITE WHERE seoReoptimize IS NOT.
 * Raw impressions and a freshness boundary are useful for identifying a
 * candidate worth testing. They do NOT turn two different time windows into a
 * controlled A/B test. YouTube's native test is concurrent and selects by
 * watch-time share, neither of which is represented in this ledger. The task
 * consequently emits an inspectable proposal for the owner to start in desktop
 * YouTube Studio and refuses to call `videos.update`.
 *
 * The owner can still make an intentional manual metadata edit in YouTube
 * Studio, but this worker will not mislabel that edit as an experiment. Native
 * test-result ingestion remains a separate unfinished connector surface.
 */
import { schedules, task } from "@trigger.dev/sdk";

import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { STUDIO_AUTOMATION_GATES, studioAutomationGate } from "@/lib/automationGate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { channelPrefix } from "@/lib/storage";
import { loadLedger, saveLedger, type PerfEntry } from "@/lib/performance";
import {
  planNativeTitleTestProposals,
  rejectSequentialTitleSwap,
  type NativeTitleTestProposal,
  type TitleCandidateStats,
} from "@/lib/titleCtrSwap";

type Logger = (m: string) => void;

/** Bound owner-facing native-test proposals per channel in one run. */
const MAX_PROPOSALS_PER_CHANNEL = 2;

function candidate(entry: PerfEntry): TitleCandidateStats {
  return {
    videoId: entry.videoId,
    title: entry.title,
    titleAlternate: entry.titleAlternate,
    titleAlternates: entry.titleAlternates,
    thumbnailImpressions: entry.thumbnailImpressions,
    ctr: entry.ctr,
    publishedAt: entry.publishedAt,
    titleSetAt: entry.titleSetAt ?? entry.publishedAt,
    swappedAt: entry.titleSwap?.swappedAt,
  };
}

/**
 * Historic swaps were sequential CTR edits. Quarantine them explicitly rather
 * than quietly declaring an alternate won; no native test outcome was stored.
 */
export function judgePriorSwaps(ledger: PerfEntry[], log: Logger = () => {}): number {
  let judged = 0;
  for (const entry of ledger) {
    const swap = entry.titleSwap;
    if (!swap || swap.outcome) continue;
    const outcome = rejectSequentialTitleSwap(entry.videoId);
    swap.outcome = outcome.verdict;
    swap.outcomeDetail = outcome.detail;
    swap.outcomeAt = Date.now();
    judged += 1;
    log(`title-swap: ${entry.videoId} ${outcome.verdict} — ${outcome.detail}`);
  }
  return judged;
}

export async function runTitleCtrSwap(
  ownerId: string,
  log: Logger,
  approvedForMetadataChanges = false,
): Promise<{
  ok: boolean;
  applied: number;
  proposed: NativeTitleTestProposal[];
  judged: number;
  approvalRequired?: boolean;
}> {
  await bootstrapSecrets((m) => log(m));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");

  const convex = new ConvexHttpClient(url);
  const channels = (await convex.query(api.channels.listChannels, { ownerId })) as Array<{
    _id: Id<"channels">; slug: string; name: string;
  }>;

  const proposed: NativeTitleTestProposal[] = [];
  const applied = 0;
  let judged = 0;
  const now = Date.now();

  for (const channel of channels) {
    const prefix = channelPrefix(ownerId, channel.slug);
    const ledger = await loadLedger(prefix);
    if (!ledger.length) continue;

    const dirty = judgePriorSwaps(ledger, log) > 0;
    judged += dirty ? 1 : 0;

    const decisions = planNativeTitleTestProposals(ledger.map(candidate), now);
    const proposals = decisions
      .filter((decision) => decision.action === "propose_native_test")
      .slice(0, MAX_PROPOSALS_PER_CHANNEL);
    for (const decision of proposals) proposed.push(decision);

    if (proposals.length) {
      for (const proposal of proposals) {
        log(
          `title-native-test PROPOSED ${channel.name} ${proposal.videoId}: ${proposal.titleVariants?.map((title) => `"${title}"`).join(" / ") ?? `"${proposal.from}" vs "${proposal.to}"`} ` +
          `(${proposal.reason}). Start a title-only native A/B test in desktop YouTube Studio; no sequential API rename was made.`,
        );
      }
      if (approvedForMetadataChanges) {
        log(`title-native-test: metadata-change approval does not authorize a sequential CTR edit as an experiment; nothing was renamed.`);
      }
    }

    if (dirty) await saveLedger(prefix, ledger);
  }

  log(
    `title-native-test: done — ${applied} applied, ${proposed.length} proposed across ${channels.length} channel(s); ` +
    `native watch-time tests must be started and resolved in YouTube Studio.`,
  );
  return {
    ok: true,
    applied,
    proposed,
    judged,
    approvalRequired: true,
  };
}

/**
 * Weekly proposal pass. It deliberately does NOT pass approval: a cron may
 * work out which titles are underperforming, but renaming a published video is
 * the owner's call, and a schedule cannot give consent on their behalf.
 */
export const titleCtrSwapSchedule = schedules.task({
  id: "title-ctr-swap",
  cron: "0 10 * * 1", // Monday 10:00, an hour after the weekend metrics settle
  run: async () => {
    const gate = studioAutomationGate(STUDIO_AUTOMATION_GATES.insights);
    if (!gate.enabled) return gate;
    return runTitleCtrSwap(
      process.env.STUDIO_OWNER_ID ?? "owner_daniel",
      (m) => console.log(`[title-swap] ${m}`),
      false,
    );
  },
});

/** Manual run only prepares native-test proposals; it never renames a video. */
export const titleCtrSwapTask = task({
  id: "title-ctr-swap-now",
  run: async (payload: { ownerId?: string; approvedForMetadataChanges?: boolean }) =>
    runTitleCtrSwap(
      payload?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel",
      (m) => console.log(`[title-swap] ${m}`),
      payload?.approvedForMetadataChanges === true,
    ),
});
