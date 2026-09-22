import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { createOriginalMusicProgramPlan } from "@/engine/originalMusicProgram";
import type { ArtifactRef, StageContext } from "@/engine/types";
import { stageReuseHash } from "@/engine/stageReuse";
import { LoopKeyframeDirectionSchema } from "@/engine/loopVisualPlan";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const motion = "Only the distant water visible through the window ripples gently.";
let images = 0;
const prompts: string[] = [];
async function main() {
  loader._load = function(id, ...args) {
    const actual = originalLoad.call(this, id, ...args);
    if (id === "@/lib/approvedYuE2AssemblySource") return { ...actual as object,
      verifyApprovedYuE2Source: async () => ({ arrangement: { arrangement: { role: "primary_music" } }, assertCurrent: async () => {} }) };
    if (id === "@/lib/novitaMedia") return { ...actual as object, renderNovitaImage: async () => {
      images++; return { url: "https://fixture.invalid/still", key: "fixture/accepted-still", jobId: "fixture", model: "fixture", costUsd: 0.01 };
    } };
    if (id === "@/lib/minimaxH3") return { ...actual as object,
      minimaxH3Readiness: () => ({ admitted: true, blockers: [] }),
      renderMiniMaxH3: async (value: { prompt: string }) => { prompts.push(value.prompt); throw new Error("fixture transport stop"); } };
    if (id === "@/lib/files") return { ...actual as object, makeRunTempDir: async () => "/tmp/reviewed-motion-fixture",
      downloadTo: async (_url: string, path: string) => path };
    if (id === "./blockContext") return { ...actual as object, recordAsset: async () => {} };
    if (id === "@/lib/storage") return { ...actual as object, getObjectBytes: async () => new Uint8Array([1, 2, 3]) };
    if (id === "@/lib/vision") return { ...actual as object, hasNonGoogleVisionKey: () => true,
      visionLocal: async (value: { prompt: string }) => {
        if (value.prompt.includes("art director")) return JSON.stringify({ score: 0.9, issues: [] });
        assert.match(value.prompt, /LOCKED MOTION/);
        return JSON.stringify({ motion });
      } };
    return actual;
  };
  try {
    const require = createRequire(import.meta.url);
    const { registerAllBlocks } = require("@/engine/blocks");
    const { registerManifest, getManifest } = require("@/engine/registry");
    const { manifestFromBlock } = require("@/engine/moduleManifest");
    const { validatePipeline } = require("@/engine/validate");
    const { runPipeline } = require("@/engine/runner");
    const { REVIEWED_MOTION_KEYFRAMES_VERSION: kv, REVIEWED_MOTION_CLIPS_VERSION: cv } = require("../reviewedLoopMotion");
    registerAllBlocks();
    const material = JSON.parse(readFileSync("test-fixtures/music-composer/seaside-after/gpu-material.json", "utf8"));
    const arrangement = material.request.acceptedArrangement;
    const root = `owner/${arrangement.ownerId}/runs/${arrangement.runId}/music/yue2-evaluation/`;
    const candidate = { version: "shared-yue2-music-candidate/v1", ownerId: arrangement.ownerId,
      channelId: arrangement.channelId, runId: arrangement.runId, arrangementFingerprint: arrangement.fingerprint,
      jobId: material.candidate.jobId, candidateSha256: "a".repeat(64), candidateKey: `${root}candidate.json`,
      listeningAudioKey: `${root}audio-headroom-${"b".repeat(64)}.wav`, listeningAudioSha256: "b".repeat(64), nativeFrames: 1440000,
      sampleRateHz: 48000, channels: 2, technicalStatus: "needs_audition", allocatedCostUsdMicros: 4208,
      costBasis: "supervised_dispatch_wall_time", providerBilledCostUsdMicros: null, productionApproved: false };
    registerManifest(manifestFromBlock({ id: "motion_source_fixture", consumes: [],
      produces: ["yue2MusicCandidate", "acceptedMusicArrangement"],
      run: async () => ({ yue2MusicCandidate: candidate, acceptedMusicArrangement: arrangement }) },
    { capabilities: ["audio.music_candidate", "music.arrangement.accepted"] }));
    const brief = createChannelProgramBrief({ family: "music_loop", nicheKey: "lofi", locale: "en",
      concept: "Quiet original instrumental focus sessions with calm seamless visual loops." });
    const route = channelProgramRouteRunSeed({ route: resolveChannelProgramRoute(brief), programBrief: brief });
    const topic = "A quiet lighthouse evening";
    const program = createOriginalMusicProgramPlan({ route, topic, providerPreference: "yue2", setting: "A coastal room",
      motionIntent: "Broad program directive: maintain a quiet static scene." });
    const store = { topic, channelProgramRoute: route, musicProgramPlan: program,
      styleDNA: { recurringSubject: "A green desk", setting: "A coastal room", motionVocabulary: ["Distant water ripples"] } };
    const ctx: StageContext = { ownerId: arrangement.ownerId, channelId: arrangement.channelId, runId: arrangement.runId,
      keyPrefix: "fixture", budgetUsd: 10, stageBudgetUsd: 10, params: {}, store, log: () => {} };
    const entries = [{ block: "motion_source_fixture" }, { block: "scene_planner", version: "3.0.0-bound-visual-plan" },
      { block: "keyframes", version: kv }, { block: "loop_clips", version: cv }];
    assert.throws(() => validatePipeline(entries.map(entry => entry.block === "keyframes"
      ? { ...entry, version: "3.0.0-yue2-reviewed" } : entry), Object.keys(store)), /loopKeyframeDirection/);
    assert.throws(() => validatePipeline(entries.map(entry => entry.block === "loop_clips"
      ? { ...entry, version: "2.0.0-yue2-reviewed" } : entry), Object.keys(store)), /loopKeyframeDirection/);
    const graph = validatePipeline(entries, Object.keys(store));
    const retained: Record<string, unknown> = {}, refs: Record<string, ArtifactRef> = {};
    const result = await runPipeline(graph, { ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId,
      keyPrefix: ctx.keyPrefix, budgetUsd: 10, seedStore: store,
      sink: { async upsert() {}, async upsertArtifacts(value: { artifacts: { artifact: ArtifactRef; payload: unknown }[] }) {
        for (const item of value.artifacts) { refs[item.artifact.key] = item.artifact; retained[item.artifact.key] = item.payload; }
      } } });
    assert.equal(result.ok, false); assert.match(result.error, /fixture transport stop/);
    assert.equal(images, 1); assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes(motion));
    assert.ok(!prompts[0].includes(program.visual.motionIntent), "broad program intent must not replace image-grounded direction");
    assert.doesNotMatch(prompts[0], /drifting steam|soft glow flicker|gentle shimmer/, "do not introduce unreviewed template motion");
    const direction = LoopKeyframeDirectionSchema.parse(retained.loopKeyframeDirection);
    assert.equal(direction.f1Key, result.store.f1Key); assert.equal(direction.motionPrompt, result.store.motionPrompt);
    assert.equal(refs.loopKeyframeDirection.producerVersion, kv);
    const current = { ...ctx, store: result.store, artifactRefs: refs };
    const clips = getManifest("loop_clips", cv);
    const before = prompts.length;
    for (const altered of [
      { ...current, artifactRefs: undefined },
      { ...current, runId: "other-run" },
      { ...current, store: { ...current.store, f1Key: "different-still" } },
      { ...current, store: { ...current.store, motionPrompt: "Move the camera through a city" } },
      { ...current, store: { ...current.store, loopKeyframeDirection: undefined } },
      { ...current, store: { ...current.store, loopKeyframeDirection: { ...direction, motionPrompt: "Substituted motion that was never reviewed" } } },
      { ...current, artifactRefs: { ...refs, loopKeyframeDirection: { ...refs.loopKeyframeDirection, producerVersion: "legacy" } } },
    ]) await assert.rejects(() => clips.execute(altered), (error: unknown) => {
      assert.match(String(error), /Reviewed loop motion handoff invalid/);
      assert.equal((error as { retryable: boolean }).retryable, false); return true;
    });
    const wrongPlan = { ...direction, visualPlanFingerprint: "c".repeat(64) };
    await assert.rejects(() => clips.execute({ ...current, store: { ...current.store, loopKeyframeDirection: wrongPlan },
      artifactRefs: { ...refs, loopKeyframeDirection: { ...refs.loopKeyframeDirection, payloadHash: stageReuseHash(wrongPlan) } } }), /handoff invalid/);
    assert.equal(prompts.length, before, "invalid handoffs must stop before H3 dispatch");
    for (const key of ["qaProfile", "qualityProfile"]) await assert.rejects(() => getManifest("keyframes", kv).execute({
      ...current, params: { [key]: "draft" },
    }), /requires production keyframe review/);
    assert.equal(images, 1, "draft cannot purchase an image then claim production review");
    await assert.rejects(() => getManifest("loop_clips", "2.0.0-yue2-reviewed").execute(current), /fixture transport stop/);
    assert.ok(prompts.at(-1)!.includes(program.visual.motionIntent), "previous explicit revision preserves its prior precedence");
    assert.ok(!prompts.at(-1)!.includes(motion));
    console.log("REVIEWED LOOP MOTION PASS: real runner binds scene, accepted still and direction; reviewed motion reaches H3; corrupt/mixed/draft handoffs rejected before spend; old revision unchanged. Approval and media providers synthetic.");
  } finally { loader._load = originalLoad; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
