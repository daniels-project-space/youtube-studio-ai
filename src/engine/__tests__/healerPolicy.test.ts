import assert from "node:assert/strict";
import { planHeal, type HealableBlock } from "@/engine/healer";

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

  console.log("healer policy tests passed");
}

main();
