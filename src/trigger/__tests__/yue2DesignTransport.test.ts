import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { designPipeline, type DesignOptions } from "@/engine/designer";
import { channelPipelinePreviewInputFromDesign, compileChannelPipelinePreview } from "@/engine/channelPipelinePreview.server";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";

// Execute the worker's actual options projection, then the real designer and
// compiler. Loading the task itself would bring unrelated provider startup in.
const source = readFileSync(new URL("../designChannelInception.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("inception.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let projection: ts.Expression | undefined;
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "designOptions") {
    assert.equal(projection, undefined, "exactly one worker design projection");
    projection = node.initializer;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(projection);
const js = ts.transpileModule(`const result = ${projection.getText(ast)}; result;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const sourceParams = { seed: 42, personalCreatorAcknowledged: true, maxCostUsd: 0.04,
  executionPolicy: { schema_version: 1, provider: "openrelay", allocation_basis: "supervised_dispatch_wall_time",
    rate_source: "operator_configured", rate_reference: "synthetic transport fixture, not a current price",
    runtime_id: "youtube-studio-fixture", hourly_rate_usd_micros: 180000, max_execution_seconds: 600,
    termination_grace_seconds: 10, reserved_allocation_usd_micros: 30500 } };
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("design transport must not dispatch or call providers"); };
try {
  for (const [family, playback, role] of [
    ["music_loop", "repeat", "primary_music"], ["sleep", "repeat", "meditation_bed"],
    ["shorts", "once", "short_form_bed"], ["narrated_stock", "once", "narration_bed"],
  ] as const) {
    const programBrief = createChannelProgramBrief({ family, nicheKey: "educational", locale: "en",
      concept: `Original ${family} programming for adult viewers.` });
    const yue2Music = { musicIntent: { playback, role, requestedDurationSec: 30 }, sourceParams };
    const payload = { family, programBrief, yue2Music };
    const project = (value: object): DesignOptions => runInNewContext(js, {
      payload: value, programBrief, publishingApproved: false, existingAtStart: true, programRouteForCompile: undefined,
      isRouteLessLegacyRetry: true, routeSyntheticScenario: undefined, submittedCreatorIntentDiagnosis: undefined,
    }) as DesignOptions;
    const selectedOptions = project(payload);
    assert.equal(selectedOptions.yue2Music, yue2Music, "worker must retain the exact requested selection");
    const selected = designPipeline(selectedOptions);
    assert.equal(selected.compilation!.modules.find(module => module.id === "music")?.version, "3.0.0-yue2-candidate");
    assert.equal(selected.productionReady, false, "transport cannot grant production qualification");
    assert.ok(selected.runtimeBlockers.some(reason => reason.includes("YuE2")));
    const changed = designPipeline(project({ ...payload, yue2Music: { ...yue2Music, sourceParams: { ...sourceParams, seed: 43 } } }));
    assert.notEqual(changed.compilation!.fingerprint, selected.compilation!.fingerprint);
    const legacy = project({ family, programBrief });
    assert.equal(legacy.yue2Music, undefined);
    assert.notEqual(designPipeline(legacy).compilation!.fingerprint, selected.compilation!.fingerprint);

    // The public build endpoint uses this projection before Trigger dispatch.
    // It must never validate a legacy snapshot after discarding a YuE2 choice.
    const previewMusic = { ...yue2Music, sourceParams: { renderer: "render-engine", seed: 42,
      personalCreatorAcknowledged: true, maxCostUsd: 1, maxExecutionSeconds: 600 } };
    const previewPayload = { ...payload, yue2Music: previewMusic };
    const preview = compileChannelPipelinePreview(channelPipelinePreviewInputFromDesign(previewPayload));
    const changedPreview = compileChannelPipelinePreview(channelPipelinePreviewInputFromDesign({ ...previewPayload,
      yue2Music: { ...previewMusic, sourceParams: { ...previewMusic.sourceParams, seed: 43 } } }));
    assert.notEqual(changedPreview.pipelineFingerprint, preview.pipelineFingerprint);
    for (const value of [null, {}, false]) {
      const previewInput = channelPipelinePreviewInputFromDesign({ ...previewPayload, yue2Music: value });
      assert.equal(previewInput.yue2Music, value);
      assert.throws(() => compileChannelPipelinePreview(previewInput), /yue2Music/);
    }
    assert.doesNotThrow(() => compileChannelPipelinePreview(channelPipelinePreviewInputFromDesign({ programBrief })));
  }
  for (const family of ["music_loop", "sleep", "shorts", "narrated_stock"] as const) {
    const programBrief = createChannelProgramBrief({ family, nicheKey: family === "music_loop" ? "lofi" : "motivation",
      locale: "en", concept: `Fresh ${family} channel with original recurring programming.` });
    const programRoute = resolveChannelProgramRoute(programBrief);
    const options = runInNewContext(js, {
      payload: { family, programBrief }, programBrief, publishingApproved: false,
      existingAtStart: false, programRouteForCompile: programRoute, isRouteLessLegacyRetry: false,
      routeSyntheticScenario: undefined, submittedCreatorIntentDiagnosis: undefined,
    }) as DesignOptions;
    assert.equal(options.useEngineMusicForFreshChannel, true);
    assert.equal(options.yue2Music, undefined, "fresh-channel default must not depend on a client-supplied selection");
    const design = designPipeline(options);
    const music = design.compilation!.modules.find(module => module.id === "music");
    assert.equal(music?.version, "4.0.0-yue2-engine-candidate", `${family} fresh channel uses the shared Engine music module`);
    assert.equal(design.pipeline.find(entry => entry.block === "music")?.params?.renderer, "render-engine");
    assert.equal(design.productionReady, false, "automatic source selection cannot bypass qualification or listening approval");

    const preview = compileChannelPipelinePreview({ programBrief });
    assert.equal(preview.routeFingerprint, programRoute.fingerprint);
    assert.ok(preview.blocks.includes("music"));
  }
  console.log("YUE2 DESIGN TRANSPORT PASS: explicit and automatic fresh-channel Engine selection across four families; preview fingerprint sensitivity, malformed selection rejection, no provider calls");
} finally { globalThis.fetch = fetchBefore; }
