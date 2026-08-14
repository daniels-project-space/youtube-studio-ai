import assert from "node:assert/strict";
import { join } from "node:path";
import { planCompleteFocusEvidence, reviewRender } from "@/lib/visualReview";

const fixture = join(process.cwd(), "public", "golden", "comic", "comic3d.mp4");
const reviewer = async () => JSON.stringify({ defects: [], summary: "Complete-focus fixture: no findings." });

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
  });
  assert.equal(result.verdict, "pass");
  assert.equal(result.evidence.coverage.requiredFocusFrameCount, 3);
  assert.equal(result.evidence.coverage.missingFocusFrameCount, 0);
  console.log("visual review complete focus coverage test passed");
}

void main();
