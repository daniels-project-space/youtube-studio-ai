import assert from "node:assert/strict";

import { assertPackageToOpeningPlanBinding } from "@/engine/packageToOpening";
import { assessThumbnailRefreshSuccessor } from "@/lib/thumbnailRefreshSuccessor";

const base = {
  ownerId: "owner-successor",
  channelId: "channel-successor",
  runId: "run-successor",
  title: "The Rule Marcus Aurelius Used Under Pressure",
  topic: "Stoic composure under pressure",
  channel: {
    ownerId: "owner-successor",
    channelId: "channel-successor",
    name: "The Quiet Stoic",
    status: "active",
    contentLane: {
      version: "content-lane/v1",
      key: "narrated_documentary",
      primaryRenderer: "timeline_assemble",
    },
    pipeline: [{ block: "metadata" }, { block: "thumbnail_gen" }],
    thumbnailPlaybook: {
      version: 1,
      visualLanguage: "charcoal sculpture, restrained copper light",
      rules: ["one monumental subject"],
      avoid: ["generic quote cards"],
      patterns: [{ id: "monument", weight: 1 }],
    },
    identity: {
      persona: "measured philosopher",
      styleGrammar: "classical restraint",
      niche: "stoic philosophy resilience",
      creativeBrief: { criticDoctrine: "Reject generic marble wallpaper." },
    },
  },
} as const;

const ready = assessThumbnailRefreshSuccessor(base);
assert.equal(ready.status, "ready_for_private_successor");
if (ready.status === "ready_for_private_successor") {
  assert.equal(ready.material.family, "narrated_stock");
  assert.equal(ready.material.store.thumbnailPlaybook, base.channel.thumbnailPlaybook);
  assert.equal(ready.material.store.title, base.title);
  assert.ok(ready.material.thumbnailDescription.length >= 80);
  assert.equal(ready.material.replayFingerprint.length, 64);
  assertPackageToOpeningPlanBinding({
    plan: ready.material.packageToOpeningPlan,
    title: ready.material.title,
    thumbnailDescription: ready.material.thumbnailDescription,
    topic: ready.material.topic,
    family: ready.material.family,
    contentLane: ready.material.contentLane,
  });
}

const drifted = assessThumbnailRefreshSuccessor({
  ...base,
  channel: {
    ...base.channel,
    thumbnailPlaybook: {
      ...base.channel.thumbnailPlaybook,
      visualLanguage: "bright pop-art collage",
    },
  },
});
assert.equal(drifted.status, "ready_for_private_successor");
if (ready.status === "ready_for_private_successor" && drifted.status === "ready_for_private_successor") {
  assert.notEqual(drifted.material.replayFingerprint, ready.material.replayFingerprint);
}

const noModule = assessThumbnailRefreshSuccessor({
  ...base,
  channel: { ...base.channel, pipeline: [{ block: "metadata" }] },
});
assert.equal(noModule.status, "private_successor_unavailable");
if (noModule.status === "private_successor_unavailable") {
  assert.ok(noModule.missing.includes("one current thumbnail module"));
}

const lofiWithoutVideo = assessThumbnailRefreshSuccessor({
  ...base,
  channel: {
    ...base.channel,
    family: "music_loop",
    contentLane: {
      version: "content-lane/v1",
      key: "lofi_music_loop",
      family: "music_loop",
      primaryRenderer: "assemble",
    },
  },
});
assert.equal(lofiWithoutVideo.status, "private_successor_unavailable");
if (lofiWithoutVideo.status === "private_successor_unavailable") {
  assert.ok(lofiWithoutVideo.missing.includes("retained Lo-Fi final video"));
}

const lofiReady = assessThumbnailRefreshSuccessor({
  ...base,
  sourceVideoKey: "owner/channels/lofi/runs/source/video.mp4",
  channel: {
    ...base.channel,
    family: "music_loop",
    contentLane: {
      version: "content-lane/v1",
      key: "lofi_music_loop",
      family: "music_loop",
      primaryRenderer: "assemble",
    },
  },
});
assert.equal(lofiReady.status, "ready_for_private_successor");
if (lofiReady.status === "ready_for_private_successor") {
  assert.equal(lofiReady.material.store.videoKey, "owner/channels/lofi/runs/source/video.mp4");
}

console.log("thumbnail refresh private successor: PASS");
