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

  console.log("healer policy tests passed");
}

main();
