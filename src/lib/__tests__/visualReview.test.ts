import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planHeal, type HealableBlock } from "@/engine/healer";
import {
  channelVisualReviewProfile,
  planVisualReviewEvidence,
  reviewRender,
  visualRepairSignals,
  type VisualReviewIntent,
} from "@/lib/visualReview";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const fixture = join(process.cwd(), "public", "golden", "comic", "comic3d.mp4");
const reviewer = async () => JSON.stringify({ defects: [], summary: "No model findings in hermetic geometry test." });
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

async function main(): Promise<void> {
  const comicProfile = channelVisualReviewProfile({
    contentLaneKey: "motion_comic",
    primaryRenderer: "motion_comic",
    channelName: "Silent Night Stories",
    persona: "Comic history fans",
    styleGrammar: "inked panels; restrained captions",
    qualityDimensions: ["identity", "footage"],
  });
  assert.match(comicProfile.expectedStructure, /speech bubbles/i, "comic channels must tell the reviewer their layout contract");
  assert.match(comicProfile.channelWorld ?? "", /Silent Night Stories/, "frozen channel identity must reach the reviewer");

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

  const work = await mkdtemp(join(tmpdir(), "ysa-visual-review-"));
  try {
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
