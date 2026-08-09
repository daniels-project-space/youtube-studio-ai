import assert from "node:assert/strict";
import {
  channelInceptionInvalidationRoots,
  positioningIdentityProjection,
  seoIdentityProjection,
} from "@/engine/channelInceptionInvalidation";

const base = {
  name: "Quiet Truth",
  family: "narrated_stock",
  language: "en",
  identity: {
    niche: "stoicism",
    persona: "calm",
    styleGrammar: "quiet",
    palette: ["#111111"],
    topicPool: ["one"],
    voiceId: "voice-a",
    voiceCasting: { voiceId: "voice-a" },
    imageKey: "avatar-a",
    bannerKey: "banner-a",
    thumbnailTemplate: "editorial",
  },
  styleDNA: { confidence: 0.9 },
  qaRubric: { floor: 8 },
  scriptPlaybook: { version: 1 },
  thumbnailPlaybook: { version: 1 },
  pipeline: [{ block: "narration_tts" }],
  moduleConfig: {},
};

function roots(patch: Record<string, unknown>) {
  const after = {
    ...base,
    ...patch,
    identity: patch.identity ? { ...base.identity, ...(patch.identity as object) } : base.identity,
  };
  return channelInceptionInvalidationRoots(base, after);
}

assert.deepEqual(roots({ identity: { topicPool: ["two"] } }), ["channel-inception-seo"]);
assert.deepEqual(roots({ identity: { voiceCasting: { voiceId: "voice-b" } } }), ["channel-inception-voice"]);
assert.deepEqual(roots({ identity: { imageKey: "avatar-b" } }), ["channel-inception-avatar"]);
assert.deepEqual(roots({ identity: { bannerKey: "banner-b" } }), ["channel-inception-banner"]);
assert.deepEqual(roots({ identity: { thumbnailTemplate: "bold" } }), ["channel-inception-thumbnails"]);
assert.deepEqual(roots({ identity: { niche: "history" } }), ["channel-inception-research"]);
assert.deepEqual(roots({ styleDNA: { confidence: 0.95 } }), ["channel-inception-positioning"]);
assert.deepEqual(roots({ pipeline: [{ block: "whiteboard_scribe" }] }), ["channel-inception-pipeline"]);
assert.deepEqual(
  roots({
    contentLane: {
      version: "content-lane/v1",
      key: "narrated_documentary",
      family: "narrated_stock",
      primaryRenderer: "stock_footage",
    },
  }),
  ["channel-inception-research", "channel-inception-pipeline"],
  "installing or changing a style lane must stale both its family research and certified pipeline proof",
);
assert.deepEqual(roots({ schedule: { frequency: "daily" }, budget: 9, status: "paused" }), []);

const downstreamIdentity = {
  ...base.identity,
  topicPool: ["expanded"],
  voiceCasting: { voiceId: "voice-b" },
  imageKey: "avatar-b",
  bannerKey: "banner-b",
};
assert.deepEqual(
  positioningIdentityProjection(downstreamIdentity),
  positioningIdentityProjection(base.identity),
  "downstream SEO, voice and art writes must not stale positioning proof",
);
assert.notDeepEqual(
  seoIdentityProjection(downstreamIdentity),
  seoIdentityProjection(base.identity),
  "SEO proof must own the expanded topic pool",
);

console.log("CHANNEL INCEPTION INVALIDATION TESTS PASS");
