/**
 * The swap writes to a live YouTube channel, so the two rules that decide
 * whether an observation may be acted on at all are tested directly.
 *
 * seoReoptimize — the sibling task that also calls videos.update — is hard
 * blocked because the ledger lacked raw impressions, a freshness boundary and a
 * fully post-package observation. This path is only allowed to write because it
 * now HAS those. If admitTitleObservation ever went soft, the swap would be
 * doing exactly the thing that containment exists to prevent.
 */
import assert from "node:assert/strict";

import { admitTitleObservation, DEFAULT_SWAP_POLICY, type TitleCandidateStats } from "@/lib/titleCtrSwap";
import { judgePriorSwaps } from "@/trigger/titleCtrSwap";
import type { PerfEntry } from "@/lib/performance";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

function stats(over: Partial<TitleCandidateStats> = {}): TitleCandidateStats {
  return {
    videoId: "v1",
    title: "A Live Title",
    titleAlternate: "The Other One",
    thumbnailImpressions: 10_000,
    ctr: 3,
    publishedAt: NOW - 30 * 24 * HOUR,
    ...over,
  };
}

function entry(over: Partial<PerfEntry> = {}): PerfEntry {
  return {
    videoId: "v1", topic: "t", title: "A Live Title",
    publishedAt: NOW - 30 * 24 * HOUR, views: 5_000, avgViewPct: 40,
    updatedAt: NOW, ...over,
  };
}

function main(): void {
  assert.equal(admitTitleObservation(stats(), NOW).admitted, true);

  // Each thing the containment names, missing in turn.
  assert.equal(
    admitTitleObservation(stats({ thumbnailImpressions: undefined }), NOW).admitted, false,
    "a CTR rate with no denominator must never be admitted");
  assert.equal(admitTitleObservation(stats({ ctr: undefined }), NOW).admitted, false);
  assert.equal(
    admitTitleObservation(stats({ thumbnailImpressions: 50 }), NOW).admitted, false,
    "below the noise floor is not evidence");

  // Freshness: the measurement must be wholly after the current title went up.
  // A month-old video whose title changed an hour ago is NOT admissible, even
  // though its lifetime impressions are large — those belong to the old title.
  assert.equal(
    admitTitleObservation(stats({ titleSetAt: NOW - HOUR }), NOW).admitted, false,
    "impressions earned by a previous title must not be attributed to this one");
  assert.equal(
    admitTitleObservation(stats({ titleSetAt: NOW - 100 * HOUR }), NOW).admitted, true,
    "past the settle window on the current title it is admissible");
  assert.ok(DEFAULT_SWAP_POLICY.settleHours >= 48, "the settle window must outlast the subscriber surge");

  // Outcome scoring uses impressions SINCE the swap, not lifetime. Using the
  // lifetime figure would declare a verdict the moment a swap was applied.
  const justSwapped = entry({
    ctr: 5,
    thumbnailImpressions: 10_400,
    titleSwap: { from: "A Live Title", to: "The Other One", baselineCtr: 2, baselineImpressions: 10_000, swappedAt: NOW - HOUR },
  });
  assert.equal(judgePriorSwaps([justSwapped]), 0, "400 impressions since the swap is not a verdict");
  assert.equal(justSwapped.titleSwap?.outcome, undefined);

  const settled = entry({
    ctr: 5,
    thumbnailImpressions: 30_000,
    titleSwap: { from: "A Live Title", to: "The Other One", baselineCtr: 2, baselineImpressions: 10_000, swappedAt: NOW - 30 * 24 * HOUR },
  });
  assert.equal(judgePriorSwaps([settled]), 1);
  assert.equal(settled.titleSwap?.outcome, "alternate_won");

  // An already-scored swap is not re-scored.
  assert.equal(judgePriorSwaps([settled]), 0, "a judged swap must stay judged");

  console.log("TITLE SWAP ATTRIBUTION PASS");
}

main();
