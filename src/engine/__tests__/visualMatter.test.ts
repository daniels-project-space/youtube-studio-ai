import assert from "node:assert/strict";

import { designPipeline } from "@/engine/designer";
import {
  attachVisualMatterReferenceAssets,
  planVisualMatter,
  visualMatterAssetRequests,
  visualMatterDirectiveForShot,
  visualMatterReferenceAssetsForShot,
} from "@/engine/visualMatter";

const story = {
  continuityLedger: {
    version: "1.0.0" as const,
    entities: [{ id: "entity-ada", name: "Ada", look: "a precise Victorian engineer with a dark teal coat" }],
    locations: [{ id: "location-lab", name: "Analytical Engine laboratory", look: "brass mechanical calculating room, tall windows" }],
    era: "1840s",
    wardrobe: ["dark teal coat", "high collar"],
    props: ["punched cards", "brass gears"],
    palette: ["dark teal", "aged brass", "warm window light"],
    cameraGrammar: ["measured dolly push"],
    negativeConstraints: ["text", "watermarks"],
  },
  narrativeBeats: [{
    id: "beat-0001",
    sourceSentenceIds: ["sentence-0001"],
    t0: 0,
    t1: 6,
    purpose: "introduce the invention and its maker",
    evidenceRefs: ["script:sentence:1"],
  }],
  shotList: [{
    id: "shot-0001",
    beatId: "beat-0001",
    sourceSentenceIds: ["sentence-0001"],
    t0: 0,
    t1: 6,
    coveragePurpose: "introduce the invention and its maker",
    literalContent: "Ada lays punched cards beside the analytical engine.",
    entities: ["entity-ada"],
    locationId: "location-lab",
    era: "1840s",
    wardrobe: ["dark teal coat"],
    props: ["punched cards", "brass gears"],
    continuityState: "Ada and laboratory remain coherent",
    cameraMove: "dolly_push" as const,
    shotScale: "medium" as const,
    lens: "35mm natural",
    lighting: "warm window light",
    motion: "Ada places a punched card beside the engine.",
    negative: "text, watermarks",
    generationProfile: "production" as const,
    candidateCount: 2,
    imageMinScore: 0.8,
    shotMinScore: 0.8,
    prompt: "Ada and the analytical engine.",
    seconds: 6,
    storyFunction: "introduction",
    section: "section-001",
    seed: 100001,
  }],
  dpVisualSpecs: [{
    shotId: "shot-0001",
    keyframePrompt: "Ada and the analytical engine in a brass laboratory.",
    motionPrompt: "Measured dolly push as Ada places the card.",
    negativePrompt: "text, watermarks",
    styleLock: "dark teal, aged brass",
    firstFrameConstraint: "Ada holds the card at 0.00s",
    lastFrameConstraint: "Ada has placed the card at 6.00s",
    continuityState: "Ada and laboratory remain coherent",
  }],
};

const manifest = planVisualMatter({
  topic: "Ada Lovelace and the first algorithm",
  channelName: "Cinematic Machines",
  styleDNA: { setting: "Victorian mechanical laboratory", colorGrade: "teal-and-brass filmic", lighting: "warm window light" },
  visualBrief: { mood: "reverent invention and quiet wonder" },
  ...story,
});

assert.equal(manifest.status, "planned");
assert.equal(manifest.characters.length, 1);
assert.equal(manifest.settings.length, 1);
assert.equal(manifest.storyboard.length, 1);
assert.match(manifest.storyboard[0].promptAddendum, /Ada lays punched cards/i);
assert.ok(manifest.reviewLocks[0].acceptanceCriteria.some((criterion) => /narrated moment/i.test(criterion)));

const directive = visualMatterDirectiveForShot(manifest, "shot-0001");
assert(directive, "every storyboard shot must compile a renderer/QA handoff");
assert.match(directive.renderPrompt, /Visual Matter lock/i);
assert.match(directive.qaCriteria, /setting remains/i);

const requests = visualMatterAssetRequests(manifest, 4);
assert.deepEqual(requests.map((request) => request.kind), [
  "mood_board",
  "character_sheet",
  "setting_sheet",
  "storyboard_frame",
]);

const anchored = attachVisualMatterReferenceAssets(manifest, [
  {
    id: "mood-primary",
    kind: "mood_board",
    label: "Mood board",
    prompt: manifest.moodBoard.visualPrompt,
    r2Key: "owner/test/channels/cinematic/visual-matter/mood.png",
  },
  {
    id: "storyboard:shot-0001",
    kind: "storyboard_frame",
    label: "Storyboard frame · shot-0001",
    prompt: requests.at(-1)!.prompt,
    shotId: "shot-0001",
    r2Key: "owner/test/channels/cinematic/visual-matter/shot-0001.png",
  },
]);
assert.equal(anchored.status, "anchored");
assert.equal(
  visualMatterReferenceAssetsForShot(anchored, "shot-0001")[0]?.id,
  "storyboard:shot-0001",
  "the exact storyboard reference must be supplied before generic mood anchors during visual QA",
);

const cinematic = designPipeline({ family: "cinematic", lengthMinutes: 1 });
const spine = cinematic.pipeline.findIndex((entry) => entry.block === "story_spine");
const visualMatter = cinematic.pipeline.findIndex((entry) => entry.block === "visual_matter");
const keyframes = cinematic.pipeline.findIndex((entry) => entry.block === "novita_render_images");
assert(visualMatter > spine && visualMatter < keyframes, "Visual Matter must sit between story planning and paid cinematic rendering");

const lofi = designPipeline({ family: "music_loop", lengthMinutes: 3 });
assert.equal(lofi.pipeline.some((entry) => entry.block === "visual_matter"), false, "lo-fi must not receive Visual Matter");

console.log("VISUAL MATTER TESTS PASS");
