import assert from "node:assert/strict";

import {
  SelfContainedStoryReceiptSchema,
  assertSelfContainedStoryReceiptBinding,
  createSelfContainedStoryReceipt,
  resolveSelfContainedStoryPlan,
  validateSelfContainedStoryReceipt,
  type SelfContainedStoryReceiptBinding,
} from "@/engine/selfContainedStoryReceipt";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const topic = "How a water clock changed the city";

const whiteboardStory = {
  title: "The clockwork canal",
  panels: [{
    idx: 0,
    narration: "A water clock divided the city day.",
    layers: [{
      kind: "art" as const,
      draw: "a brass water clock beside a canal",
      color: "black" as const,
      cue: "water clock",
      box: [0.1, 0.2, 0.4, 0.4],
    }],
  }],
  fullText: "A water clock divided the city day.",
};

const whiteboardBinding: SelfContainedStoryReceiptBinding = {
  family: "whiteboard",
  contentLaneKey: "whiteboard_explainer",
  routeFingerprint: HASH_A,
  programBriefFingerprint: HASH_A,
  topic,
};

function whiteboardReceipt(routeFingerprint = HASH_A) {
  return createSelfContainedStoryReceipt({
    family: "whiteboard",
    routeFingerprint,
    programBriefFingerprint: HASH_A,
    topic,
    planner: { id: "approved-story-fixture/v1", provenance: "provider-free fixture" },
    critique: { accepted: true, score: 0.91, iterations: 1, issues: [] },
    storyKind: "whiteboard-storyboard/v1",
    story: whiteboardStory,
  });
}

async function main() {
  const receipt = whiteboardReceipt();
  assert.deepEqual(validateSelfContainedStoryReceipt(receipt), receipt);

  const artifact = artifactContract("selfContainedStoryReceipt");
  assert.equal(artifact.type, "SelfContainedStoryReceipt");
  assert.equal(artifact.opaque, false);
  assert.deepEqual(validateArtifact(artifact, receipt), receipt);

  // Each receipt family has a strict native shape, not a generic JSON plan.
  const comic = createSelfContainedStoryReceipt({
    family: "comic",
    routeFingerprint: HASH_A,
    programBriefFingerprint: HASH_A,
    topic: "The silent observatory",
    planner: { id: "approved-story-fixture/v1", provenance: "provider-free fixture" },
    critique: { accepted: true, score: 0.92, iterations: 1, issues: [] },
    storyKind: "motion-comic-storyboard/v1",
    story: {
      title: "The silent observatory",
      logline: "A watcher finds a signal in abandoned stone.",
      narratorVoiceId: "narrator-voice",
      characters: [],
      panels: [{
        visual: {
          environment: "ancient_ruins",
          era: "ancient",
          subjects: [],
          objects: ["artifact"],
          action: "watchful_pause",
          relations: [],
          mood: "mysterious",
          lighting: "moonlight",
        },
        characters: [],
        shot: "wide",
        lines: [{ speaker: "narrator", text: "The stones remembered every signal." }],
      }],
    },
  });
  assert.equal(comic.family, "comic");

  const lore = createSelfContainedStoryReceipt({
    family: "loreshort",
    routeFingerprint: HASH_A,
    programBriefFingerprint: HASH_A,
    topic: "The forest archive",
    planner: { id: "approved-story-fixture/v1", provenance: "provider-free fixture" },
    critique: { accepted: true, score: 0.9, iterations: 1, issues: [] },
    storyKind: "lore-plan/v1",
    story: {
      scenes: [{
        line: "The forest kept its oldest records in the roots.",
        shot: "wide",
        visual: "Moonlight crosses carved roots beside a hidden archive door.",
        camera: "Slowly track through the roots toward the door.",
      }],
    },
  });
  assert.equal(lore.family, "loreshort");

  assert.throws(
    () => assertSelfContainedStoryReceiptBinding({
      receipt,
      expected: { ...whiteboardBinding, family: "comic", contentLaneKey: "motion_comic" },
    }),
    /family/i,
    "a receipt cannot cross renderer families",
  );
  assert.throws(
    () => assertSelfContainedStoryReceiptBinding({
      receipt,
      expected: { ...whiteboardBinding, contentLaneKey: "motion_comic" },
    }),
    /content lane/i,
    "a receipt cannot cross content lanes",
  );
  assert.throws(
    () => assertSelfContainedStoryReceiptBinding({
      receipt,
      expected: { ...whiteboardBinding, routeFingerprint: HASH_B },
    }),
    /route fingerprint/i,
    "a receipt cannot cross frozen routes",
  );
  assert.throws(
    () => assertSelfContainedStoryReceiptBinding({
      receipt,
      expected: { ...whiteboardBinding, programBriefFingerprint: HASH_B },
    }),
    /program brief fingerprint/i,
    "a receipt cannot cross program briefs",
  );
  assert.throws(
    () => assertSelfContainedStoryReceiptBinding({
      receipt,
      expected: { ...whiteboardBinding, topic: "A different water-clock story" },
    }),
    /topic fingerprint/i,
    "a receipt cannot cross topics",
  );

  const tamperedPayload = {
    ...receipt,
    story: { ...whiteboardStory, fullText: "A substituted narration was never approved." },
  };
  assert.throws(
    () => validateArtifact(artifact, tamperedPayload),
    /fullText|fingerprint/i,
    "the artifact schema itself rejects a modified approved story",
  );
  assert.throws(
    () => SelfContainedStoryReceiptSchema.parse({ ...receipt, unexpected: true }),
    /unrecognized/i,
    "the receipt schema is closed to unapproved fields",
  );

  const receiptForOtherRoute = whiteboardReceipt(HASH_B);
  assert.throws(
    () => resolveSelfContainedStoryPlan({
      family: "whiteboard",
      receipt: receiptForOtherRoute,
      binding: whiteboardBinding,
      legacyPlan: whiteboardStory,
    }),
    /route fingerprint/i,
    "a supplied receipt must reject instead of falling back to a legacy plan",
  );
  assert.throws(
    () => resolveSelfContainedStoryPlan({
      family: "whiteboard",
      receipt,
      binding: whiteboardBinding,
      legacyPlan: { ...whiteboardStory, title: "A substitute plan" },
    }),
    /conflicts/i,
    "a valid receipt is the sole planning authority when it is supplied",
  );

  const legacy = resolveSelfContainedStoryPlan({ family: "whiteboard", legacyPlan: whiteboardStory });
  assert.equal(legacy.receiptSupplied, false);
  assert.deepEqual(legacy.plan, whiteboardStory);

  console.log("self-contained story receipt strict binding test passed");
}

void main();
