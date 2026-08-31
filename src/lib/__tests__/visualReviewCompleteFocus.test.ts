import assert from "node:assert/strict";
import { join } from "node:path";
import { planCompleteFocusEvidence, reviewRender } from "@/lib/visualReview";
import { FINAL_VISUAL_REVIEW_MAX_IMAGES_PER_REQUEST } from "@/engine/visualReviewBudget";

const fixture = join(process.cwd(), "public", "golden", "comic", "comic3d.mp4");
const reviewer = async () => JSON.stringify({ defects: [], summary: "Complete-focus fixture: no findings." });
const sourceSha256A = "a".repeat(64);
const sourceSha256B = "b".repeat(64);

async function main(): Promise<void> {
  const fullCutSchedule = planCompleteFocusEvidence(18, [
    { startSec: 0.2, endSec: 17.8, reason: "reviewer" },
  ]);
  assert(fullCutSchedule.length > 24, "complete focus planning must not inherit the ordinary 24-frame repair cap");
  assert.equal(fullCutSchedule[0]?.tSec, 0.2);
  assert.equal(fullCutSchedule.at(-1)?.tSec, 17.8);

  const result = await reviewRender(fixture, 18, {
    title: "Complete cinematic focus fixture",
    expectTitleCard: false,
    focusWindows: [{ startSec: 7, endSec: 8, reason: "reviewer" }],
  }, {
    runId: "visual-review-complete-focus",
    required: true,
    reviewer,
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
    requireCompleteFocusCoverage: true,
    sourceSha256: sourceSha256A,
  });
  assert.equal(result.verdict, "pass");
  assert.equal(result.evidence.source.sha256, sourceSha256A, "evidence must retain the exact reviewed master SHA-256");
  assert.equal(result.evidence.coverage.requiredFocusFrameCount, 3);
  assert.equal(result.evidence.coverage.missingFocusFrameCount, 0);

  // Every retained evidence frame must have reached the reviewer. The full
  // sealed schedule intentionally exceeds a single provider request, so this
  // proves chunking rather than representative-frame sampling.
  const reviewedFrameIds = new Set<string>();
  const batchSizes: number[] = [];
  const batchingReviewer = async (input: { frames: Array<{ id: string }> }) => {
    batchSizes.push(input.frames.length);
    input.frames.forEach((frame) => reviewedFrameIds.add(frame.id));
    return JSON.stringify({ defects: [], summary: "All supplied evidence frames reviewed." });
  };
  const fullyCovered = await reviewRender(fixture, 18, {
    title: "Complete cinematic provider-batch fixture",
    expectTitleCard: false,
    focusWindows: [{ startSec: 0.2, endSec: 17.8, reason: "reviewer" }],
  }, {
    runId: "visual-review-complete-focus-provider-batches",
    required: true,
    reviewer: batchingReviewer,
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
    requireCompleteFocusCoverage: true,
    sourceSha256: sourceSha256A,
  });
  assert.ok(batchSizes.length > 2, "a complete 2fps schedule must split across provider requests");
  assert.ok(
    batchSizes.every((size) => size > 0 && size <= FINAL_VISUAL_REVIEW_MAX_IMAGES_PER_REQUEST),
    "no final-review batch may exceed Qwen's operational receipt limit",
  );
  assert.ok(
    batchSizes.some((size) => size === FINAL_VISUAL_REVIEW_MAX_IMAGES_PER_REQUEST),
    "complete evidence must use the full admitted final-review envelope rather than silently falling back to one-frame calls",
  );
  assert.deepEqual(
    [...reviewedFrameIds].sort(),
    fullyCovered.evidence.frames.map((frame) => frame.id).sort(),
    "the receipt may retain only frames that were sent to a reviewer batch",
  );

  // A model can return a wildly broad defect range. It must remain inside the
  // ordinary reactive cap rather than enlarging the sealed cinematic 2fps plan
  // after the pre-render reservation was fixed.
  const reactiveBatchSizes: number[] = [];
  const broadDefectReviewer = async (input: { phase: "broad" | "focus"; frames: unknown[] }) => {
    reactiveBatchSizes.push(input.frames.length);
    return JSON.stringify(input.phase === "broad"
      ? {
          defects: [{
            startSec: 0,
            endSec: 1_000_000_000,
            severity: "critical",
            category: "general_visual",
            confidence: 0.99,
            observed: "Synthetic broad defect range.",
            expected: "The sealed cinematic focus window.",
            suggestedRepair: "Repair the source shot.",
          }],
          summary: "Critical finding in broad pass.",
        }
      : { defects: [], summary: "Focused review." });
  };
  const reactiveBounded = await reviewRender(fixture, 18, {
    title: "Reactive focus bounded fixture",
    expectTitleCard: false,
    focusWindows: [{ startSec: 7, endSec: 8, reason: "reviewer" }],
  }, {
    runId: "visual-review-reactive-focus-bounded",
    required: true,
    reviewer: broadDefectReviewer,
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
    requireCompleteFocusCoverage: true,
    completeFocusWindows: [{ startSec: 7, endSec: 8, reason: "reviewer" }],
    expectedCompleteFocusFrameCount: 3,
    sourceSha256: sourceSha256A,
  });
  assert.equal(reactiveBounded.evidence.coverage.requiredFocusFrameCount, 3);
  assert.ok(
    reactiveBounded.evidence.frames.length <= 11,
    "an untrusted broad defect range must not trigger a full-master complete-focus pass",
  );
  assert.ok(reactiveBatchSizes.every((size) => size <= FINAL_VISUAL_REVIEW_MAX_IMAGES_PER_REQUEST));

  let mismatchReviewerCalls = 0;
  await assert.rejects(
    () => reviewRender(fixture, 18, {
      title: "Mismatched sealed focus plan",
      focusWindows: [{ startSec: 7, endSec: 8, reason: "reviewer" }],
    }, {
      runId: "visual-review-complete-focus-mismatch",
      reviewer: async () => {
        mismatchReviewerCalls += 1;
        return JSON.stringify({ defects: [], summary: "Should not run." });
      },
      persistEvidence: false,
      requireCompleteFocusCoverage: true,
      completeFocusWindows: [{ startSec: 7, endSec: 8, reason: "reviewer" }],
      expectedCompleteFocusFrameCount: 4,
      sourceSha256: sourceSha256A,
    }),
    /sealed complete-focus plan mismatch/,
    "a timing/count mismatch must fail before any reviewer/provider call",
  );
  assert.equal(mismatchReviewerCalls, 0);

  const differentMaster = await reviewRender(fixture, 18, {
    title: "Complete cinematic focus fixture",
    expectTitleCard: false,
    focusWindows: [{ startSec: 7, endSec: 8, reason: "reviewer" }],
  }, {
    runId: "visual-review-complete-focus-different-master",
    required: true,
    reviewer,
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
    requireCompleteFocusCoverage: true,
    sourceSha256: sourceSha256B,
  });
  assert.notEqual(
    differentMaster.reviewFingerprint,
    result.reviewFingerprint,
    "a distinct final-master SHA-256 must invalidate the visual-review fingerprint",
  );
  await assert.rejects(
    () => reviewRender(fixture, 18, { title: "Invalid source SHA fixture" }, {
      runId: "visual-review-invalid-source-sha",
      reviewer,
      persistEvidence: false,
      sourceSha256: "not-a-sha256",
    }),
    /64-character hexadecimal SHA-256/,
    "a malformed final-master binding must fail before evidence extraction",
  );
  console.log("visual review complete focus coverage test passed");
}

void main();
