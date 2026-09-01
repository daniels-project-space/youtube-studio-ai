import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const comicEngine = read("lib", "motionComic.ts");
const whiteboardEngine = read("lib", "whiteboardSync.ts");
const comicBlock = read("trigger", "blocks", "motionComicBlocks.ts");
const whiteboardBlock = read("trigger", "blocks", "whiteboardScribeBlocks.ts");
const qaVisual = read("trigger", "blocks", "narratedBlocks.ts");

for (const [label, source] of [
  ["motion comic", comicBlock],
  ["whiteboard", whiteboardBlock],
] as const) {
  for (const output of [
    "narrationKey",
    "narrationLocalPath",
    "narrationDurationSec",
    "narrationTranscriptText",
    "narrationPerformanceEvidence",
    "sentenceTimings",
    "narrationStartSec",
  ]) {
    assert.match(source, new RegExp(`"${output}"`), `${label} must expose ${output} to final QA`);
  }
  assert.match(
    source,
    /preflightNarrationPerformance\(/,
    `${label} must measure the actual voice-only source before it can enter QA`,
  );
  assert.match(
    source,
    /putObjectFromFile\(narrationKey, res\.narrationPath/,
    `${label} must retain a durable source-audio artifact for a retrying QA worker`,
  );
}

assert.match(
  comicEngine,
  /narrationPath: narration,[\s\S]{0,180}narrationStartSec: PREROLL_MS \/ 1000/,
  "motion comic must declare its intentional visual pre-roll rather than masquerading as zero-offset speech",
);
assert.match(
  comicEngine,
  /const sentenceTimings: Array<\{ text: string; start: number; end: number \}> = \[\]/,
  "motion comic must retain source-relative cues for the lines that actually reached its narration mix",
);
assert.match(
  comicEngine,
  /spokenNarration\.push\(line\.text\)/,
  "motion comic transcript evidence must exclude dialogue lines that failed synthesis",
);

assert.match(
  whiteboardEngine,
  /narrationPath: mp3Path,[\s\S]{0,180}narrationStartSec: 2\.6/,
  "whiteboard must declare its intentional hand/title pre-roll",
);
assert.match(
  whiteboardEngine,
  /start: word\.start \/ 1000,[\s\S]{0,80}end: word\.end \/ 1000/,
  "whiteboard must convert its renderer-local millisecond word alignment into QA's seconds contract",
);

assert.match(
  qaVisual,
  /const rawNarrationStartSec = ctx\.store\["narrationStartSec"\]/,
  "QA must accept a renderer-declared narration offset",
);
assert.match(
  qaVisual,
  /narration start evidence is malformed or outside the final master duration/,
  "QA must fail closed rather than trusting an invalid renderer-declared narration offset",
);
assert.match(
  qaVisual,
  /declaredNarrationStartSec[\s\S]{0,500}\? declaredNarrationStartSec[\s\S]{0,500}: ctx\.store\["introApplied"\]/,
  "a valid renderer-declared offset must take precedence over the legacy intro-card fallback",
);
assert.match(
  qaVisual,
  /finalMasterTranscriptCues\(\{[\s\S]{0,260}sentenceTimings:[\s\S]{0,180}narrationStartSec,[\s\S]{0,180}finalMasterDurationSec:/,
  "the visual reviewer must receive narration cues shifted onto the released master's clock",
);

assert.match(
  qaVisual,
  /selfContainedStoryPlanEvidence\?\.narrationTextSha256[\s\S]{0,600}finalMasterNarrationSemantic[\s\S]{0,600}expectedTextSha256/,
  "production QA must bind a narrated self-contained plan to the exact narration semantically audited in the final master",
);
assert.match(
  qaVisual,
  /self-contained narrated plan does not match the exact narration audited in the final master/,
  "a substituted renderer narration must be a production-critical failure rather than a plan-only advisory",
);
assert.match(
  qaVisual,
  /selfContainedStoryVisualReviewPlanFromReceipt\([\s\S]{0,650}sentenceTimings:[\s\S]{0,240}narrationStartSec:[\s\S]{0,240}whiteboardRenderSchedule:/,
  "QA must derive plan-bound final-master locks and exact whiteboard evidence from the sealed receipt and renderer schedule",
);
assert.match(
  qaVisual,
  /creativeLocks: \[[\s\S]{0,320}selfContainedStoryVisualPlan\.creativeLocks/,
  "every self-contained panel lock must feed the actual visual-review evidence plan rather than a logging-only path",
);
assert.match(
  qaVisual,
  /completeFocusFrames: selfContainedStoryVisualPlan\.requiredEvidenceFrames/,
  "every renderer-authored whiteboard trace/completion sample must bypass the generic focus cap",
);
assert.match(
  qaVisual,
  /storySpineVisualReviewLocks\(\{[\s\S]{0,420}expectedStorySpineFingerprint:[\s\S]{0,180}narrationStartSec,[\s\S]{0,180}finalMasterDurationSec:/,
  "validated Story Spine shots must be rebound to final-master time before visual review",
);
assert.match(
  qaVisual,
  /creativeLocks: \[[\s\S]{0,420}storySpineVisualLocks/,
  "Story Spine shot locks must feed the actual final visual reviewer",
);

console.log("SELF-CONTAINED NARRATION FINAL-QA WIRING PASS");
