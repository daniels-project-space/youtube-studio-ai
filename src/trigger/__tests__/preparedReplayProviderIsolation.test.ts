import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import {
  planWeekPreparationKey, planWeekPreparedScriptKey, planWeekPreparedNarrationKey,
  planWeekPreparedNarrationAudioKey, planWeekPreparedMusicKey, planWeekPreparedMusicAudioKey,
  planWeekPreparedImagesKey, planWeekPreparedImageKey, type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { PREPARED_METADATA_READ } from "@/lib/preparedMediaStorage";

const manifest: PlanWeekPreparationManifest = {
  version: "plan-week-preparation/inputs-v1", ownerId: "replay-owner", channelId: "replay-channel",
  channelSlug: "archive", batchId: "batch", itemId: "episode", itemKey: "week:0", requestKey: "week", frozenAt: 1,
  plan: { topic: "The old lock", title: "The old lock", description: "A source-bound history.",
    sceneSeed: "An archive", thumbnailKey: "owner/replay-owner/old.jpg", thumbnailSource: "planner_artwork" },
  execution: { pipeline: [{ block: "script_gen" }], moduleConfig: {}, seedStore: {} },
  prompts: { script: "Source", narration: "Voice", shotlist: "Shots", visual: "Archive" },
};
const encode = (value: unknown) => Buffer.from(canonicalJson(value));
const manifestBytes = encode(manifest), manifestKey = planWeekPreparationKey(manifest);
const manifestSha256 = sha256BytesHex(manifestBytes);
const payload = { ...manifest, manifestKey, manifestSha256, maxCostUsd: 2,
  shots: [{ id: "shot-1", prompt: "An old lock in the archive", candidateCount: 1 }] };
const common = { ...manifest, topic: manifest.plan.topic, manifestSha256, createdAt: 2 };
const script = { hook: "An old lock.", sections: [{ heading: "Archive", narration: "A missing pin.", role: "outro" }],
  narrationText: "An old lock. A missing pin.", estDurationSec: 12 };
const scriptSha256 = sha256Hex(canonicalJson(script));
// Arbitrary bytes test storage integrity only, not audio/image quality.
const media = Buffer.alloc(4096, 7), mediaHash = sha256BytesHex(media);
const narrationKey = planWeekPreparedNarrationAudioKey(manifest), musicKey = planWeekPreparedMusicAudioKey(manifest);
const imageKey = planWeekPreparedImageKey({ ...manifest, index: 0 });
const stillRenderManifest = { version: "1.0.0", generation: { contractVersion: "1.0.0", profileId: "production",
  model: "Tongyi-MAI/Z-Image-Turbo", revision: "f332072aa78be7aecdf3ee76d5c247082da564a6", checkpoint: "Z-Image-Turbo",
  precision: "bf16", width: 1920, height: 1088, steps: 9, allowFallback: false },
  items: [{ shotId: "shot-1", candidateIndex: 0, stillKey: imageKey, outputId: "fixture" }] };
const sidecars = new Map<string, Buffer>([
  [planWeekPreparedScriptKey(manifest), encode({ ...common, version: "plan-week-prepared-script/v1", script, scriptSha256 })],
  [planWeekPreparedNarrationKey(manifest), encode({ ...common, version: "plan-week-prepared-narration/v1", scriptSha256,
    narrationKey, audioSha256: mediaHash, audioByteLength: media.length, narrationDurationSec: 12,
    narrationTranscriptText: script.narrationText, narrationTranscriptSha256: sha256Hex(script.narrationText),
    narrationPerformanceEvidence: { version: "narration-performance-evidence/v1", source: "local_ffmpeg",
      durationSec: 12, wordCount: 6, wordsPerSec: 0.5, integratedLufs: -18, windowMeanDb: -15 },
    sentenceTimings: [{ text: script.narrationText, start: 0, end: 12 }], chapterPlan: [{ kind: "footage", durSec: 12 }] })],
  [planWeekPreparedMusicKey(manifest), encode({ ...common, version: "plan-week-prepared-music/v1", musicKey,
    audioSha256: mediaHash, audioByteLength: media.length, musicDurationSec: 120, provider: "mureka",
    musicProgram: createChannelMusicProgram({ channelId: manifest.channelId, channelIdentityFingerprint: "a".repeat(64),
      family: "history", contentLaneKey: "documentary", topic: manifest.plan.topic, providerPreference: "mureka" }) })],
  [planWeekPreparedImagesKey(manifest), encode({ ...common, version: "plan-week-prepared-images/v1", stillRenderManifest,
    stillRenderManifestSha256: sha256Hex(canonicalJson(stillRenderManifest)),
    items: [{ shotId: "shot-1", candidateIndex: 0, stillKey: imageKey, sha256: mediaHash, byteLength: media.length }] })],
]);
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch;
const savedEnv = new Map(["OPENROUTER_API_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].map(key => [key, process.env[key]]));
const vaultReads: string[] = [], events: string[] = [];
let missingKey = "", mediaMode: "good" | "changed" | "short" | "timeout" = "good";
let paidCalls = 0, writes = 0, mediaReads = 0, dispatches = 0;
const claims = new Map<string, Uint8Array>();
const timeout = new Error("bounded media deadline");
async function main() {
  delete process.env.OPENROUTER_API_KEY;
  globalThis.fetch = async () => { throw new Error("external network forbidden"); };
  loader._load = function(id, ...args) {
    if (id === "@trigger.dev/sdk") return { task: (value: unknown) => value,
      tasks: { trigger: async () => { dispatches++; return { id: "next-stage-fixture" }; } },
      idempotencyKeys: { create: async () => "fixture-idempotency" } };
    if (id === "@/lib/vault") return { hydrateEnv: async (service: string) => {
      vaultReads.push(service); events.push(`vault:${service}`);
      if (service !== "cloudflare") throw new Error("generation provider unavailable");
      process.env.R2_ACCESS_KEY_ID = "fixture"; process.env.R2_SECRET_ACCESS_KEY = "fixture";
      return ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
    } };
    if (id === "@/lib/storage") return {
      getObjectBytes: async (key: string, _bucket: unknown, options: unknown) => {
        events.push(`read:${key}`);
        if (claims.has(key)) {
          assert.deepEqual(options, { maxBytes: claims.get(key)!.byteLength, timeoutMs: 30_000 });
          return claims.get(key)!;
        }
        if ([narrationKey, musicKey, imageKey].includes(key)) {
          assert.deepEqual(options, { maxBytes: media.length, timeoutMs: 300_000 });
          mediaReads++;
          if (mediaMode === "timeout") throw timeout;
          if (mediaMode === "short") return media.subarray(1);
          if (mediaMode === "changed") return Buffer.alloc(media.length, 8);
          return media;
        }
        assert.deepEqual(options, PREPARED_METADATA_READ);
        if (key === manifestKey) return manifestBytes;
        if (key === missingKey) throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
        assert.ok(sidecars.has(key), `unexpected storage read ${key}`);
        return sidecars.get(key)!;
      },
      putObject: async (key: string, bytes: Uint8Array, options: { ifNoneMatch?: string }) => {
        if (key.endsWith(".dispatch.json")) {
          assert.equal(options.ifNoneMatch, "*");
          if (claims.has(key)) throw Object.assign(new Error("already claimed"), { $metadata: { httpStatusCode: 412 } });
          claims.set(key, bytes); return key;
        }
        writes++; throw new Error("replay must not write");
      },
    };
    const actual = originalLoad.call(this, id, ...args);
    const stop = async () => { paidCalls++; events.push("generation"); throw new Error("stubbed generation boundary"); };
    if (id === "@/lib/scriptGen") return { ...actual as object, synthScript: stop };
    if (id === "@/lib/novitaRenderFarm") return { ...actual as object, renderImages: stop };
    if (id === "@/lib/music") return { ...actual as object, generateMureka: stop, generateSuno: stop };
    if (id === "@/lib/tts") return { ...actual as object, synthNarration: stop };
    return actual;
  };
  try {
    const require = createRequire(import.meta.url);
    // Fixture builders may import bootstrap transitively before the vault seam.
    delete require.cache[require.resolve("../../lib/bootstrap")];
    type Task = { run(payload: unknown): Promise<{ reused: boolean; costUsd: number }> };
    const tasks: Task[] = [require("../planWeekPreparedScript").planWeekPreparedScriptTask,
      require("../planWeekPreparedNarration").planWeekPreparedNarrationTask,
      require("../planWeekPreparedMusic").planWeekPreparedMusicTask,
      require("../planWeekPreparedImages").planWeekPreparedImagesTask];
    for (const task of tasks) {
      const result = await task.run(payload);
      assert.equal(result.reused, true); assert.equal(result.costUsd, 0);
    }
    assert.deepEqual(vaultReads, ["cloudflare"], "real bootstrap must not hydrate generation providers during replay");
    assert.equal(mediaReads, 3); assert.equal(dispatches, 1, "saved script retains its normal idempotent narration handoff");
    for (const mode of ["changed", "short", "timeout"] as const) {
      mediaMode = mode;
      for (const task of tasks.slice(1)) await assert.rejects(() => task.run(payload));
    }
    assert.equal(paidCalls, 0); assert.equal(writes, 0); assert.equal(dispatches, 1);
    assert.equal(claims.size, 0, "completed or rejected reuse never claims fresh generation");
    assert.deepEqual(vaultReads, ["cloudflare"]);
    mediaMode = "good";
    missingKey = planWeekPreparedScriptKey(manifest); events.length = 0;
    await assert.rejects(() => tasks[0].run(payload), /CRITICAL keys missing/);
    assert.equal(paidCalls, 0, "fresh script still needs its generation credential");
    assert.ok(events.indexOf(`read:${missingKey}`) < events.indexOf("vault:openrouter"));
    process.env.OPENROUTER_API_KEY = "fixture";
    await assert.rejects(() => tasks[0].run(payload), /stubbed generation boundary/);
    assert.equal(paidCalls, 1);
    await assert.rejects(() => tasks[0].run(payload), /PAID_STAGE_RECONCILIATION_REQUIRED/);
    assert.equal(paidCalls, 1, "a lost script result cannot buy another attempt");
    missingKey = planWeekPreparedImagesKey(manifest); events.length = 0;
    await assert.rejects(() => tasks[3].run(payload), /stubbed generation boundary/);
    assert.ok(events.indexOf(`read:${missingKey}`) < events.indexOf("vault:novita"));
    assert.ok(events.indexOf("vault:novita") < events.indexOf("generation"));
    assert.equal(paidCalls, 2); assert.equal(writes, 0);
    await assert.rejects(() => tasks[3].run(payload), /PAID_STAGE_RECONCILIATION_REQUIRED/);
    assert.equal(paidCalls, 2, "a lost image result cannot buy another wave");
    assert.equal(claims.size, 2);
    for (const [index, key] of [[1, planWeekPreparedNarrationKey(manifest)], [2, planWeekPreparedMusicKey(manifest)]] as const) {
      missingKey = key;
      const fresh = { ...payload, speaker: "fixture-voice" };
      const before: number = paidCalls;
      await assert.rejects(() => tasks[index].run(fresh), /stubbed generation boundary/);
      assert.equal(paidCalls, before + 1);
      await assert.rejects(() => tasks[index].run(fresh), /PAID_STAGE_RECONCILIATION_REQUIRED/);
      assert.equal(paidCalls, before + 1, "lost prepared audio cannot buy another take");
    }
    assert.equal(claims.size, 4);
    missingKey = "";
    for (const task of tasks) assert.equal((await task.run(payload)).reused, true,
      "a completed sidecar replays even when the dispatch claim exists");
    console.log("PREPARED REPLAY ISOLATION PASS: four real producers and real bootstrap, no generation credentials on reuse, bounded retained bytes, nine bad-media holds, fresh-work credential ordering");
  } finally {
    loader._load = originalLoad; globalThis.fetch = originalFetch;
    for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
