import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createAcceptedMusicArrangement } from "@/engine/acceptedMusicArrangement";
import type { StageContext, RunStageSink } from "@/engine/types";
import { createModelUsageScope, recordModelUsage } from "@/lib/modelUsage";
import { createImageUsageScope, recordImageUsage } from "@/lib/imageUsage";
import { PRICE } from "@/engine/pricing";
import type { PreparedMotionComicExternalScore } from "../motionComicBlocks";

type Score = PreparedMotionComicExternalScore["externalScore"];
type CastInput = { externalScore?: Score };
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
const originalConvex = process.env.NEXT_PUBLIC_CONVEX_URL;
const source = Buffer.from("external native audio source, unchanged");
const sourceKey = "owner/score-owner/runs/source-run/music.mp3";
const hash = createHash("sha256").update(source).digest("hex");
let root: string;
let headLength: number | null = source.byteLength;
let returnedBytes: Uint8Array = source;
let castCalls: CastInput[] = [];
let reads: string[] = [];
let heads: string[] = [];
let assets: Array<{ kind: string; meta?: Record<string, unknown> }> = [];
let leaseCalls = 0;
let bindingWriteAttempts = 0;
let networkCalls = 0;
let invalidAudio = false;
let validationProbes = 0;
let nestedMusicGenerations = 0;
let scoreEvidenceOverride: Record<string, unknown> | null | undefined;
const bindings = new Map<string, Buffer>();
let sourceReadQueue: Uint8Array[] = [];
let localDirectory: string | undefined;
let failureCostFixture = false;
let trackedVisionFixture = false;
const story = {
  title: "Shared score story", logline: "A story", narratorVoiceId: "narrator", characters: [],
  panels: [{ lines: [{ speaker: "narrator", text: "A story begins." }] }],
};
const checkpoint = Buffer.from(JSON.stringify({
  version: "motion-comic-storyboard/v3",
  outcome: { story, planner: { id: "fixture", provenance: "storage fixture" },
    critique: { accepted: true, score: 1, iterations: 1, issues: [] } },
}));

// Exercise the real block, manifest, source validation, filesystem and asset
// metadata boundary. The renderer is the library agent's separate integration.
loader._load = function (id, ...args) {
  if (id === "node:child_process") return {
    ...originalLoad.call(this, id, ...args) as object,
    spawn: (bin: string) => {
      assert.ok(bin.includes("ffmpeg"), "only the audio decode process is expected");
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(),
        kill: () => { throw new Error("unexpected decode termination"); } });
      queueMicrotask(() => { child.stdout.end(Buffer.alloc(8_000 * 4 * 10)); child.emit("close", 0); });
      return child;
    },
    execFile: (bin: string, _args: string[], _options: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (bin.includes("ffprobe")) {
        validationProbes++;
        callback(null, { stdout: JSON.stringify({ streams: [{ codec_type: invalidAudio ? "video" : "audio", duration: "10", sample_rate: "8000" }],
          format: { duration: "10", format_name: "wav" } }), stderr: "" });
      } else if (bin.includes("ffmpeg")) callback(null, { stdout: "", stderr: "" });
      else throw new Error("unexpected process");
    },
  };
  if (id.endsWith("/storage")) return {
    headObjectMetadata: async (key: string) => { heads.push(key); return headLength === null ? null : { contentLength: headLength }; },
    getObjectBytes: async (key: string) => {
      reads.push(key);
      if (key === sourceKey) return sourceReadQueue.shift() ?? returnedBytes;
      if (key.includes("/bindings/")) {
        if (!bindings.has(key)) throw new Error("NoSuchKey");
        return bindings.get(key)!;
      }
      return checkpoint;
    },
    putObject: async (key: string, bytes: Uint8Array, options: { ifNoneMatch?: string }) => {
      if (!key.includes("/bindings/")) return;
      bindingWriteAttempts++;
      assert.ok(leaseCalls > 0, "binding write requires fresh execution admission");
      assert.equal(options.ifNoneMatch, "*", "source binding must use an atomic create-only write");
      if (bindings.has(key)) throw Object.assign(new Error("exists"), { name: "PreconditionFailed" });
      bindings.set(key, Buffer.from(bytes));
    }, putObjectFromFile: async () => {},
  };
  if (id.endsWith("/files")) return { makeRunTempDir: async () => localDirectory ?? root };
  if (id.endsWith("/studioConvexHttpClient")) return {
    StudioConvexHttpClient: class { async mutation(_api: unknown, input: typeof assets[number]) { assets.push(input); } },
  };
  if (id.endsWith("/novitaRenderFarm")) return { hasNovitaRenderFarmConfig: () => true };
  if (id.endsWith("/novitaMedia")) return { createAttestedNovitaImageGenerator: () => () => { throw new Error("unexpected image purchase"); } };
  if (id.endsWith("/narrationPerformance")) return { preflightNarrationPerformance: async () => ({ durationSec: 10 }) };
  const actual = originalLoad.call(this, id, ...args);
  if (id.endsWith("/motionComic")) return {
    ...actual as object,
    hasMotionComic: () => true,
    planMotionComicStoryboard: () => { throw new Error("unexpected planner purchase"); },
    castMotionComic: async (input: CastInput) => {
      castCalls.push(input);
      if (failureCostFixture) {
        recordModelUsage({ provider: "fixture", model: "planning", kind: "text", reportedCostUsd: 0.05 });
        recordImageUsage({ provider: "fixture", model: "art", route: "fixture", images: 1, costUsd: 1 });
        if (trackedVisionFixture) recordModelUsage({ provider: "fixture", model: "grader", kind: "vision", reportedCostUsd: 0.001 });
      }
      if (input.externalScore) {
        const bytes = await readFile(input.externalScore.path);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), input.externalScore.contentSha256);
      }
      const { path: _path, ...evidence } = input.externalScore ?? {};
      void _path;
      return { outPath: join(root, "final.mp4"), narrationPath: join(root, "narration.mp3"),
        ...(input.externalScore && scoreEvidenceOverride !== null ? { externalScore: { ...evidence, durationSec: 10, ...scoreEvidenceOverride } } : {}),
        narrationText: "A story", durationMs: 10_000, panels: 4,
        ttsCharactersGenerated: failureCostFixture ? 200 / PRICE.ttsElevenPerKCharUsd : 0,
        musicGenerations: nestedMusicGenerations, visionGraderCalls: trackedVisionFixture ? 1 : 0,
        sentenceTimings: [], narrationStartSec: 0, reviewTimeline: {} };
    },
  };
  return actual;
};
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden"); };
process.env.NEXT_PUBLIC_CONVEX_URL = "https://score-fixture.invalid";

async function main() {
  root = await mkdtemp(join(tmpdir(), "shared-score-block-test-"));
  /* eslint-disable @typescript-eslint/no-require-imports -- load production modules after I/O intercepts */
  const { motionComicBlock } = require("../motionComicBlocks") as typeof import("../motionComicBlocks");
  const { createSharedScoreMotionComicManifest, SHARED_SCORE_MAX_BYTES, SHARED_SCORE_MOTION_COMIC_VERSION } = require("../sharedScoreMotionComic") as typeof import("../sharedScoreMotionComic");
  const { manifestFromBlock, configuredMaxCostUsd } = require("@/engine/moduleManifest") as typeof import("@/engine/moduleManifest");
  const { MODULE_CONTRACTS } = require("@/engine/moduleContracts") as typeof import("@/engine/moduleContracts");
  const registry = require("@/engine/registry") as typeof import("@/engine/registry");
  const { runPipeline } = require("@/engine/runner") as typeof import("@/engine/runner");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const legacy = manifestFromBlock(motionComicBlock, MODULE_CONTRACTS.motion_comic);
  const selected = createSharedScoreMotionComicManifest(legacy);
  registry._clear();
  registry.registerManifest(legacy);
  registry.registerManifestVersion(selected);
  assert.equal(registry.get("motion_comic"), motionComicBlock);
  assert.equal(registry.get("motion_comic", SHARED_SCORE_MOTION_COMIC_VERSION), selected.block);
  assert.equal(registry.all().length, 1);
  assert.ok(selected.requiredCapabilities.includes("audio.music_generated"));
  assert.ok(selected.consumes.musicKey);
  assert.ok(selected.optionalConsumes.acceptedMusicArrangement);
  assert.equal(legacy.consumes.musicKey, undefined);
  for (const panels of [4, 8, 16]) {
    assert.equal(configuredMaxCostUsd(selected, { panels }), configuredMaxCostUsd(legacy, { panels }) - PRICE.musicTrackUsd);
  }

  function context(params: Record<string, unknown> = {}, store: Record<string, unknown> = {}): StageContext {
    return {
      ownerId: "score-owner", channelId: "score-channel", runId: "score-run",
      keyPrefix: "owner/score-owner/channel/score-channel/", budgetUsd: 100, stageBudgetUsd: 100,
      params: { panels: 4, scorePlayback: "once", bodyMusicVol: 0, targetLufs: -23, ...params },
      store: { topic: story.title, musicKey: sourceKey, ...store }, log: () => {},
      assertInlinePaidExecutionLease: async () => { leaseCalls++; },
    };
  }
  function reset(preserveBindings = false) {
    castCalls = []; heads = []; reads = []; assets = []; leaseCalls = 0;
    bindingWriteAttempts = 0;
    headLength = source.byteLength; returnedBytes = source;
    invalidAudio = false; validationProbes = 0; nestedMusicGenerations = 0;
    scoreEvidenceOverride = undefined;
    sourceReadQueue = []; localDirectory = undefined;
    failureCostFixture = false; trackedVisionFixture = false;
    if (!preserveBindings) bindings.clear();
  }
  const arrangement = (overrides: Record<string, unknown> = {}) => createAcceptedMusicArrangement({
    ownerId: "score-owner", channelId: "score-channel", runId: "score-run", topic: story.title,
    sourceBrief: { direction: "A supplied score" },
    arrangement: { role: "narration_bed", direction: "Quiet continuous score", requestedDurationSec: 60,
      form: "continuous", ending: "natural_cadence", playback: "once",
      sections: Array.from({ length: 4 }, (_, i) => ({ id: `s-${i}`, label: "Review interval", startFraction: i / 4,
        endFraction: (i + 1) / 4, energy: 0.1, instruction: "Remain steady" })) },
    ...overrides,
  });

  for (const playback of ["once", "repeat"] as const) {
    reset();
    const ctx = context({ scorePlayback: playback, bodyMusicVol: playback === "once" ? 0 : 2,
      targetLufs: playback === "once" ? -23 : -12 }, playback === "once" ? { acceptedMusicArrangement: arrangement() } : {});
    const before = structuredClone(ctx.params);
    const result = await selected.execute(ctx);
    assert.equal(castCalls.length, 1);
    assert.equal(validationProbes, 1, "real validator probes the source before delegation");
    assert.equal(leaseCalls, 3);
    assert.deepEqual(ctx.params, before);
    const score = castCalls[0].externalScore!;
    assert.equal(score.contentSha256, hash);
    assert.equal(score.byteLength, source.byteLength);
    assert.equal(score.path, join(root, `${hash}.audio`));
    assert.equal(score.playback, playback);
    assert.equal(score.gain, ctx.params.bodyMusicVol);
    assert.equal(score.targetLufs, ctx.params.targetLufs);
    assert.equal(result.__costUsd, 0, "source reuse creates no generation charge");
    const evidence = assets.find((asset) => asset.kind === "video")!.meta!.externalScore as Record<string, unknown>;
    assert.equal(evidence.musicKey, sourceKey);
    assert.equal(evidence.contentSha256, hash);
    assert.equal(evidence.gain, score.gain);
    assert.equal(evidence.playback, playback);
    assert.equal(evidence.evidenceScope, "source-consumption-only");
    assert.equal(evidence.durationSec, 10);
    assert.equal(evidence.path, undefined);
  }
  for (const params of [{ scorePlayback: undefined }, { scorePlayback: "loop" }, { bodyMusicVol: undefined },
    { bodyMusicVol: NaN }, { bodyMusicVol: -1 }, { bodyMusicVol: 2.1 }, { bodyMusicVol: "0.2" },
    { targetLufs: undefined }, { targetLufs: -24 }, { targetLufs: -11 }, { targetLufs: Infinity }]) {
    reset();
    const ctx = context(params);
    assert.equal(selected.configSchema.safeParse(ctx.params).success, false);
    await assert.rejects(() => selected.execute(ctx));
    assert.equal(heads.length, 0); assert.equal(castCalls.length, 0);
  }
  for (const musicKey of [undefined, "", "https://source.invalid/music.wav", "owner/other/runs/r/music.wav",
    "owner/score-owner-evil/r/music.wav", "owner/score-owner/../other/music.wav", "owner/score-owner/a//b",
    "owner/score-owner/a/%2e%2e/b", "owner/score-owner/a\\b"]) {
    reset();
    await assert.rejects(() => selected.execute(context({}, { musicKey })), /owner-scoped/);
    assert.equal(heads.length, 0); assert.equal(castCalls.length, 0);
  }
  for (const overrides of [{ ownerId: "other" }, { channelId: "other" }, { runId: "other" }, { topic: "other" }]) {
    reset();
    await assert.rejects(() => selected.execute(context({}, { acceptedMusicArrangement: arrangement(overrides) })), /binding/);
    assert.equal(heads.length, 0);
  }
  reset();
  await assert.rejects(() => selected.execute(context({ scorePlayback: "repeat" }, { acceptedMusicArrangement: arrangement() })), /playback/);
  await assert.rejects(() => selected.execute(context({}, { acceptedMusicArrangement: { ...arrangement(), fingerprint: "0".repeat(64) } })));
  assert.equal(heads.length, 0);
  for (const length of [null, 0, SHARED_SCORE_MAX_BYTES + 1]) {
    reset(); headLength = length;
    await assert.rejects(() => selected.execute(context()), /byte limit/);
    assert.equal(reads.length, 0); assert.equal(castCalls.length, 0);
  }
  reset(); returnedBytes = new Uint8Array();
  await assert.rejects(() => selected.execute(context()), /byte length/);
  assert.equal(castCalls.length, 0);
  reset(); invalidAudio = true;
  await assert.rejects(() => selected.execute(context()), /single audio stream/);
  assert.deepEqual(reads, [sourceKey], "invalid audio fails before even reading the storyboard checkpoint");
  assert.equal(castCalls.length, 0); assert.equal(leaseCalls, 0);
  reset(); nestedMusicGenerations = 1;
  await assert.rejects(() => selected.execute(context()), /nested music generation/);
  assert.equal(assets.length, 0, "nested music invariant fails before final artifact recording");
  for (const override of [null, { contentSha256: "0".repeat(64) }, { byteLength: 1 }, { playback: "repeat" },
    { gain: 1 }, { targetLufs: -14 }, { durationSec: 0 }]) {
    reset(); scoreEvidenceOverride = override;
    await assert.rejects(() => selected.execute(context()), /consumption evidence mismatch/);
    assert.equal(assets.length, 0, "only verified actual consumption may become an output asset");
  }
  // Cost-only runner fixture: real selected block/error and usage scopes.
  // The producer/compiler handoff is evaluated in the separate integration suite.
  for (const withVision of [false, true]) {
    reset(); failureCostFixture = true; trackedVisionFixture = withVision; scoreEvidenceOverride = null;
    const ctx = context();
    const rows: Parameters<RunStageSink["upsert"]>[0][] = [];
    const failed = await runPipeline({ blocks: [selected.block], manifests: [selected],
      entries: [{ block: selected.id, version: selected.version, params: ctx.params }],
      producedKeys: [...selected.block.produces] }, {
      ...ctx, seedStore: { ...ctx.store }, paramsByBlock: { motion_comic: ctx.params },
      resume: false, defaultRetries: 0, sink: { upsert: async (row) => { rows.push(row); } },
    });
    assert.equal(failed.ok, false);
    assert.match(failed.error ?? "", /consumption evidence mismatch/);
    const expected = withVision ? 1.251 : 1.25;
    assert.ok(Math.abs(failed.costTotal - expected) < 1e-9, `runner must retain full attempt cost ${expected}, got ${failed.costTotal}`);
    const failure = rows.findLast((row) => row.status === "failed")!;
    assert.ok(Math.abs(failure.cost! - expected) < 1e-9, "persisted failed stage includes planning and no duplicate vision charge");
    assert.equal(castCalls.length, 1); assert.equal(assets.length, 0);
  }
  for (const useSharedScore of [true, false]) {
    for (const withVision of [false, true]) {
      reset(); failureCostFixture = true; trackedVisionFixture = withVision;
      const modelScope = createModelUsageScope();
      const imageScope = createImageUsageScope();
      const ctx = context();
      ctx.modelUsageCostUsd = () => modelScope.snapshot().costUsd;
      ctx.modelUsageAccounting = (kinds) => {
        const groups = modelScope.snapshot().groups.filter((group) => !kinds || kinds.includes(group.kind));
        return groups.reduce((total, group) => ({ calls: total.calls + group.calls, cacheHits: total.cacheHits + group.cacheHits,
          costUsd: total.costUsd + group.costUsd, unpricedCalls: total.unpricedCalls + group.unpricedCalls }),
        { calls: 0, cacheHits: 0, costUsd: 0, unpricedCalls: 0 });
      };
      ctx.imageUsageAccounting = () => imageScope.snapshot();
      const output = await modelScope.run(() => imageScope.run(() => (useSharedScore ? selected : legacy).execute(ctx)));
      const expected = useSharedScore ? (withVision ? 1.251 : 1.25) : 1.2 + (withVision ? PRICE.visionGraderUsd : 0);
      const reportedCost = output.__costUsd;
      assert.ok(typeof reportedCost === "number" && Number.isFinite(reportedCost));
      assert.ok(Math.abs(reportedCost - expected) < 1e-9,
        `successful ${useSharedScore ? "shared score" : "legacy"} explicit cost must be ${expected}, got ${output.__costUsd}`);
      assert.equal(modelScope.snapshot().costUsd, withVision ? 0.051000000000000004 : 0.05);
      assert.equal(imageScope.snapshot().costUsd, 1);
      assert.equal(assets.filter((asset) => asset.kind === "video").length, 1);
    }
  }
  reset();
  const expired = context(); expired.assertInlinePaidExecutionLease = async () => { throw new Error("expired lease"); };
  await assert.rejects(() => selected.execute(expired), /expired lease/);
  assert.equal(bindingWriteAttempts, 0); assert.equal(bindings.size, 0);
  assert.ok(reads.every((key) => key === sourceKey || key.includes("/bindings/")));
  assert.equal(castCalls.length, 0);
  reset();
  const missingLease = context(); delete missingLease.assertInlinePaidExecutionLease;
  await assert.rejects(() => selected.execute(missingLease), /ownership admission/);
  assert.equal(bindingWriteAttempts, 0); assert.equal(bindings.size, 0);
  assert.equal(castCalls.length, 0);
  reset();
  const deniedRemote = context();
  deniedRemote.assertRemoteChildExecutionLease = async () => { throw new Error("remote lease denied"); };
  await assert.rejects(() => selected.execute(deniedRemote), /remote lease denied/);
  assert.equal(bindingWriteAttempts, 0); assert.equal(bindings.size, 0);
  assert.equal(leaseCalls, 0, "denied remote admission must not fall back to inline admission");
  assert.equal(castCalls.length, 0);
  reset();
  const remote = context(); delete remote.assertInlinePaidExecutionLease;
  remote.assertRemoteChildExecutionLease = async () => { leaseCalls++; };
  await selected.execute(remote); assert.equal(leaseCalls, 3);
  reset();
  const failAfterBinding = context();
  failAfterBinding.assertInlinePaidExecutionLease = async () => {
    if (++leaseCalls > 1) throw new Error("attempt stopped before purchase");
  };
  await assert.rejects(() => selected.execute(failAfterBinding), /attempt stopped/);
  assert.equal(bindings.size, 1);
  const firstBinding = Buffer.from([...bindings.values()][0]);
  reset(true);
  localDirectory = join(root, "fresh-worker"); await mkdir(localDirectory);
  returnedBytes = Buffer.alloc(source.byteLength, 97);
  await assert.rejects(() => selected.execute(context()), /durable source binding mismatch/);
  assert.equal(castCalls.length, 0); assert.equal(leaseCalls, 1);
  assert.deepEqual([...bindings.values()][0], firstBinding);
  reset(true);
  localDirectory = join(root, "next-worker"); await mkdir(localDirectory);
  await selected.execute(context());
  assert.equal(castCalls.length, 1, "unchanged source survives fresh local worker recovery");
  reset(true);
  await assert.rejects(() => selected.execute(context({ bodyMusicVol: 0.25 })), /durable source binding mismatch/);
  assert.equal(castCalls.length, 0);
  reset();
  sourceReadQueue = [source, Buffer.alloc(source.byteLength, 98)];
  const concurrent = await Promise.allSettled([selected.execute(context()), selected.execute(context())]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  assert.equal(bindings.size, 1); assert.equal(castCalls.length, 1);
  const winner = JSON.parse([...bindings.values()][0].toString("utf8")) as { source: { contentSha256: string } };
  assert.equal(castCalls[0].externalScore!.contentSha256, winner.source.contentSha256);
  reset();
  const wrongPrefix = context(); wrongPrefix.keyPrefix = "owner/other/runs/other/";
  wrongPrefix.assertInlinePaidExecutionLease = async () => {
    if (++leaseCalls > 1) throw new Error("stop before purchase");
  };
  await assert.rejects(() => selected.execute(wrongPrefix), /stop before purchase/);
  assert.deepEqual([...bindings.keys()], ["owner/score-owner/runs/score-run/bindings/motion-comic-shared-score.json"]);
  reset();
  await writeFile(join(root, `${hash}.audio`), "corrupted local source");
  await assert.rejects(() => selected.execute(context()), /integrity mismatch/);
  assert.equal(castCalls.length, 0);
  reset();
  const oldContext = context({}, { musicKey: "invalid", acceptedMusicArrangement: "invalid" });
  oldContext.params = { panels: 4 }; delete oldContext.assertInlinePaidExecutionLease;
  await legacy.execute(oldContext);
  assert.equal(heads.length, 0); assert.equal(leaseCalls, 0);
  assert.equal(castCalls[0].externalScore, undefined, "legacy delegation unchanged");
  assert.equal(assets.find((asset) => asset.kind === "video")!.meta!.externalScore, undefined);
  assert.equal(networkCalls, 0);
  console.log("sharedScoreMotionComic: manifest, source binding, explicit mix, ownership and legacy behavior PASS");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  loader._load = originalLoad; globalThis.fetch = originalFetch;
  if (originalConvex === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
  else process.env.NEXT_PUBLIC_CONVEX_URL = originalConvex;
  if (root) await rm(root, { recursive: true, force: true });
});
