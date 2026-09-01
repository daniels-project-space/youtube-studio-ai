import assert from "node:assert/strict";

import {
  CHARACTER_ANGLE_ATLAS_VIEWS,
  createCharacterAngleAtlasExperiment,
  createVisualAtlasExperimentPlan,
  createVisualAtlasQualificationReceipt,
  selectVisualAtlasCandidate,
  visualAtlasCellAddress,
  VisualAtlasExperimentPlanSchema,
  type VisualAtlasFrame,
  type VisualAtlasGridSize,
} from "@/engine/visualAtlasExperiment";
import {
  createMotionComicVisualAtlasExperiment,
  projectMotionComicVisualCharacter,
  projectMotionComicVisualScene,
  type MotionComicStoryboard,
} from "@/lib/motionComic";

const sha = (letter: string) => letter.repeat(64);
const identityAnchors = ["line-language", "palette", "wardrobe-construction", "channel-motif"];
const identityAnchorDefinitions = identityAnchors.map((id, index) => ({
  id,
  role: (["line_language", "palette", "wardrobe", "motif"] as const)[index],
  instruction: `Preserve the exact ${id.replaceAll("-", " ")} established by the channel identity in every frame.`,
  sourceFingerprint: sha((index + 1).toString(16)),
}));
const visualElements = ["face", "hair", "wardrobe", "hands", "silhouette"];

const characterPlan = createCharacterAngleAtlasExperiment({
  ownerId: "owner-daniel",
  channelId: "channel-heist",
  channelIdentityFingerprint: sha("a"),
  characterSpecFingerprint: sha("b"),
  characterId: "character-mara",
  identityAnchors: identityAnchorDefinitions,
  visualElementIds: visualElements,
});

assert.equal(characterPlan.frames.length, 16);
assert.deepEqual(characterPlan.frames.map((frame) => frame.frameId), [...CHARACTER_ANGLE_ATLAS_VIEWS]);
assert.deepEqual(
  characterPlan.variants.map((variant) => ({
    grid: variant.gridSize,
    sheets: variant.sheetCount,
    tile: variant.tilePixels,
    status: variant.geometryStatus,
  })),
  [
    { grid: 2, sheets: 4, tile: 1_024, status: "renderable" },
    { grid: 4, sheets: 1, tile: 512, status: "renderable" },
    { grid: 8, sheets: 1, tile: 256, status: "geometry_blocked" },
    { grid: 16, sheets: 1, tile: 128, status: "geometry_blocked" },
  ],
  "2K geometry should render only the 2x2 and 4x4 experiments",
);
assert.match(characterPlan.variants[2].blocker ?? "", /raise the canvas to at least 4096px/i);
assert.match(characterPlan.variants[3].blocker ?? "", /raise the canvas to at least 8192px/i);

assert.deepEqual(visualAtlasCellAddress(characterPlan, 4, 0), {
  sheetIndex: 0,
  row: 0,
  column: 0,
  coordinate: "A1",
  crop: [0, 0, 512, 512],
});
assert.deepEqual(visualAtlasCellAddress(characterPlan, 4, 15), {
  sheetIndex: 0,
  row: 3,
  column: 3,
  coordinate: "D4",
  crop: [1536, 1536, 512, 512],
});
assert.deepEqual(visualAtlasCellAddress(characterPlan, 2, 4), {
  sheetIndex: 1,
  row: 0,
  column: 0,
  coordinate: "A1",
  crop: [0, 0, 1024, 1024],
});

const storyboardFrames: VisualAtlasFrame[] = Array.from({ length: 16 }, (_, index) => ({
  frameId: `beat-${String(index + 1).padStart(2, "0")}`,
  sequenceIndex: index,
  shot: index % 3 === 0 ? "wide" : index % 3 === 1 ? "medium" : "close",
  description: `Causal story beat ${index + 1}; show the stated action, consequence, and continuity change.`,
  persistentIdentityAnchorIds: identityAnchors,
  visualElementIds: [`beat-prop-${index + 1}`, "channel-motif"],
  characterIds: index % 2 ? ["character-mara"] : ["character-mara", "character-sol"],
  motion: {
    camera: index % 2 ? "slow push in" : "measured lateral track",
    subject: "visible purposeful movement begins immediately",
    environment: "secondary layers move subtly from the opening frame",
    beginsAtFrameZero: true,
  },
}));

const storyboardPlan = createVisualAtlasExperimentPlan({
  useCase: "storyboard_sequence",
  ownerId: "owner-daniel",
  channelId: "channel-heist",
  channelIdentityFingerprint: sha("c"),
  sourcePlanFingerprint: sha("d"),
  identityAnchors: identityAnchorDefinitions,
  frames: storyboardFrames,
});
assert.equal(storyboardPlan.baseline.plannedProviderCalls, 16);
assert.equal(storyboardPlan.variants.find((variant) => variant.gridSize === 4)?.plannedProviderCalls, 1);

const liveMotionComicStoryboard: MotionComicStoryboard = {
  title: "The Quiet Workshop",
  logline: "An engineer traces the failure before the winter crossing.",
  narratorVoiceId: "storyteller",
  characters: [{
    id: "mara",
    name: "Mara",
    visual: projectMotionComicVisualCharacter({ age: "adult", role: "engineer" }),
    voiceId: "storyteller",
  }],
  panels: ["discovering", "examining", "repairing", "departing"].map((action, index) => ({
    visual: projectMotionComicVisualScene({
      environment: index < 2 ? "workshop" : "bridge",
      era: "historic",
      subjects: ["engineer"],
      objects: index < 2 ? ["lantern", "map"] : ["lantern", "rope"],
      action,
      relations: [index < 2 ? "subject_examines_object" : "subject_carries_object"],
      mood: index < 3 ? "tense" : "resolved",
      lighting: "moonlight",
    }),
    characters: ["mara"],
    shot: (["wide", "medium", "close", "wide"] as const)[index],
    lines: [{ speaker: "narrator", text: `Causal story beat ${index + 1} remains bound to the same world and subject.` }],
  })),
};
const liveMotionComicPlan = createMotionComicVisualAtlasExperiment({
  ownerId: "owner-daniel",
  channelId: "channel-heist",
  channelIdentityFingerprint: sha("c"),
  identityAnchors: identityAnchorDefinitions,
  storyboard: liveMotionComicStoryboard,
});
assert.equal(liveMotionComicPlan.frameCount, liveMotionComicStoryboard.panels.length);
assert.ok(
  liveMotionComicPlan.frames.every((frame) =>
    identityAnchors.every((anchor) => frame.persistentIdentityAnchorIds.includes(anchor)) &&
    frame.motion.beginsAtFrameZero,
  ),
  "the real motion-comic adapter must carry all channel anchors and immediate motion into every panel",
);
assert.ok(
  liveMotionComicPlan.frames[3]?.visualElementIds.some((id) => id.includes("rope")),
  "late storyboard-specific objects must survive the adapter, not only opening imagery",
);

const missingIdentity = structuredClone(storyboardPlan);
missingIdentity.frames[9].persistentIdentityAnchorIds = ["line-language"];
missingIdentity.fingerprint = sha("e");
assert.throws(
  () => VisualAtlasExperimentPlanSchema.parse(missingIdentity),
  /drops persistent channel identity anchor/i,
  "every frame—not only the opening few—must retain the channel identity",
);

const atlasArtifacts = (gridSize: VisualAtlasGridSize) => {
  const variant = storyboardPlan.variants.find((candidate) => candidate.gridSize === gridSize)!;
  return Array.from({ length: variant.sheetCount }, (_, sheetIndex) => ({
    sheetIndex,
    r2Key: `owner/daniel/atlas/${gridSize}/sheet-${sheetIndex}.png`,
    contentSha256: sha((sheetIndex % 6).toString(16)),
    width: variant.canvasPixels,
    height: variant.canvasPixels,
    byteLength: 1_000_000 + sheetIndex,
  }));
};

const crops = (gridSize: VisualAtlasGridSize, scores: {
  quality: number;
  continuity: number;
  identity?: number;
  elements?: number;
}) => {
  const variant = storyboardPlan.variants.find((candidate) => candidate.gridSize === gridSize)!;
  return storyboardPlan.frames.map((frame, frameIndex) => {
    const address = visualAtlasCellAddress(storyboardPlan, gridSize, frameIndex);
    return {
      frameId: frame.frameId,
      sheetIndex: address.sheetIndex,
      coordinate: address.coordinate,
      r2Key: `owner/daniel/atlas/${gridSize}/crop-${frame.frameId}.png`,
      contentSha256: sha((frameIndex % 6).toString(16)),
      width: variant.tilePixels,
      height: variant.tilePixels,
      byteLength: 50_000 + frameIndex,
      identityAnchorCoverage: scores.identity ?? 1,
      visualElementCoverage: scores.elements ?? 1,
      legibilityScore: scores.quality,
      continuityScore: scores.continuity,
    };
  });
};

const reviewer = (letter: string, verdict: "pass" | "fail" = "pass") => ({
  kind: "human_visual_review" as const,
  reviewerId: "reviewer-daniel",
  reviewReceiptFingerprint: sha(letter),
  verdict,
  notes: verdict === "pass"
    ? "Reviewed every crop at native resolution and the full row-major sequence; identity, required objects, and continuity pass."
    : "One or more crops lose the recurring identity.",
});

// The 2x2 variant stands in for the measured independent-quality baseline in
// this pure contract test; it uses four real sheets and sixteen audited crops.
const baseline = createVisualAtlasQualificationReceipt({
  plan: storyboardPlan,
  gridSize: 2,
  providerCalls: 4,
  observedCostUsd: 0.16,
  observedRuntimeSec: 96,
  atlasArtifacts: atlasArtifacts(2),
  crops: crops(2, { quality: 0.91, continuity: 0.88 }),
  reviewer: reviewer("b"),
});
const candidate = createVisualAtlasQualificationReceipt({
  plan: storyboardPlan,
  gridSize: 4,
  providerCalls: 1,
  observedCostUsd: 0.04,
  observedRuntimeSec: 31,
  atlasArtifacts: atlasArtifacts(4),
  crops: crops(4, { quality: 0.92, continuity: 0.9 }),
  reviewer: reviewer("c"),
});
assert.deepEqual(selectVisualAtlasCandidate({ plan: storyboardPlan, baseline, candidate }), {
  decision: "qualified",
  reasons: [],
  selectedGridSize: 4,
  savings: { providerCalls: 3, costUsd: 0.12, runtimeSec: 65 },
});

const identityDrop = createVisualAtlasQualificationReceipt({
  plan: storyboardPlan,
  gridSize: 4,
  providerCalls: 1,
  observedCostUsd: 0.04,
  observedRuntimeSec: 31,
  atlasArtifacts: atlasArtifacts(4),
  crops: crops(4, { quality: 0.94, continuity: 0.93, identity: 0.99 }),
  reviewer: reviewer("d"),
});
assert.deepEqual(
  selectVisualAtlasCandidate({ plan: storyboardPlan, baseline, candidate: identityDrop }),
  {
    decision: "rejected",
    reasons: ["at least one atlas crop drops a persistent channel identity anchor"],
  },
  "an attractive/cheap atlas must still fail when any channel identity anchor is missing",
);

assert.throws(
  () => createVisualAtlasQualificationReceipt({
    plan: storyboardPlan,
    gridSize: 8,
    providerCalls: 1,
    observedCostUsd: 0.03,
    observedRuntimeSec: 25,
    atlasArtifacts: atlasArtifacts(8),
    crops: crops(8, { quality: 1, continuity: 1 }),
    reviewer: reviewer("e"),
  }),
  /quality floor is 512px/i,
  "8x8 at 2K must be rejected before provider spend rather than accepted from a prompt claim",
);

console.log("VISUAL ATLAS EXPERIMENT PASS: geometry, full identity coverage, crop binding, and reviewed selection");
