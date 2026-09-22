import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type { ArtifactRef, StageContext } from "@/engine/types";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { createOriginalMusicProgramPlan } from "@/engine/originalMusicProgram";
import { LoopVisualPlanSchema, loopVisualPlanFingerprint } from "@/engine/loopVisualPlan";
import { stageReuseHash } from "@/engine/stageReuse";
import { classifyExecutionError } from "@/engine/executionErrors";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
let renders = 0;
let motionVerdict: unknown = { motion: "Distant water moves gently outside the window." };
const reviews: string[] = [], renderPrompts: string[] = [];
const dna = { recurringSubject: "A green desk with a brass compass", setting: "A base lighthouse room",
  signatureScenes: [{ name: "Harbor", setting: "A harbor-facing room", motion: "Distant water ripples" }],
  colorGrade: "Soft watercolor", composition: "Desk in foreground", motifs: ["compass"], visualAvoid: ["city street"] };
const ctx: StageContext = { ownerId: "bound-owner", channelId: "bound-channel", runId: "bound-run", keyPrefix: "fixture",
  budgetUsd: 10, stageBudgetUsd: 10, params: {}, log: () => {}, store: { topic: "Quiet evening", styleDNA: dna } };
async function main() {
  loader._load = function(id, ...args) {
    const actual = originalLoad.call(this, id, ...args);
    if (id === "@/lib/novitaMedia") return { ...actual as object, renderNovitaImage: async (value: { prompt: string }) => {
      renders++; renderPrompts.push(value.prompt);
      return { url: "https://fixture.invalid/still", key: "still", jobId: "fixture", model: "fixture", costUsd: 0.01 };
    } };
    if (id === "@/lib/files") return { ...actual as object, makeRunTempDir: async () => "/tmp/bound-visual-fixture",
      downloadTo: async (_url: string, path: string) => path };
    if (id === "./blockContext") return { ...actual as object, recordAsset: async () => {} };
    if (id === "@/lib/vision") return { ...actual as object, hasNonGoogleVisionKey: () => true,
      visionLocal: async (value: { prompt: string }) => {
        reviews.push(value.prompt);
        return JSON.stringify(value.prompt.includes("art director") ? { score: 0.9, issues: [] } : motionVerdict);
      } };
    return actual;
  };
  try {
    const require = createRequire(import.meta.url);
    const { registerAllBlocks } = require("@/engine/blocks");
    const { getManifest, allManifests } = require("@/engine/registry");
    const { validatePipeline } = require("@/engine/validate");
    const { runPipeline } = require("@/engine/runner");
    const { BOUND_SCENE_PLANNER_VERSION: pv, BOUND_KEYFRAMES_VERSION: kv } = require("../boundLoopVisuals");
    registerAllBlocks();
    const planner = getManifest("scene_planner", pv), keyframes = getManifest("keyframes", kv);
    assert.equal(allManifests().includes(planner), false); assert.equal(allManifests().includes(keyframes), false);
    const entries = [{ block: "scene_planner", version: pv, params: { clipDurationSec: 15 } }, { block: "keyframes", version: kv }];
    assert.throws(() => validatePipeline([{ block: "scene_planner", version: pv }, { block: "keyframes" }], Object.keys(ctx.store)));
    assert.throws(() => validatePipeline([{ block: "scene_planner" }, { block: "keyframes", version: kv }], Object.keys(ctx.store)));
    const graph = validatePipeline(entries, Object.keys(ctx.store));
    const retained: Record<string, unknown> = {}, refs: Record<string, ArtifactRef> = {};
    const result = await runPipeline(graph, { ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId,
      keyPrefix: ctx.keyPrefix, budgetUsd: 10, seedStore: ctx.store,
      sink: { async upsert() {}, async upsertArtifacts(value: { artifacts: { artifact: ArtifactRef; payload: unknown }[] }) {
        for (const item of value.artifacts) { refs[item.artifact.key] = item.artifact; retained[item.artifact.key] = item.payload; }
      } } });
    assert.equal(result.ok, true, result.error); assert.equal(renders, 1);
    const plan = LoopVisualPlanSchema.parse(retained.loopVisualPlan);
    assert.equal(plan.scene.durationSec, 15, "planner parameters must not become keyframe parameters");
    assert.equal(plan.identity.setting, "A harbor-facing room");
    assert.match(renderPrompts[0], /A harbor-facing room/); assert.match(renderPrompts[0], /green desk/);
    assert.match(reviews[0], /SETTING: A harbor-facing room/); assert.doesNotMatch(reviews[0], /base lighthouse room/);
    assert.match(reviews[1], /LOCKED MOTION: Distant water ripples/);
    const current = { ...ctx, store: { ...ctx.store, ...retained, scenes: [plan.scene] }, artifactRefs: refs };
    const before = renders;
    for (const altered of [
      { ...current, artifactRefs: undefined },
      { ...current, runId: "other-run" },
      { ...current, store: { ...current.store, topic: "Other topic" } },
      { ...current, store: { ...current.store, styleDNA: { ...dna, recurringSubject: "Different subject" } } },
      { ...current, store: { ...current.store, scenes: [{ ...plan.scene, fluxPrompt: "Substituted city" }] } },
      { ...current, store: { ...current.store, loopVisualPlan: { ...plan, identity: { ...plan.identity, setting: "Substituted city" } } } },
      { ...current, artifactRefs: { ...refs, loopVisualPlan: { ...refs.loopVisualPlan, producerVersion: "legacy" } } },
    ]) await assert.rejects(() => keyframes.execute(altered));
    const { fingerprint: _fingerprint, ...body } = plan;
    void _fingerprint;
    const replacementBody = { ...body, identity: { ...body.identity, setting: "Resealed wrong setting" } };
    const replacement = { ...replacementBody, fingerprint: loopVisualPlanFingerprint(replacementBody) };
    await assert.rejects(() => keyframes.execute({ ...current, store: { ...current.store, loopVisualPlan: replacement },
      artifactRefs: { ...refs, loopVisualPlan: { ...refs.loopVisualPlan, payloadHash: stageReuseHash(replacement) } } }), /does not bind/);
    assert.equal(renders, before, "all corrupted handoffs stop before any image purchase");

    const brief = createChannelProgramBrief({ family: "music_loop", nicheKey: "lofi", locale: "en",
      concept: "Quiet original instrumental focus sessions with calm seamless visual loops." });
    const route = channelProgramRouteRunSeed({ route: resolveChannelProgramRoute(brief), programBrief: brief });
    const program = createOriginalMusicProgramPlan({ route, topic: String(ctx.store.topic), setting: "A seaside tea pavilion",
      motionIntent: "Only distant sea ripples", visualStyle: "watercolor", providerPreference: "suno" });
    const store = { ...ctx.store, channelProgramRoute: route, musicProgramPlan: program };
    const bound = await planner.execute({ ...ctx, store });
    const programPlan = LoopVisualPlanSchema.parse(bound.loopVisualPlan);
    assert.equal(programPlan.identity.setting, program.visual.setting);
    assert.equal(programPlan.programFingerprint, program.fingerprint);
    assert.ok(programPlan.scene.fluxPrompt.includes(program.visual.setting));
    assert.ok(programPlan.scene.fluxPrompt.includes(dna.recurringSubject));
    const programRef = { ...refs.loopVisualPlan, payloadHash: stageReuseHash(bound.loopVisualPlan) };
    await keyframes.execute({ ...ctx, store: { ...store, ...bound }, artifactRefs: { loopVisualPlan: programRef } });
    assert.ok(reviews.at(-2)!.includes(`SETTING: ${program.visual.setting}`));
    assert.ok(reviews.at(-1)!.includes(`LOCKED MOTION: ${program.visual.motionIntent}`));
    const oldProgramRenders = renders;
    const changedProgram = createOriginalMusicProgramPlan({ route, topic: String(ctx.store.topic), setting: "Different pavilion" });
    await assert.rejects(() => keyframes.execute({ ...ctx, store: { ...store, ...bound, musicProgramPlan: changedProgram },
      artifactRefs: { loopVisualPlan: programRef } }));
    assert.equal(renders, oldProgramRenders);
    motionVerdict = { motion: 42 };
    await assert.rejects(() => keyframes.execute({ ...ctx, store: { ...store, ...bound }, artifactRefs: { loopVisualPlan: programRef } }), (error: unknown) => {
      assert.match(String(error), /independent motion-direction review failed/);
      assert.equal(classifyExecutionError(error).retryable, false);
      return true;
    });
    assert.equal(renders, oldProgramRenders + 1, "invalid motion review does not buy a replacement image");
    const beforeConflict = renders;
    await assert.rejects(() => planner.execute({ ...ctx, store, params: { sceneLibrary: {
      [String(ctx.store.topic)]: { fluxPrompt: "Authored city room", klingMotionPrompt: "Light flickers" },
    } } }), /both own this scene/);
    assert.equal(renders, beforeConflict);
    assert.equal(dna.setting, "A base lighthouse room", "no upstream identity rewrite");
    console.log("BOUND VISUAL HANDOFF PASS: actual versioned pipeline and runner lineage; selected setting reaches render and reviewer; route setting preserved; changed/cross-run/resealed inputs rejected before purchase; provider transport synthetic.");
  } finally { loader._load = originalLoad; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
