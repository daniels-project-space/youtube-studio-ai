import assert from "node:assert/strict";

import { registerAllBlocks } from "@/engine/blocks";
import type { ShotPlan } from "@/engine/storySpine";
import { getManifest } from "@/engine/registry";
import {
  MAX_CINEMATIC_QUALITY_REPAIR_ATTEMPTS,
  canAttemptCinematicQualityRepair,
  planCinematicQualityRepair,
  resolveChannelVisualQualityPolicy,
} from "@/trigger/blocks/novitaRenderBlocks";

registerAllBlocks();
for (const blockId of ["qa_assets", "qa_shots"]) {
  const manifest = getManifest(blockId);
  assert(manifest, `${blockId} manifest must be registered`);
  for (const key of ["qualityBar", "styleDNA", "styleGrammar", "palette", "persona", "niche", "validationSpec"]) {
    assert(key in manifest.optionalConsumes, `${blockId} must declare channel policy input ${key}`);
  }
}

const baseline = resolveChannelVisualQualityPolicy({});
assert.equal(baseline.scoreFloor, 0, "missing legacy identity state must preserve authored shot floors");
assert.equal(baseline.identityFloor, 0);
assert.match(baseline.brief, /authored DP specification/);

const strict = resolveChannelVisualQualityPolicy({
  qualityBar: {
    target: 1.8,
    dimensions: [
      { id: "identity", minScore: 2, description: "The channel must remain recognizable." },
      { id: "footage", minScore: 1.6, description: "Footage must match the channel." },
    ],
  },
  styleGrammar: "No glossy ad lighting; grounded noir documentary frames.",
  palette: ["#171717", "#d3a73d"],
  persona: "Measured investigative narrator",
  niche: "crime history",
  styleDNA: {
    recurringSubject: "archival case-file desk",
    setting: "rainy city records room",
    composition: "subject on the lower third with documentary depth",
    visualAvoid: ["generic stock police lights"],
  },
  validationSpec: {
    assertions: [
      {
        id: "identity_lock",
        description: "Every frame must retain the archival noir identity.",
        check: "vision_judge",
        severity: "block",
      },
      {
        id: "audio_mix",
        description: "Narration is intelligible.",
        check: "metric",
        severity: "block",
      },
    ],
  },
});
assert.equal(strict.scoreFloor, 0.95, "quality rubric must raise the generic render floor");
assert.equal(strict.identityFloor, 0.95, "identity-specific rubric must tighten continuity");
assert.match(strict.brief, /No glossy ad lighting/);
assert.match(strict.brief, /#171717/);
assert.match(strict.brief, /identity_lock/);
assert.doesNotMatch(strict.brief, /audio_mix/, "non-visual assertions must not pollute a frame grader");

const malformed = resolveChannelVisualQualityPolicy({
  qualityBar: { target: "not-a-score" },
  palette: ["#112233", 4, null],
});
assert.equal(malformed.scoreFloor, 0, "malformed rubric state must not lower or crash QA");
assert.match(malformed.brief, /#112233/);

const partiallyMalformed = resolveChannelVisualQualityPolicy({
  qualityBar: { target: 1.8, dimensions: [{ id: "identity", minScore: "invalid" }] },
});
assert.equal(partiallyMalformed.scoreFloor, 0.9, "a malformed dimension must not discard the valid channel target");

assert.equal(MAX_CINEMATIC_QUALITY_REPAIR_ATTEMPTS, 2, "cinematic QA recovery must keep a small source-level cap");
assert.equal(canAttemptCinematicQualityRepair(1), true);
assert.equal(canAttemptCinematicQualityRepair(2), true);
assert.equal(canAttemptCinematicQualityRepair(3), false, "a channel cannot request an unbounded paid repair loop");

const repairShot = {
  id: "shot-archive-desk",
  beatId: "beat-1",
  sourceSentenceIds: ["s-1"],
  t0: 0,
  t1: 4,
  coveragePurpose: "Establish the investigator's evidence desk.",
  literalContent: "An investigator opens an archival case file at a rainy-city records desk.",
  entities: ["investigator", "case file"],
  era: "1994",
  wardrobe: ["wool coat"],
  props: ["case file", "desk lamp"],
  continuityState: "same investigator, coat, desk, and amber practical key light",
  cameraMove: "dolly_push",
  shotScale: "medium",
  lens: "40mm anamorphic",
  lighting: "low-key amber practicals",
  motion: "the investigator opens the file while rain moves outside the window",
  negative: "no text, no watermark, no glossy commercial lighting",
  generationProfile: "production",
  candidateCount: 2,
  imageMinScore: 0.82,
  shotMinScore: 0.84,
  prompt: "archival records desk",
  seconds: 4,
  storyFunction: "evidence reveal",
  section: "opening",
  seed: 41,
} satisfies ShotPlan;

const repairSpec = {
  shotId: repairShot.id,
  keyframePrompt: "Medium 40mm anamorphic frame of the investigator opening the archival file at the records desk.",
  motionPrompt: "Slow dolly push as the investigator opens the archival file; rain remains outside the window.",
  negativePrompt: "No typography, no watermarks, no plastic skin, no generic police lights.",
  styleLock: "grounded archival noir documentary",
  firstFrameConstraint: "File closed under the investigator's hand.",
  lastFrameConstraint: "File open with evidence visible, identity and desk unchanged.",
  continuityState: repairShot.continuityState,
};

const imageRepair = planCinematicQualityRepair({
  phase: "image",
  shot: repairShot,
  spec: repairSpec,
  policy: strict,
  notes: ["The desk was rendered as a generic white studio.", "The investigator's coat changed between candidates."],
  attempt: 1,
});
const sameImageRepair = planCinematicQualityRepair({
  phase: "image",
  shot: repairShot,
  spec: repairSpec,
  policy: strict,
  notes: ["The desk was rendered as a generic white studio.", "The investigator's coat changed between candidates."],
  attempt: 1,
});
assert.deepEqual(imageRepair, sameImageRepair, "a restart must reuse the exact deterministic repair identity");
assert.equal(imageRepair.repairId, "shot-archive-desk-qa-image-r01");
assert.equal(imageRepair.shot.candidateCount, 1, "a repair spends for one targeted candidate, not a fresh fanout");
assert.match(imageRepair.shot.prompt, /LOCKED channel visual identity/);
assert.match(imageRepair.shot.prompt, /No glossy ad lighting/);
assert.match(imageRepair.shot.prompt, /generic white studio/);
assert.match(imageRepair.shot.negative ?? "", /Do not relax literal story fidelity/);

const secondImageRepair = planCinematicQualityRepair({
  phase: "image",
  shot: repairShot,
  spec: repairSpec,
  policy: strict,
  notes: ["The desk was rendered as a generic white studio."],
  attempt: 2,
});
assert.notEqual(secondImageRepair.repairId, imageRepair.repairId);
assert.notEqual(secondImageRepair.shot.seed, imageRepair.shot.seed, "each bounded repair must have a distinct deterministic seed");

const videoRepair = planCinematicQualityRepair({
  phase: "video",
  shot: repairShot,
  spec: repairSpec,
  policy: strict,
  notes: ["The middle frame freezes and the camera move reverses."],
  attempt: 1,
  stillKey: "owner/demo/runs/run/novita/image/selected.png",
  endStillKey: "owner/demo/runs/run/novita/image/selected-next.png",
});
assert.equal(videoRepair.shot.stillKey, "owner/demo/runs/run/novita/image/selected.png");
assert.equal(
  videoRepair.shot.endStillKey,
  "owner/demo/runs/run/novita/image/selected-next.png",
  "a repaired continuous shot must retain its reviewed LTX endpoint rather than silently dropping the handoff",
);
assert.match(videoRepair.shot.prompt, /First-frame constraint/);
assert.match(videoRepair.shot.prompt, /middle frame freezes/);
assert.throws(
  () => planCinematicQualityRepair({
    phase: "video",
    shot: repairShot,
    spec: repairSpec,
    policy: strict,
    notes: [],
    attempt: 1,
  }),
  /requires the selected still/,
  "video repair must remain attached to the approved still rather than silently changing identity",
);

console.log("Novita channel quality policy tests passed");
