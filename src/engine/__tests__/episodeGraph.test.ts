import assert from "node:assert/strict";

import {
  assertEpisodeGraph,
  assertEpisodeGraphAgainstStorySpine,
  buildEpisodeGraph,
  compileSceneManifest,
  DETERMINISTIC_SCENE_RENDERER,
  episodeGraphFingerprint,
} from "@/engine/episodeGraph";
import { buildEpisodeGraphFromStorySpine } from "@/trigger/blocks/episodeGraphBlocks";
import { assertChildContentSafety } from "@/trigger/blocks/childrenSafetyBlocks";
import { assertSceneCompilerAdmission } from "@/trigger/blocks/sceneCompilerBlocks";
import { assertLearningContract, buildLearningContract } from "@/engine/learningContract";
import { contentLaneForFamily } from "@/engine/contentLane";
import { sceneKindFor } from "@/remotion/sceneCompiler/SceneCompiler";
import {
  evidenceVisualManifestFingerprint,
  type EvidenceVisualManifest,
} from "@/engine/evidenceVisualManifest";
import { createEditorialEvidencePacket } from "@/engine/editorialEvidencePacket";

const graphInput = {
  seriesId: "series-curious-lantern",
  episodeId: "episode-how-seeds-grow",
  topic: "How seeds begin to grow",
  audience: "children" as const,
  durationSec: 12,
  sources: [
    {
      id: "source-curriculum-plants",
      kind: "curriculum" as const,
      label: "Primary science: how plants grow",
      locator: "curriculum://primary-science/plants",
    },
    {
      id: "source-script-seeds",
      kind: "script" as const,
      label: "Approved episode script",
      locator: "script://how-seeds-grow/v1",
    },
  ],
  characterIds: ["character-mira"],
  settingIds: ["setting-garden"],
  characters: [
    {
      id: "character-mira",
      displayName: "Mira",
      continuityLock: "Mira wears a yellow raincoat and carries a small green watering can.",
    },
  ],
  settings: [
    {
      id: "setting-garden",
      displayName: "Sunny garden",
      continuityLock: "A small raised garden bed with warm morning light and a blue fence.",
    },
  ],
  beats: [
    {
      id: "beat-seed-question",
      kind: "question" as const,
      t0: 0,
      t1: 6,
      claim: "Seeds need helpful conditions before they can grow.",
      learningObjective: "Explain that seeds need water and light to grow.",
      scenePurpose: "Present a clear question about the seed.",
      sourceRefs: ["source-script-seeds", "source-curriculum-plants"],
      characterIds: ["character-mira"],
      settingId: "setting-garden",
      text: "Mira finds a tiny seed and wonders what will help it grow.",
      camera: { framing: "medium" as const, move: "push" as const },
      visualState: { action: "Mira kneels beside the garden bed and holds the seed in her open hand.", props: ["seed"] },
      transition: "cut" as const,
      storySpineBeatIds: ["beat-opening"],
      storySpineSentenceIds: ["sentence-opening"],
    },
    {
      id: "beat-seed-lesson",
      kind: "lesson" as const,
      t0: 6,
      t1: 12,
      claim: "Water and light help a seed start to grow.",
      learningObjective: "Explain that seeds need water and light to grow.",
      scenePurpose: "Answer the question with a visible, gentle routine.",
      sourceRefs: ["source-script-seeds", "source-curriculum-plants"],
      characterIds: ["character-mira"],
      settingId: "setting-garden",
      text: "Mira gives the seed water and places it where warm sunlight can reach it.",
      camera: { framing: "wide" as const, move: "static" as const },
      visualState: { action: "Mira gently waters the seed while sunlight crosses the garden bed.", props: ["watering can", "seed"] },
      transition: "match_cut" as const,
      storySpineBeatIds: ["beat-lesson"],
      storySpineSentenceIds: ["sentence-lesson"],
    },
  ],
  causalEdges: [
    {
      id: "edge-question-teaches",
      fromBeatId: "beat-seed-question",
      toBeatId: "beat-seed-lesson",
      relation: "teaches" as const,
      rationale: "The question is answered with a visible, safe growing routine.",
      sourceRefs: ["source-curriculum-plants"],
    },
  ],
};

const graph = buildEpisodeGraph(graphInput);
assert.equal(graph.version, "episode-graph/v1");
assert.equal(graph.beats.length, 2);
assert.equal(assertEpisodeGraph(graph).episodeId, graph.episodeId);
assert.match(episodeGraphFingerprint(graph), /^[a-f0-9]{64}$/);
assert.equal(episodeGraphFingerprint(graph), episodeGraphFingerprint(structuredClone(graph)));

const sceneManifest = compileSceneManifest(graph);
assert.equal(sceneManifest.renderer, DETERMINISTIC_SCENE_RENDERER);
assert.equal(sceneManifest.externalProviderCalls, 0, "the pure scene compiler must never imply a paid media call");
assert.deepEqual(sceneManifest.scenes.map((scene) => scene.beatId), ["beat-seed-question", "beat-seed-lesson"]);
assert.deepEqual(sceneManifest.scenes[1].causalInputBeatIds, ["beat-seed-question"]);
assert.equal(sceneManifest.scenes[1].settingId, "setting-garden");
assert.deepEqual(sceneManifest.scenes[0].visualState.props, ["seed"]);
assert.deepEqual(sceneManifest.scenes[1].visualState.props, ["seed", "watering can"]);
assert.equal(sceneManifest.scenes[0].label, "Seeds need helpful conditions before they can grow.");
assert.match(sceneManifest.fingerprint, /^[a-f0-9]{64}$/);

const invalidGap = structuredClone(graph);
invalidGap.beats[1].t0 = 7;
assert.throws(() => assertEpisodeGraph(invalidGap), /uncovered interval/);

const invalidCausalDirection = structuredClone(graph);
invalidCausalDirection.causalEdges[0].fromBeatId = "beat-seed-lesson";
invalidCausalDirection.causalEdges[0].toBeatId = "beat-seed-question";
assert.throws(() => assertEpisodeGraph(invalidCausalDirection), /must advance forward/);

const unknownCharacter = structuredClone(graph);
unknownCharacter.beats[1].characterIds = ["character-stranger"];
assert.throws(() => assertEpisodeGraph(unknownCharacter), /unknown id character-stranger/);

const unsafeChildCopy = structuredClone(graph);
unsafeChildCopy.beats[0].text = "Mira finds a gun in the garden.";
assert.throws(() => assertEpisodeGraph(unsafeChildCopy), /child-unsafe or promotional language/);

const scriptOnlyChildClaim = structuredClone(graph);
scriptOnlyChildClaim.beats[0].sourceRefs = ["source-script-seeds"];
assert.throws(() => assertEpisodeGraph(scriptOnlyChildClaim), /requires a curriculum or primary source reference/);

const storySpine = {
  version: "1.0.0" as const,
  timedScript: {
    version: "1.0.0" as const,
    narrationDurationSec: 12,
    sentences: [
      { id: "sentence-opening", text: "Mira finds a tiny seed.", t0: 0, t1: 6, sectionId: "section-opening", evidenceRefs: [] },
      { id: "sentence-lesson", text: "Mira gives it water and light.", t0: 6, t1: 12, sectionId: "section-lesson", evidenceRefs: [] },
    ],
  },
  narrativeBeats: [
    { id: "beat-opening", sourceSentenceIds: ["sentence-opening"], t0: 0, t1: 6, purpose: "question", evidenceRefs: [] },
    { id: "beat-lesson", sourceSentenceIds: ["sentence-lesson"], t0: 6, t1: 12, purpose: "lesson", evidenceRefs: [] },
  ],
  continuityLedger: {
    version: "1.0.0" as const,
    entities: [{ id: "character-mira", name: "Mira", look: "yellow raincoat" }],
    locations: [{ id: "setting-garden", name: "Garden", look: "raised bed" }],
    era: "present day",
    wardrobe: ["yellow raincoat"],
    props: ["watering can"],
    palette: ["yellow", "green"],
    cameraGrammar: ["gentle push"],
    negativeConstraints: ["logos"],
  },
  shotList: [
    {
      id: "shot-opening", beatId: "beat-opening", sourceSentenceIds: ["sentence-opening"], t0: 0, t1: 6,
      coveragePurpose: "question", literalContent: "Mira holds a seed.", entities: ["character-mira"],
      locationId: "setting-garden", era: "present day", wardrobe: ["yellow raincoat"], props: ["seed"],
      continuityState: "Mira is in the garden", cameraMove: "static" as const, shotScale: "medium" as const,
      lens: "35mm", lighting: "sunny", motion: "Mira raises her hand.", negative: "logos",
      generationProfile: "draft" as const, candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
      prompt: "Mira holds a seed.", seconds: 6, storyFunction: "opening", section: "section-opening", seed: 1,
    },
    {
      id: "shot-lesson", beatId: "beat-lesson", sourceSentenceIds: ["sentence-lesson"], t0: 6, t1: 12,
      coveragePurpose: "lesson", literalContent: "Mira waters a seed.", entities: ["character-mira"],
      locationId: "setting-garden", era: "present day", wardrobe: ["yellow raincoat"], props: ["watering can"],
      continuityState: "Mira remains in the garden", cameraMove: "static" as const, shotScale: "medium" as const,
      lens: "35mm", lighting: "sunny", motion: "Mira waters the seed.", negative: "logos",
      generationProfile: "draft" as const, candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
      prompt: "Mira waters a seed.", seconds: 6, storyFunction: "lesson", section: "section-lesson", seed: 2,
    },
  ],
  dpVisualSpecs: [
    { shotId: "shot-opening", keyframePrompt: "Mira holds a seed.", motionPrompt: "gentle hand movement", negativePrompt: "logos", styleLock: "warm children illustration", firstFrameConstraint: "Mira holds seed", lastFrameConstraint: "Mira looks at seed", continuityState: "Mira in garden" },
    { shotId: "shot-lesson", keyframePrompt: "Mira waters a seed.", motionPrompt: "gentle water pour", negativePrompt: "logos", styleLock: "warm children illustration", firstFrameConstraint: "Mira holds watering can", lastFrameConstraint: "water reaches soil", continuityState: "Mira in garden" },
  ],
  editorEdl: {
    version: "1.0.0" as const,
    durationSec: 12,
    shots: [
      { shotId: "shot-opening", sourceSentenceIds: ["sentence-opening"], t0: 0, t1: 6 },
      { shotId: "shot-lesson", sourceSentenceIds: ["sentence-lesson"], t0: 6, t1: 12 },
    ],
  },
  coverage: { mappedSec: 12, totalSec: 12, ratio: 1, gaps: [] },
};

assert.equal(assertEpisodeGraphAgainstStorySpine(graph, storySpine).episodeId, graph.episodeId);

// This is the reusable children-learning handoff: real Story Spine evidence
// becomes a causal Episode Graph, a zero-provider Scene Manifest, and a
// private-human-review receipt before a renderer may be admitted.
const bridgedChildren = buildEpisodeGraphFromStorySpine({
  storySpine,
  topic: "How seeds grow",
  audience: "children",
  seriesId: "series-curious-lantern",
  episodeId: "episode-how-seeds-grow",
  curriculumLabel: "Primary science: plants grow",
  curriculumLocator: "curriculum://primary-science/plants",
});
assert.equal(bridgedChildren.episodeGraph.audience, "children");
assert.equal(bridgedChildren.sceneManifest.externalProviderCalls, 0);

// A reviewed factual visual must travel through the real Episode Graph bridge,
// not remain a valid-but-orphaned artifact. The Scene Compiler consumes the
// resulting graph-owned manifest and still validates the exact scene/sentence
// attachment on its own boundary.
const factualStorySpine = structuredClone(storySpine);
factualStorySpine.timedScript.sentences[0].text = "According to Seed Atlas, 20 seeds sprouted in week one and 35 in week two.";
const factualVisualBase = {
  version: "evidence-visual-manifest/v1" as const,
  id: "visual-seed-sprout-trend",
  visualKind: "chart" as const,
  surface: "scene_compiler" as const,
  targetSceneId: "scene-opening",
  sources: [{
    id: "source-seed-atlas",
    name: "Seed Atlas",
    url: "https://example.org/seed-atlas",
    snapshotSha256: "b".repeat(64),
  }],
  narrationAnchors: [{
    id: "anchor-seed-sprout-trend",
    sentenceId: "sentence-opening",
    startSec: 0,
    endSec: 6,
    spokenText: factualStorySpine.timedScript.sentences[0].text,
    requiredAttribution: "Seed Atlas",
    sourceIds: ["source-seed-atlas"],
  }],
  values: [
    { id: "value-seeds-week-one", sourceId: "source-seed-atlas", narrationAnchorId: "anchor-seed-sprout-trend", role: "series" as const, value: 20, unit: "seeds", display: "20" },
    { id: "value-seeds-week-two", sourceId: "source-seed-atlas", narrationAnchorId: "anchor-seed-sprout-trend", role: "series" as const, value: 35, unit: "seeds", display: "35" },
  ],
  attribution: { visibleText: "Seed Atlas", sourceIds: ["source-seed-atlas"] },
};
const factualVisual: EvidenceVisualManifest = {
  ...factualVisualBase,
  review: {
    decision: "approved",
    reviewerId: "editorial-data-desk",
    reviewId: "review-seed-sprout-trend",
    reviewedAt: new Date().toISOString(),
    reviewedManifestFingerprint: evidenceVisualManifestFingerprint(factualVisualBase),
  },
};
const bridgedFactual = buildEpisodeGraphFromStorySpine({
  storySpine: factualStorySpine,
  topic: "How seeds grow",
  seriesId: "series-curious-lantern",
  episodeId: "episode-how-seeds-grow-data",
  evidenceVisualManifests: [factualVisual],
});
assert.equal(bridgedFactual.episodeGraph.beats[0].visualState.evidenceVisualIntent, "factual_chart");
assert.equal(bridgedFactual.sceneManifest.scenes[0].visualState.evidenceVisualManifest?.id, factualVisual.id);
assert.equal(sceneKindFor(bridgedFactual.sceneManifest.scenes[0]), "chart");
const factualEditorialPacket = createEditorialEvidencePacket({
  subject: "How seeds grow",
  sources: [{
    id: "source-seed-atlas",
    name: "Seed Atlas",
    url: "https://example.org/seed-atlas",
    snapshotSha256: "b".repeat(64),
    kind: "dataset",
  }],
  claims: [{
    id: "claim-seed-sprout-trend",
    sourceIds: ["source-seed-atlas"],
    approvedText: "Seed Atlas records 20 sprouts in week one and 35 in week two.",
    numericAnchor: "20 and 35",
    context: "Reviewed Seed Atlas weekly sprout trend.",
  }],
  review: {
    reviewerId: "editorial-data-desk",
    reviewId: "review-editorial-seed-atlas",
    reviewedAt: new Date().toISOString(),
  },
});
const packetBoundFactual = buildEpisodeGraphFromStorySpine({
  storySpine: factualStorySpine,
  topic: "How seeds grow",
  seriesId: "series-curious-lantern",
  episodeId: "episode-how-seeds-grow-data-packet",
  evidenceVisualManifests: [factualVisual],
  editorialEvidencePacket: factualEditorialPacket,
});
assert.deepEqual(
  packetBoundFactual.episodeGraph.beats[0].sourceRefs,
  ["source-validated-story-spine", "source-editorial-source-seed-atlas"],
  "the factual renderer route must retain the packet-bound source alongside the Story Spine source",
);
assert.equal(
  packetBoundFactual.episodeGraph.sources.find((source) => source.id === "source-editorial-source-seed-atlas")?.locator,
  "https://example.org/seed-atlas",
);
const mismatchedPacketVisual = structuredClone(factualVisual);
mismatchedPacketVisual.sources[0]!.snapshotSha256 = "c".repeat(64);
mismatchedPacketVisual.review.reviewedManifestFingerprint = evidenceVisualManifestFingerprint(mismatchedPacketVisual);
assert.throws(
  () => buildEpisodeGraphFromStorySpine({
    storySpine: factualStorySpine,
    topic: "How seeds grow",
    seriesId: "series-curious-lantern",
    episodeId: "episode-how-seeds-grow-data-packet-mismatch",
    evidenceVisualManifests: [mismatchedPacketVisual],
    editorialEvidencePacket: factualEditorialPacket,
  }),
  /does not match the packet's reviewed immutable snapshot/,
  "changing a factual visual's source snapshot must fail before the scene compiler receives it",
);
assert.equal(
  assertSceneCompilerAdmission({
    manifest: bridgedFactual.sceneManifest,
    narrationDurationSec: 12,
    aspect: "16:9",
  }).fingerprint,
  bridgedFactual.sceneManifest.fingerprint,
);
const wrongSceneEvidence = structuredClone(factualVisual);
wrongSceneEvidence.targetSceneId = "scene-missing";
wrongSceneEvidence.review.reviewedManifestFingerprint = evidenceVisualManifestFingerprint(wrongSceneEvidence);
assert.throws(
  () => buildEpisodeGraphFromStorySpine({
    storySpine: factualStorySpine,
    topic: "How seeds grow",
    seriesId: "series-curious-lantern",
    episodeId: "episode-how-seeds-grow-data",
    evidenceVisualManifests: [wrongSceneEvidence],
  }),
  /targets a scene outside this Story Spine/,
);
const childrenLearningLane = contentLaneForFamily("children_learning");
assert(childrenLearningLane);
const childrenLessonContract = buildLearningContract(bridgedChildren.episodeGraph, childrenLearningLane);
assert.throws(
  () => buildLearningContract(bridgedChildren.episodeGraph, contentLaneForFamily("illustrated_explainer")),
  /children Episode Graphs require the children_learning_supervised lane/,
);
assert.equal(
  assertLearningContract(childrenLessonContract, bridgedChildren.episodeGraph).audience,
  "children",
);
assert.throws(
  () => assertChildContentSafety({
    ...bridgedChildren,
    lessonContract: childrenLessonContract,
    contentLane: { key: "children_learning_supervised" },
  }),
  /child-editor-approved show bible is required/,
  "a children graph and lesson alone cannot enter the supervised render lane",
);
assert.equal(
  assertSceneCompilerAdmission({
    manifest: bridgedChildren.sceneManifest,
    narrationDurationSec: 12,
    aspect: "16:9",
  }).fingerprint,
  bridgedChildren.sceneManifest.fingerprint,
);
assert.throws(
  () => assertChildContentSafety({ ...bridgedChildren, lessonContract: childrenLessonContract, contentLane: { key: "illustrated_explainer" } }),
  /children-learning supervised lane is required/,
);
const staleLessonContract = structuredClone(childrenLessonContract);
staleLessonContract.episodeGraphFingerprint = "0".repeat(64);
assert.throws(
  () => assertLearningContract(staleLessonContract, bridgedChildren.episodeGraph),
  /fingerprint does not match|does not match the active Episode Graph/,
);
assert.throws(
  () => assertSceneCompilerAdmission({ manifest: bridgedChildren.sceneManifest, narrationDurationSec: 11, aspect: "16:9" }),
  /does not match narration/,
);
const wrongSpineCharacter = structuredClone(graph);
wrongSpineCharacter.beats[0].characterIds = ["character-other"];
wrongSpineCharacter.characterIds.push("character-other");
wrongSpineCharacter.characters.push({ id: "character-other", displayName: "Other", continuityLock: "Not present in the source spine." });
assert.throws(
  () => assertEpisodeGraphAgainstStorySpine(wrongSpineCharacter, storySpine),
  /unknown id character-other/,
);

console.log("episode graph contract test passed");
