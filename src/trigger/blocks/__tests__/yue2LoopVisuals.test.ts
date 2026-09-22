import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { OriginalMusicProgramPlanSchema, originalMusicProgramPlanFingerprint } from "@/engine/originalMusicProgram";
import type { StageContext } from "@/engine/types";
import { stageReuseHash } from "@/engine/stageReuse";
import { buildChannelProfile } from "@/engine/channelProfile";
import type { StyleDNA } from "@/engine/creative/types";
import { createImageUsageScope, recordImageUsage } from "@/lib/imageUsage";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
let approved = false, verifies = 0, checks = 0, renders = 0;
let revokeAt = Infinity;
let images = 0;
async function main() {
  loader._load = function(id, ...args) {
    const actual = originalLoad.call(this, id, ...args);
    if (id === "@/lib/approvedYuE2AssemblySource") return { ...actual as object,
      verifyApprovedYuE2Source: async (_ctx: StageContext, playback: string) => {
        assert.equal(playback, "repeat"); verifies++;
        if (!approved) throw new Error("source not approved");
        return { arrangement: { arrangement: { role: "primary_music" } }, assertCurrent: async () => {
          checks++; if (checks >= revokeAt) throw new Error("approval withdrawn before next take");
        } };
      } };
    if (id === "@/lib/minimaxH3") return { ...actual as object,
      minimaxH3Readiness: () => ({ admitted: true, blockers: [] }),
      renderMiniMaxH3: async () => { renders++; return { receipt: { runtime: { costUsd: 0.01 } }, outputBytes: new Uint8Array([1]) }; } };
    if (id === "@/lib/storage") return { ...actual as object, getObjectBytes: async () => new Uint8Array([1, 2, 3]) };
    if (id === "@/lib/files") return { ...actual as object, makeRunTempDir: async () => "/tmp/yue2-loop-fixture",
      writeBytes: async (path: string) => path, downloadTo: async (_url: string, path: string) => path };
    if (id === "@/lib/vision") return { ...actual as object, hasNonGoogleVisionKey: () => true,
      visionLocal: async () => JSON.stringify({ score: 0.4, issues: ["Missing the authorized subject"] }) };
    if (id === "@/lib/novitaMedia") return { ...actual as object, renderNovitaImage: async () => {
      images++; recordImageUsage({ provider: "fixture", model: "fixture", route: "fixture", images: 1, costUsd: 0.01 });
      return { url: "https://fixture.invalid/still", key: "fixture/still", jobId: "fixture", model: "fixture", costUsd: 0.01 };
    } };
    if (id === "@/lib/ffmpeg") return { ...actual as object, seamlessLoopUnit: async (_input: string, output: string) => output };
    return actual;
  };
  try {
    const require = createRequire(import.meta.url);
    const { registerAllBlocks } = require("@/engine/blocks");
    const { getManifest, allManifests } = require("@/engine/registry");
    const { designPipeline } = require("@/engine/designer");
    const { runPipeline } = require("@/engine/runner") as typeof import("@/engine/runner");
    const { validatePipeline } = require("@/engine/validate") as typeof import("@/engine/validate");
    registerAllBlocks();
    const brief = createChannelProgramBrief({ family: "music_loop", nicheKey: "lofi", locale: "en",
      concept: "Quiet original instrumental sessions with calm seamless loop visuals." });
    const route = resolveChannelProgramRoute(brief), seed = channelProgramRouteRunSeed({ route, programBrief: brief });
    const ctx: StageContext = { ownerId: "fixture", channelId: "fixture", runId: "fixture", keyPrefix: "fixture",
      budgetUsd: 10, stageBudgetUsd: 10, params: {}, log: () => {}, store: { topic: "A quiet lighthouse evening",
        channelProgramRoute: seed, styleDNA: { recurringSubject: "A green desk", setting: "A coastal room",
          audio: { genre: "lofi", instrumentation: ["piano"] }, motionVocabulary: ["Distant water ripples"] } } };
    const program = getManifest("music_program_plan", "2.0.0-yue2-intent");
    assert.equal(allManifests().includes(program), false);
    const legacy = await getManifest("music_program_plan").execute(ctx);
    const planned = await program.execute(ctx);
    const sealed = OriginalMusicProgramPlanSchema.parse(planned.musicProgramPlan);
    assert.equal(sealed.version, "original-music-program-plan/v2-yue2");
    assert.equal(sealed.audio.providerPreference, "yue2");
    assert.match(sealed.visual.motionIntent, /Camera completely static/);
    assert.match(sealed.audio.direction, /piano/);
    assert.notEqual(legacy.musicProgramPlan.audio.providerPreference, "yue2");
    const frozenProgram = getManifest("music_program_plan", "2.1.0-yue2-frozen-identity");
    assert.ok(frozenProgram.consumes.channelProfile);
    const staleStore = { ...ctx.store, styleDNA: { setting: "STALE CITY", audio: { genre: "STALE ELECTRO",
      instrumentation: ["STALE SYNTH"] }, motionVocabulary: ["STALE CAMERA SWEEP"] }, niche: "STALE NICHE" };
    for (const [instrument, setting, movement] of [
      ["felt piano", "coastal lighthouse room", "Distant water ripples"],
      ["bowed glass", "quiet woodland cabin", "Leaves moving gently"],
    ]) {
      const profile = buildChannelProfile({ row: { _id: ctx.channelId!, name: setting, slug: "frozen-fixture",
        status: "paused", template: "music_loop", budget: 1, identity: { niche: setting } },
        archetype: "music_loop", pipeline: [{ block: "music_program_plan", version: frozenProgram.version }],
        styleDNA: { setting, audio: { genre: "ambient", instrumentation: [instrument] },
          motionVocabulary: [movement] } as StyleDNA });
      const store = { ...staleStore, channelProfile: profile };
      const before = structuredClone(store);
      const previous = await program.execute({ ...ctx, store });
      assert.match(JSON.stringify(previous), /STALE/, "fixture reproduces the prior loose-identity behavior");
      const patch = await frozenProgram.execute({ ...ctx, store });
      const executed = await runPipeline(validatePipeline(profile.pipeline, Object.keys(store)), {
        ownerId: ctx.ownerId, channelId: ctx.channelId!, runId: ctx.runId, keyPrefix: ctx.keyPrefix,
        budgetUsd: 0, seedStore: store, defaultRetries: 0,
        sink: { upsert: async () => {} },
      });
      assert.equal(executed.ok, true, executed.error);
      assert.deepEqual(executed.store.musicProgramPlan, patch.musicProgramPlan,
        "actual runner must honor the declared frozen-profile input and identical sealed output");
      const current = OriginalMusicProgramPlanSchema.parse(patch.musicProgramPlan);
      assert.ok(current.audio.direction.includes(instrument));
      assert.ok(current.visual.setting.includes(setting));
      assert.ok(current.visual.motionIntent.includes(movement));
      assert.doesNotMatch(JSON.stringify(current), /STALE/);
      assert.deepEqual(store, before, "frozen identity projection must not mutate input seeds");
      const withoutDna = { ...profile, styleDNA: undefined, identity: {} };
      const absent = await frozenProgram.execute({ ...ctx, store: { ...staleStore, channelProfile: withoutDna } });
      assert.doesNotMatch(JSON.stringify(absent), /STALE|felt piano|bowed glass/,
        "absent canonical fields must not revive stale loose identity");
      await assert.rejects(() => frozenProgram.execute({ ...ctx, store: { ...staleStore,
        channelProfile: { ...profile, id: "another-channel" } } }), /current channel/);
    }
    for (const channelProfile of [undefined, null, { id: ctx.channelId }]) {
      await assert.rejects(() => frozenProgram.execute({ ...ctx, store: { ...staleStore, channelProfile } }));
    }
    const oldWithProfile = await program.execute({ ...ctx, store: { ...ctx.store, channelProfile: { id: "malformed" } } });
    assert.deepEqual(oldWithProfile, planned, "previously frozen v2 programs retain exact behavior");
    const wrongVersion = { ...sealed, version: "original-music-program-plan/v1" as const };
    assert.throws(() => OriginalMusicProgramPlanSchema.parse({ ...wrongVersion, fingerprint: originalMusicProgramPlanFingerprint(wrongVersion) }), /version does not bind/);
    await assert.rejects(() => program.execute({ ...ctx, params: { provider: "suno" } }), /conflicts/);
    const routed = { ...ctx, store: { ...ctx.store, ...planned, reuseMusicKey: "legacy-public-track" } };
    await assert.rejects(() => getManifest("music").execute(routed), /legacy generation and reuse cannot substitute/);

    const params = { seed: 42, personalCreatorAcknowledged: true, maxCostUsd: 0.04,
      executionPolicy: { schema_version: 1, provider: "openrelay", allocation_basis: "supervised_dispatch_wall_time",
        rate_source: "operator_configured", rate_reference: "synthetic test, not a current rate", runtime_id: "fixture",
        hourly_rate_usd_micros: 180000, max_execution_seconds: 600, termination_grace_seconds: 10, reserved_allocation_usd_micros: 30500 } };
    await assert.rejects(() => getManifest("music", "3.0.0-yue2-candidate").execute({ ...ctx,
      params, store: { ...ctx.store, ...legacy } }), /legacy provider choice cannot be overwritten/);
    const design = designPipeline({ family: "music_loop", nicheKey: "lofi", programBrief: brief, programRoute: route,
      yue2Music: { sourceParams: params, musicIntent: { playback: "repeat", role: "primary_music", requestedDurationSec: 30 } } });
    assert.equal(design.productionReady, false);
    assert.equal(design.compilation.bindings.loop_clips.yue2MusicCandidate, "music:yue2MusicCandidate");
    const visualPlan = await getManifest("scene_planner", "3.0.0-bound-visual-plan").execute(routed);
    const visualContext = { ...routed, store: { ...routed.store, ...visualPlan, f1Key: "fixture/first-frame.png" },
      artifactRefs: { loopVisualPlan: { artifactId: `${ctx.runId}:scene_planner:loopVisualPlan:fixture`,
        key: "loopVisualPlan", type: "LoopVisualPlan", schemaVersion: "1.0.0", producerModule: "scene_planner",
        producerVersion: "3.0.0-bound-visual-plan", payloadHash: stageReuseHash(visualPlan.loopVisualPlan) } } };
    for (const id of ["keyframes", "loop_clips"]) {
      const manifest = getManifest(id, id === "keyframes" ? "3.0.0-yue2-reviewed" : "2.0.0-yue2-reviewed");
      assert.ok(manifest.consumes.yue2MusicCandidate); assert.ok(manifest.consumes.acceptedMusicArrangement);
      await assert.rejects(() => manifest.execute(visualContext), /source not approved/);
    }
    assert.equal(verifies, 2); assert.equal(renders, 0);
    approved = true; revokeAt = 2;
    await assert.rejects(() => getManifest("loop_clips", "2.0.0-yue2-reviewed").execute({ ...routed,
      store: { ...routed.store, f1Key: "fixture/first-frame.png", scenes: [{ fluxPrompt: "A coastal room", klingMotionPrompt: "Water ripples", durationSec: 15 }] } }),
    (error: unknown) => {
      assert.match(String(error), /approval withdrawn/);
      assert.equal((error as { additionalObservedCostUsd: number }).additionalObservedCostUsd, 0.01);
      assert.equal((error as { retryable: boolean }).retryable, false); return true;
    });
    assert.equal(renders, 1, "the next paid take stops after approval is withdrawn");
    assert.equal(checks, 2);
    checks = 0;
    const usage = createImageUsageScope();
    await assert.rejects(() => usage.run(() => getManifest("keyframes", "3.0.0-yue2-reviewed").execute(visualContext)),
      (error: unknown) => { assert.match(String(error), /approval withdrawn/);
        assert.equal((error as { retryable: boolean }).retryable, false); return true; });
    assert.equal(images, 1, "withdrawal prevents the art critic from buying a second image");
    assert.equal(usage.snapshot().costUsd, 0.01, "the first image remains accounted");
    console.log("YUE2 LOOP INTEGRATION PASS: actual routed creator compilation, versioned intent, legacy substitution refusal, pre-visual approval and per-take revocation with retained cost; approval/provider boundaries synthetic.");
  } finally { loader._load = originalLoad; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
