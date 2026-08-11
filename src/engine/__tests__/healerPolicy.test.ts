import assert from "node:assert/strict";
import { planHeal, type HealableBlock, type VisualRepairSignal } from "@/engine/healer";

const blocks: HealableBlock[] = [
  { id: "thumbnail_gen", produces: ["thumbnailKey"], consumes: ["title"], paid: true },
  { id: "qa_visual", produces: ["qaReport"], consumes: ["thumbnailKey"] },
];

function main(): void {
  assert.equal(
    planHeal("thumbnail score 4: illegible, cluttered and amateur", blocks),
    null,
    "quality rejection must fail closed instead of replaying an identical paid checkpoint",
  );
  assert.equal(
    planHeal("both attempts failed the gate", blocks),
    null,
    "legacy thumbnail-gate text must not trigger a blind self-heal loop",
  );

  const missingArtifact = planHeal("thumbnail missing from uploaded draft", blocks);
  assert.deepEqual(missingArtifact?.rerunBlocks, ["thumbnail_gen", "qa_visual"]);
  assert.match(missingArtifact?.reason ?? "", /restore checkpoint \+ persist/);

  const comicBlocks: HealableBlock[] = [
    { id: "motion_comic", produces: ["videoLocalPath", "motionComicTimeline"], consumes: ["topic"], paid: true },
    { id: "qa_visual", produces: ["qaReport"], consumes: ["videoLocalPath", "motionComicTimeline"] },
  ];
  const reviewSignal: VisualRepairSignal = {
    schemaVersion: 1,
    owner: "motion_comic",
    action: "reflow_bubble",
    category: "overlay_occlusion",
    severity: "major",
    startSec: 6,
    endSec: 9,
    observed: "Bubble covers a character face",
    expected: "Bubble avoids the face",
    confidence: 0.98,
    targetId: "p0-b0",
    forbiddenRects: [[0.2, 0.2, 0.3, 0.2]],
  };
  const visualPlan = planHeal("qa_visual FAILED: visual review", comicBlocks, () => {}, [reviewSignal]);
  assert.deepEqual(visualPlan?.rerunBlocks, ["motion_comic", "qa_visual"]);
  assert.deepEqual(visualPlan?.visualRepair, [reviewSignal]);
  assert.match(visualPlan?.hints.motion_comic?.[0] ?? "", /overlay_occlusion/);

  healClassDeclarationTests();

  console.log("healer policy tests passed");
}

/**
 * TYPED HEAL CLASS (P0-1 step 2).
 *
 * `timeline_assemble` chooses between a ~4-min surgical re-finish and a ~40-min
 * full rebuild. It used to make that call by running a regex over the healer's
 * free-text hints; the wording drifted, the match stopped firing, and every
 * overlay heal silently paid the full recompose — undetectable, because both
 * branches yield a correct video and only the bill differs.
 *
 * The strategy is now DECLARED per defect class. These assertions are the
 * contract: they pin each defect to its repair surface so a future edit to the
 * catalog cannot quietly re-route spend. The consumer's rule is
 * `every(c => c === "overlay_finish")` — a mixed diagnosis must take the branch
 * that can fix BOTH defects, which is the rebuild.
 */
function healClassDeclarationTests(): void {
  const timelineBlocks: HealableBlock[] = [
    { id: "stock_footage", produces: ["footageClips"], consumes: ["narrationText"], paid: true },
    { id: "timeline_assemble", produces: ["videoLocalPath"], consumes: ["footageClips"] },
    { id: "qa_visual", produces: ["qaReport"], consumes: ["videoLocalPath"] },
  ];
  const classesFor = (failure: string, block = "timeline_assemble"): string[] =>
    [...(planHeal(failure, timelineBlocks)?.healClasses[block] ?? [])].sort();

  // Composited-on-top defects: repairable from the persisted pre-overlay master.
  assert.deepEqual(classesFor("captions missing: 42 cues prepared but 0 burned"), ["overlay_finish"]);
  assert.deepEqual(classesFor("quotes missing: 3 generated but 0 composited"), ["overlay_finish"]);
  // The loudnorm pass runs in the finishing stage, exactly as this rule's label
  // ("re-finish (loudnorm pass)") always claimed. The prose regex could never
  // see that — the QA string carries no overlay/caption wording — so this class
  // paid a full recompose to redo a step the cheap path performs.
  assert.deepEqual(classesFor("audio loudness -34.2 LUFS outside the sane band [-30,-8]"), ["overlay_finish"]);

  // Baked into the compose output the pre-overlay master already contains:
  // re-finishing would faithfully preserve the defect.
  assert.deepEqual(classesFor("qa_visual FAILED: black segment at 42s"), ["body_rebuild"]);
  assert.deepEqual(classesFor("outro card missing: outro render/compose failed"), ["body_rebuild"]);
  assert.deepEqual(classesFor("music missing from mix"), ["body_rebuild"]);

  // Mixed diagnosis → both classes declared, so the consumer's `every` check
  // correctly refuses the surgical path.
  assert.deepEqual(
    classesFor("captions missing: 12 cues prepared | black segment at 12s"),
    ["body_rebuild", "overlay_finish"],
  );

  // A block pulled into the rerun set ONLY by the downstream closure has no
  // declared class — its consumer must fall back to its conservative branch
  // rather than inherit someone else's strategy.
  const footagePlan = planHeal("footage contradicts the channel's visual world", timelineBlocks);
  assert.deepEqual(footagePlan?.healClasses.stock_footage, ["body_rebuild"]);
  assert.ok(footagePlan?.rerunBlocks.includes("timeline_assemble"), "closure must still re-run the timeline");
  assert.equal(footagePlan?.healClasses.timeline_assemble, undefined, "closure membership must not declare a class");

  // A bounded reviewer action already names its repair surface.
  const overlaySignal: VisualRepairSignal = {
    schemaVersion: 1,
    owner: "timeline_assemble",
    action: "recompose_overlay",
    category: "overlay_occlusion",
    severity: "major",
    startSec: 8,
    endSec: 11,
    observed: "Quote card covers the subject",
    expected: "Quote card sits clear of the subject",
    confidence: 0.95,
  };
  assert.deepEqual(
    planHeal("qa_visual FAILED: visual review", timelineBlocks, () => {}, [overlaySignal])
      ?.healClasses.timeline_assemble,
    ["overlay_finish"],
  );
  assert.deepEqual(
    planHeal("qa_visual FAILED: visual review", timelineBlocks, () => {}, [
      { ...overlaySignal, owner: "stock_footage", action: "resample_footage" },
    ])?.healClasses.stock_footage,
    ["body_rebuild"],
  );
}

main();
