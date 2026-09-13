import assert from "node:assert/strict";
import Module from "node:module";

import { planStorySpine } from "@/engine/storySpine";
import { sha256BytesHex } from "@/lib/sha256";

const objectBytes = new Map<string, Uint8Array>();
const written: Array<{ path: string; bytes: Uint8Array }> = [];
const clipDurations: number[] = [];
let storageReads = 0;
let providerCalls = 0;

// The actual block, scene-plan resolver, style selector, and text-cue helper
// remain live. Only external storage, local media I/O/probing, and the paid
// Novita primitive are controlled so this proves the executable zero-spend
// branch rather than a fixture that merely resembles its output.
const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function preparedFootageRuntimeLoad(request, ...args) {
  const resolved = originalLoad.call(this, request, ...args) as Record<string, unknown>;
  if (request.endsWith("/storage")) {
    return {
      ...resolved,
      getObjectBytes: async (key: string) => {
        storageReads++;
        const bytes = objectBytes.get(key);
        if (!bytes) throw new Error(`unexpected R2 key ${key}`);
        return bytes;
      },
    };
  }
  if (request.endsWith("/files")) {
    return {
      ...resolved,
      makeRunTempDir: async () => "/tmp/prepared-footage-runtime",
      writeBytes: async (path: string, bytes: Uint8Array) => {
        written.push({ path, bytes });
        return path;
      },
    };
  }
  if (request.endsWith("/ffmpeg")) {
    return {
      ...resolved,
      probe: async (path: string) => {
        const match = /clip_(\d+)\.mp4$/u.exec(path);
        return {
          durationSec: clipDurations[(match ? Number(match[1]) : 1) - 1] ?? 6,
          hasVideo: true,
          hasAudio: false,
        };
      },
    };
  }
  if (request.endsWith("/novitaMedia")) {
    return {
      ...resolved,
      renderNovitaGeneratedScenes: async () => {
        providerCalls++;
        throw new Error("prepared footage must never dispatch Novita");
      },
    };
  }
  return resolved;
};

async function main(): Promise<void> {
  const { genFootage, resolveGeneratedFootageScenePlan } = await import("../genFootageBlocks");
  const spine = planStorySpine({
    topic: "How a missing archive photograph changed the case",
    narrationDurationSec: 24,
    sentenceTimings: [
      { text: "The archive box arrived with one photograph missing from the index.", start: 0, end: 6 },
      { text: "A careful comparison of the paper revealed it came from a different case file.", start: 6, end: 12 },
      { text: "The catalog number led the researcher to a long-forgotten newspaper room.", start: 12, end: 18 },
      { text: "That new evidence reframed what happened on the night in question.", start: 18, end: 24 },
    ],
    styleDNA: {
      recurringSubject: "archival investigator at a case-file desk",
      setting: "rainy city records room",
      colorGrade: "grounded amber-and-charcoal documentary",
      visualAvoid: ["logos"],
    },
    generationProfile: "production",
    targetShotSec: 6,
  });
  const planningStore = {
    styleDNA: {
      recurringSubject: "archival investigator at a case-file desk",
      setting: "rainy city records room",
      colorGrade: "grounded amber-and-charcoal documentary",
      visualAvoid: ["logos"],
    },
    narrationDurationSec: 24,
    ltxStyleId: "cinematic_heist_noir",
    timedScript: spine.timedScript,
    narrativeBeats: spine.narrativeBeats,
    continuityLedger: spine.continuityLedger,
    shotList: spine.shotList,
    dpVisualSpecs: spine.dpVisualSpecs,
    editorEdl: spine.editorEdl,
    storyCoverage: spine.coverage,
  };
  const plan = resolveGeneratedFootageScenePlan({
    store: planningStore,
    label: "prepared-footage-runtime",
    maxScenes: 4,
    minScenes: 4,
    defaultDurationSec: 6,
    avoid: "logos",
  });
  clipDurations.splice(0, clipDurations.length, ...plan.scenes.map((scene) => scene.durationSec));
  const clipKeys = plan.scenes.map((_, index) => `owner/fixture/prepared/footage/clip-${String(index + 1).padStart(4, "0")}.mp4`);
  const clips = clipKeys.map((r2Key, index) => {
    const bytes = Buffer.from(`prepared-video-${index + 1}`.repeat(100));
    objectBytes.set(r2Key, bytes);
    return {
      r2Key,
      sha256: sha256BytesHex(bytes),
      byteLength: bytes.byteLength,
      durationSec: plan.scenes[index]!.durationSec,
    };
  });
  const preparedFootage = {
    version: "plan-week-prepared-footage/v1" as const,
    manifestSha256: "a".repeat(64),
    ownerId: "fixture-owner",
    channelId: "fixture-channel",
    batchId: "fixture-batch",
    itemId: "fixture-item",
    requestKey: "fixture-request",
    topic: "How a missing archive photograph changed the case",
    generatedFootageSceneManifest: {
      version: "generated-footage-scene-manifest/v1" as const,
      source: "story_spine" as const,
      exactOrder: true as const,
      durationSec: plan.scenes.reduce((total, scene) => total + scene.durationSec, 0),
      items: plan.scenes.map((scene, index) => ({ sceneId: scene.id, clipKey: clipKeys[index]! })),
    },
    clips,
    ltxStyleId: "cinematic_heist_noir",
    createdAt: Date.now(),
  };
  const context = {
    ownerId: "fixture-owner",
    runId: "fixture-run",
    channelId: "fixture-channel",
    keyPrefix: "owner/fixture/",
    params: { clipSec: 6, maxClips: 4 },
    store: {
      ...planningStore,
      preparedFootage,
    },
    log: () => undefined,
  };

  const result = await genFootage.run(context as never) as Record<string, unknown>;
  assert.deepEqual(result.footageKeys, clipKeys, "the actual block must preserve the immutable prepared clip order");
  assert.equal(result.__costUsd, 0, "a fully verified prepared footage result must not report a Novita charge");
  assert.deepEqual(result.footageRenderer, {
    kind: "novita-ltx",
    styleId: "cinematic_heist_noir",
  }, "legacy prepared footage must retain its explicit renderer identity");
  assert.equal(providerCalls, 0, "the success path must not invoke the paid renderer");
  assert.equal(storageReads, 4, "the actual block must re-read every retained clip before reuse");
  assert.equal(written.length, 4, "every verified retained clip must be rehydrated for assembly");

  storageReads = 0;
  written.length = 0;
  const corrupt = structuredClone(preparedFootage);
  corrupt.clips[1]!.sha256 = "0".repeat(64);
  await assert.rejects(
    () => genFootage.run({ ...context, store: { ...context.store, preparedFootage: corrupt } } as never),
    /bytes do not match its immutable receipt/,
    "changed R2 bytes must fail closed before a fallback render can spend",
  );
  assert.equal(providerCalls, 0, "digest rejection must not dispatch the paid renderer");
  assert.equal(storageReads, 4, "the bounded concurrent verifier may finish all R2 reads, but must never dispatch a replacement render");

  console.log("prepared weekly footage runtime reuse passed");
}

main().finally(() => {
  loader._load = originalLoad;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
