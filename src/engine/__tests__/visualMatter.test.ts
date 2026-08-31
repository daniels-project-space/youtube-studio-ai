import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { designPipeline } from "@/engine/designer";
import { planVisualTreatment } from "@/engine/visualTreatmentCatalog";
import {
  assertVisualMatterReferenceAssetBytes,
  attachVisualMatterReferenceAssets,
  planVisualMatter,
  visualMatterAssetRequestFingerprint,
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

const recipeAwareManifest = planVisualMatter({
  topic: "Ada Lovelace and the first algorithm",
  channelName: "Cinematic Machines",
  styleDNA: { setting: "Victorian mechanical laboratory", colorGrade: "teal-and-brass filmic", lighting: "warm window light" },
  visualBrief: { mood: "reverent invention and quiet wonder" },
  studioAssetRecipeProjection: {
    version: "studio-asset-recipe-projection/v1",
    cameraAddenda: ["slow controlled orbit, never a whip pan"],
    motionAddenda: ["animate only a motivated hand action"],
    promptAddenda: ["handcrafted brass-and-teal material language"],
    sourceEntryFingerprints: ["a".repeat(64)],
    fingerprint: "b".repeat(64),
  },
  ...story,
});
assert.match(recipeAwareManifest.channelWorld, /Approved Studio treatment: handcrafted brass-and-teal/i);
assert.match(recipeAwareManifest.storyboard[0]!.promptAddendum, /Approved camera grammar: slow controlled orbit/i);
assert.match(recipeAwareManifest.storyboard[0]!.motionAddendum, /approved motion grammar: animate only a motivated/i);
assert.ok(
  recipeAwareManifest.storyboard[0]!.acceptanceCriteria.some((criterion) => /Approved Studio recipe grammar/i.test(criterion)),
  "approved recipe grammar must become a retained visual-QA criterion",
);

assert.equal(manifest.status, "planned");
assert.equal(manifest.characters.length, 1);
assert.equal(manifest.settings.length, 1);
assert.equal(manifest.storyboard.length, 1);
assert.match(manifest.storyboard[0].promptAddendum, /Ada lays punched cards/i);
assert.ok(manifest.reviewLocks[0].acceptanceCriteria.some((criterion) => /narrated moment/i.test(criterion)));

const clayTreatment = planVisualTreatment("clay_stop_motion");
const treatmentAwareManifest = planVisualMatter({
  topic: "Ada Lovelace and the first algorithm",
  channelName: "Cinematic Machines",
  visualTreatment: clayTreatment,
  ...story,
});
assert.equal(treatmentAwareManifest.treatment?.key, "clay_stop_motion");
assert.equal(treatmentAwareManifest.treatment?.planFingerprint, clayTreatment.fingerprint);
assert.notEqual(treatmentAwareManifest.revision, manifest.revision, "treatment selection must bind the Visual Matter revision");
assert.match(treatmentAwareManifest.storyboard[0]!.promptAddendum, /Clay stop-motion|miniature world|sculpted/i);
assert.match(treatmentAwareManifest.storyboard[0]!.motionAddendum, /stepped motion|anticipation/i);
assert.ok(
  treatmentAwareManifest.reviewLocks[0]!.acceptanceCriteria.some((criterion) => /clay-material-integrity/i.test(criterion)),
  "the treatment's frame/global QA benchmarks must flow to the existing visual-review locks",
);
assert.throws(
  () => planVisualMatter({
    topic: "Ada Lovelace and the first algorithm",
    visualTreatment: { ...clayTreatment, fingerprint: "0".repeat(64) },
    ...story,
  }),
  /exactly match/i,
  "a caller cannot weaken a treatment plan before it reaches Visual Matter",
);

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

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const referenceAsset = (request: typeof requests[number], bytes: Uint8Array, r2Key: string) => ({
  ...request,
  r2Key,
  contentType: "image/png",
  contentSha256: digest(bytes),
  sourceManifestRevision: manifest.revision,
  requestFingerprint: visualMatterAssetRequestFingerprint(manifest.revision, request),
  receipt: {
    provider: "approved-test-adapter",
    model: "reference-model/v1",
    responseId: `response:${request.id}`,
    requestSha256: "a".repeat(64),
    responseSha256: "b".repeat(64),
    costUsd: 0,
  },
});
const moodBytes = new Uint8Array([1, 2, 3]);
const storyboardBytes = new Uint8Array([4, 5, 6]);

assert.throws(
  () => attachVisualMatterReferenceAssets(manifest, [{
    id: "mood-primary",
    kind: "mood_board",
    label: "Mood board",
    prompt: manifest.moodBoard.visualPrompt,
    r2Key: "owner/test/channels/cinematic/visual-matter/mood.png",
  } as never]),
  /contentSha256|sourceManifestRevision|requestFingerprint/i,
  "a claimed anchor without byte/request evidence must be rejected",
);

const anchored = attachVisualMatterReferenceAssets(manifest, [
  referenceAsset(requests[0]!, moodBytes, "owner/test/channels/cinematic/visual-matter/mood.png"),
  referenceAsset(requests.at(-1)!, storyboardBytes, "owner/test/channels/cinematic/visual-matter/shot-0001.png"),
]);
assert.equal(anchored.status, "anchored");
assert.match(anchored.referencePackFingerprint ?? "", /^[a-f0-9]{64}$/);
assert.equal(
  visualMatterReferenceAssetsForShot(anchored, "shot-0001")[0]?.id,
  "storyboard:shot-0001",
  "the exact storyboard reference must be supplied before generic mood anchors during visual QA",
);
const storyboardAnchor = visualMatterReferenceAssetsForShot(anchored, "shot-0001")[0]!;
assert.equal(assertVisualMatterReferenceAssetBytes(storyboardAnchor, storyboardBytes).id, storyboardAnchor.id);
assert.throws(
  () => assertVisualMatterReferenceAssetBytes(storyboardAnchor, moodBytes),
  /bytes do not match/i,
  "the visual-QA consumer boundary must reject a swapped R2 object",
);
assert.throws(
  () => attachVisualMatterReferenceAssets(manifest, [{
    ...referenceAsset(requests[0]!, moodBytes, "owner/test/channels/cinematic/visual-matter/mood.png"),
    requestFingerprint: "c".repeat(64),
  }]),
  /invalid request fingerprint/i,
  "an adapter cannot attach a real image to a different planned request",
);

const cinematic = designPipeline({ family: "cinematic", lengthMinutes: 1 });
const spine = cinematic.pipeline.findIndex((entry) => entry.block === "story_spine");
const studioAssets = cinematic.pipeline.findIndex((entry) => entry.block === "studio_asset_resolve");
const visualMatter = cinematic.pipeline.findIndex((entry) => entry.block === "visual_matter");
const assetQa = cinematic.pipeline.findIndex((entry) => entry.block === "qa_assets");
const studioLtxAdapter = cinematic.pipeline.findIndex((entry) => entry.block === "studio_ltx_adapter_resolve");
const keyframes = cinematic.pipeline.findIndex((entry) => entry.block === "novita_render_images");
assert(
  studioAssets > spine && visualMatter > studioAssets && visualMatter < keyframes,
  "approved Studio recipes must resolve after the Story Spine and before fresh visual planning or paid cinematic rendering",
);
assert.deepEqual(
  cinematic.pipeline[studioAssets]?.params,
  { enabled: true, family: "cinematic", contentLane: "cinematic_ai", moduleId: "visual_matter" },
  "cinematic defaults must opt into owner-scoped Studio recipe resolution without requesting a LoRA or raw guide",
);
assert(
  studioLtxAdapter > assetQa && studioLtxAdapter < cinematic.pipeline.findIndex((entry) => entry.block === "novita_render_video"),
  "the one supported standard LTX adapter selection must wait for keyframe QA and precede video-worker admission",
);
assert.deepEqual(
  cinematic.pipeline[studioLtxAdapter]?.params,
  { enabled: true, family: "cinematic", contentLane: "cinematic_ai" },
  "the direct LTX resolver must be lane-pinned and leave runtime identity to its sealed contract",
);

const cinematicClay = designPipeline({
  family: "cinematic",
  lengthMinutes: 1,
  toggles: { visualTreatment: "clay_stop_motion" },
});
assert.equal(
  cinematicClay.pipeline.find((entry) => entry.block === "visual_matter")?.params?.visualTreatment,
  "clay_stop_motion",
  "the designer must pass the selected treatment into the sealed Visual Matter plan",
);
assert.equal(
  cinematicClay.pipeline.find((entry) => entry.block === "studio_asset_resolve")?.params?.treatment,
  "clay_stop_motion",
  "treatment-scoped Studio recipes must be resolved against the same sealed treatment as Visual Matter",
);
assert.equal(
  cinematicClay.pipeline.find((entry) => entry.block === "studio_ltx_adapter_resolve")?.params?.treatment,
  "clay_stop_motion",
  "a treatment-specific direct-LTX adapter must resolve against the same sealed treatment as Visual Matter and final QA",
);
assert.throws(
  () => designPipeline({ family: "whiteboard", lengthMinutes: 1, toggles: { visualTreatment: "clay_stop_motion" } }),
  /require the cinematic Visual Matter pipeline/i,
  "a treatment cannot silently claim it is active on a family without this visual-planning/QA path",
);
assert.equal(
  cinematic.pipeline.some((entry) => entry.block === "visual_matter_references"),
  false,
  "Visual Matter reference pixels must remain an explicit opt-in with no default provider spend",
);

const cinematicReferences = designPipeline({
  family: "cinematic",
  lengthMinutes: 1,
  toggles: { visualMatterReferenceAssets: true },
});
const referencePlan = cinematicReferences.pipeline.findIndex((entry) => entry.block === "visual_matter_references");
const referenceVisualMatter = cinematicReferences.pipeline.findIndex((entry) => entry.block === "visual_matter");
const referenceKeyframes = cinematicReferences.pipeline.findIndex((entry) => entry.block === "novita_render_images");
assert(
  referencePlan > referenceVisualMatter && referenceVisualMatter > spine && referencePlan < referenceKeyframes,
  "the optional reference pack must follow Visual Matter/story planning and precede primary rendering",
);
assert.deepEqual(
  cinematicReferences.pipeline[referencePlan]?.params,
  { enabled: true, maxImages: 8, generationProfile: "production" },
  "the designer must emit the exact bounded, pinned reference-pack configuration",
);

const lofi = designPipeline({ family: "music_loop", lengthMinutes: 3 });
assert.equal(lofi.pipeline.some((entry) => entry.block === "visual_matter"), false, "lo-fi must not receive Visual Matter");
assert.equal(
  lofi.pipeline.some((entry) => entry.block === "visual_matter_references"),
  false,
  "non-cinematic families must not receive the optional Visual Matter render lane",
);

const cinematicWithoutStudioReuse = designPipeline({
  family: "cinematic",
  lengthMinutes: 1,
  toggles: { studioAssetLibrary: false },
});
const disabledStudioAssets = cinematicWithoutStudioReuse.pipeline.find((entry) => entry.block === "studio_asset_resolve");
assert.equal(disabledStudioAssets?.params?.enabled, false, "disabling reuse must emit a typed no-op rather than leave a downstream artifact undefined");
const disabledStudioLtx = cinematicWithoutStudioReuse.pipeline.find((entry) => entry.block === "studio_ltx_adapter_resolve");
assert.equal(disabledStudioLtx?.params?.enabled, false, "disabling Studio reuse must also leave the direct-LTX path as a typed no-op");
const disabledStudioPostproduction = cinematicWithoutStudioReuse.pipeline.find(
  (entry) => entry.block === "studio_postproduction_asset_resolve",
);
assert.equal(
  disabledStudioPostproduction?.params?.enabled,
  false,
  "disabling Studio reuse must retain a typed zero-cost post-production resolver rather than breaking the sealed route",
);

console.log("VISUAL MATTER TESTS PASS");
