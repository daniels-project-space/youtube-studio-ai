import assert from "node:assert/strict";
import { designPipeline, designPipelineCore } from "../designer";
import { selectYuE2Pipeline, type YuE2PipelineSelection } from "../yue2PipelineSelection";
import { validatePipeline } from "../validate";
import { compilePipeline } from "../pipelineCompiler";

const sourceParams = { seed: 42, personalCreatorAcknowledged: true, maxCostUsd: 0.04,
  executionPolicy: { schema_version: 1, provider: "openrelay", allocation_basis: "supervised_dispatch_wall_time",
    rate_source: "operator_configured", rate_reference: "synthetic qualification fixture, not a current price",
    runtime_id: "youtube-studio-fixture", hourly_rate_usd_micros: 180000, max_execution_seconds: 600,
    termination_grace_seconds: 10, reserved_allocation_usd_micros: 30500 } };
const selection: YuE2PipelineSelection = { musicIntent: { playback: "repeat", role: "primary_music", requestedDurationSec: 30 }, sourceParams };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("pipeline selection cannot dispatch providers"); };
try {
  for (const [family, playback, role] of [
    ["music_loop", "repeat", "primary_music"], ["sleep", "repeat", "meditation_bed"],
    ["sleep", "once", "meditation_bed"], ["shorts", "once", "short_form_bed"],
    ["narrated_stock", "once", "narration_bed"],
  ] as const) {
    const opts = { family, nicheKey: family === "music_loop" ? "lofi" : "motivation" };
    const baseline = designPipeline(opts), before = structuredClone(baseline.pipeline);
    const chosen = { ...selection, musicIntent: { ...selection.musicIntent, playback, role } };
    const result = designPipeline({ ...opts, yue2Music: chosen });
    assert.equal(result.productionReady, false, "source selection is not automatic production qualification");
    assert.ok(result.runtimeBlockers.some(reason => reason.includes("YuE2")));
    const modules = result.compilation!.modules;
    assert.equal(modules.find(module => module.id === "music")?.version, "3.0.0-yue2-candidate");
    assert.equal(modules.find(module => module.id === "composer_brief")?.version, "3.0.0-yue2-score");
    assert.equal(modules.find(module => module.id === (family === "music_loop" ? "assemble" : "timeline_assemble"))?.version,
      playback === "once" ? "3.1.0-yue2-reviewed-once" : "3.0.0-yue2-reviewed-loop");
    assert.deepEqual(result.pipeline.find(entry => entry.block === "music")?.params, sourceParams);
    assert.deepEqual(result.pipeline.find(entry => entry.block === "composer_brief")?.params?.musicIntent, chosen.musicIntent);
    assert.equal(result.pipeline.filter(entry => entry.block === "music_arrangement_plan").length, 1);
    if (family === "music_loop") {
      for (const [id, version] of [["music_program_plan", "2.0.0-yue2-intent"], ["scene_planner", "3.0.0-bound-visual-plan"],
        ["keyframes", "3.0.0-yue2-reviewed"], ["loop_clips", "2.0.0-yue2-reviewed"]]) {
        assert.equal(modules.find(module => module.id === id)?.version, version);
      }
      assert.equal(result.compilation!.bindings.keyframes.loopVisualPlan, "scene_planner:loopVisualPlan");
      assert.equal(result.compilation!.bindings.loop_clips.yue2MusicCandidate, "music:yue2MusicCandidate");
    }
    assert.deepEqual(selectYuE2Pipeline(result.pipeline, chosen), result.pipeline, "reselection is idempotent");
    assert.notEqual(result.compilation!.fingerprint, baseline.compilation!.fingerprint);
    assert.ok(Number.isFinite(result.compilation!.reservedMaxCostUsd));
    assert.equal(result.compilation!.bindings.music.acceptedMusicArrangement, "music_arrangement_plan:acceptedMusicArrangement");
    assert.equal(result.compilation!.bindings.music_arrangement_plan.musicBrief, "composer_brief:musicBrief");
    assert.deepEqual(baseline.pipeline, before);
    assert.deepEqual(designPipeline(opts).pipeline, before, "default and legacy designs remain unchanged");
    const changed = designPipeline({ ...opts, yue2Music: { ...chosen, sourceParams: { ...sourceParams, seed: 43 } } });
    assert.notEqual(changed.compilation!.fingerprint, result.compilation!.fingerprint);
    const higher = designPipeline({ ...opts, yue2Music: { ...chosen, sourceParams: { ...sourceParams, maxCostUsd: 0.08 } } });
    assert.ok(Math.abs(higher.compilation!.reservedMaxCostUsd - result.compilation!.reservedMaxCostUsd - 0.04) < 1e-8);
  }
  const baseline = designPipeline({ family: "music_loop", nicheKey: "lofi" }).pipeline;
  assert.throws(() => selectYuE2Pipeline(baseline, { ...selection, musicIntent: { ...selection.musicIntent, playback: "once" } }), /narrated timeline/);
  assert.throws(() => selectYuE2Pipeline(baseline.filter(entry => entry.block !== "music"), selection), /exactly one music/);
  assert.throws(() => selectYuE2Pipeline([...baseline, baseline.find(entry => entry.block === "music")!], selection), /exactly one music/);
  assert.throws(() => selectYuE2Pipeline(baseline.map(entry => entry.block === "composer_brief" ? { ...entry, version: "2.0.0-accepted-arrangement" } : entry), selection), /explicitly pinned/);
  assert.throws(() => selectYuE2Pipeline(baseline.map(entry => entry.block === "composer_brief"
    ? { ...entry, params: { ...entry.params, musicIntent: { ...selection.musicIntent, playback: "once" } } } : entry), selection), /explicit music intent/);
  for (const patch of [{ seed: undefined }, { personalCreatorAcknowledged: false }, { maxCostUsd: 0.01 }, { provider: "suno" }]) {
    assert.throws(() => selectYuE2Pipeline(baseline, { ...selection, sourceParams: { ...sourceParams, ...patch } }));
  }
  const missingPlayback = { ...selection, musicIntent: { role: "primary_music", requestedDurationSec: 30 } } as YuE2PipelineSelection;
  assert.throws(() => selectYuE2Pipeline(baseline, missingPlayback));
  assert.throws(() => designPipelineCore({ family: "music_loop", yue2Music: selection }, { validateRuntimeRegistry: false }), /runtime validation/);
  assert.throws(() => designPipeline({ family: "music_loop", yue2Music: selection, paramOverrides: { music: { trackCount: 2 } } }), /legacy music overrides/);
  const selected = selectYuE2Pipeline(baseline, selection);
  for (const optional of [false, true]) {
    const disconnected = validatePipeline(selected, ["styleDNA"]);
    const index = disconnected.manifests.findIndex(manifest => manifest.id === "music_arrangement_plan");
    const mediator = disconnected.manifests[index];
    const { musicBrief, ...consumes } = mediator.consumes;
    disconnected.manifests[index] = { ...mediator, consumes,
      optionalConsumes: { ...mediator.optionalConsumes, ...(optional ? { musicBrief } : {}) } };
    assert.throws(() => compilePipeline(disconnected), /without declaring it/, "absent or optional crew handoff cannot qualify mediation");
  }
  const optionalConsumer = validatePipeline(selected, ["styleDNA"]);
  const consumerIndex = optionalConsumer.manifests.findIndex(manifest => manifest.id === "music");
  const consumer = optionalConsumer.manifests[consumerIndex];
  const { acceptedMusicArrangement, ...consumes } = consumer.consumes;
  optionalConsumer.manifests[consumerIndex] = { ...consumer, consumes,
    optionalConsumes: { ...consumer.optionalConsumes, acceptedMusicArrangement } };
  assert.throws(() => compilePipeline(optionalConsumer), /without declaring it/, "music must require the accepted handoff");
  const withoutMediator = selected.filter(entry => entry.block !== "music_arrangement_plan");
  assert.throws(() => compilePipeline(validatePipeline(withoutMediator, ["styleDNA"])), /music\.arrangement\.accepted/);
  const reordered = [...withoutMediator, { block: "music_arrangement_plan" }];
  assert.throws(() => compilePipeline(validatePipeline(reordered, ["styleDNA"])), /music\.arrangement\.accepted/);
  const wrong = selected.map(entry => entry.block === "assemble" ? { block: "assemble", params: entry.params } : entry);
  assert.throws(() => compilePipeline(validatePipeline(wrong, ["styleDNA"])), /musicUrl/, "ordinary assembly cannot consume a private candidate");
  console.log("YUE2 PIPELINE SELECTION PASS: five real family/playback designs and compilations, exact versions and budgets, legacy parity, rejecting ownership/config cases; no provider calls");
} finally { globalThis.fetch = originalFetch; }
