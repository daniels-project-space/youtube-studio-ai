/**
 * The native-test proposal loop identifies published videos worth comparing in
 * desktop YouTube Studio. These cases prevent it from acting on noise or
 * mistaking an ordinary sequential CTR delta for a test verdict.
 */
import assert from "node:assert/strict";

import {
  DEFAULT_SWAP_POLICY,
  admitNativeTitleTestOutcome,
  channelMedianCtr,
  planNativeTitleTestProposals,
  rejectSequentialTitleSwap,
  type TitleCandidateStats,
} from "@/lib/titleCtrSwap";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

function video(over: Partial<TitleCandidateStats> = {}): TitleCandidateStats {
  return {
    videoId: over.videoId ?? "v1",
    title: "The Original Title That Went Out",
    titleAlternate: "The Runner Up Nobody Ever Used",
    thumbnailImpressions: 10_000,
    ctr: 2.0,
    publishedAt: NOW - 30 * 24 * HOUR,
    ...over,
  };
}

/** A channel whose median is 6% — the reference a laggard has to fall below. */
function healthyChannel(): TitleCandidateStats[] {
  return [
    video({ videoId: "a", ctr: 5.5 }),
    video({ videoId: "b", ctr: 6.0 }),
    video({ videoId: "c", ctr: 6.5 }),
    video({ videoId: "d", ctr: 7.0 }),
  ];
}

function decision(videos: TitleCandidateStats[], id: string) {
  return planNativeTitleTestProposals(videos, NOW).find((d) => d.videoId === id)!;
}

function main(): void {
  assert.equal(channelMedianCtr(healthyChannel()), 6.25);
  assert.equal(channelMedianCtr([video({ ctr: 3 })]), null, "one video is not a median");

  // The case the loop exists for.
  const laggard = video({ videoId: "slow", ctr: 2.0 });
  const d = decision([...healthyChannel(), laggard], "slow");
  assert.equal(d.action, "propose_native_test", d.reason);
  assert.equal(d.to, "The Runner Up Nobody Ever Used");
  assert.equal(d.baselineCtr, 2.0, "the number the alternate must beat is recorded");

  // Noise floor: the same weak CTR on a handful of impressions is not evidence.
  assert.equal(
    decision([...healthyChannel(), video({ videoId: "slow", ctr: 2.0, thumbnailImpressions: 300 })], "slow").action,
    "hold",
  );

  // Settling period: a fresh upload's CTR is its subscribers, not its title.
  assert.equal(
    decision([...healthyChannel(), video({ videoId: "slow", ctr: 2.0, publishedAt: NOW - 6 * HOUR })], "slow").action,
    "hold",
  );

  // Relative, not absolute: 2% is fine on a channel that runs at 2%.
  const lowChannel = [
    video({ videoId: "a", ctr: 1.9 }), video({ videoId: "b", ctr: 2.0 }),
    video({ videoId: "c", ctr: 2.1 }), video({ videoId: "d", ctr: 2.2 }),
  ];
  assert.equal(decision([...lowChannel, video({ videoId: "slow", ctr: 2.0 })], "slow").action, "hold",
    "an absolute threshold would punish a whole channel for its niche");

  // Never propose twice, and never without a distinct alternate.
  assert.equal(decision([...healthyChannel(), video({ videoId: "slow", ctr: 2.0, swappedAt: NOW - HOUR })], "slow").action, "hold");
  assert.equal(decision([...healthyChannel(), video({ videoId: "slow", ctr: 2.0, titleAlternate: "" })], "slow").action, "hold");
  assert.equal(
    decision([...healthyChannel(), video({ videoId: "slow", ctr: 2.0, titleAlternate: "The Original Title That Went Out" })], "slow").action,
    "hold", "a title cannot be compared against itself");

  // Every hold explains itself; a silent decline is how the unread
  // titleAlternate field went unnoticed for so long.
  for (const held of planNativeTitleTestProposals(healthyChannel(), NOW)) {
    assert.ok(held.reason.length > 10, `hold without a reason: ${JSON.stringify(held)}`);
  }

  // A normal analytics snapshot cannot masquerade as a native result.
  assert.equal(
    admitNativeTitleTestOutcome({ videoId: "v" }).verdict,
    "not_experiment",
  );
  assert.equal(
    admitNativeTitleTestOutcome({
      videoId: "v",
      platformReceiptId: "studio-test-123",
      originalWatchTimeShare: 0.44,
      alternateWatchTimeShare: 0.56,
      platformVerdict: "alternate_won",
    }).verdict,
    "alternate_won",
  );
  assert.equal(
    admitNativeTitleTestOutcome({
      videoId: "v",
      platformReceiptId: "studio-test-123",
      originalWatchTimeShare: 0.56,
      alternateWatchTimeShare: 0.44,
      platformVerdict: "alternate_won",
    }).verdict,
    "not_experiment",
    "a fabricated verdict must conflict with its own watch-time evidence",
  );
  assert.equal(DEFAULT_SWAP_POLICY.minImpressions, 2_000);
  assert.equal(
    rejectSequentialTitleSwap("v").verdict,
    "not_experiment",
    "a sequential CTR edit must never be presented as a native YouTube experiment",
  );

  console.log("TITLE CTR SWAP PASS");
}

main();
