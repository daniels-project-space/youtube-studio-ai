import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { createOriginalMusicProgramPlan } from "@/engine/originalMusicProgram";
import { ChannelMusicProgramSchema, music3StructuredCaptionWordCount, type ChannelMusicProgram } from "@/engine/channelMusicProgram";
import type { StageContext } from "@/engine/types";
import { canonicalJson } from "@/lib/canonicalJson";
import { MusicError } from "@/lib/music";
import { sha256Hex, sha256BytesHex } from "@/lib/sha256";
import { PLAN_WEEK_PREPARATION_VERSION, planWeekPreparationKey, type PlanWeekPreparationManifest } from "@/lib/planWeekPreparation";
import type { PlanWeekPreparedMusicArgs } from "../planWeekPreparedMusic";

type Provider = "mureka" | "suno" | "minimax_music3";
const boundaryStop = new Error("test stopped at paid provider boundary");
let dispatched: { provider: Provider; prompt: string; model?: string; program?: ChannelMusicProgram }[] = [];
let failureProvider: Provider | null = null;
let persisted: ChannelMusicProgram | undefined;
let manifestBytes: Uint8Array = new Uint8Array();
let manifestKey = "";
const claims = new Map<string, Uint8Array>();
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
const originalMurekaKey = process.env.MUREKA_API_KEY;
const originalSunoKey = process.env.SUNO_API_KEY;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden in direction tests"); };

const dispatch = async (provider: Provider, input: { prompt?: string; model?: string; program?: ChannelMusicProgram }) => {
  dispatched.push({ provider, prompt: input.program?.generation.structuredCaption ?? input.prompt!, model: input.model, program: input.program });
  if (provider === failureProvider) throw new MusicError("provider rejected before generation", { safeToFallback: true });
  throw boundaryStop;
};
loader._load = function (id, ...args) {
  if (id === "@trigger.dev/sdk") return { task: (definition: unknown) => definition };
  if (id === "@/lib/bootstrap") return { bootstrapSecrets: async () => {} };
  if (id === "@/lib/storage") return {
    putObject: async (key: string, bytes: Uint8Array) => {
      if (key.endsWith(".dispatch.json")) { claims.set(key, bytes); return key; }
      persisted = ChannelMusicProgramSchema.parse(JSON.parse(Buffer.from(bytes).toString()));
    },
    getObjectBytes: async (key: string) => {
      if (key === manifestKey) return manifestBytes;
      if (claims.has(key)) return claims.get(key)!;
      throw Object.assign(new Error("missing sidecar"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    },
  };
  const actual = originalLoad.call(this, id, ...args);
  if (id === "@/lib/music") return {
    ...actual as object,
    generateMureka: (input: { prompt: string; model?: string }) => dispatch("mureka", input),
    generateSuno: (input: { prompt: string; model?: string }) => dispatch("suno", input),
  };
  if (id === "@/lib/minimaxMusic3") return { ...actual as object, generateMiniMaxMusic3: (input: { program: ChannelMusicProgram }) => dispatch("minimax_music3", input) };
  if (id === "@/lib/files") return { ...actual as object, makeRunTempDir: async () => "/tmp/music-direction-unused" };
  if (id === "./blockContext") return { ...actual as object, recordAsset: async () => {} };
  return actual;
};

const topic = "Evening session";
const studioCore = {
  version: "studio-postproduction-recipe-projection/v1", assetKind: "audio_recipe",
  promptAddenda: ["Keep the approved glass harmonics audible."],
  quoteOverlayPreset: null, dataInsertPreset: null, transitionPreset: null,
  sourceEntryFingerprints: ["a".repeat(64)],
};
const studio = { ...studioCore, fingerprint: sha256Hex(canonicalJson(studioCore)) };
const dna = { audio: { genre: "driving orchestral percussion", instrumentation: ["timpani", "low strings"], textures: ["dry room"], bpmRange: [110, 120], moodArc: "urgent pursuit resolves decisively", loopable: false } };
const brief = createChannelProgramBrief({ family: "music_loop", nicheKey: "lofi", locale: "en", concept: "Original instrumental sessions with a distinct channel sound." });
const route = channelProgramRouteRunSeed({ route: resolveChannelProgramRoute(brief), programBrief: brief });
const sleepBrief = createChannelProgramBrief({ family: "sleep", nicheKey: "lifestyle", locale: "en", concept: "A stable, beatless overnight soundscape." });
const sleepRoute = channelProgramRouteRunSeed({ route: resolveChannelProgramRoute(sleepBrief), programBrief: sleepBrief });

async function main() {
  const loadWithProviderFixtures = createRequire(__filename);
  const { music } = loadWithProviderFixtures("../blocks/musicBlocks") as typeof import("../blocks/musicBlocks");
  const { planWeekPreparedMusicTask } = loadWithProviderFixtures("../planWeekPreparedMusic") as {
    planWeekPreparedMusicTask: { run: (args: PlanWeekPreparedMusicArgs) => Promise<unknown> };
  };
  async function runtime(
    provider: Provider,
    prompt: string,
    store: Record<string, unknown> = {},
    error?: RegExp,
    model?: string,
    expectedProviders: Provider[] = [provider],
  ) {
    dispatched = []; persisted = undefined;
    const runtimeStore: Record<string, unknown> = { topic, channelProgramRoute: route, ...store };
    if (runtimeStore.channelProgramRoute === route && runtimeStore.musicProgramPlan === undefined) {
      runtimeStore.musicProgramPlan = createOriginalMusicProgramPlan({
        route,
        topic,
        audioDirection: "An original loopable Music Loop score.",
        providerPreference: provider,
      });
    }
    const ctx: StageContext = {
      ownerId: "owner-direction", channelId: "channel-direction", runId: "run-direction",
      keyPrefix: "owner/direction/channel/music/", budgetUsd: 5, log: () => {},
      params: { provider, prompt, ...(model === undefined ? {} : { model }) }, store: runtimeStore,
    };
    if (error) {
      await assert.rejects(music.run(ctx), error);
      assert.equal(dispatched.length, 0, "invalid caption must fail before purchasing");
      assert.equal(persisted, undefined, "invalid caption must not be sealed/persisted");
      return "";
    }
    await assert.rejects(music.run(ctx), /test stopped at paid provider boundary/);
    assert.deepEqual(dispatched.map(({ provider: used }) => used), expectedProviders);
    assert.ok(persisted);
    ChannelMusicProgramSchema.parse(persisted);
    if (provider === "minimax_music3") {
      assert.deepEqual(dispatched[0].program, persisted, "dispatch uses the exact sealed program");
      const words = music3StructuredCaptionWordCount(dispatched[0].prompt);
      assert.ok(words >= 250 && words <= 450, `caption contains ${words} words`);
    }
    return dispatched[0].prompt;
  }
  async function weekly(prompt: string, seed: Record<string, unknown> = {}, config: Record<string, unknown> = {}) {
    claims.clear(); // Each direction comparison is an independent fixture run.
    dispatched = [];
    const manifest: PlanWeekPreparationManifest = {
      version: PLAN_WEEK_PREPARATION_VERSION, ownerId: "owner-direction", channelId: "channel-direction",
      channelSlug: "direction", batchId: "batch-direction", itemId: "item-direction", itemKey: "week:0", requestKey: "week",
      frozenAt: Date.now() - 1000,
      plan: { topic, title: topic, description: "An original music session.", sceneSeed: "Evening light", thumbnailKey: "owner/thumbnail.jpg", thumbnailSource: "planner_artwork" },
      execution: { pipeline: [{ block: "music" }], moduleConfig: { music: { provider: "mureka", prompt, ...config } }, seedStore: seed },
      prompts: { script: "script", narration: "narration", shotlist: "shotlist", visual: "visual" },
    };
    manifestKey = planWeekPreparationKey(manifest);
    manifestBytes = Buffer.from(canonicalJson(manifest));
    await assert.rejects(planWeekPreparedMusicTask.run({ ...manifest, manifestKey, manifestSha256: sha256BytesHex(manifestBytes), maxCostUsd: 5 }), /test stopped at paid provider boundary/);
    assert.equal(dispatched.length, 1, "real weekly task reaches the mocked provider exactly once");
    return dispatched[0].prompt;
  }

  const flat = "Keep a flat nocturnal pulse with no build, drop, or climax.";
  const active = "Propulsive championship percussion for high energy athletic training.";
  process.env.MUREKA_API_KEY = "fixture-mureka";
  process.env.SUNO_API_KEY = "fixture-suno";
  await runtime("mureka", "Warm instrumental detail.", {}, undefined, "  ");
  assert.equal(dispatched[0]!.model, undefined, "blank model control must preserve Mureka's provider default");
  await runtime("suno", "Warm instrumental detail.", {}, undefined, "  ");
  assert.equal(dispatched[0]!.model, "V5", "blank model control must preserve the existing Suno default");
  await runtime("mureka", "Warm instrumental detail.", {}, undefined, "MurekaX");
  assert.equal(dispatched[0]!.model, "MurekaX", "Mureka's selected provider receives its model override");
  await runtime("suno", "Warm instrumental detail.", {}, undefined, "SunoCustom");
  assert.equal(dispatched[0]!.model, "SunoCustom", "Suno's selected provider receives its model override");
  failureProvider = "mureka";
  await runtime("mureka", "Warm instrumental detail.", {}, undefined, "MurekaX", ["mureka", "suno"]);
  assert.equal(dispatched[0]!.model, "MurekaX");
  assert.equal(dispatched[1]!.model, "V5", "Mureka model IDs must not leak into Suno fallback");
  failureProvider = "suno";
  await runtime("suno", "Warm instrumental detail.", {}, undefined, "SunoCustom", ["suno", "mureka"]);
  assert.equal(dispatched[0]!.model, "SunoCustom");
  assert.equal(dispatched[1]!.model, undefined, "Suno model IDs must not leak into Mureka fallback");
  failureProvider = null;
  for (const provider of ["mureka", "suno", "minimax_music3"] as const) {
    const sleepPrompt = await runtime(provider, "Use a driving 120 BPM groove with a strong pulse.", {
      channelProgramRoute: sleepRoute,
      styleDNA: { audio: {
        genre: "soft nocturnal ambient",
        instrumentation: ["warm sustained pad", "distant piano harmonics"],
        textures: ["steady filtered noise", "quiet room air"],
        bpmRange: [120, 120],
        moodArc: "A driving 120 BPM groove with a strong pulse.",
        loopable: true,
      } },
    });
    assert.equal(persisted!.mix.targetLufs, -20, "an unconfigured sleep route must retain the sleep-specific mastering target");
    assert.equal(persisted!.mix.narrationPriority, true, "the canonical guided-sleep route gives narration foreground priority");
    assert.equal(persisted!.mix.bodyMusicVol, 0.1026, "the canonical guided-sleep route defaults to narrated-bed gain");
    assert.match(sleepPrompt, /unmetered and beatless/u);
    assert.match(sleepPrompt, /diffuse, sustained background texture/u);
    assert.doesNotMatch(sleepPrompt, /The melodic lead belongs/u);
    assert.match(sleepPrompt, /warm sustained pad/u);
    assert.doesNotMatch(sleepPrompt, /\b120\s*BPM\b|driving orchestral percussion|strong pulse|resolves back to the tonic/iu);
    assert.doesNotMatch(sleepPrompt, /flat dynamics with no section development|abrupt key, tempo|melody that masks narration/u);

    for (const intent of [flat, active]) {
      const caption = await runtime(provider, intent);
      assert.equal(persisted!.mix.targetLufs, -16, "the primary-music default remains music-forward after role-default correction");
      assert.ok(caption.includes(intent));
      assert.ok(persisted!.generation.structuredCaption.includes(intent), "selected prompt is sealed, even for text-only providers");
      assert.ok(!caption.includes(intent === flat ? active : flat));
    }
    const composer = "Follow the episode's rain motif, ending with crystalline silence.";
    const composerOnly = await runtime(provider, "glassy harmonic", { musicBrief: { musicPrompt: composer } });
    assert.ok(composerOnly.includes(composer));
    assert.ok(composerOnly.includes("glassy harmonic"));
    const moduleNuance = "Keep a glass harmonic under the episode's rain motif.";
    const caption = await runtime(provider, moduleNuance, { styleDNA: dna, musicBrief: { musicPrompt: composer }, studioAudioRecipeProjection: studio });
    assert.ok(caption.includes(dna.audio.genre));
    assert.ok(caption.includes(composer));
    if (provider !== "minimax_music3") assert.ok(caption.includes(moduleNuance));
    assert.ok(music3StructuredCaptionWordCount(caption) <= 450);
    assert.ok(caption.includes(studioCore.promptAddenda[0]));
    assert.ok(!caption.includes("to study and relax to"));
    assert.match(caption, /natural ending/i);
    assert.match(await runtime(provider, "IGNORED_EXPLICIT_GENRE", { styleDNA: { audio: { ...dna.audio, loopable: true } } }), /loop-friendly, resolves back to the tonic/i);
    const sealedDirection = "Retain the sealed bowed-metal motif and final suspended chord.";
    const plan = createOriginalMusicProgramPlan({ route, topic, audioDirection: sealedDirection, providerPreference: provider });
    const sealed = await runtime(provider, flat, { channelProgramRoute: route, musicProgramPlan: plan });
    assert.ok(sealed.includes(sealedDirection));
    assert.ok(sealed.includes(flat));
  }
  await runtime("suno", "A safe background score.", { channelProgramRoute: undefined });
  assert.equal(persisted!.family, "unclassified");
  assert.equal(persisted!.contentLaneKey, "unclassified");
  assert.equal(persisted!.role, "narration_bed");
  assert.equal(persisted!.mix.bodyMusicVol, 0.1026,
    "legacy runs without a route must not inherit LoFi's primary-music gain");
  for (const intent of [flat, active]) assert.ok((await weekly(intent)).includes(intent));
  const composer = "Let this episode's motif dissolve into glass harmonics.";
  const weeklyNuance = "Add a barely audible glass harmonic.";
  const weeklyDna = await weekly(weeklyNuance, { styleDNA: dna, musicBrief: { musicPrompt: composer }, studioAudioRecipeProjection: studio });
  assert.ok(weeklyDna.includes(dna.audio.genre));
  assert.ok(weeklyDna.includes(composer));
  assert.ok(weeklyDna.includes(weeklyNuance));
  assert.ok(weeklyDna.includes(studioCore.promptAddenda[0]));
  assert.match(weeklyDna, /natural ending/i);
  assert.match(await weekly(flat, { styleDNA: { audio: { ...dna.audio, loopable: true } } }), /loop-friendly, resolves back to the tonic/i);
  assert.ok((await weekly(weeklyNuance, { styleDNA: dna })).includes(weeklyNuance));
  for (const field of ["composerDirection", "musicPrompt"]) {
    const caption = await weekly("IGNORED_EXPLICIT_GENRE", {}, { [field]: composer });
    assert.ok(caption.includes(composer));
    assert.ok(caption.includes("Additional module direction"));
  }
  const sealedDirection = "Preserve the sealed prepared session's metallic pulse.";
  const plan = createOriginalMusicProgramPlan({ route, topic, audioDirection: sealedDirection, providerPreference: "mureka" });
  const weeklySealed = await weekly(flat, { channelProgramRoute: route, musicProgramPlan: plan, studioAudioRecipeProjection: studio });
  assert.ok(weeklySealed.includes(sealedDirection));
  assert.ok(weeklySealed.includes(flat));
  assert.ok(weeklySealed.includes(studioCore.promptAddenda[0]));
  const differentProviderPlan = createOriginalMusicProgramPlan({ route, topic, audioDirection: sealedDirection, providerPreference: "suno" });
  await assert.rejects(weekly(flat, { channelProgramRoute: route, musicProgramPlan: differentProviderPlan }), /provider does not match the frozen route/);
  assert.equal(dispatched.length, 0, "weekly generation cannot buy a provider that the sealed route will refuse");
  await assert.rejects(weekly(flat, { channelProgramRoute: route, musicProgramPlan: { ...plan, topic: "tampered" } }));
  assert.equal(dispatched.length, 0, "invalid supplied sealed plan fails before dispatch");
  // Weekly preparation can precede the original planner; this existing
  // admission difference is intentional here, not claimed runtime parity.
  assert.ok((await weekly(flat, { channelProgramRoute: route })).includes(flat));

  // More than the old 600-character clamp, but still inside the word gate.
  const longDirection = `${"Unhurried-resonance ".repeat(36)}CRITICAL_ENDING_INSTRUCTION`;
  assert.ok(longDirection.length > 600);
  assert.ok((await runtime("minimax_music3", "IGNORED_EXPLICIT_GENRE", { styleDNA: dna, musicBrief: { musicPrompt: longDirection } })).includes("CRITICAL_ENDING_INSTRUCTION"));
  assert.ok((await weekly(longDirection)).includes("CRITICAL_ENDING_INSTRUCTION"));
  await runtime("minimax_music3", `${"preserve ".repeat(460)}CRITICAL_ENDING_INSTRUCTION`, {}, /450|word/i);
  assert.equal(networkCalls, 0);
  console.log("SHARED MUSIC DIRECTION PASS: real runtime and weekly boundaries; channel intent, beatless sleep across providers, DNA precedence, episode nuance, sealed direction, Studio additions, lossless bounds, no network");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad;
  globalThis.fetch = originalFetch;
  if (originalMurekaKey === undefined) delete process.env.MUREKA_API_KEY;
  else process.env.MUREKA_API_KEY = originalMurekaKey;
  if (originalSunoKey === undefined) delete process.env.SUNO_API_KEY;
  else process.env.SUNO_API_KEY = originalSunoKey;
});
