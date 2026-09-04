/**
 * `title-ctr-swap` — the publish-side half of the title loop.
 *
 * Metacraft has always produced a runner-up title, judged it, stored it in
 * `titleAlternate` and then never used it. This finds published videos whose
 * click-through trails their own channel and puts the runner-up live, so the
 * second title the studio already paid for gets tested instead of discarded.
 *
 * WHY THIS IS ALLOWED TO WRITE WHERE seoReoptimize IS NOT.
 * The sibling task seoReoptimize is hard-blocked by an attribution admission:
 * the performance ledger had "no immutable package version, raw impressions,
 * freshness boundary, or fully post-package observation". That containment is
 * correct and this does not route around it — it satisfies it. Raw impressions
 * now flow from YouTube Analytics through the ingestion into the ledger;
 * `titleSetAt` records when the live title went up; and admitTitleObservation
 * refuses any video whose measurement is not wholly after that point. A swap
 * also knows its exact package on both sides, because it writes the title
 * itself. Where the data is missing the answer is "hold", never a proxy.
 *
 * THREE SEPARATE PERMISSIONS, all required before a single title changes:
 *   1. the studio automation gate for insights
 *   2. an explicit `approvedForMetadataChanges` from the caller — the scheduled
 *      run never passes it, so a cron can propose but cannot rename
 *   3. per-channel YouTube write scopes, checked through requireYouTubeConnector
 *
 * Each run also judges the swaps it made previously, because a loop that keeps
 * changing titles without ever scoring the change is not learning, it is
 * churning.
 */
import { schedules, task } from "@trigger.dev/sdk";

import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { STUDIO_AUTOMATION_GATES, studioAutomationGate } from "@/lib/automationGate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { channelPrefix } from "@/lib/storage";
import { loadLedger, saveLedger, type PerfEntry } from "@/lib/performance";
import { updateVideoMetadata } from "@/lib/youtube";
import { requireYouTubeConnector } from "@/lib/youtubeConnector";
import { YOUTUBE_WRITE_SCOPES } from "@/lib/publishingPolicy";
import {
  judgeSwapOutcome,
  planTitleSwaps,
  type SwapDecision,
  type TitleCandidateStats,
} from "@/lib/titleCtrSwap";

type Logger = (m: string) => void;

/** How many titles may change on one channel in a single run. */
const MAX_PER_CHANNEL = 2;

function candidate(entry: PerfEntry): TitleCandidateStats {
  return {
    videoId: entry.videoId,
    title: entry.title,
    titleAlternate: entry.titleAlternate,
    thumbnailImpressions: entry.thumbnailImpressions,
    ctr: entry.ctr,
    publishedAt: entry.publishedAt,
    titleSetAt: entry.titleSetAt ?? entry.publishedAt,
    swappedAt: entry.titleSwap?.swappedAt,
  };
}

/** Score the swaps made on a previous run, so the loop actually learns. */
export function judgePriorSwaps(ledger: PerfEntry[], log: Logger = () => {}): number {
  let judged = 0;
  for (const entry of ledger) {
    const swap = entry.titleSwap;
    if (!swap || swap.outcome) continue;
    const outcome = judgeSwapOutcome({
      videoId: entry.videoId,
      baselineCtr: swap.baselineCtr,
      postSwapCtr: entry.ctr ?? null,
      // Impressions accrued since the swap, not lifetime.
      postSwapImpressions: (entry.thumbnailImpressions ?? 0) - swap.baselineImpressions,
    });
    if (outcome.verdict === "inconclusive") continue;
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
  proposed: SwapDecision[];
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

  const proposed: SwapDecision[] = [];
  let applied = 0;
  let judged = 0;
  const now = Date.now();

  for (const channel of channels) {
    const prefix = channelPrefix(ownerId, channel.slug);
    const ledger = await loadLedger(prefix);
    if (!ledger.length) continue;

    let dirty = judgePriorSwaps(ledger, log) > 0;
    judged += dirty ? 1 : 0;

    const decisions = planTitleSwaps(ledger.map(candidate), now);
    const swaps = decisions.filter((d) => d.action === "swap").slice(0, MAX_PER_CHANNEL);
    for (const decision of swaps) proposed.push(decision);

    if (swaps.length && !approvedForMetadataChanges) {
      // Proposals are useful on their own — this is what the scheduled run
      // produces, so the owner can see what it WOULD do before arming it.
      for (const swap of swaps) {
        log(`title-swap PROPOSED (not applied) ${channel.name} ${swap.videoId}: "${swap.from}" -> "${swap.to}" (${swap.reason})`);
      }
    } else if (swaps.length) {
      let refreshToken: string;
      try {
        refreshToken = (
          await requireYouTubeConnector(convex, {
            channelId: channel._id,
            ownerId,
            requiredScopes: YOUTUBE_WRITE_SCOPES,
          })
        ).refreshToken;
      } catch (error) {
        log(`title-swap: ${channel.name} skipped — ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      for (const swap of swaps) {
        const entry = ledger.find((e) => e.videoId === swap.videoId);
        if (!entry) continue;
        try {
          await updateVideoMetadata({ refreshToken, videoId: swap.videoId, title: swap.to! });
          // Record BEFORE anything else can fail: an applied swap that is not
          // written down would be re-applied on the next run, and the baseline
          // it must beat would be lost.
          entry.titleSwap = {
            from: swap.from!,
            to: swap.to!,
            baselineCtr: swap.baselineCtr!,
            baselineImpressions: swap.baselineImpressions!,
            swappedAt: now,
          };
          entry.title = swap.to!;
          // The freshness boundary moves with the title. Without this the next
          // run would judge the new title using impressions the old one earned.
          entry.titleSetAt = now;
          dirty = true;
          applied += 1;
          log(`title-swap APPLIED ${channel.name} ${swap.videoId}: "${swap.from}" -> "${swap.to}"`);
        } catch (error) {
          log(`title-swap: ${swap.videoId} failed (${error instanceof Error ? error.message : error})`);
        }
      }
    }

    if (dirty) await saveLedger(prefix, ledger);
  }

  log(
    `title-swap: done — ${applied} applied, ${proposed.length} proposed across ${channels.length} channel(s)` +
    (approvedForMetadataChanges ? "" : " (approval not given; nothing was renamed)"),
  );
  return {
    ok: true,
    applied,
    proposed,
    judged,
    ...(approvedForMetadataChanges ? {} : { approvalRequired: true }),
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

/** Manual run. Pass `approvedForMetadataChanges: true` to actually rename. */
export const titleCtrSwapTask = task({
  id: "title-ctr-swap-now",
  run: async (payload: { ownerId?: string; approvedForMetadataChanges?: boolean }) =>
    runTitleCtrSwap(
      payload?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel",
      (m) => console.log(`[title-swap] ${m}`),
      payload?.approvedForMetadataChanges === true,
    ),
});
