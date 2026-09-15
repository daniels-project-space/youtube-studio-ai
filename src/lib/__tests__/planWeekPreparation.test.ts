import assert from "node:assert/strict";

import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertPlanWeekPreparationManifestBinding,
  assertPlanWeekPreparedFootageBinding,
  assertPlanWeekPreparedImagesBinding,
  assertPlanWeekPreparedMusicBinding,
  assertPlanWeekPreparedNarrationBinding,
  assertPlanWeekPreparedScriptBinding,
  PLAN_WEEK_PREPARATION_VERSION,
  PLAN_WEEK_PREPARED_FOOTAGE_VERSION,
  PLAN_WEEK_PREPARED_IMAGES_VERSION,
  PLAN_WEEK_PREPARED_MUSIC_VERSION,
  PLAN_WEEK_PREPARED_NARRATION_VERSION,
  PLAN_WEEK_PREPARED_SCRIPT_VERSION,
  planWeekPreparationPrompt,
  planWeekPreparationKey,
  planWeekPreparationManifestSha256,
  planWeekPreparedNarrationAudioKey,
  planWeekPreparedNarrationKey,
  planWeekPreparedMusicAudioKey,
  planWeekPreparedFootageClipKey,
  planWeekPreparedH3FirstFrameKey,
  planWeekPreparedFootageKey,
  planWeekPreparedImageKey,
  planWeekPreparedImagesKey,
  planWeekPreparedMusicKey,
  planWeekPreparedMusicNativeWavKey,
  planWeekPreparedMusicQualityReceiptKey,
  planWeekPreparedMusicRuntimeReceiptKey,
  planWeekPreparedScriptKey,
  planWeekThumbnailKey,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { PLAN_WEEK_CONTRACT_VERSION } from "@/lib/planWeekContract";
import { sha256Hex } from "@/lib/sha256";
import {
  MINIMAX_H3_MANIFEST_SHA256,
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
  miniMaxH3RequestKey,
} from "@/lib/minimaxH3";
import { buildPreparedFootageSidecar } from "@/trigger/minimaxH3WeeklyBatch";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import {
  claimPlanItem,
  completeDeferredFramePlanItem,
  finalizePlanBatch,
  recordPlanItemPreparation,
} from "../../../convex/contentPlan";

const ownerId = "owner-preparation";
const channelId = "channels:preparation";
const batchId = "planBatches:preparation";
const itemId = "contentPlan:preparation";
const channelSlug = "frozen-history";
const itemKey = "week-2026-09:0";
const requestKey = "week-2026-09";
const thumbnailKey = `owner/${ownerId}/channel/${channelSlug}/plan/${itemId}.jpg`;

const manifest: PlanWeekPreparationManifest = {
  version: PLAN_WEEK_PREPARATION_VERSION,
  ownerId,
  channelId,
  batchId,
  itemId,
  itemKey,
  requestKey,
  channelSlug,
  frozenAt: Date.now() - 1_000,
  plan: {
    topic: "The lock that changed a kingdom",
    title: "The Lock That Changed a Kingdom",
    description: "A practical history episode about an overlooked mechanism.",
    sceneSeed: "A battered iron lock opens over a crowded medieval market.",
    thumbnailKey,
    thumbnailSource: "planner_artwork",
  },
  execution: {
    pipeline: [{ block: "topic_select" }, { block: "script_gen" }],
    moduleConfig: { script_gen: { maxSeconds: 360 } },
    seedStore: {
      channelName: "Frozen History",
      channelProgramRoute: { routeFingerprint: "a".repeat(64) },
    },
  },
  prompts: {
    script: "Build a causal narration with a satisfying payoff.",
    narration: "Read in the frozen channel voice.",
    shotlist: "Every shot advances the story.",
    visual: "Keep the iron lock readable in the opening frame.",
  },
};

const pointer = {
  version: PLAN_WEEK_PREPARATION_VERSION,
  manifestKey: planWeekPreparationKey(manifest),
  manifestSha256: planWeekPreparationManifestSha256(manifest),
};

assert.equal(
  planWeekThumbnailKey({ ownerId, channelSlug, itemId }),
  `owner/${ownerId}/channel/${channelSlug}/plan/${itemId}.jpg`,
  "thumbnail destinations use the same canonical owner/channel/item namespace",
);
assert.equal(
  planWeekPreparedScriptKey({ ownerId, channelSlug, batchId, itemId }),
  `owner/${ownerId}/channel/${channelSlug}/plan-batches/${batchId}/items/${itemId}/preparation/prepared/script.json`,
  "prepared scripts share the same canonical owner/channel/batch/item namespace",
);
assert.equal(
  planWeekPreparedNarrationKey({ ownerId, channelSlug, batchId, itemId }),
  `owner/${ownerId}/channel/${channelSlug}/plan-batches/${batchId}/items/${itemId}/preparation/prepared/narration.json`,
  "prepared narration receipts share the canonical weekly item namespace",
);
assert.equal(
  planWeekPreparedNarrationAudioKey({ ownerId, channelSlug, batchId, itemId }),
  `owner/${ownerId}/channel/${channelSlug}/plan-batches/${batchId}/items/${itemId}/preparation/prepared/narration.mp3`,
  "prepared narration audio cannot point to an arbitrary R2 destination",
);
assert.equal(
  planWeekPreparedMusicKey({ ownerId, channelSlug, batchId, itemId }),
  `owner/${ownerId}/channel/${channelSlug}/plan-batches/${batchId}/items/${itemId}/preparation/prepared/music.json`,
  "prepared music receipts share the canonical weekly item namespace",
);
assert.equal(
  planWeekPreparedMusicAudioKey({ ownerId, channelSlug, batchId, itemId }),
  `owner/${ownerId}/channel/${channelSlug}/plan-batches/${batchId}/items/${itemId}/preparation/prepared/music.mp3`,
  "prepared music masters cannot point at arbitrary R2 destinations",
);
assert.equal(
  planWeekPreparedFootageKey({ ownerId, channelSlug, batchId, itemId }),
  `owner/${ownerId}/channel/${channelSlug}/plan-batches/${batchId}/items/${itemId}/preparation/prepared/footage.json`,
  "prepared footage receipts share the canonical weekly item namespace",
);
assert.equal(
  planWeekPreparedImagesKey({ ownerId, channelSlug, batchId, itemId }),
  `owner/${ownerId}/channel/${channelSlug}/plan-batches/${batchId}/items/${itemId}/preparation/prepared/images.json`,
  "prepared image receipts share the canonical weekly item namespace",
);
assert.equal(
  planWeekPreparedImageKey({ ownerId, channelSlug, batchId, itemId, index: 0 }),
  `owner/${ownerId}/channel/${channelSlug}/plan-batches/${batchId}/items/${itemId}/preparation/prepared/images/still-00001.png`,
  "prepared image bytes use deterministic numbered destinations",
);
for (const malformed of [
  { ownerId: "owner/other", channelSlug, itemId },
  { ownerId, channelSlug: "history\\..\\other", itemId },
  { ownerId, channelSlug, itemId: "../foreign-item" },
]) {
  assert.throws(
    () => planWeekThumbnailKey(malformed),
    /safe path segment/,
    "path separators cannot create a cross-channel weekly destination",
  );
}
assert.throws(
  () => planWeekPreparationKey({ ownerId, channelSlug: "../foreign-channel", batchId, itemId }),
  /safe path segment/,
  "preparation manifests reject traversal-like channel namespaces",
);

assert.equal(pointer.manifestSha256.length, 64);
const preparedScript = {
  version: PLAN_WEEK_PREPARED_SCRIPT_VERSION,
  manifestSha256: pointer.manifestSha256,
  ownerId,
  channelId,
  batchId,
  itemId,
  requestKey,
  topic: manifest.plan.topic,
  script: {
    hook: "The old lock was never meant to open.",
    sections: [{ heading: "The mechanism", narration: "One missing pin changed the kingdom.", role: "outro" as const }],
    narrationText: "The old lock was never meant to open. One missing pin changed the kingdom.",
    estDurationSec: 14,
    programRouteFingerprint: "a".repeat(64),
    crafted: {
      hook: "The old lock was never meant to open.",
      opening: "One missing pin changed the kingdom.",
      coldOpen: "The old lock was never meant to open. One missing pin changed the kingdom.",
      device: "wrong_way",
      loop: "Reveal why the missing pin changed the kingdom.",
      verdict: {
        punch: 9,
        specificity: 9,
        curiosity: 9,
        voiceMatch: 9,
        promise: 9,
        honest: true,
        judged: true,
        factCheck: "verified" as const,
        lint: {
          pass: true,
          firstSentenceWords: 9,
          estHookSeconds: 4,
          hookSentences: 1,
          openingWords: 8,
          bannedHits: [],
          issues: [],
        },
      },
    },
  },
  scriptSha256: "",
  createdAt: Date.now() - 500,
};
preparedScript.scriptSha256 = sha256Hex(canonicalJson(preparedScript.script));
const admittedPreparedScript = assertPlanWeekPreparedScriptBinding({ prepared: preparedScript, manifest });
assert.equal(
  admittedPreparedScript.script.narrationText,
  preparedScript.script.narrationText,
  "a prepared script is bound to its exact frozen weekly item before scheduled execution can reuse it",
);
const preparedImageKey = planWeekPreparedImageKey({ ownerId, channelSlug, batchId, itemId, index: 0 });
const preparedStillManifest = {
  version: "1.0.0" as const,
  generation: {
    contractVersion: "1.0.0" as const,
    profileId: "production" as const,
    model: "Tongyi-MAI/Z-Image-Turbo",
    revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
    checkpoint: "Z-Image-Turbo",
    precision: "bf16" as const,
    width: 1920,
    height: 1088,
    steps: 9,
    allowFallback: false as const,
  },
  items: [{ shotId: "shot-1", candidateIndex: 0, outputId: "prepared-shot-1", stillKey: preparedImageKey }],
};
const preparedImages = {
  version: PLAN_WEEK_PREPARED_IMAGES_VERSION,
  manifestSha256: pointer.manifestSha256,
  ownerId,
  channelId,
  batchId,
  itemId,
  requestKey,
  topic: manifest.plan.topic,
  stillRenderManifest: preparedStillManifest,
  stillRenderManifestSha256: sha256Hex(canonicalJson(preparedStillManifest)),
  items: [{ shotId: "shot-1", candidateIndex: 0, stillKey: preparedImageKey, sha256: "4".repeat(64), byteLength: 4_096 }],
  createdAt: Date.now() - 250,
};
assert.equal(
  assertPlanWeekPreparedImagesBinding({ prepared: preparedImages, manifest }).items[0]?.stillKey,
  preparedImageKey,
  "prepared images bind ordered candidates, bytes, and the exact weekly item before reuse",
);
assert.throws(
  () => assertPlanWeekPreparedImagesBinding({
    prepared: { ...preparedImages, items: [{ ...preparedImages.items[0], stillKey: "owner/foreign/still.png" }] },
    manifest,
  }),
  /binding mismatch/,
  "a prepared image may not redirect scheduled execution outside its canonical preparation namespace",
);
assert.throws(
  () => assertPlanWeekPreparedImagesBinding({
    prepared: { ...preparedImages, stillRenderManifestSha256: "5".repeat(64) },
    manifest,
  }),
  /digest mismatch/,
  "a prepared image receipt cannot name a different still manifest",
);
const h3NativeDurationSec = MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps;
const h3ClipKey = planWeekPreparedFootageClipKey({ ownerId, channelSlug, batchId, itemId, index: 0 });
const h3FirstFrameKey = planWeekPreparedH3FirstFrameKey({ ownerId, channelSlug, batchId, itemId, index: 0 });
const h3Job = {
  sceneId: "shot-1",
  prompt: "A quiet archival room, dust in a shaft of light, no text.",
  seed: 812,
  firstFrame: { r2Key: h3FirstFrameKey, sha256: "2".repeat(64) },
  output: { r2Key: h3ClipKey },
  maxCostUsd: 0.4,
  requestKey: "",
};
h3Job.requestKey = miniMaxH3RequestKey({
  provider: "salad",
  execution: "weekly-batch",
  prompt: h3Job.prompt,
  seed: h3Job.seed,
  firstFrame: h3Job.firstFrame,
  output: h3Job.output,
  maxCostUsd: h3Job.maxCostUsd,
});
const h3Prepared = {
  version: PLAN_WEEK_PREPARED_FOOTAGE_VERSION,
  manifestSha256: pointer.manifestSha256,
  ownerId,
  channelId,
  batchId,
  itemId,
  requestKey,
  topic: manifest.plan.topic,
  generatedFootageSceneManifest: {
    version: "generated-footage-scene-manifest/v1" as const,
    source: "story_spine" as const,
    exactOrder: true as const,
    durationSec: h3NativeDurationSec,
    items: [{ sceneId: "shot-1", clipKey: h3ClipKey }],
  },
  clips: [{ r2Key: h3ClipKey, sha256: "3".repeat(64), byteLength: 8_192, durationSec: h3NativeDurationSec }],
  renderer: {
    kind: "minimax-h3" as const,
    provider: "salad" as const,
    execution: "weekly-batch" as const,
    runtimeId: MINIMAX_H3_RUNTIME_ID,
    profileId: MINIMAX_H3_PROFILE.id,
    modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
  },
  h3Jobs: [h3Job],
  h3Receipts: [{
    schema: "minimax-h3-worker/v1" as const,
    requestKey: h3Job.requestKey,
    jobId: "h3-job-1",
    execution: "weekly-batch" as const,
    profile: MINIMAX_H3_PROFILE,
    promptSha256: sha256Hex(h3Job.prompt),
    seed: h3Job.seed,
    firstFrame: h3Job.firstFrame,
    output: { r2Key: h3ClipKey, contentSha256: "3".repeat(64), byteLength: 8_192, contentType: "video/mp4" as const },
    runtime: {
      provider: "salad" as const,
      gpuModel: "RTX 5090" as const,
      runtimeId: MINIMAX_H3_RUNTIME_ID,
      modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
      capacityMode: "medium" as const,
      costUsd: 0.25,
    },
  }],
  createdAt: Date.now() - 50,
};
assert.equal(
  assertPlanWeekPreparedFootageBinding({ prepared: h3Prepared, manifest }).renderer?.kind,
  "minimax-h3",
  "prepared H3 footage binds an explicit renderer instead of masquerading as an LTX receipt",
);
const producerSidecar = buildPreparedFootageSidecar({
  manifest,
  binding: {
    ownerId,
    channelSlug,
    batchId,
    itemId,
    manifestKey: pointer.manifestKey,
    manifestSha256: pointer.manifestSha256,
    sceneIds: ["shot-1"],
  },
  jobs: [h3Job],
  result: [{
    requestKey: h3Job.requestKey,
    receipt: h3Prepared.h3Receipts[0],
    outputBytes: new Uint8Array(0),
  }],
});
assert.equal(
  producerSidecar.generatedFootageSceneManifest.items[0]?.clipKey,
  h3ClipKey,
  "the weekly Salad producer must emit the canonical prepared-footage clip destination",
);
assert.equal(
  producerSidecar.h3Receipts?.[0]?.requestKey,
  h3Job.requestKey,
  "the weekly prepared-footage sidecar must retain the exact H3 provider receipt",
);
assert.throws(
  () => assertPlanWeekPreparedFootageBinding({
    prepared: { ...h3Prepared, clips: [{ ...h3Prepared.clips[0], durationSec: 5 }] },
    manifest,
  }),
  /native H3|duration|H3 clip/i,
  "an H3 prepared receipt rejects a non-native clip duration before reuse",
);
assert.equal(
  admittedPreparedScript.script.crafted?.verdict.factCheck,
  "verified",
  "the exact judged hook receipt survives weekly preparation rather than invalidating a normal script_gen result",
);
assert.throws(
  () => assertPlanWeekPreparedScriptBinding({
    prepared: { ...preparedScript, topic: "A foreign episode" },
    manifest,
  }),
  /binding mismatch/,
  "a prepared script cannot cross from one weekly episode topic into another",
);
assert.throws(
  () => assertPlanWeekPreparedScriptBinding({
    prepared: { ...preparedScript, scriptSha256: "b".repeat(64) },
    manifest,
  }),
  /binding mismatch/,
  "a receipt cannot name a different script than the one it carries",
);
const preparedNarration = {
  version: PLAN_WEEK_PREPARED_NARRATION_VERSION,
  manifestSha256: pointer.manifestSha256,
  ownerId,
  channelId,
  batchId,
  itemId,
  requestKey,
  topic: manifest.plan.topic,
  scriptSha256: preparedScript.scriptSha256,
  narrationKey: planWeekPreparedNarrationAudioKey({ ownerId, channelSlug, batchId, itemId }),
  audioSha256: "c".repeat(64),
  audioByteLength: 4_096,
  narrationDurationSec: 12,
  narrationTranscriptText: "The old lock was never meant to open. One missing pin changed the kingdom.",
  narrationTranscriptSha256: "",
  narrationPerformanceEvidence: {
    version: "narration-performance-evidence/v1" as const,
    source: "local_ffmpeg" as const,
    durationSec: 12,
    wordCount: 18,
    wordsPerSec: 1.5,
    integratedLufs: -18,
    windowMeanDb: -15,
  },
  sentenceTimings: [
    { text: "The old lock was never meant to open.", start: 0, end: 5 },
    { text: "One missing pin changed the kingdom.", start: 5.5, end: 11.8 },
  ],
  chapterPlan: [{ kind: "footage" as const, durSec: 12 }],
  createdAt: Date.now() - 300,
};
preparedNarration.narrationTranscriptSha256 = sha256Hex(preparedNarration.narrationTranscriptText);
assert.equal(
  assertPlanWeekPreparedNarrationBinding({ prepared: preparedNarration, manifest }).narrationKey,
  preparedNarration.narrationKey,
  "a prepared narration binds an exact script, measured receipt, timing map, and canonical retained audio key",
);
assert.throws(
  () => assertPlanWeekPreparedNarrationBinding({
    prepared: { ...preparedNarration, narrationKey: "owner/foreign/narration.mp3" },
    manifest,
  }),
  /binding mismatch/,
  "a prepared narration may not redirect scheduled execution to another episode's audio",
);
assert.throws(
  () => assertPlanWeekPreparedNarrationBinding({
    prepared: { ...preparedNarration, sentenceTimings: [{ text: "late", start: 0, end: 13 }] },
    manifest,
  }),
  /sentence timings are invalid/,
  "a timing map cannot overrun the retained narration it claims to describe",
);
assert.throws(
  () => assertPlanWeekPreparedNarrationBinding({
    prepared: { ...preparedNarration, narrationTranscriptSha256: "d".repeat(64) },
    manifest,
  }),
  /transcript does not match/,
  "a sidecar cannot swap the text that its measured audio receipt claims to narrate",
);
const preparedMusic = {
  version: PLAN_WEEK_PREPARED_MUSIC_VERSION,
  manifestSha256: pointer.manifestSha256,
  ownerId,
  channelId,
  batchId,
  itemId,
  requestKey,
  topic: manifest.plan.topic,
  musicKey: planWeekPreparedMusicAudioKey({ ownerId, channelSlug, batchId, itemId }),
  audioSha256: "e".repeat(64),
  audioByteLength: 8_192,
  musicDurationSec: 120,
  provider: "minimax_music3" as const,
  musicProgram: createChannelMusicProgram({
    channelId,
    channelIdentityFingerprint: "f".repeat(64),
    family: "history",
    contentLaneKey: "documentary",
    topic: manifest.plan.topic,
    providerPreference: "minimax_music3",
  }),
  minimax: {
    nativeWavKey: planWeekPreparedMusicNativeWavKey({ ownerId, channelSlug, batchId, itemId }),
    runtimeReceiptKey: planWeekPreparedMusicRuntimeReceiptKey({ ownerId, channelSlug, batchId, itemId }),
    qualityReceiptKey: planWeekPreparedMusicQualityReceiptKey({ ownerId, channelSlug, batchId, itemId }),
  },
  createdAt: Date.now() - 200,
};
assert.equal(
  assertPlanWeekPreparedMusicBinding({ prepared: preparedMusic, manifest }).musicProgram.fingerprint,
  preparedMusic.musicProgram.fingerprint,
  "a prepared MiniMax master binds the frozen episode, sealed music program, and all required audit artifacts",
);
assert.throws(
  () => assertPlanWeekPreparedMusicBinding({
    prepared: { ...preparedMusic, musicKey: "owner/foreign/music.mp3" },
    manifest,
  }),
  /binding mismatch/,
  "a prepared weekly master may not redirect scheduled execution to another channel object",
);
assert.throws(
  () => assertPlanWeekPreparedMusicBinding({
    prepared: { ...preparedMusic, minimax: undefined },
    manifest,
  }),
  /MiniMax music receipt is invalid/,
  "a MiniMax weekly master cannot bypass its native-WAV, runtime, and human-audition evidence",
);
const preparedFootageClipKey = planWeekPreparedFootageClipKey({ ownerId, channelSlug, batchId, itemId, index: 0 });
const preparedFootage = {
  version: PLAN_WEEK_PREPARED_FOOTAGE_VERSION,
  manifestSha256: pointer.manifestSha256,
  ownerId,
  channelId,
  batchId,
  itemId,
  requestKey,
  topic: manifest.plan.topic,
  generatedFootageSceneManifest: {
    version: "generated-footage-scene-manifest/v1" as const,
    source: "story_spine" as const,
    exactOrder: true as const,
    durationSec: 5,
    items: [{ sceneId: "shot-1", clipKey: preparedFootageClipKey }],
  },
  clips: [{ r2Key: preparedFootageClipKey, sha256: "1".repeat(64), byteLength: 8_192, durationSec: 5 }],
  ltxStyleId: "cinematic-documentary",
  createdAt: Date.now() - 100,
};
assert.equal(
  assertPlanWeekPreparedFootageBinding({ prepared: preparedFootage, manifest }).clips[0]?.r2Key,
  preparedFootageClipKey,
  "prepared footage binds every ordered rendered clip to the retained generated-footage manifest",
);
assert.throws(
  () => assertPlanWeekPreparedFootageBinding({
    prepared: { ...preparedFootage, clips: [{ ...preparedFootage.clips[0], r2Key: "owner/foreign/clip.mp4" }] },
    manifest,
  }),
  /clip binding mismatch/,
  "a prepared footage receipt cannot substitute a foreign or reordered clip object",
);
assert.equal(
  planWeekPreparationPrompt(manifest, "narration"),
  manifest.prompts.narration,
  "a frozen narration brief is readable by the corresponding execution module",
);
assert.equal(
  planWeekPreparationPrompt(pointer, "narration"),
  undefined,
  "the pointer-only scheduled seed cannot impersonate a verified preparation packet",
);
assert.throws(
  () => planWeekPreparationPrompt({ prompts: { narration: "" } }, "narration"),
  /narration prompt is invalid/,
  "a malformed frozen brief fails closed before a paid narration request",
);
assert.equal(
  assertPlanWeekPreparationManifestBinding({
    manifest,
    pointer,
    ownerId,
    channelId,
    batchId,
    itemId,
    itemKey,
    requestKey,
    channelSlug,
    topic: manifest.plan.topic,
    title: manifest.plan.title,
    thumbnailKey,
    thumbnailSource: "planner_artwork",
  }).prompts.script,
  manifest.prompts.script,
  "an exact content-addressed preparation packet is admissible",
);
assert.throws(
  () => assertPlanWeekPreparationManifestBinding({
    manifest: { ...manifest, plan: { ...manifest.plan, title: "Changed after freezing" } },
    pointer,
    ownerId,
    channelId,
    batchId,
    itemId,
    itemKey,
    requestKey,
    channelSlug,
    topic: manifest.plan.topic,
    title: manifest.plan.title,
    thumbnailKey,
    thumbnailSource: "planner_artwork",
  }),
  /binding mismatch/,
  "changing any frozen editorial input invalidates the original digest",
);
assert.throws(
  () => assertPlanWeekPreparationManifestBinding({
    manifest,
    pointer: { ...pointer, manifestKey: "owner/wrong.json" },
    ownerId,
    channelId,
    batchId,
    itemId,
    itemKey,
    requestKey,
    channelSlug,
    topic: manifest.plan.topic,
    title: manifest.plan.title,
    thumbnailKey,
    thumbnailSource: "planner_artwork",
  }),
  /binding mismatch/,
  "the manifest is namespaced to its exact owner/channel/batch/item",
);

async function invoke<T>(definition: unknown, context: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  })._handler(context, args);
}

async function main() {
  const batch = {
    _id: batchId,
    ownerId,
    channelId,
    channelSlug,
    requestKey,
    contractVersion: PLAN_WEEK_CONTRACT_VERSION,
  };
  const channel = { _id: channelId, ownerId };
  let item: Record<string, unknown> = {
    _id: itemId,
    ownerId,
    channelId,
    batchId,
    itemKey,
    topic: manifest.plan.topic,
    title: manifest.plan.title,
    description: manifest.plan.description,
    sceneSeed: manifest.plan.sceneSeed,
    generationState: "pending",
  };
  const context = {
    auth: {
      getUserIdentity: async () => ({
        role: "service",
        subject: "trigger-plan-week",
        owner_id: ownerId,
        issuer: "https://studio.test",
        tokenIdentifier: `test|${ownerId}`,
      }),
    },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => id === channelId ? channel : id === batchId ? batch : id === itemId ? item : null,
      patch: async (_id: string, patch: Record<string, unknown>) => {
        item = { ...item, ...patch };
      },
    },
  };
  const args = {
    ownerId,
    channelId,
    batchId,
    itemId,
    manifest,
    thumbnailSource: manifest.plan.thumbnailSource,
    ...pointer,
  };
  const first = await invoke<{ state: string; reused: boolean }>(recordPlanItemPreparation, context, args);
  assert.deepEqual(first, { state: "frozen", reused: false });
  assert.equal(item.preparationManifestSha256, pointer.manifestSha256);
  const replay = await invoke<{ state: string; reused: boolean }>(recordPlanItemPreparation, context, args);
  assert.deepEqual(replay, { state: "frozen", reused: true });
  await assert.rejects(
    invoke(recordPlanItemPreparation, context, { ...args, manifestSha256: "b".repeat(64) }),
    /binding mismatch/,
    "a service worker cannot substitute a different digest after the item is frozen",
  );
  await assert.rejects(
    invoke(recordPlanItemPreparation, context, { ...args, thumbnailSource: "rendered_video_frame" }),
    /binding mismatch/,
    "a frozen planner-artwork manifest cannot be relabeled as a rendered-frame plan",
  );

  // Lo-Fi retains a deterministic future key but explicitly blocks generic
  // planner artwork. It becomes schedulable only as a final-render-frame job.
  const lofiBatchId = "planBatches:lofi";
  const lofiItemId = "contentPlan:lofi";
  let lofiBatch: Record<string, unknown> = {
    _id: lofiBatchId,
    ownerId,
    channelId,
    channelSlug,
    requestKey,
    contractVersion: PLAN_WEEK_CONTRACT_VERSION,
    itemIds: [lofiItemId],
    topicState: "complete",
    topicUsageCheckpointKey: "topics:lofi",
    accountingComplete: true,
    budgetExceeded: false,
    actualCostUsd: 0,
    reservedCostUsd: 1,
    status: "running",
  };
  let lofiItem: Record<string, unknown> = {
    _id: lofiItemId,
    ownerId,
    channelId,
    batchId: lofiBatchId,
    itemKey: "week-2026-09:lofi",
    topic: "A slow rain room for deep focus",
    title: "Slow Rain Room",
    description: "A seamless focus session built from one retained scene.",
    sceneSeed: "A rainy studio window glows at night.",
    generationState: "pending",
  };
  const lofiThumbnailKey = `owner/${ownerId}/channel/${channelSlug}/plan/${lofiItemId}.jpg`;
  const lofiManifest: PlanWeekPreparationManifest = {
    ...manifest,
    batchId: lofiBatchId,
    itemId: lofiItemId,
    itemKey: String(lofiItem.itemKey),
    plan: {
      topic: String(lofiItem.topic),
      title: String(lofiItem.title),
      description: String(lofiItem.description),
      sceneSeed: String(lofiItem.sceneSeed),
      thumbnailKey: lofiThumbnailKey,
      thumbnailSource: "rendered_video_frame",
    },
  };
  const lofiPointer = {
    version: PLAN_WEEK_PREPARATION_VERSION,
    manifestKey: planWeekPreparationKey(lofiManifest),
    manifestSha256: planWeekPreparationManifestSha256(lofiManifest),
  };
  const lofiContext = {
    auth: context.auth,
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => id === channelId ? channel : id === lofiBatchId ? lofiBatch : id === lofiItemId ? lofiItem : null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        if (id === lofiBatchId) lofiBatch = { ...lofiBatch, ...patch };
        else lofiItem = { ...lofiItem, ...patch };
      },
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => table === "contentPlan" ? [lofiItem] : [],
        }),
      }),
    },
  };
  await invoke(recordPlanItemPreparation, lofiContext, {
    ownerId,
    channelId,
    batchId: lofiBatchId,
    itemId: lofiItemId,
    manifest: lofiManifest,
    thumbnailSource: lofiManifest.plan.thumbnailSource,
    ...lofiPointer,
  });
  const blockedGenericClaim = await invoke<{ state: string }>(claimPlanItem, lofiContext, {
    ownerId, channelId, batchId: lofiBatchId, itemId: lofiItemId, claimant: "test-lofi",
  });
  assert.equal(blockedGenericClaim.state, "blocked");
  const deferred = await invoke<{ state: string; reused: boolean }>(completeDeferredFramePlanItem, lofiContext, {
    ownerId, channelId, batchId: lofiBatchId, itemId: lofiItemId, thumbnailKey: lofiThumbnailKey,
  });
  assert.deepEqual(deferred, { state: "ready", reused: false, thumbnailKey: lofiThumbnailKey });
  assert.equal(lofiItem.generationState, "deferred_to_final_render");
  assert.equal(lofiItem.usageCheckpointKey, undefined);
  assert.equal(lofiItem.thumbnailSource, "rendered_video_frame");
  const finalized = await invoke<{ status: string; planned: number; actualCostUsd: number }>(finalizePlanBatch, lofiContext, {
    ownerId, channelId, batchId: lofiBatchId,
  });
  assert.deepEqual(finalized, { status: "ready", planned: 1, actualCostUsd: 0 });
}

main()
  .then(() => console.log("plan-week preparation tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
