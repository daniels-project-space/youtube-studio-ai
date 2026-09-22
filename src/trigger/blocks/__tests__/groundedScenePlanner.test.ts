import assert from "node:assert/strict";
import { registerAllBlocks } from "@/engine/blocks";
import { allManifests, getManifest } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import { planScenes, type ScenePlanInput } from "@/engine/prompt/scenePlanner";
import type { StageContext } from "@/engine/types";
import { GROUNDED_SCENE_PLANNER_VERSION, planGroundedScenes } from "../groundedScenePlanner";

const identity = {
  recurringSubject: "The keeper's green desk with a brass compass", setting: "A lighthouse study",
  composition: "Desk in foreground, window behind", colorGrade: "Soft cool watercolor with warm lamp light",
  motifs: ["brass compass"], visualAvoid: ["neon streets"], motionDiscipline: "Static camera",
  motionVocabulary: ["Outside water only"],
  signatureScenes: [
    { name: "Harbor", setting: "A harbor-facing lighthouse room", motion: "Distant harbor water ripples" },
    { name: "Cliffs", setting: "A cliff-facing lighthouse room", motion: "Distant clouds drift above cliffs" },
  ],
};
const input: ScenePlanInput = { topic: "An evening by the sea", styleDNA: identity, defaultDurationSec: 15 };
async function main() {
  const random = Math.random, fetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("scene planning must not call a provider"); };
  try {
    Math.random = () => 0;
    const before = planScenes(input);
    Math.random = () => 0.999;
    assert.notDeepEqual(planScenes(input), before, "reproduce unstable legacy scene selection");
    assert.ok(!before.scenes[0].fluxPrompt.includes(identity.recurringSubject), "reproduce dropped recurring subject");

    Math.random = () => { throw new Error("selected version cannot use randomness"); };
    const expected = planGroundedScenes(input);
    for (let i = 0; i < 10; i++) assert.deepEqual(planGroundedScenes(structuredClone(input)), expected);
    const scene = expected.scenes[0];
    for (const value of [identity.recurringSubject, identity.composition, identity.colorGrade, ...identity.motifs, ...identity.visualAvoid]) {
      assert.ok(scene.fluxPrompt.includes(value), `visual identity survives: ${value}`);
    }
    const chosen = identity.signatureScenes.find(candidate => scene.fluxPrompt.includes(candidate.setting))!;
    assert.ok(chosen); assert.ok(scene.klingMotionPrompt.includes(chosen.motion));
    assert.equal(scene.durationSec, 15);
    assert.deepEqual(input.styleDNA, identity, "no upstream mutation");
    const selectedWorlds = new Set(Array.from({ length: 30 }, (_, index) =>
      planGroundedScenes({ ...input, topic: `Seaside evening ${index}` }).scenes[0].fluxPrompt));
    assert.ok(selectedWorlds.size > 1);
    const settings = new Set(Array.from({ length: 30 }, (_, index) => {
      const prompt = planGroundedScenes({ ...input, topic: `Seaside evening ${index}` }).scenes[0].fluxPrompt;
      return identity.signatureScenes.find(candidate => prompt.includes(candidate.setting))!.name;
    }));
    assert.equal(settings.size, 2, "stable selection still supports different episodes");

    for (const subject of ["A quiet meadow altar", "A minimalist forest reading bench", "A coastal tea table"]) {
      const plan = planGroundedScenes({ ...input, styleDNA: { ...identity, recurringSubject: subject, signatureScenes: [] } });
      assert.ok(plan.scenes[0].fluxPrompt.includes(subject));
      assert.ok(plan.scenes[0].fluxPrompt.includes(identity.setting));
    }
    const guarded = new Proxy(identity, { get(target, key) {
      assert.ok(!["audio", "narrative", "seo", "thumbnail"].includes(String(key)), "visual planner must not consume another module's domain");
      return Reflect.get(target, key);
    } });
    assert.deepEqual(planGroundedScenes({ ...input, styleDNA: guarded }), expected);
    const library = { [input.topic]: { fluxPrompt: "Authored locked frame", klingMotionPrompt: "Authored motion", durationSec: 12, musicPrompt: "Locked music intent" } };
    assert.deepEqual(planGroundedScenes({ ...input, sceneLibrary: library }), planScenes({ ...input, sceneLibrary: library }));
    for (const invalid of [{ ...identity, recurringSubject: "" }, { ...identity, signatureScenes: [{ setting: "room", motion: 42 }] },
      { ...identity, motifs: [42] }]) {
      assert.throws(() => planGroundedScenes({ ...input, styleDNA: invalid as unknown as typeof identity }));
    }
    assert.throws(() => planGroundedScenes({ ...input, defaultDurationSec: Number.NaN }));
    assert.throws(() => planGroundedScenes({ ...input, sceneLibrary: { [input.topic]: { fluxPrompt: "", klingMotionPrompt: "Motion" } } }));

    registerAllBlocks();
    const legacy = getManifest("scene_planner")!, selected = getManifest("scene_planner", GROUNDED_SCENE_PLANNER_VERSION)!;
    assert.ok(selected); assert.equal(allManifests().includes(selected), false);
    const ctx: StageContext = { ownerId: "fixture", channelId: "fixture", runId: "fixture", keyPrefix: "fixture",
      params: { clipDurationSec: 15 }, budgetUsd: 1, log: () => {}, store: { topic: input.topic, styleDNA: identity } };
    assert.deepEqual((await selected.execute(ctx)).scenes, expected.scenes);
    Math.random = () => 0;
    assert.deepEqual((await legacy.execute(ctx)).scenes, before.scenes, "legacy block remains unchanged");
    const entries = [{ block: "scene_planner", version: GROUNDED_SCENE_PLANNER_VERSION }];
    assert.throws(() => validatePipeline(entries, ["topic"]), /styleDNA/);
    const graph = validatePipeline(entries, ["topic", "styleDNA"]);
    const result = await runPipeline(graph, { ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId,
      keyPrefix: ctx.keyPrefix, budgetUsd: 1, seedStore: ctx.store, sink: { async upsert() {} } });
    assert.equal(result.ok, true, result.error); assert.equal(result.costTotal, 0);
    console.log("Grounded scene planner passed: real registration, strict selection and runner; stable scene and motion, subject retained, authored library/legacy unchanged, visual-only inputs, no provider calls.");
  } finally { Math.random = random; globalThis.fetch = fetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
