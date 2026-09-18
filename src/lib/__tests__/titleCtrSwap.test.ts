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
  nativeTitleTestVariants,
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
  assert.deepEqual(d.titleVariants, ["The Original Title That Went Out", "The Runner Up Nobody Ever Used"]);
  assert.equal(d.baselineCtr, 2.0, "the number the alternate must beat is recorded");

  // YouTube Studio does not allow native title/thumbnail tests on made-for-
  // kids videos. A strong enough CTR signal must still never create an
  // impossible owner workflow for the supervised children-learning lane.
  const madeForKids = decision(
    [...healthyChannel(), video({ videoId: "kids", ctr: 2.0, madeForKids: true })],
    "kids",
  );
  assert.equal(madeForKids.action, "hold");
  assert.match(madeForKids.reason, /made-for-kids/i);

  // Noise floor: the same weak CTR on a handful of impressions is not evidence.
  assert.equal(
    decision([...healthyChannel(), video({ videoId: "slow", ctr: 2.0, thumbnailImpressions: 300 })], "slow").action,
    "hold",
  );
  const threeWay = video({
    videoId: "three-way",
    ctr: 2,
    titleAlternates: ["Second Judged Candidate", "Third Judged Candidate", "Ignored Fourth Candidate"],
  });
  const threeWayDecision = decision([...healthyChannel(), threeWay], "three-way");
  assert.equal(threeWayDecision.action, "propose_native_test");
  assert.deepEqual(threeWayDecision.titleVariants, [
    "The Original Title That Went Out",
    "The Runner Up Nobody Ever Used",
    "Second Judged Candidate",
  ], "the native slate is bounded to three total title-only variants");
  assert.deepEqual(
    nativeTitleTestVariants(video({ titleAlternates: [" the original title that went out ", " the runner up nobody ever used ", "A New Candidate"] })),
    ["The Original Title That Went Out", "The Runner Up Nobody Ever Used", "A New Candidate"],
    "case/spacing duplicates cannot create a false variant",
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
  const threeVariantWinner = admitNativeTitleTestOutcome({
    videoId: "three",
    platformReceiptId: "studio-test-three-123",
    variants: [
      { title: "The Original Title That Went Out", watchTimeShare: 0.28 },
      { title: "The Runner Up Nobody Ever Used", watchTimeShare: 0.31 },
      { title: "The Third Judged Title", watchTimeShare: 0.41 },
    ],
    platformOutcome: "variant_won",
    platformWinnerTitle: "The Third Judged Title",
  });
  assert.equal(threeVariantWinner.verdict, "variant_won");
  assert.equal(threeVariantWinner.winnerIndex, 2);
  assert.equal(threeVariantWinner.winnerTitle, "The Third Judged Title");
  assert.equal(
    admitNativeTitleTestOutcome({
      videoId: "forged-three",
      platformReceiptId: "studio-test-three-123",
      variants: [
        { title: "The Original Title That Went Out", watchTimeShare: 0.4 },
        { title: "The Runner Up Nobody Ever Used", watchTimeShare: 0.35 },
        { title: "The Third Judged Title", watchTimeShare: 0.25 },
      ],
      platformOutcome: "variant_won",
      platformWinnerTitle: "The Third Judged Title",
    }).verdict,
    "not_experiment",
    "the recorded platform winner must agree with the supplied per-variant watch-time evidence",
  );
  assert.equal(
    admitNativeTitleTestOutcome({
      videoId: "wrong-slate",
      platformReceiptId: "studio-test-three-123",
      variants: [
        { title: "The Original Title That Went Out", watchTimeShare: 0.5 },
        { title: "The Original Title That Went Out", watchTimeShare: 0.5 },
      ],
      platformOutcome: "inconclusive",
    }).verdict,
    "not_experiment",
    "duplicate titles cannot produce a false native-test slate",
  );
  assert.equal(
    admitNativeTitleTestOutcome({
      videoId: "inconclusive",
      platformReceiptId: "studio-test-three-123",
      variants: [
        { title: "The Original Title That Went Out", watchTimeShare: 0.4 },
        { title: "The Runner Up Nobody Ever Used", watchTimeShare: 0.35 },
        { title: "The Third Judged Title", watchTimeShare: 0.25 },
      ],
      platformOutcome: "inconclusive",
      platformWinnerTitle: "The Original Title That Went Out",
    }).verdict,
    "not_experiment",
    "an inconclusive platform result must not smuggle in a winner",
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
