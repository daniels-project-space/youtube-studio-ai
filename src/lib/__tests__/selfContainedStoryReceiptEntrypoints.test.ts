import assert from "node:assert/strict";

import {
  createSelfContainedStoryReceipt,
  selfContainedStoryPayloadFingerprint,
  selfContainedStoryReceiptFingerprint,
} from "@/engine/selfContainedStoryReceipt";
import { craftLoreShort } from "@/lib/loreshort";
import { castMotionComic } from "@/lib/motionComic";
import { castWhiteboardSync } from "@/lib/whiteboardSync";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

async function main() {
  const whiteboardTopic = "How a water clock changed the city";
  const whiteboardPlan = {
    title: "The clockwork canal",
    panels: [{
      idx: 0,
      narration: "A water clock divided the city day.",
      layers: [{
        kind: "art" as const,
        draw: "a brass water clock beside a canal",
        color: "black" as const,
        cue: "water clock",
        box: [0.1, 0.2, 0.4, 0.4] as [number, number, number, number],
      }],
    }],
    fullText: "A water clock divided the city day.",
  };
  const whiteboardReceipt = createSelfContainedStoryReceipt({
    family: "whiteboard",
    routeFingerprint: HASH_A,
    programBriefFingerprint: HASH_A,
    topic: whiteboardTopic,
    planner: { id: "entrypoint-fixture/v1", provenance: "provider-free fixture" },
    critique: { accepted: true, score: 0.9, iterations: 1, issues: [] },
    storyKind: "whiteboard-storyboard/v1",
    story: whiteboardPlan,
  });
  let whiteboardImageCalls = 0;
  await assert.rejects(
    () => castWhiteboardSync({
      brief: { topic: whiteboardTopic },
      runDir: "/tmp/self-contained-story-receipt-whiteboard",
      generateImage: async () => {
        whiteboardImageCalls += 1;
        return undefined as never;
      },
      // A valid legacy plan must not become a hidden fallback for a receipt
      // which does not bind to this route.
      plan: whiteboardPlan,
      approvedStoryReceipt: whiteboardReceipt,
      storyReceiptBinding: {
        family: "whiteboard",
        contentLaneKey: "whiteboard_explainer",
        routeFingerprint: HASH_B,
        programBriefFingerprint: HASH_A,
        topic: whiteboardTopic,
      },
    }),
    /route fingerprint/i,
  );
  assert.equal(whiteboardImageCalls, 0, "whiteboard rejects a bad receipt before provider work or plan fallback");

  const overCapWhiteboardStory = {
    ...whiteboardPlan,
    panels: [{
      ...whiteboardPlan.panels[0],
      layers: [
        ...whiteboardPlan.panels[0].layers,
        ...Array.from({ length: 5 }, (_, index) => ({
          kind: "art" as const,
          draw: `an additional sealed sketch ${index + 1}`,
          color: "black" as const,
          cue: "water clock",
          box: [0.1, 0.2, 0.4, 0.4] as [number, number, number, number],
        })),
      ],
    }],
  };
  const overCapReceiptCandidate = {
    ...whiteboardReceipt,
    story: overCapWhiteboardStory,
    storyFingerprint: selfContainedStoryPayloadFingerprint({
      storyKind: "whiteboard-storyboard/v1",
      story: overCapWhiteboardStory,
    }),
  };
  const overCapReceipt = {
    ...overCapReceiptCandidate,
    fingerprint: selfContainedStoryReceiptFingerprint(overCapReceiptCandidate),
  };
  let overCapWhiteboardImageCalls = 0;
  await assert.rejects(
    () => castWhiteboardSync({
      brief: { topic: whiteboardTopic },
      runDir: "/tmp/self-contained-story-receipt-whiteboard-over-cap",
      generateImage: async () => {
        overCapWhiteboardImageCalls += 1;
        return undefined as never;
      },
      approvedStoryReceipt: overCapReceipt,
      storyReceiptBinding: {
        family: "whiteboard",
        contentLaneKey: "whiteboard_explainer",
        routeFingerprint: HASH_A,
        programBriefFingerprint: HASH_A,
        topic: whiteboardTopic,
      },
    }),
    /art-layer ceiling/i,
  );
  assert.equal(
    overCapWhiteboardImageCalls,
    0,
    "a sealed whiteboard receipt over the art ceiling must reject before image work",
  );

  const comicTopic = "The silent observatory";
  const comicReceipt = createSelfContainedStoryReceipt({
    family: "comic",
    routeFingerprint: HASH_A,
    programBriefFingerprint: HASH_A,
    topic: comicTopic,
    planner: { id: "entrypoint-fixture/v1", provenance: "provider-free fixture" },
    critique: { accepted: true, score: 0.9, iterations: 1, issues: [] },
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
  let comicImageCalls = 0;
  await assert.rejects(
    () => castMotionComic({
      brief: { topic: comicTopic },
      runDir: "/tmp/self-contained-story-receipt-comic",
      outPath: "/tmp/self-contained-story-receipt-comic.mp4",
      generateImage: async () => {
        comicImageCalls += 1;
        return Buffer.alloc(0);
      },
      approvedStoryReceipt: comicReceipt,
      storyReceiptBinding: {
        family: "comic",
        contentLaneKey: "motion_comic",
        routeFingerprint: HASH_B,
        programBriefFingerprint: HASH_A,
        topic: comicTopic,
      },
    }),
    /route fingerprint/i,
  );
  assert.equal(comicImageCalls, 0, "motion comic rejects a bad receipt before provider work");

  const loreTopic = "The forest archive";
  const loreReceipt = createSelfContainedStoryReceipt({
    family: "loreshort",
    routeFingerprint: HASH_A,
    programBriefFingerprint: HASH_A,
    topic: loreTopic,
    planner: { id: "entrypoint-fixture/v1", provenance: "provider-free fixture" },
    critique: { accepted: true, score: 0.9, iterations: 1, issues: [] },
    storyKind: "lore-plan/v1",
    story: {
      scenes: [{
        line: "The forest kept its oldest records in the roots.",
        visual: "Moonlight crosses carved roots beside a hidden archive door.",
        camera: "Slowly track through the roots toward the door.",
      }],
    },
  });
  let loreProviderCalls = 0;
  await assert.rejects(
    () => craftLoreShort({
      slug: "self-contained-story-receipt-lore",
      title: "The forest archive",
      kicker: "A sealed story test",
      topic: loreTopic,
      narrator: "The Archivist",
    }, {
      generateImage: async () => {
        loreProviderCalls += 1;
        return Buffer.alloc(0);
      },
      generateClip: async () => {
        loreProviderCalls += 1;
        return Buffer.alloc(0);
      },
      synthLine: async () => {
        loreProviderCalls += 1;
        return Buffer.alloc(0);
      },
      approvedStoryReceipt: loreReceipt,
      storyReceiptBinding: {
        family: "loreshort",
        contentLaneKey: "lore_micro_doc",
        routeFingerprint: HASH_B,
        programBriefFingerprint: HASH_A,
        topic: loreTopic,
      },
    }),
    /route fingerprint/i,
  );
  assert.equal(loreProviderCalls, 0, "LoreShort rejects a bad receipt before cache, planner, or provider work");

  console.log("self-contained story receipt renderer entrypoint test passed");
}

void main();
