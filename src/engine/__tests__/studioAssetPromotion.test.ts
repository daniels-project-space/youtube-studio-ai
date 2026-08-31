import assert from "node:assert/strict";

import {
  approveStudioAssetPromotionCandidate,
  assertStudioAssetPromotionCandidate,
  createStudioAssetPromotionCandidates,
  createStudioPostproductionPromotionCandidates,
  studioAssetPromotionCandidateInventory,
} from "@/engine/studioAssetPromotion";
import { createStudioTransitionDecisionReceipt } from "@/engine/studioPostproductionDecision";
import { sha256Hex } from "@/lib/sha256";

const digest = (value: string) => sha256Hex(value);

const manifest = {
  version: "visual-matter/v1" as const,
  status: "planned" as const,
  revision: digest("visual-matter-revision"),
  topic: "A small impossible machine finds a way home",
  channelWorld: "clockwork city at blue hour",
  moodBoard: {
    id: "mood-primary" as const,
    mood: "quietly hopeful",
    palette: ["ink blue", "warm brass"],
    lighting: "soft practical pools against a cool twilight city",
    visualPrompt: "clean cinematic miniature city, tactile materials, restrained anamorphic highlights",
  },
  characters: [],
  settings: [{
    id: "setting-city",
    name: "clockwork city",
    continuityLock: "weathered brass tram lines and blue hour mist",
    stylePrompt: "tactile clockwork city with readable depth layers",
  }],
  storyboard: [{
    shotId: "shot-arrival",
    beatId: "beat-arrival",
    t0: 0,
    t1: 4,
    characterIds: [],
    settingId: "setting-city",
    promptAddendum: "slow low-angle reveal past foreground gears into a distant station",
    motionAddendum: "measured forward dolly; drifting steam provides only subtle parallax",
    acceptanceCriteria: ["clear depth", "stable brass material", "no accidental text"],
    referenceAssetIds: [],
  }],
  reviewLocks: [{
    shotId: "shot-arrival",
    startSec: 0,
    endSec: 4,
    expected: "a tactile clockwork city reveal",
    acceptanceCriteria: ["clear depth", "stable brass material", "no accidental text"],
  }],
  referenceAssets: [],
};

const candidates = createStudioAssetPromotionCandidates({
  ownerId: "owner-a",
  channelId: "channel-a",
  runId: "run-a",
  family: "cinematic",
  contentLane: "cinematic_ai",
  finalMasterReleaseCertificateKey: "owners/owner-a/runs/run-a/release.json",
  finalMasterReleaseCertificateFingerprint: digest("certificate"),
  finalMasterSha256: digest("master"),
  qualityEvidenceFingerprint: digest("quality"),
  visualReviewReceiptFingerprint: digest("visual-review"),
  visualQualityScore: 87,
  visualMinimumScore: 74,
  visualMatter: manifest,
  sourceEntryFingerprints: [],
});

assert.deepEqual(
  candidates.map((candidate) => candidate.proposal.assetKind),
  ["camera_recipe", "motion_recipe", "prompt_recipe"],
  "a new reviewed Visual Matter plan may propose only bounded channel-local recipe kinds",
);
for (const candidate of candidates) {
  assert.equal(candidate.proposal.scope, "channel");
  assert.equal(candidate.proposal.channelId, "channel-a");
  assert.equal(candidate.proposal.identitySensitivity, "channel");
  assert.equal(candidate.proposal.compatibility.moduleIds[0], "visual_matter");
  assertStudioAssetPromotionCandidate(candidate);
}

const approved = approveStudioAssetPromotionCandidate({
  candidate: candidates[0],
  approvedBy: "owner-a",
  approvedAt: 1_760_000_000_000,
});
assert.equal(approved.status, "approved");
assert.equal(approved.scope, "channel");
assert.equal(approved.channelId, "channel-a");
assert.equal(approved.approval.provenanceFingerprint, digest("certificate"));
assert.equal(approved.approval.qualityScore, 87);

const inventory = studioAssetPromotionCandidateInventory(candidates);
assert.equal(inventory.length, 3);
assert.equal("finalMasterReleaseCertificateKey" in inventory[0]!, false, "browser inventory must not expose R2 evidence keys");
assert.equal("recipe" in inventory[0]!, false, "browser inventory must not expose reusable prompt instructions before approval");

assert.deepEqual(
  createStudioAssetPromotionCandidates({
    ownerId: "owner-a",
    channelId: "channel-a",
    runId: "run-a",
    family: "cinematic",
    contentLane: "cinematic_ai",
    finalMasterReleaseCertificateKey: "owners/owner-a/runs/run-a/release.json",
    finalMasterReleaseCertificateFingerprint: digest("certificate"),
    finalMasterSha256: digest("master"),
    qualityEvidenceFingerprint: digest("quality"),
    visualReviewReceiptFingerprint: digest("visual-review"),
    visualQualityScore: 87,
    visualMinimumScore: 74,
    visualMatter: manifest,
    sourceEntryFingerprints: [digest("already-approved")],
  }),
  [],
  "a run that reused an approved recipe must not create a duplicate candidate",
);

assert.throws(
  () => createStudioAssetPromotionCandidates({
    ownerId: "owner-a",
    channelId: "channel-a",
    runId: "run-a",
    family: "cinematic",
    contentLane: "cinematic_ai",
    finalMasterReleaseCertificateKey: "owners/owner-a/runs/run-a/release.json",
    finalMasterReleaseCertificateFingerprint: digest("certificate"),
    finalMasterSha256: digest("master"),
    qualityEvidenceFingerprint: digest("quality"),
    visualReviewReceiptFingerprint: digest("visual-review"),
    visualQualityScore: 70,
    visualMinimumScore: 74,
    visualMatter: manifest,
    sourceEntryFingerprints: [],
  }),
  /passing final-master visual score/i,
);

assert.throws(
  () => assertStudioAssetPromotionCandidate({ ...candidates[0], channelId: "channel-b" }),
  /fingerprint|source channel/i,
  "tampering a candidate's owner/channel binding must fail before approval",
);

const operatorTransitionDecision = createStudioTransitionDecisionReceipt({
  frozenChannelModuleConfig: { editor_brief: { transitions: "dip_to_black" } },
  explicitTransition: "dip_to_black",
  studioTransitionPreset: "crossfade",
  studioSourceEntryFingerprints: [digest("shadowed-studio-transition")],
});
const postproductionCandidates = createStudioPostproductionPromotionCandidates({
  ownerId: "owner-a",
  channelId: "channel-a",
  runId: "run-a",
  family: "cinematic",
  contentLane: "cinematic_ai",
  finalMasterReleaseCertificateKey: "owners/owner-a/runs/run-a/release.json",
  finalMasterReleaseCertificateFingerprint: digest("certificate"),
  finalMasterSha256: digest("master"),
  qualityEvidenceFingerprint: digest("quality"),
  visualReviewReceiptFingerprint: digest("visual-review"),
  visualQualityScore: 87,
  visualMinimumScore: 74,
  decision: operatorTransitionDecision,
});
assert.equal(postproductionCandidates.length, 1);
assert.equal(postproductionCandidates[0]!.proposal.assetKind, "transition_template");
assert.equal(postproductionCandidates[0]!.proposal.compatibility.moduleIds[0], "timeline_assemble");
assert.equal(
  "postproductionDecisionFingerprint" in postproductionCandidates[0]!.origin,
  true,
  "a promoted transition must point to the exact timeline decision in the release certificate",
);
assert.deepEqual(
  createStudioPostproductionPromotionCandidates({
    ownerId: "owner-a",
    channelId: "channel-a",
    runId: "run-a",
    family: "cinematic",
    contentLane: "cinematic_ai",
    finalMasterReleaseCertificateKey: "owners/owner-a/runs/run-a/release.json",
    finalMasterReleaseCertificateFingerprint: digest("certificate"),
    finalMasterSha256: digest("master"),
    qualityEvidenceFingerprint: digest("quality"),
    visualReviewReceiptFingerprint: digest("visual-review"),
    visualQualityScore: 87,
    visualMinimumScore: 74,
    decision: createStudioTransitionDecisionReceipt({
      frozenChannelModuleConfig: undefined,
      explicitTransition: undefined,
      studioTransitionPreset: "crossfade",
      studioSourceEntryFingerprints: [digest("already-approved-transition")],
    }),
  }),
  [],
  "an already-approved Studio transition is usage evidence, never a duplicate promotion candidate",
);

console.log("STUDIO ASSET PROMOTION TESTS PASS");
