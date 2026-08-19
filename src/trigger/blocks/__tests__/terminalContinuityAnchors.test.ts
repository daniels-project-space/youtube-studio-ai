import assert from "node:assert/strict";

import { generationProfile } from "@/engine/generationProfiles";
import { SelectedStillManifestSchema, ShotRenderManifestSchema } from "@/engine/renderArtifacts";
import { planStorySpine } from "@/engine/storySpine";
import { deriveTerminalStillAnchors } from "@/trigger/blocks/novitaRenderBlocks";

const profile = generationProfile("production");

const spine = planStorySpine({
  topic: "Continuity proof",
  narrationDurationSec: 12,
  sentenceTimings: [
    { text: "The investigator walks through the same office and opens the case file.", start: 0, end: 6 },
    { text: "The evidence changes the direction of the investigation.", start: 6, end: 12 },
  ],
  styleDNA: {
    recurringSubject: "a faceless investigator in a charcoal coat",
    setting: "a 1980s evidence office",
    wardrobe: ["charcoal coat"],
    props: ["sealed case file"],
    era: "1980s",
  },
  generationProfile: "production",
  targetShotSec: 3,
});

assert.equal(spine.shotList.length, 4, "fixture must create two coverage shots per causal beat");
assert.equal(
  spine.shotList[0]!.continuityState,
  spine.shotList[1]!.continuityState,
  "sub-shots of one beat must share a continuity state",
);
assert.notEqual(
  spine.shotList[1]!.continuityState,
  spine.shotList[2]!.continuityState,
  "a new causal beat remains a real editorial cut",
);

const selected = SelectedStillManifestSchema.parse({
  version: "1.0.0",
  generation: {
    contractVersion: "1.0.0",
    profileId: profile.id,
    model: profile.image.model,
    revision: profile.image.revision,
    checkpoint: profile.image.checkpoint,
    precision: profile.image.precision,
    width: profile.image.width,
    height: profile.image.height,
    steps: profile.image.steps,
    allowFallback: false,
  },
  items: spine.shotList.map((shot, index) => ({
    shotId: shot.id,
    stillKey: `r2/selected/${shot.id}.png`,
    candidateIndex: 0,
    score: 0.96,
    semanticAlignment: 0.96,
    continuity: 0.96,
    artifactFree: 0.96,
    notes: [`selected ${index}`],
  })),
});

const anchors = deriveTerminalStillAnchors(spine.shotList, selected);
assert.deepEqual(anchors.get("shot-0001"), {
  terminalAnchorShotId: "shot-0002",
  terminalStillKey: "r2/selected/shot-0002.png",
});
assert.deepEqual(anchors.get("shot-0003"), {
  terminalAnchorShotId: "shot-0004",
  terminalStillKey: "r2/selected/shot-0004.png",
});
assert.equal(anchors.has("shot-0002"), false, "a beat boundary must never be endpoint-conditioned");
assert.equal(anchors.has("shot-0004"), false, "the final shot has no terminal handoff");

const changedWardrobe = spine.shotList.map((shot) => ({ ...shot, wardrobe: [...shot.wardrobe] }));
changedWardrobe[1]!.wardrobe = ["raincoat"];
assert.equal(
  deriveTerminalStillAnchors(changedWardrobe, selected).has("shot-0001"),
  false,
  "an identity/wardrobe change must disable endpoint morphing even within one beat",
);

assert.throws(
  () => ShotRenderManifestSchema.parse({
    version: "1.0.0",
    generation: {
      contractVersion: "1.0.0", profileId: "production", model: "ltx", revision: "a".repeat(40), checkpoint: "pinned",
      precision: "bf16", width: 1280, height: 704, steps: 8, allowFallback: false, fps: 25, guidanceScale: 1,
      pipeline: "distilled", twoStageRefine: true, textEncoderCheckpoint: "text", videoVaeCheckpoint: "video",
      audioVaeCheckpoint: "audio", spatialUpscalerCheckpoint: "upscale", quantization: "fp8-cast", offload: "cpu",
      spatialUpscaleFactor: 2, stageOneWidth: 640, stageOneHeight: 352, outputWidth: 1280, outputHeight: 704,
    },
    durationSec: 3,
    items: [{ shotId: "shot-0001", clipKey: "r2/a.mp4", t0: 0, t1: 3, sourceSentenceIds: ["sentence-0001"], continuityState: "state", terminalAnchorShotId: "shot-0002" }],
  }),
  /terminal anchor id and still key/,
  "a stored endpoint reference must be complete and auditable",
);

console.log("terminal continuity anchor tests passed");
