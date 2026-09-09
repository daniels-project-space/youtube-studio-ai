import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import type { SceneManifest } from "@/engine/episodeGraph";
import { SCENE_LANDSCAPE_PROFILE, SCENE_PORTRAIT_PROFILE, SCENE_PORTRAIT_LAYOUT, resolveSceneLayout, preflightSceneLayout, portraitLabelLines, rectContains } from "@/remotion/sceneCompiler/layoutProfile";

const scene = { id: "scene-one", t0: 0, t1: 1, kind: "question", label: "A readable native portrait label", characterIds: [], visualState: { action: "A test", props: [] } } as unknown as SceneManifest["scenes"][number];
const manifest = { durationSec: 1, scenes: [scene], audience: "general" } as SceneManifest;
const portrait = resolveSceneLayout({ layoutProfile: SCENE_PORTRAIT_PROFILE });
assert.deepEqual(resolveSceneLayout(), { id: SCENE_LANDSCAPE_PROFILE, width: 1920, height: 1080 });
assert.equal(resolveSceneLayout({ width: 1280, height: 720 }).id, SCENE_LANDSCAPE_PROFILE);
assert.deepEqual(portrait, { id: SCENE_PORTRAIT_PROFILE, width: 1080, height: 1920 });
for (const profile of ["scene-layout/portrait-v0", "scene-layout/portrait-v2", "portrait", "", "__proto__"]) assert.throws(() => resolveSceneLayout({ layoutProfile: profile }), /Unsupported/);
assert.throws(() => resolveSceneLayout({ width: 1080, height: 1920 }), /explicit versioned/);
assert.throws(() => resolveSceneLayout({ layoutProfile: SCENE_PORTRAIT_PROFILE, width: 540, height: 960 }), /native 1080x1920/);
for (const value of [0, -1, NaN, Infinity]) assert.throws(() => resolveSceneLayout({ width: value }), /positive finite/);
const layout = SCENE_PORTRAIT_LAYOUT;
for (const rect of [layout.disclosure, layout.visual, layout.label]) assert.ok(rectContains(layout.safe, rect));
assert.ok(layout.disclosure.y + layout.disclosure.height < layout.visual.y);
assert.ok(layout.visual.y + layout.visual.height < layout.label.y);
assert.ok(layout.labelFontSize * layout.labelLineHeight * 3 <= layout.label.height);
assert.ok(portraitLabelLines("A route through the changing landscape").length <= 3);
assert.throws(() => portraitLabelLines("W".repeat(28)), /unbreakable/);
assert.throws(() => portraitLabelLines("x".repeat(73)), /72 glyphs/);
assert.throws(() => portraitLabelLines(" "), /blank/);
preflightSceneLayout(manifest, portrait);
const rejected = [
  { value: { ...manifest, audience: "children" }, message: /children grammar/ },
  { value: { ...manifest, scenes: [{ ...scene, visualState: { evidenceVisualIntent: "factual_chart" } }] }, message: /factual-evidence/ },
  { value: { ...manifest, scenes: [{ ...scene, visualState: { evidenceVisualManifest: {} } }] }, message: /factual-evidence/ },
  { value: { ...manifest, scenes: [{ ...scene, visualState: { evidenceVisualIntent: "invalid-but-present" } }] }, message: /factual-evidence/ },
  { value: { ...manifest, scenes: [{ ...scene, kind: "unimplemented" }] }, message: /Unsupported portrait scene kind/ },
  { value: { ...manifest, scenes: [{ ...scene, label: "W".repeat(28) }] }, message: /unbreakable/ },
  { value: { ...manifest, scenes: [{ ...scene, t0: 0.5 }] }, message: /timing/ },
  { value: { ...manifest, durationSec: 2 }, message: /complete manifest/ },
  { value: { ...manifest, scenes: [{ ...scene, visualState: { syntheticScenarioProfile: "ai_town", syntheticScenarioVisualKind: "decision_options" } }] }, message: /grammar\/disclosure/ },
  { value: { ...manifest, scenes: [{ ...scene, visualState: { syntheticScenarioVisualKind: "town_turn" } }] }, message: /grammar\/disclosure/ },
  { value: { ...manifest, scenes: [{ ...scene, visualState: { syntheticScenarioProfile: "__proto__", syntheticScenarioVisualKind: "town_turn" } }] }, message: /grammar\/disclosure/ },
];
for (const item of rejected) assert.throws(() => preflightSceneLayout(item.value as SceneManifest, portrait), item.message);
for (const kind of ["map", "chart", "diagram", "panel", "puppet", "screen"]) preflightSceneLayout({ ...manifest, scenes: [{ ...scene, kind }] } as unknown as SceneManifest, portrait);
for (const [profile, kinds] of Object.entries({ ai_town: ["town_overview", "town_turn"], ai_decision: ["decision_options", "decision_outcome"], ai_pov: ["pov_hud"] })) {
  for (const kind of kinds) preflightSceneLayout({ ...manifest, scenes: [{ ...scene, visualState: { ...scene.visualState, syntheticScenarioProfile: profile, syntheticScenarioVisualKind: kind } }] } as SceneManifest, portrait);
}

async function callerTests() {
  const localRequire = createRequire(path.join(process.cwd(), "package.json"));
  const { build } = localRequire(localRequire.resolve("esbuild", { paths: [path.dirname(localRequire.resolve("tsx/package.json"))] })) as { build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }> };
  type TransportBuilder = {
    onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string }): void;
    onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string }): void;
  };
  let calls = 0;
  const result = await build({
    entryPoints: [path.join(process.cwd(), "src/lib/sceneCompilerRender.ts")], bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "only-external-render-transport", setup(builder: TransportBuilder) {
      builder.onResolve({ filter: /^@remotion\/(renderer|bundler)$/ }, (args) => ({ path: args.path, namespace: "render-transport" }));
      builder.onLoad({ filter: /.*/, namespace: "render-transport" }, () => ({ contents: "export const ensureBrowser = () => globalThis.__portraitTransport(); export const bundle = () => globalThis.__portraitTransport(); export const selectComposition = () => globalThis.__portraitTransport(); export const renderMedia = () => globalThis.__portraitTransport();", loader: "js" }));
    } }],
  });
  const globals = globalThis as typeof globalThis & { __portraitTransport?: () => never };
  globals.__portraitTransport = () => { calls += 1; throw new Error("External render work reached before portrait refusal"); };
  try {
    const compiled = { exports: {} as { renderSceneManifest(args: Record<string, unknown>): Promise<string> } };
    new Function("require", "module", "exports", result.outputFiles[0]!.text)(localRequire, compiled, compiled.exports);
    for (const item of rejected) {
      await assert.rejects(compiled.exports.renderSceneManifest({ manifest: item.value, outPath: "/tmp/never-written-portrait.mp4", layoutProfile: SCENE_PORTRAIT_PROFILE }), item.message);
    }
    for (const layoutProfile of ["scene-layout/portrait-v0", "unknown"]) await assert.rejects(compiled.exports.renderSceneManifest({ manifest, outPath: "/tmp/never-written-portrait.mp4", layoutProfile }), /Unsupported/);
    await assert.rejects(compiled.exports.renderSceneManifest({ manifest, outPath: "/tmp/never-written-portrait.mp4", width: 1080, height: 1920 }), /explicit versioned/);
    assert.equal(calls, 0, "actual renderer must refuse all unsafe portrait requests before browser, bundling, or render work");
    await assert.rejects(compiled.exports.renderSceneManifest({ manifest, outPath: "/tmp/never-written-portrait.mp4", layoutProfile: SCENE_PORTRAIT_PROFILE }), /External render work reached/);
    assert.equal(calls, 1, "supported portrait request must reach the actual renderer transport seam");
  } finally { delete globals.__portraitTransport; }
  console.log("scene compiler portrait profile/preflight and real renderer caller tests passed");
}
callerTests().catch((error) => { console.error(error); process.exitCode = 1; });
