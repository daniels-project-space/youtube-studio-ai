import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import Module from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { createAcceptedMusicArrangement } from "@/engine/acceptedMusicArrangement";
import type { PipelinePolicy } from "@/engine/pipelineCompiler";
import type { PipelineEntry, RunStageSink } from "@/engine/types";
import type { MotionComicStoryboard } from "@/lib/motionComic";

const version = "2.0.0-shared-score";
const musicVersion = "2.0.0-provider-outputs";
const ownerId = "score-owner";
const channelId = "score-channel";
const prefix = `owner/${ownerId}/channel/${channelId}/`;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const policy: PipelinePolicy = {
  id: "shared-score-comic-cpu", version: "1.0.0", minimumCertification: "contract",
  requiredCapabilities: [], requireCrewBindings: false,
  requireStoryAlignmentForGeneratedVisuals: false, allowOpaqueMigrationArtifacts: true,
};
const story: MotionComicStoryboard = {
  title: "Synthetic shared score handoff", logline: "A local transport fixture.", narratorVoiceId: "narrator", characters: [],
  panels: Array.from({ length: 4 }, () => ({
    visual: { environment: "ancient_ruins", era: "ancient", subjects: [], objects: ["artifact"], action: "watchful_pause", relations: [], mood: "mysterious", lighting: "moonlight" },
    characters: [], shot: "wide", lines: [{ speaker: "narrator", text: "The stones remembered every signal across the quiet valley." }],
  })),
};
const checkpoint = Buffer.from(JSON.stringify({ version: "motion-comic-storyboard/v3", outcome: {
  story, planner: { id: "synthetic-cpu", provenance: "Explicit fixture, not creative qualification" },
  critique: { accepted: true, score: 1, iterations: 1, issues: [] },
} }));

function wav(value: number): Buffer {
  const frames = 480;
  const result = Buffer.alloc(44 + frames * 8);
  result.write("RIFF", 0); result.writeUInt32LE(result.length - 8, 4); result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(3, 20); result.writeUInt16LE(2, 22);
  result.writeUInt32LE(48000, 24); result.writeUInt32LE(384000, 28); result.writeUInt16LE(8, 32);
  result.writeUInt16LE(32, 34); result.write("data", 36); result.writeUInt32LE(frames * 8, 40);
  for (let index = 44; index < result.length; index += 4) result.writeFloatLE(value, index);
  return result;
}

type Row = Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>[number];
function localSink() {
  const rows = new Map<string, Row>();
  const artifacts: Array<Parameters<NonNullable<RunStageSink["upsertArtifacts"]>>[0]> = [];
  const sink: RunStageSink = {
    async upsert(args) {
      const previous = rows.get(args.block) ?? { block: args.block, status: "queued" };
      rows.set(args.block, structuredClone({ ...previous,
        ...Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) }));
    },
    async getResumeState() { return structuredClone([...rows.values()]); },
    async upsertArtifacts(args) { artifacts.push(structuredClone(args)); },
  };
  return { rows, artifacts, sink };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "shared-score-comic-"));
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  const originalFetch = globalThis.fetch;
  const savedEnvironment = { ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY, MUREKA_API_KEY: process.env.MUREKA_API_KEY, NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL };
  process.env.ELEVENLABS_API_KEY = "explicit-cpu-fixture-never-sent";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://synthetic.invalid";
  process.env.MUREKA_API_KEY = "explicit-cpu-fixture-never-sent";
  const objects = new Map<string, Buffer>();
  let sharedAudio = wav(0.125);
  let sharedProviderCalls = 0;
  let interruptArtAdmission = false;
  let directory = root;
  let artCalls = 0;
  let voiceCalls = 0;
  let musicCalls = 0;
  let commands: string[][] = [];
  let normalizationTargets: number[] = [];
  let libraryCalls: Array<Record<string, unknown>> = [];
  let mixes: Array<{ path: string; hash: string }> = [];
  let assets: Array<{ kind: string; meta?: Record<string, unknown> }> = [];
  const resetEvidence = () => { sharedProviderCalls = 0; artCalls = 0; voiceCalls = 0; musicCalls = 0; commands = []; normalizationTargets = []; libraryCalls = []; mixes = []; assets = []; };
  const materialize = async (path: string) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "explicit fake media process output");
  };
  const processCommand = async (command: string, values: string[]) => {
    assert.ok(["ffmpeg", "ffprobe", "python3"].includes(command));
    commands.push([command, ...values]);
    const loudnorm = values.find((value) => value.startsWith("loudnorm=") && value.includes("print_format=json"));
    if (loudnorm) {
      normalizationTargets.push(Number(loudnorm.match(/loudnorm=I=(-?[\d.]+)/)![1]));
      return { stdout: "", stderr: JSON.stringify({ input_i: "-19", input_tp: "-4", input_lra: "2", input_thresh: "-29", target_offset: "0" }) };
    }
    if (command === "ffprobe") return { stdout: JSON.stringify({
      streams: [
        ...values.at(-1)!.endsWith(".audio") ? [] : [{ codec_type: "video", duration: "1.7", duration_ts: 17, time_base: "1/10", start_time: "0" }],
        { codec_type: "audio", duration: "1.7", duration_ts: 81600, time_base: "1/48000", start_time: "0", sample_rate: "48000" },
      ],
      format: { format_name: values.at(-1)!.endsWith(".audio") ? "wav" : "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.7" },
    }), stderr: "" };
    if (values.some((value) => value.includes("amix="))) {
      const inputs = values.flatMap((value, index) => value === "-i" ? [values[index + 1]] : []);
      mixes.push({ path: inputs[2], hash: sha(await readFile(inputs[2])) });
    }
    if (command === "python3") {
      assert.equal(values[0], join("scripts", "mc_page_render.py"));
      await materialize(values[3]);
      await writeFile(join(directory, "motion_comic_review_timeline.json"), JSON.stringify({ version: "motion-comic-review/v1", bubbles: [] }));
    } else if (values.at(-1) !== "-" && values.at(-1) !== "pipe:1") await materialize(values.at(-1)!);
    return { stdout: "", stderr: "lavfi.signalstats.YAVG=128" };
  };
  const execFile = Object.assign((command: string, values: string[], ...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout?: string, stderr?: string) => void;
    void processCommand(command, values).then((result) => callback(null, result.stdout, result.stderr), callback);
  }, { [promisify.custom]: processCommand });
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://api.mureka.ai/v1/instrumental/generate") {
      assert.equal(init?.method, "POST");
      sharedProviderCalls++;
      return Response.json({ id: "synthetic-shared-score", status: "preparing" });
    }
    if (String(input) === "https://api.mureka.ai/v1/instrumental/query/synthetic-shared-score") {
      return Response.json({ status: "succeeded", choices: [{ url: "https://synthetic.invalid/shared.wav", duration: 0.01 }] });
    }
    if (String(input) === "https://synthetic.invalid/shared.wav") return new Response(new Uint8Array(sharedAudio));
    assert.equal(String(input), "https://api.elevenlabs.io/v1/text-to-dialogue", "all other network requests are forbidden");
    voiceCalls++;
    return new Response(new Uint8Array(16_384).fill(1), { status: 200 });
  };
  loader._load = function (id, ...args) {
    if (id === "@/lib/music") {
      const actual = originalLoad.call(this, id, ...args) as typeof import("@/lib/music");
      return { ...actual,
        generateMureka: (input: Parameters<typeof actual.generateMureka>[0]) => actual.generateMureka({ ...input, pollIntervalMs: 0 }),
        selfLoopAudio: async (input: string, output: string) => { await copyFile(input, output); return output; },
        generateMusic: async () => { musicCalls++; return { url: "https://synthetic.invalid/fake-legacy-score.mp3" }; },
      };
    }
    if (id === "@/agents/mastra") return { ...originalLoad.call(this, id, ...args) as object,
      agentJson: async () => { throw new Error("unexpected planning purchase"); } };
    if (id === "@/lib/creativeText") return { ...originalLoad.call(this, id, ...args) as object,
      hasCreativeTextKey: () => true, creativeTextJson: async () => { throw new Error("unexpected critic purchase"); } };
    if (id === "@/lib/vision") return { VISION_GATE_MAX_TOKENS: 1000,
      visionLocal: async () => { throw new Error("unexpected vision purchase"); } };
    if (id === "@/lib/pydeps") return { preflightPythonRenderer: async () => {} };
    if (id === "@/lib/novitaRenderFarm") return { ...originalLoad.call(this, id, ...args) as object, hasNovitaRenderFarmConfig: () => true };
    if (id === "@/lib/novitaMedia") return { createAttestedNovitaImageGenerator: () => {
      if (interruptArtAdmission) throw new Error("explicit fake art transport interruption");
      return async () => { artCalls++; return Buffer.from("explicit fake panel art"); };
    } };
    if (id === "@/lib/files") return { ...originalLoad.call(this, id, ...args) as object,
      makeRunTempDir: async (_runId: string, scope?: string) => {
        const path = scope ? directory : join(directory, "shared-producer");
        await mkdir(path, { recursive: true }); return path;
      },
    };
    if (id === "@/lib/storage") return {
      headObjectMetadata: async (key: string) => objects.has(key) ? { contentLength: objects.get(key)!.length } : null,
      getObjectBytes: async (key: string) => {
        if (key.includes("storyboard")) return checkpoint;
        const bytes = objects.get(key);
        if (!bytes) throw Object.assign(new Error("synthetic R2 source missing"), {
          name: "NoSuchKey", $metadata: { httpStatusCode: 404 },
        });
        return Buffer.from(bytes);
      },
      putObject: async (key: string, bytes: Uint8Array, options?: { ifNoneMatch?: string }) => {
        if (options?.ifNoneMatch === "*" && objects.has(key)) {
          throw Object.assign(new Error("synthetic conditional write conflict"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
        }
        objects.set(key, Buffer.from(bytes));
      },
      putObjectFromFile: async (key: string, path: string) => { objects.set(key, await readFile(path)); },
    };
    if (id === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: class {
      async mutation(_api: unknown, args: { kind: string; meta?: Record<string, unknown> }) {
        assets.push(args); return "synthetic-asset";
      }
    } };
    if (id === "@/lib/ffmpeg") return { ...originalLoad.call(this, id, ...args) as object,
      masterAudioTransparentGain: async (input: string, output: string) => { await copyFile(input, output); return output; },
      ffprobeDuration: async (path: string) => basename(path) === "final.mp4" ? 31.021995 : 1.7,
      normalizeAudioOnly: async (input: string, output: string, target: number) => {
        normalizationTargets.push(target); await copyFile(input, output);
      },
      probe: async () => ({ hasAudio: true, durationSec: 11 }),
      measureAudio: async () => ({ integratedLufs: -14, windowMeanDb: -16 }),
    };
    if (id === "@/lib/motionComic") {
      const actual = originalLoad.call(this, id, ...args) as typeof import("@/lib/motionComic");
      return { ...actual, castMotionComic: async (input: Parameters<typeof actual.castMotionComic>[0]) => {
        libraryCalls.push(input as unknown as Record<string, unknown>);
        return actual.castMotionComic(input);
      } };
    }
    if (id === "node:child_process") return { ...originalLoad.call(this, id, ...args) as object,
      execFile,
      spawn: (command: string, values: string[]) => {
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
        queueMicrotask(async () => {
          try {
            const output = await processCommand(command, values);
            child.stdout.write(output.stdout);
            child.stderr.write(output.stderr);
            if (values.at(-1) === "pipe:1") child.stdout.write(Buffer.alloc(480 * 4));
            child.emit("close", 0);
          } catch (error) { child.emit("error", error); }
        });
        return child;
      },
    };
    return originalLoad.call(this, id, ...args);
  };
  let reset: (() => void) | undefined;
  try {
    // Load the real execution chain only after installing explicit I/O fixtures.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerAllBlocks, _resetBlocks } = require("@/engine/blocks") as typeof import("@/engine/blocks");
    const { getManifest } = require("@/engine/registry") as typeof import("@/engine/registry");
    const { validatePipeline } = require("@/engine/validate") as typeof import("@/engine/validate");
    const { compilePipeline } = require("@/engine/pipelineCompiler") as typeof import("@/engine/pipelineCompiler");
    const { runPipeline } = require("@/engine/runner") as typeof import("@/engine/runner");
    const { motionComicBlock } = require("../motionComicBlocks") as typeof import("../motionComicBlocks");
    const { music } = require("../musicBlocks") as typeof import("../musicBlocks");
    /* eslint-enable @typescript-eslint/no-require-imports */
    reset = _resetBlocks;
    _resetBlocks(); registerAllBlocks();
    assert.equal(getManifest("motion_comic")!.block, motionComicBlock);
    assert.equal(getManifest("music")!.block, music, "unversioned music must retain its legacy implementation");
    assert.ok(getManifest("music")!.produces.musicRuntimeReceiptKey, "legacy output contract remains unchanged");
    assert.ok(getManifest("music", musicVersion), "parent must register the real provider-aware music manifest");
    const alternate = getManifest("motion_comic", version);
    assert.ok(alternate, "parent must register the real shared-score manifest");
    assert.ok(alternate.consumes.musicKey);
    assert.ok(alternate.requiredCapabilities.includes("audio.music_generated"));
    const params = { panels: 4, scorePlayback: "repeat", bodyMusicVol: 0.35, targetLufs: -19 };
    const entry: PipelineEntry = { block: "motion_comic", version, params };
    const seed = { topic: story.title, channelName: "Synthetic score fixture" };
    const pipeline = (selected: PipelineEntry, producerParams: Record<string, unknown> = {}): PipelineEntry[] => [
      ...(selected.version === version ? [{ block: "music", version: musicVersion, params: { provider: "mureka", trackCount: 1, prompt: "Synthetic shared score fixture", ...producerParams } }] : []), selected, { block: "originality_gate" },
    ];
    assert.throws(() => validatePipeline([entry], ["topic", "channelName"]), /audio.music_generated|musicKey/);
    assert.throws(() => validatePipeline([entry], ["topic", "channelName", "musicKey"]), /audio.music_generated/,
      "an orphaned seeded key cannot substitute for the real shared music producer");
    for (const badParams of [{}, { ...params, scorePlayback: undefined }, { ...params, bodyMusicVol: undefined },
      { ...params, targetLufs: undefined }, { ...params, bodyMusicVol: 2.01 }, { ...params, targetLufs: -11 }]) {
      assert.throws(() => compilePipeline(validatePipeline(pipeline({ ...entry, params: badParams }), Object.keys(seed)), policy));
    }
    assert.equal(artCalls + voiceCalls + musicCalls, 0);
    const legacyCompilation = compilePipeline(validatePipeline(pipeline({ block: "motion_comic", params: { panels: 4 } }), ["topic", "channelName"]), policy);
    const selectedCompilation = compilePipeline(validatePipeline(pipeline(entry), Object.keys(seed)), policy);
    assert.equal(selectedCompilation.modules[0].version, musicVersion);
    assert.equal(selectedCompilation.modules[1].version, version);
    assert.notEqual(selectedCompilation.fingerprint, legacyCompilation.fingerprint);
    const execute = async (input: Record<string, unknown>, selected = entry, runId = "score-run", saved = localSink(), producerParams: Record<string, unknown> = {}) => {
      const resolved = validatePipeline(pipeline(selected, producerParams), Object.keys(input));
      const compiled = compilePipeline(resolved, policy);
      const result = await runPipeline(resolved, {
        ownerId, channelId, runId, keyPrefix: prefix, seedStore: input,
        budgetUsd: Math.max(100, compiled.reservedMaxCostUsd), sink: saved.sink, defaultRetries: 0,
        assertInlinePaidExecutionLease: async () => {},
        // Keep the real compiler's downstream originality requirement; this
        // focused render handoff stops before that separate review/purchase.
        stopAfterBlockId: "motion_comic",
        rehydrate: async (_block, outputs) => ({ ok: true, outputs }),
      });
      return { result, saved };
    };
    for (const playback of ["once", "repeat"] as const) {
      directory = join(root, playback); await mkdir(directory);
      await writeFile(join(directory, "music.mp3"), "stale nested legacy score must never be selected");
      resetEvidence();
      const selected = { ...entry, params: { ...params, scorePlayback: playback } };
      const runId = `score-${playback}`;
      const scoreKey = `${prefix}runs/${runId}/music.mp3`;
      const f = await execute(seed, selected, runId);
      assert.equal(f.result.ok, true, f.result.error);
      assert.equal(f.result.store.musicKey, scoreKey);
      assert.equal(f.result.store.musicProvider, "mureka");
      assert.equal(sharedProviderCalls, 1, "the real shared music producer buys exactly one explicitly fake job");
      assert.ok((f.saved.rows.get("music")?.cost ?? 0) > 0, "fake provider usage retains real cost accounting");
      assert.equal(musicCalls, 0, "shared score must never purchase a nested score");
      assert.ok(artCalls > 0 && voiceCalls > 0, "exercise the real library with explicit fake art and voice");
      assert.equal(libraryCalls.length, 1);
      assert.ok(libraryCalls[0].externalScore, "the real production block passes the explicit library contract");
      assert.equal(mixes.length, 1);
      assert.equal(mixes[0].hash, sha(objects.get(scoreKey)!));
      assert.notEqual(mixes[0].path, join(directory, "music.mp3"));
      const mux = commands.find((command) => command.some((arg) => arg.includes("amix=")))!;
      assert.equal(mux.includes("-stream_loop"), playback === "repeat");
      assert.ok(mux.some((arg) => arg.includes("volume=0.35")));
      assert.deepEqual(normalizationTargets, [-19]);
      const scoreEvidence = assets.find((asset) => asset.kind === "video")!.meta!.externalScore as Record<string, unknown>;
      assert.equal(scoreEvidence.musicKey, scoreKey);
      assert.equal(scoreEvidence.contentSha256, sha(objects.get(scoreKey)!));
      assert.equal(scoreEvidence.durationSec, 480 / 48000, "source evidence uses decoded samples, not the fixture's 1.7-second container duration");
      assert.equal(scoreEvidence.evidenceScope, "source-consumption-only");
      const refs = f.saved.artifacts.flatMap((batch) => batch.artifacts);
      assert.ok(refs.some((row) => row.artifact.producerVersion === version));
      const sourceRef = refs.find((row) => row.artifact.key === "musicKey")!.artifact;
      assert.equal(sourceRef.producerModule, "music");
      assert.equal(sourceRef.producerVersion, musicVersion);
      assert.ok(refs.find((row) => row.artifact.key === "videoKey")!.inputArtifactIds.includes(sourceRef.artifactId));
      resetEvidence();
      const resumed = await execute(seed, selected, runId, f.saved);
      assert.equal(resumed.result.ok, true, resumed.result.error);
      assert.equal(sharedProviderCalls + artCalls + voiceCalls + musicCalls + commands.length + libraryCalls.length, 0);
      const changed = await execute(seed, selected, runId, f.saved, { prompt: "Changed shared score intent" });
      assert.equal(changed.result.ok, false, "changed source cannot reuse an old stage receipt");
      assert.equal(libraryCalls.length, 0);
      resetEvidence();
      const changedSourceRun = `${runId}-changed-source`;
      sharedAudio = wav(-0.25);
      const otherScoreKey = `${prefix}runs/${changedSourceRun}/music.mp3`;
      const fresh = await execute(seed, selected, changedSourceRun);
      assert.equal(fresh.result.ok, true, fresh.result.error);
      assert.equal(musicCalls, 0);
      assert.equal(mixes.at(-1)?.hash, sha(objects.get(otherScoreKey)!));
      const retryRun = `${runId}-interrupted`;
      const retryKey = `${prefix}runs/${retryRun}/music.mp3`;
      interruptArtAdmission = true;
      const interrupted = await execute(seed, selected, retryRun);
      interruptArtAdmission = false;
      assert.equal(interrupted.result.ok, false);
      assert.match(interrupted.result.error ?? "", /explicit fake art transport interruption/);
      assert.equal(interrupted.saved.rows.get("music")?.status, "ok");
      objects.set(retryKey, wav(0.375));
      resetEvidence();
      const changedBytes = await execute(seed, selected, retryRun, interrupted.saved);
      assert.equal(changedBytes.result.ok, false, "same-key/same-length replacement cannot replace the first durable score binding");
      assert.match(changedBytes.result.error ?? "", /durable source binding mismatch/);
      assert.equal(sharedProviderCalls + artCalls + voiceCalls + musicCalls + libraryCalls.length, 0, "replacement refusal must precede paid render I/O");
      sharedAudio = wav(0.125);
    }
    directory = join(root, "producer-reuse-refused"); await mkdir(directory); resetEvidence();
    const reusedKey = `${prefix}runs/score-once/music.mp3`;
    const reusedProducer = await execute({ ...seed, reuseMusicKey: reusedKey }, entry, "producer-reuse");
    assert.equal(reusedProducer.result.ok, false, "an unproven raw reuse key cannot relabel the original provider or approval");
    assert.equal(reusedProducer.result.failedBlock, "music");
    assert.match(reusedProducer.result.error ?? "", /reuse/i);
    assert.equal(reusedProducer.saved.rows.has("motion_comic"), false);
    assert.equal(sharedProviderCalls + artCalls + voiceCalls + musicCalls + commands.length, 0,
      "raw reuse must be refused before any fake provider or render work");
    const arrangement = createAcceptedMusicArrangement({
      ownerId, channelId, runId: "score-run", topic: story.title, sourceBrief: { fixture: true },
      arrangement: { role: "narration_bed", direction: "Explicit synthetic score", requestedDurationSec: 20,
        form: "continuous", ending: "natural_cadence", playback: "once",
        sections: Array.from({ length: 4 }, (_, index) => ({ id: `interval-${index}`, label: "Stable interval",
          startFraction: index / 4, endFraction: (index + 1) / 4, energy: 0.2, instruction: "Hold the same texture." })) },
    });
    for (const [invalid, expectedError] of [
      [{ ...seed, musicKey: "owner/another-owner/runs/source/music.wav" }, /owner-scoped/],
      [{ ...seed, musicKey: `${prefix}runs/source/missing.wav` }, /missing, empty/],
      [{ ...seed, musicKey: `${prefix}runs/score-once/music.mp3`, acceptedMusicArrangement: arrangement }, /binding or playback mismatch/],
    ] as const) {
      resetEvidence();
      await assert.rejects(alternate.execute({
        ownerId, channelId, runId: "score-run", keyPrefix: prefix, params, store: invalid,
        budgetUsd: 100, stageBudgetUsd: 100, assertInlinePaidExecutionLease: async () => {}, log: () => {},
      }), expectedError);
      assert.equal(sharedProviderCalls + artCalls + voiceCalls + musicCalls + commands.length, 0, "source refusal must precede paid render I/O");
    }
    directory = join(root, "legacy"); await mkdir(directory); resetEvidence();
    const legacy = await execute({ topic: story.title, channelName: seed.channelName }, { block: "motion_comic", params: { panels: 4 } });
    assert.equal(legacy.result.ok, false, "retain the existing legacy manifest's undeclared-read refusal");
    assert.match(legacy.result.error ?? "", /undeclared artifact read "persona"/);
    assert.equal(artCalls + voiceCalls + musicCalls, 0);
    // Direct legacy behavior remains testable without pretending its existing
    // incomplete read contract passed the real runner above.
    resetEvidence();
    await motionComicBlock.run({
      ownerId, channelId, runId: "legacy-direct", keyPrefix: prefix,
      params: { panels: 4 }, store: { topic: story.title, channelName: seed.channelName },
      budgetUsd: 100, stageBudgetUsd: 100, log: () => {},
    });
    assert.equal(musicCalls, 1, "legacy retains its existing nested score behavior, using an explicit fake purchase");
    assert.equal(libraryCalls[0].externalScore, undefined);
    assert.deepEqual(normalizationTargets, [-14]);
    const normalization = commands.find(command => command.some(value => value.includes("linear=true:")));
    assert.ok(normalization, "legacy finishing must actually apply its measured loudness pass");
    assert.equal(normalization[normalization.indexOf("-ar") + 1], "48000");
    assert.equal(normalization[normalization.indexOf("-t") + 1], "1.7");
    assert.equal(normalization[normalization.indexOf("-c:v") + 1], "copy");
    console.log("SHARED SCORE MOTION COMIC PASS: real cold Mureka producer/registry/compiler/runner/block/cast, once/repeat, raw reuse refusal, same-key replacement refusal, cache identity; legacy persona contract failure retained and direct legacy behavior verified; paid I/O explicitly fake");
  } finally {
    reset?.(); loader._load = originalLoad; globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
