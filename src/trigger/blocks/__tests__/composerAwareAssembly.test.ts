import assert from "node:assert/strict";
import Module from "node:module";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildChannelProfile } from "@/engine/channelProfile";
import { validateArtifact } from "@/engine/artifactSchemas";
import { composerDirectives, resolveComposerConfig } from "@/lib/crew/composer";
import { resolveAssembleParams } from "@/lib/assembly/planTimeline";
import type { StageContext } from "@/engine/types";
import { COMPOSER_MIX_ASSEMBLY_VERSION, createComposerAwareAssemblyManifest } from "../composerAwareAssembly";

type Args = Record<string, unknown>;
const calls: { bodies: Args[]; compositions: Args[]; targets: number[]; voiceFx: number } = {
  bodies: [], compositions: [], targets: [], voiceFx: 0,
};
const temporary = new Set<string>();
const stored = new Map<string, Uint8Array>();
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
const convexEnv = { public: process.env.NEXT_PUBLIC_CONVEX_URL, private: process.env.CONVEX_URL };
delete process.env.NEXT_PUBLIC_CONVEX_URL;
delete process.env.CONVEX_URL;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden in assembly evaluation"); };

async function encoded(path: string): Promise<string> {
  temporary.add(dirname(path));
  await writeFile(path, "mocked encoded bytes");
  return path;
}

// Keep the production blocks, adapter, planner, backend, and filesystem real.
// Only durable storage and FFmpeg operations are replaced.
loader._load = function (id, ...args) {
  if (id.endsWith("/storage")) return {
    getObjectBytes: async (key: string) => {
      if (key === "test/music.mp3") return Buffer.from("mocked music bytes");
      if (stored.has(key)) return stored.get(key)!;
      throw new Error("NoSuchKey");
    },
    putObject: async (key: string, bytes: Uint8Array) => { stored.set(key, bytes); },
    putObjectFromFile: async (key: string, path: string) => { stored.set(key, await readFile(path)); },
    publicUrl: (key: string) => `https://storage.invalid/${key}`,
  };
  const actual = originalLoad.call(this, id, ...args);
  if (id.endsWith("/ffmpeg")) return {
    ...actual as object,
    assembleBeatBody: async (input: Args) => { calls.bodies.push(input); return encoded(String(input.outPath)); },
    composeWithIntro: async (input: Args) => { calls.compositions.push(input); return encoded(String(input.outPath)); },
    normalizeAudioOnly: async (_input: string, output: string, target: number) => { calls.targets.push(target); return encoded(output); },
    probe: async () => ({ durationSec: 10, width: 1920, height: 1080, hasAudio: true }),
    applyVoiceFx: async () => { calls.voiceFx++; throw new Error("assembly must not apply narration effects"); },
  };
  return actual;
};

async function main() {
  // Load only after the CommonJS boundary intercepts are installed.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { registerAllBlocks, _resetBlocks } = require("@/engine/blocks") as typeof import("@/engine/blocks");
  const registry = require("@/engine/registry") as typeof import("@/engine/registry");
  const { timelineAssemble } = require("../narratedBlocks") as typeof import("../narratedBlocks");
  /* eslint-enable @typescript-eslint/no-require-imports */
  _resetBlocks();
  registerAllBlocks();
  registerAllBlocks();
  const baseline = registry.getManifest("timeline_assemble")!;
  const revised = registry.getManifest("timeline_assemble", COMPOSER_MIX_ASSEMBLY_VERSION)!;
  assert.equal(baseline.block, timelineAssemble);
  assert.equal(registry.get("timeline_assemble", baseline.version), timelineAssemble);
  assert.notEqual(revised.block, baseline.block);
  assert.equal(revised.execute, revised.block.run);
  assert.equal(revised.certification.status, "contract");
  assert.equal(registry.all().filter((block) => block.id === "timeline_assemble").length, 1);
  assert.ok(!registry.allManifests().includes(revised), "opt-in version must not enter default discovery");
  assert.equal(registry.get("timeline_assemble", "2.0.0-missing"), undefined, "no fallback to default for an unknown version");
  assert.equal(baseline.optionalConsumes.musicBrief, undefined, "default contract stays unchanged");
  assert.ok(revised.optionalConsumes.musicBrief);

  const profile = buildChannelProfile({
    row: { _id: "mix-channel", name: "Mix", slug: "mix", status: "active", template: "A", budget: 1, identity: {} },
    archetype: "narrated-essay",
    pipeline: [{ block: "composer_brief", params: { preset: "meditation" } }],
  });
  // This is the real deterministic directive producer used by composerBriefBlock,
  // not an LLM-generated duckDb/bedLufs substitute.
  const config = resolveComposerConfig(profile);
  const brief = validateArtifact(registry.getManifest("composer_brief")!.produces.musicBrief, {
    musicPrompt: "A quiet instrumental bed.",
    audio: { duckDb: -40, bedLufs: -22, voiceFx: "radio" },
    config, directives: composerDirectives(config), configVersion: "composer@1.0.0",
  });
  validateArtifact(revised.optionalConsumes.musicBrief, brief);
  const fixture = await mkdtemp(join(tmpdir(), "composer-mix-fixture-"));
  temporary.add(fixture);
  const footage = join(fixture, "footage.mp4");
  const narration = join(fixture, "narration.mp3");
  await writeFile(footage, "source fixture");
  await writeFile(narration, "already processed narration");

  const makeContext = (edl: boolean, params: Args = {}, musicBrief: unknown = brief): StageContext => ({
    ownerId: "owner-mix", channelId: "mix-channel", runId: "composer-mix-evaluation",
    keyPrefix: "test/composer-mix/", budgetUsd: 0, log: () => {},
    params: Object.freeze({ useAssemblyEdl: edl, tailSec: 0, burnCaptions: false, transitions: "hardcut", introMusicVol: 0.33, musicDuckRampSec: 2, ...params }),
    store: Object.freeze({ footageClips: [footage], entityClips: [], narrationLocalPath: narration,
      narrationDurationSec: 10, musicKey: "test/music.mp3", musicUrl: "https://unused.invalid/music.mp3",
      cutSheet: { sections: [{ name: "body", cutsPerMin: 6 }], transitions: "crossfade" },
      ...(musicBrief === undefined ? {} : { musicBrief }),
    }),
  });
  function resetCalls() {
    calls.bodies.length = 0; calls.compositions.length = 0; calls.targets.length = 0; calls.voiceFx = 0;
    stored.clear();
  }
  async function run(edl: boolean, params: Args, expectedGain: number, expectedLufs: number, musicBrief: unknown = brief, version: string | null = COMPOSER_MIX_ASSEMBLY_VERSION) {
    resetCalls();
    const ctx = makeContext(edl, params, musicBrief);
    const before = structuredClone(ctx.params);
    const selected = registry.getManifest("timeline_assemble", version ?? undefined)!;
    const output = await selected.block.run(ctx);
    assert.ok(output.videoKey);
    assert.equal(calls.bodies.length, 1, "real selected assembly runs its body builder");
    assert.equal(calls.compositions.length, 1);
    assert.deepEqual(calls.targets, [expectedLufs], "real final normalization receives the resolved target exactly once");
    const composed = calls.compositions[0];
    assert.equal(composed.bodyMusicVol, expectedGain);
    assert.equal(composed.introMusicVol, 0.33);
    assert.equal(composed.musicDuckRampSec, 2);
    assert.equal(composed.transition, "hardcut");
    assert.equal(composed.narrationPath, narration, "assembly consumes the original narration asset unchanged");
    assert.equal(calls.voiceFx, 0);
    assert.deepEqual(ctx.params, before, "wrapper never mutates frozen params");
    return { gain: composed.bodyMusicVol, target: calls.targets[0], maxSegSec: calls.bodies[0].maxSegSec };
  }

  for (const edl of [false, true]) {
    await run(edl, {}, 0.25, -16);
    await run(edl, { bodyMusicVol: 0.08, targetLufs: -13 }, 0.08, -13);
    await run(edl, { bodyMusicVol: 0, targetLufs: -14 }, 0, -14);
    await run(edl, { bodyMusicVol: 0.1026, targetLufs: -14 }, 0.1026, -14);
    await run(edl, { targetLufs: -12 }, 0.25, -12);
    await run(edl, {}, 0.1026, -14, {});
    resetCalls();
    const absentContext = makeContext(edl);
    const absentStore = { ...absentContext.store };
    delete absentStore.musicBrief;
    await revised.execute({ ...absentContext, store: Object.freeze(absentStore) });
    assert.equal(calls.compositions[0].bodyMusicVol, 0.1026);
    assert.deepEqual(calls.targets, [-14]);
    await run(edl, {}, 0.04, -14, { directives: { bodyMusicVol: 0.04, voiceFx: "radio" } });
    for (const [name, gain] of Object.entries({ none: 0.5, gentle: 0.25, standard: 0.1026, aggressive: 0.05 })) {
      const assemblyProfile = { ...profile, pipeline: [{ block: "timeline_assemble", params: { musicDuckProfile: name } }] };
      assert.equal(resolveAssembleParams(assemblyProfile).bodyMusicVol, gain, "wrapper mapping matches the real existing profile resolver");
      await run(edl, { musicDuckProfile: name }, gain, -16);
      await run(edl, { musicDuckProfile: name, bodyMusicVol: 0 }, 0, -16);
    }
    const old = await run(edl, {}, 0.1026, -14, brief, baseline.version);
    const unversioned = await run(edl, {}, 0.1026, -14, brief, null);
    assert.deepEqual(unversioned, old, "unversioned invocation preserves baseline behavior");
    await run(edl, { musicDuckProfile: "none" }, 0.1026, -14, brief, baseline.version);
    for (const invalid of [null, { directives: null }, { directives: { bodyMusicVol: -1 } },
      { directives: { bodyMusicVol: "0.25" } }, { directives: { bodyMusicVol: Infinity } },
      { directives: { targetLufs: -30 } }, { directives: { targetLufs: NaN } }]) {
      resetCalls();
      assert.throws(() => validateArtifact(revised.optionalConsumes.musicBrief, invalid));
      await assert.rejects(revised.execute(makeContext(edl, { bodyMusicVol: 0.2, targetLufs: -14 }, invalid)));
      assert.equal(calls.bodies.length + calls.compositions.length + calls.targets.length, 0, "invalid overridden directives reject before any encode");
    }
    for (const params of [{ bodyMusicVol: -1 }, { bodyMusicVol: null }, { targetLufs: "-14" }, { musicDuckProfile: "deep" }]) {
      resetCalls();
      await assert.rejects(revised.execute(makeContext(edl, params)));
      assert.equal(calls.bodies.length + calls.compositions.length + calls.targets.length, 0);
    }
  }
  // Delegate identity and pass-through invariants are also checked directly;
  // neither a profile nor unrelated/voice params may be rewritten by the wrapper.
  let received: StageContext | undefined;
  const delegate = { ...baseline, block: { ...baseline.block, run: async (ctx: StageContext) => { received = ctx; return {}; } } };
  const wrapped = createComposerAwareAssemblyManifest(delegate);
  const ctx = makeContext(false, { voiceFx: "none", editorSentinel: { keep: true } });
  await wrapped.execute(ctx);
  assert.equal(received!.store, ctx.store);
  assert.deepEqual(received!.params, { ...ctx.params, bodyMusicVol: 0.25, targetLufs: -16 });
  assert.equal(registry.get("timeline_assemble"), timelineAssemble);
  assert.equal(networkCalls, 0);
  console.log("COMPOSER MIX ASSEMBLY PASS: typed producer directives, exact-version selection, real legacy + EDL backend handoff, overrides/profiles/zero, invalid-before-encode, no voice processing, default isolation");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  loader._load = originalLoad;
  globalThis.fetch = originalFetch;
  if (convexEnv.public === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
  else process.env.NEXT_PUBLIC_CONVEX_URL = convexEnv.public;
  if (convexEnv.private === undefined) delete process.env.CONVEX_URL;
  else process.env.CONVEX_URL = convexEnv.private;
  for (const path of temporary) await rm(path, { recursive: true, force: true });
});
