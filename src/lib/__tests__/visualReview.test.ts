import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planHeal, type HealableBlock } from "@/engine/healer";
import {
  channelVisualReviewProfile,
  maxAllowedVisualReviewGapSec,
  planVisualReviewEvidence,
  reviewRender,
  visualReviewReceiptFingerprint,
  visualRepairSignals,
  type VisualReviewIntent,
} from "@/lib/visualReview";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const fixture = join(process.cwd(), "public", "golden", "comic", "comic3d.mp4");
const reviewer = async () => JSON.stringify({ defects: [], summary: "No model findings in hermetic geometry test." });
const malformedReviewer = async () => "this is not a structured review receipt";
const reviewSource = readFileSync(new URL("../visualReview.ts", import.meta.url), "utf8");
assert.match(
  reviewSource,
  /hasNonGoogleVisionKey\(\)/,
  "the default final-master reviewer must reject a Gemini-only environment",
);
assert.match(
  reviewSource,
  /providers: \["openrouter"\]/,
  "the default final-master reviewer must scope its evidence calls to non-Google providers",
);
assert.match(
  reviewSource,
  /video-review\/v5/,
  "a pre-schema receipt must not be mistaken for current non-Google evidence",
);
assert.match(
  reviewSource,
  /visual-review-receipt\/v1/,
  "a review result must declare the content-addressed receipt schema it returns",
);
const phraseReviewer = async () => JSON.stringify({
  defects: [{
    startSec: 6,
    endSec: 10,
    severity: "major",
    category: "general_visual",
    confidence: 0.9,
    observed: "A large white rectangular overlay is covering the face and upper body of the main character.",
    expected: "The face must remain visible.",
    evidenceFrameIds: ["f001"],
    suggestedRepair: "Move the overlay away from the face.",
  }],
  summary: "Known visual phrasing.",
});

function makeBadComic(input: string, output: string): void {
  // The two obvious faults are deliberately present only in the 6–10s window:
  // a large bubble-shaped plate that occludes the panel subject and a second
  // plate that extends beyond the right edge. This uses the real Golden comic
  // video rather than a synthetic still.
  const filters = [
    "drawbox=x=650:y=190:w=560:h=360:color=white@1:t=fill:enable='between(t,6,10)'",
    "drawbox=x=650:y=190:w=560:h=360:color=black@1:t=7:enable='between(t,6,10)'",
    "drawbox=x=1810:y=640:w=280:h=200:color=white@1:t=fill:enable='between(t,6,10)'",
    "drawbox=x=1810:y=640:w=280:h=200:color=black@1:t=7:enable='between(t,6,10)'",
  ].join(",");
  const rendered = spawnSync(
    FFMPEG,
    ["-y", "-i", input, "-vf", filters, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", output],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  assert.equal(rendered.status, 0, rendered.stderr?.slice(-1200));
}

function makeSparseCoverageFixture(output: string): void {
  const rendered = spawnSync(
    FFMPEG,
    [
      "-y",
      "-f", "lavfi",
      "-i", "color=c=black:s=160x90:r=1",
      "-t", "90",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "40",
      "-pix_fmt", "yuv420p",
      output,
    ],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  assert.equal(rendered.status, 0, rendered.stderr?.slice(-1200));
}

function plannedMaxGapSec(frames: Array<{ tSec: number }>, durationSec: number): number {
  const timestamps = [0, ...frames.map((frame) => frame.tSec), durationSec].sort((a, b) => a - b);
  return timestamps.slice(1).reduce((max, timestamp, index) => Math.max(max, timestamp - timestamps[index]), 0);
}

async function main(): Promise<void> {
  const comicProfile = channelVisualReviewProfile({
    contentLaneKey: "motion_comic",
    primaryRenderer: "motion_comic",
    channelName: "Silent Night Stories",
    persona: "Comic history fans",
    styleGrammar: "inked panels; restrained captions",
    qualityDimensions: ["identity", "footage"],
    qualityCriteria: [
      "footage: Every visual change must clarify or advance the current spoken point; decorative novelty is a defect.",
      "pacing: Reference-quality mechanics only, no automatic comparison with a reference channel.",
    ],
  });
  assert.match(comicProfile.expectedStructure, /speech bubbles/i, "comic channels must tell the reviewer their layout contract");
  assert.match(comicProfile.channelWorld ?? "", /Silent Night Stories/, "frozen channel identity must reach the reviewer");
  assert.equal(comicProfile.qualityCriteria.length, 2, "full QualityBar criteria must survive the channel-review profile");

  let groundedPrompt = "";
  const groundedReviewer = async (input: { prompt: string }) => {
    groundedPrompt = input.prompt;
    return JSON.stringify({ defects: [], summary: "Grounded review fixture." });
  };
  const grounded = await reviewRender(fixture, 18, {
    title: "Reference-quality QA grounding fixture",
    expectTitleCard: false,
    qualityCriteria: comicProfile.qualityCriteria,
  }, {
    runId: "visual-review-quality-bar",
    reviewer: groundedReviewer,
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
  });
  assert.equal(grounded.verdict, "pass");
  assert.match(groundedPrompt, /CHANNEL QUALITY BAR/, "the final reviewer must receive the full channel quality standard");
  assert.match(groundedPrompt, /decorative novelty is a defect/i);
  assert.match(groundedPrompt, /not an automatic comparison/i);
  assert.doesNotMatch(
    groundedPrompt,
    /REFERENCE-MECHANICS CRITERIA/,
    "an unopted generic QualityBar review must not demand typed reference receipts or turn a normal reviewer pass into needs_human",
  );

  // Typed reference mechanics are a separate contract from the generic
  // six-item QualityBar prose cap: every requested ID gets a receipt in the
  // same non-Google reviewer response, with no additional provider call.
  const referenceCriteria = Array.from({ length: 7 }, (_, index) => ({
    id: `reference-mechanic-${index + 1}`,
    criterion: `Original visual mechanic ${index + 1} must be visibly supported by the reviewed frames.`,
  }));
  let referenceCriteriaPrompt = "";
  const referenceCriteriaReviewer = async (input: { prompt: string }) => {
    referenceCriteriaPrompt = input.prompt;
    return JSON.stringify({
      defects: [],
      referenceCriteria: referenceCriteria.map((criterion) => ({
        id: criterion.id,
        verdict: "pass",
        evidenceFrameIds: ["f001"],
      })),
      summary: "All typed reference mechanics are visibly supported in this batch.",
    });
  };
  const referenceCriteriaPassed = await reviewRender(fixture, 18, {
    title: "Typed reference-criteria fixture",
    expectTitleCard: false,
    qualityCriteria: Array.from({ length: 7 }, (_, index) => `Generic prose criterion ${index + 1}`),
    referenceCriteria,
  }, {
    runId: "visual-review-reference-criteria",
    reviewer: referenceCriteriaReviewer,
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
  });
  assert.equal(referenceCriteriaPassed.verdict, "pass", "all explicit reference receipts must allow the review to pass");
  assert.equal(referenceCriteriaPassed.referenceCriteriaComplete, true);
  assert.match(referenceCriteriaPassed.reviewFingerprint, /^[a-f0-9]{64}$/, "a review receipt must retain its full SHA-256 fingerprint");
  assert.equal(referenceCriteriaPassed.reviewReceiptVersion, "visual-review-receipt/v1");
  assert.match(referenceCriteriaPassed.reviewReceiptFingerprint, /^[a-f0-9]{64}$/, "a post-review receipt must be content-addressed with SHA-256");
  assert.deepEqual(referenceCriteriaPassed.referenceCriteria.map((criterion) => criterion.id), referenceCriteria.map((criterion) => criterion.id));
  assert(referenceCriteriaPassed.referenceCriteria.every((criterion) => criterion.scope === "global"), "typed mechanics must default to sampled broad-review coverage");
  assert.match(referenceCriteriaPrompt, /REFERENCE-MECHANICS CRITERIA/, "typed mechanics must reach the existing reviewer request");
  assert.match(referenceCriteriaPrompt, /reference-mechanic-7/, "typed mechanics must not be truncated by the six-item QualityBar cap");

  const receiptWithDifferentPersistedFrameKey = visualReviewReceiptFingerprint({
    ran: referenceCriteriaPassed.ran,
    verdict: referenceCriteriaPassed.verdict,
    reviewFingerprint: referenceCriteriaPassed.reviewFingerprint,
    evidence: {
      ...referenceCriteriaPassed.evidence,
      frames: referenceCriteriaPassed.evidence.frames.map((frame, index) =>
        index === 0 ? { ...frame, r2Key: "reviews/fixture/frames/rebound-f001.jpg" } : frame,
      ),
    },
    defects: referenceCriteriaPassed.defects,
    referenceCriteria: referenceCriteriaPassed.referenceCriteria,
    referenceCriteriaComplete: referenceCriteriaPassed.referenceCriteriaComplete,
  });
  assert.notEqual(
    receiptWithDifferentPersistedFrameKey,
    referenceCriteriaPassed.reviewReceiptFingerprint,
    "the post-review receipt must bind persisted evidence frame keys",
  );
  const receiptWithDifferentSourceSha = visualReviewReceiptFingerprint({
    ran: referenceCriteriaPassed.ran,
    verdict: referenceCriteriaPassed.verdict,
    reviewFingerprint: referenceCriteriaPassed.reviewFingerprint,
    evidence: {
      ...referenceCriteriaPassed.evidence,
      source: { ...referenceCriteriaPassed.evidence.source, sha256: "f".repeat(64) },
    },
    defects: referenceCriteriaPassed.defects,
    referenceCriteria: referenceCriteriaPassed.referenceCriteria,
    referenceCriteriaComplete: referenceCriteriaPassed.referenceCriteriaComplete,
  });
  assert.notEqual(
    receiptWithDifferentSourceSha,
    referenceCriteriaPassed.reviewReceiptFingerprint,
    "the post-review receipt must bind the source SHA-256",
  );

  const outputChangedReceipt = await reviewRender(fixture, 18, {
    title: "Typed reference-criteria fixture",
    expectTitleCard: false,
    qualityCriteria: Array.from({ length: 7 }, (_, index) => `Generic prose criterion ${index + 1}`),
    referenceCriteria,
  }, {
    runId: "visual-review-reference-criteria-output-change",
    reviewer: async () => JSON.stringify({
      defects: [],
      referenceCriteria: referenceCriteria.map((criterion, index) => ({
        id: criterion.id,
        verdict: index === 0 ? "fail" : "pass",
        evidenceFrameIds: ["f001"],
      })),
      summary: "One typed reference mechanic visibly fails.",
    }),
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
  });
  assert.equal(outputChangedReceipt.reviewFingerprint, referenceCriteriaPassed.reviewFingerprint, "legacy reviewFingerprint must remain a plan/intent binding");
  assert.notEqual(
    outputChangedReceipt.reviewReceiptFingerprint,
    referenceCriteriaPassed.reviewReceiptFingerprint,
    "the post-review receipt must change when parsed reviewer verdicts change",
  );

  // A global criterion cannot clear the sampled-evidence gate with a pass in
  // only one broad batch.
  // The remaining batch is structurally valid but not observable, so this must
  // remain incomplete and escalate rather than silently inheriting the pass.
  let globalCriterionBroadBatchCount = 0;
  const incompleteGlobalCriterion = await reviewRender(fixture, 18, {
    title: "Global reference-criterion coverage fixture",
    expectTitleCard: false,
    referenceCriteria: [{
      id: "purposeful-change-map",
      criterion: "Every material visual change must purposefully advance the current story relationship.",
      scope: "global",
    }],
  }, {
    runId: "visual-review-incomplete-global-reference-criterion",
    reviewer: async (input) => {
      const verdict = input.phase === "broad" && globalCriterionBroadBatchCount++ === 0
        ? "pass"
        : "not_observable";
      return JSON.stringify({
        defects: [],
        referenceCriteria: [{
          id: "purposeful-change-map",
          verdict,
          evidenceFrameIds: [input.frames[0].id],
        }],
        summary: "Global criterion coverage fixture.",
      });
    },
    persistEvidence: false,
    maxFrames: 16,
    maxFocusFrames: 0,
  });
  assert(globalCriterionBroadBatchCount >= 2, "fixture must exercise more than one broad reviewer batch");
  assert.equal(incompleteGlobalCriterion.verdict, "needs_human", "one passing frame batch must not clear a global sampled-evidence gate");
  assert.equal(incompleteGlobalCriterion.referenceCriteriaComplete, false, "a global receipt requires passes from all sampled broad-review batches");
  assert.equal(incompleteGlobalCriterion.referenceCriteria[0]?.verdict, "not_observable");
  assert.match(incompleteGlobalCriterion.summary, /all sampled broad-review batches/i);

  const omittedReferenceCriteria = await reviewRender(fixture, 18, {
    title: "Omitted reference-criteria receipt fixture",
    expectTitleCard: false,
    referenceCriteria: [referenceCriteria[0]],
  }, {
    runId: "visual-review-omitted-reference-criteria",
    reviewer,
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
  });
  assert.equal(omittedReferenceCriteria.verdict, "needs_human", "an omitted requested reference receipt must never pass visual QA");
  assert.equal(omittedReferenceCriteria.referenceCriteriaComplete, false);
  assert.match(omittedReferenceCriteria.summary, /omitted or malformed requested reference criteria/i);

  const malformedReferenceCriteria = await reviewRender(fixture, 18, {
    title: "Malformed reference-criteria receipt fixture",
    expectTitleCard: false,
    referenceCriteria: [referenceCriteria[0]],
  }, {
    runId: "visual-review-malformed-reference-criteria",
    reviewer: async () => JSON.stringify({
      defects: [],
      referenceCriteria: [{
        id: referenceCriteria[0].id,
        verdict: "pass",
        evidenceFrameIds: ["not-a-reviewed-frame"],
      }],
      summary: "Malformed frame receipt fixture.",
    }),
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
  });
  assert.equal(malformedReferenceCriteria.verdict, "needs_human", "a malformed evidence-frame receipt must never pass visual QA");
  assert.equal(malformedReferenceCriteria.referenceCriteriaComplete, false);

  const planned = planVisualReviewEvidence({
    durationSec: 18,
    sceneTimes: [2, 6, 10, 15],
    transcriptCues: [{ text: "The speaker reacts.", startSec: 6, endSec: 8 }],
    overlays: [{ id: "bubble", startSec: 6, endSec: 10, kind: "comic_bubble" }],
    focusWindows: [{ startSec: 6, endSec: 8, reason: "repair" }],
    maxFrames: 40,
  });
  assert(planned.some((frame) => frame.selectionReasons.includes("scene")), "scene boundaries must contribute evidence");
  assert(planned.some((frame) => frame.selectionReasons.includes("cue")), "caption/narration cues must contribute evidence");
  assert(planned.filter((frame) => frame.selectionReasons.includes("focus")).length >= 4, "repair windows must receive dense evidence");

  // Temporal anchors are reserved before high-priority scene/cue/focus frames,
  // so a long master cannot silently lose its middle to priority truncation.
  const longDurationSec = 3_600;
  const longPlanned = planVisualReviewEvidence({
    durationSec: longDurationSec,
    sceneTimes: Array.from({ length: 120 }, (_, index) => index * 20 + 1),
    transcriptCues: Array.from({ length: 120 }, (_, index) => ({
      text: `Cue ${index + 1}`,
      startSec: index * 20 + 2,
      endSec: index * 20 + 8,
    })),
    focusWindows: [{ startSec: 4, endSec: 20, reason: "repair" }],
    maxFrames: 48,
  });
  assert.equal(longPlanned.length, 48, "broad evidence must stay within its configured cap");
  assert(longPlanned.filter((frame) => frame.selectionReasons.includes("uniform")).length >= 40, "long masters must retain their reserved temporal anchors");
  assert(
    plannedMaxGapSec(longPlanned, longDurationSec) <= maxAllowedVisualReviewGapSec(longDurationSec),
    "priority frames must not create an unreviewed long-duration middle",
  );

  // A real provider used this common phrase during the live comic proof. It
  // must become a typed, repairable occlusion rather than general_visual.
  const phrased = await reviewRender(fixture, 18, {
    title: "Comic category-normalization fixture",
    expectTitleCard: false,
  }, {
    runId: "visual-review-category-phrase",
    reviewer: phraseReviewer,
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
  });
  assert(
    phrased.defects.some((defect) => defect.category === "overlay_occlusion" && defect.source === "vision"),
    "provider wording such as covering the face must route to overlay_occlusion",
  );

  // A malformed model reply previously became an empty defect list and could
  // silently certify a weak render. Receipt completeness is now fail-closed.
  const malformedReceipt = await reviewRender(fixture, 18, {
    title: "Malformed reviewer receipt fixture",
    expectTitleCard: false,
  }, {
    runId: "visual-review-malformed-receipt",
    required: true,
    reviewer: malformedReviewer,
    persistEvidence: false,
    maxFrames: 8,
    maxFocusFrames: 0,
  });
  assert.equal(malformedReceipt.verdict, "needs_human", "an incomplete reviewer receipt must never certify visual QA");
  assert.match(malformedReceipt.summary, /incomplete structured receipt/i, "the receipt failure must be diagnosable");

  const work = await mkdtemp(join(tmpdir(), "ysa-visual-review-"));
  try {
    const sparseCoverage = join(work, "sparse-coverage.mp4");
    makeSparseCoverageFixture(sparseCoverage);
    const coverageEscalated = await reviewRender(sparseCoverage, 90, {
      title: "Required coverage-gate fixture",
      expectTitleCard: false,
    }, {
      runId: "visual-review-coverage-gate",
      required: true,
      reviewer,
      persistEvidence: false,
      maxFrames: 8,
      maxFocusFrames: 0,
    });
    assert.equal(coverageEscalated.verdict, "needs_human", "required review must not pass when its frame budget cannot cover the master");
    assert(
      coverageEscalated.evidence.coverage.maxGapSec > coverageEscalated.evidence.coverage.maxAllowedGapSec,
      "coverage evidence must record the failed cap",
    );
    assert.match(coverageEscalated.summary, /evidence gap/i, "coverage escalation must be diagnosable in the QA report");

    const badComic = join(work, "comic-overlay-defects.mp4");
    makeBadComic(fixture, badComic);
    const flawedIntent: VisualReviewIntent = {
      title: "The Silent Night — comic review fixture",
      topic: "A comic-book sequence",
      transcriptCues: [{ text: "The speaker reacts.", startSec: 6, endSec: 10 }],
      overlays: [
        {
          id: "p0-b0",
          kind: "comic_bubble",
          startSec: 6,
          endSec: 10,
          rect: [0.22, 0.15, 0.46, 0.48],
          keepClear: [[0.35, 0.22, 0.20, 0.22]],
        },
        {
          id: "p0-b1",
          kind: "comic_bubble",
          startSec: 6,
          endSec: 10,
          rect: [0.88, 0.58, 0.25, 0.25],
          keepClear: [],
        },
      ],
    };
    const failed = await reviewRender(badComic, 18, flawedIntent, {
      runId: "visual-review-fixture",
      reviewer,
      persistEvidence: false,
      maxFrames: 28,
      maxFocusFrames: 16,
    });
    assert.equal(failed.verdict, "fail", "real comic render with bad overlay geometry must fail visual review");
    assert(failed.defects.some((defect) => defect.category === "overlay_occlusion" && defect.startSec >= 6 && defect.startSec <= 10));
    assert(failed.defects.some((defect) => defect.category === "overlay_off_canvas" && defect.startSec >= 6 && defect.startSec <= 10));
    assert(failed.evidence.frames.some((frame) => frame.selectionReasons.includes("focus")), "detected faults must trigger focused re-review evidence");

    const signals = visualRepairSignals(failed, flawedIntent);
    assert(signals.length >= 2, "blocking visual defects must become bounded repair signals");
    assert(signals.every((signal) => signal.owner === "motion_comic" && signal.action === "reflow_bubble"));
    const blocks: HealableBlock[] = [
      { id: "motion_comic", produces: ["videoLocalPath", "motionComicTimeline"], consumes: ["topic"], paid: true },
      { id: "qa_visual", produces: ["qaReport"], consumes: ["videoLocalPath", "motionComicTimeline"] },
    ];
    const heal = planHeal("qa_visual FAILED: visual review", blocks, () => {}, signals);
    assert.deepEqual(heal?.rerunBlocks, ["motion_comic", "qa_visual"], "comic overlay repair must rerender then rereview");
    assert(heal?.visualRepair?.every((signal) => signal.action === "reflow_bubble"));

    // The repaired render is the untouched Golden comic and has valid layout
    // geometry. It is re-reviewed with the same evidence path, not simply
    // marked fixed by the healer.
    const repaired = await reviewRender(fixture, 18, {
      ...flawedIntent,
      overlays: [{
        id: "p0-b0",
        kind: "comic_bubble",
        startSec: 6,
        endSec: 10,
        rect: [0.05, 0.05, 0.20, 0.14],
        keepClear: [[0.45, 0.30, 0.18, 0.22]],
      }],
      focusWindows: [{ startSec: 4.8, endSec: 11.2, reason: "repair" }],
    }, {
      runId: "visual-review-fixture-repaired",
      reviewer,
      persistEvidence: false,
      maxFrames: 28,
      maxFocusFrames: 16,
    });
    assert.equal(repaired.verdict, "pass", "layout-only repair must pass its focused re-review");
    assert(repaired.evidence.frames.some((frame) => frame.selectionReasons.includes("focus")), "repaired range must be re-reviewed densely");
    console.log("visual review comic fixture test passed");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

void main();
