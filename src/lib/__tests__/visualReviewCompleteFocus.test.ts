import assert from "node:assert/strict";
import { join } from "node:path";
import { planCompleteFocusEvidence, reviewRender } from "@/lib/visualReview";

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
