/** Local-only visual foundation proof. No storage, provider, or pipeline admission. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderStill, selectComposition } from "@remotion/renderer";
import { SceneManifestSchema, type SceneManifest } from "../src/engine/episodeGraph";
import { getSceneCompilerServeUrl, renderSceneManifest } from "../src/lib/sceneCompilerRender";
import { SCENE_PORTRAIT_PROFILE, SCENE_PORTRAIT_LAYOUT, preflightSceneLayout, resolveSceneLayout, rectContains } from "../src/remotion/sceneCompiler/layoutProfile";

const browserExecutable = "/usr/bin/google-chrome";
const output = await mkdtemp(path.join(os.tmpdir(), "ysa-scene-portrait-proof-"));
console.log(`Evidence directory: ${output}`);
type Word = { text: string; x: number; y: number; width: number; height: number };
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
function readDisclosure(png: string): { words: Word[]; tsv: string } {
  // Only the fixed all-uppercase disclosure uses this alphabet; ordinary
  // presentation labels below continue using unrestricted OCR.
  const tsv = execFileSync("tesseract", [png, "stdout", "--psm", "11", "-c", "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ ", "tsv"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const words = tsv.trim().split("\n").slice(1).map((line) => line.split("\t")).filter((columns) => columns[0] === "5" && columns[11]?.trim() && Number(columns[7]) < SCENE_PORTRAIT_LAYOUT.visual.y).map((columns) => ({ text: columns[11]!, x: Number(columns[6]), y: Number(columns[7]), width: Number(columns[8]), height: Number(columns[9]) }));
  return { words, tsv };
}
function assertDisclosure(words: Word[]) {
  assert.equal(normalize(words.map((word) => word.text).join(" ")), normalize("FICTIONAL AI SCENARIO ILLUSTRATIVE ASSUMPTIONS"));
  for (const word of words) assert.ok(rectContains(SCENE_PORTRAIT_LAYOUT.disclosure, word));
}
function visualContrast(png: string): number {
  const stats = execFileSync("ffmpeg", ["-v", "error", "-i", png, "-vf", "crop=888:1112:96:360,signalstats,metadata=mode=print:file=-", "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8" });
  const minimum = Number(stats.match(/lavfi.signalstats.YMIN=(\d+)/)?.[1]);
  const maximum = Number(stats.match(/lavfi.signalstats.YMAX=(\d+)/)?.[1]);
  assert.ok(Number.isFinite(minimum) && Number.isFinite(maximum));
  return maximum - minimum;
}
if (process.env.SCENE_PROOF_TRANSITION_ONLY_FRAME) {
  const contrast = visualContrast(process.env.SCENE_PROOF_TRANSITION_ONLY_FRAME);
  console.log(JSON.stringify({ frame: process.env.SCENE_PROOF_TRANSITION_ONLY_FRAME, contrast }));
  assert.ok(contrast > 40, "transition visual region must retain artwork, not only the blank background");
  process.exit(0);
}
async function negativeDisclosureControls(missingFrame: string) {
  const missing = readDisclosure(missingFrame);
  assert.throws(() => assertDisclosure(missing.words), assert.AssertionError, "an actual native frame with no disclosure must fail");
  const wrongFrame = path.join(output, "known-wrong-disclosure.png");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x071525:s=1080x1920", "-vf", "drawtext=text='FICTIONAL HI SCENARIO':fontcolor=white:fontsize=36:x=98:y=160,drawtext=text='ILLUSTRATIVE ASSUMPTIONS':fontcolor=white:fontsize=36:x=98:y=210", "-frames:v", "1", wrongFrame]);
  const wrong = readDisclosure(wrongFrame);
  assert.ok(wrong.words.length > 3, "negative control must contain actual readable but incorrect text");
  assert.throws(() => assertDisclosure(wrong.words), assert.AssertionError, "the uppercase whitelist must not turn HI into the required AI");
  const controls = { missingFrame, missingWords: missing.words, wrongFrame, wrongWords: wrong.words, expected: "FICTIONAL AI SCENARIO ILLUSTRATIVE ASSUMPTIONS", bothRejected: true };
  await writeFile(path.join(output, "disclosure-negative-controls.json"), JSON.stringify(controls, null, 2));
  return controls;
}
if (process.env.SCENE_PROOF_NEGATIVE_ONLY_FRAME) {
  await negativeDisclosureControls(process.env.SCENE_PROOF_NEGATIVE_ONLY_FRAME);
  console.log("Actual missing/wrong disclosure pixel controls rejected");
  process.exit(0);
}
const kinds = ["map", "chart", "diagram", "panel", "puppet", "screen", "town_overview", "town_turn", "decision_options", "decision_outcome", "pov_hud"];
const labels = ["A route through the changing landscape", "Illustrative signals, not measured data", "One cause changes the wider system", "Three moments in a connected story", "The same character stays in the scene", "A closer look at the working screen", "A fictional town before the next turn", "A fictional town responds to change", "Three choices, each with a trade-off", "The chosen path reveals its trade-off", "A fictional point of view, not a recording"];
// Validate the production-shaped envelope, then exercise each explicit legacy
// renderer kind. This is a renderer diagnostic, not a certified episode receipt.
const manifest = SceneManifestSchema.parse({
  version: "scene-manifest/v1", durationSec: kinds.length, fingerprint: "a".repeat(64),
  topic: "Local deterministic portrait layout diagnostic", audience: "general",
  seriesId: "series-layout", episodeId: "episode-layout", renderer: "deterministic-scene/v1", externalProviderCalls: 0,
  scenes: kinds.map((kind, index) => ({
    id: `scene-layout-${index}`, beatId: `beat-layout-${index}`, t0: index, t1: index + 1,
    kind: "question",
    label: labels[index], characterIds: kind === "puppet" ? ["character-constant"] : [],
    settingId: "setting-constant", camera: { framing: "wide", move: index % 2 ? "push" : "static" },
    visualState: { action: labels[index], props: [], ...(index >= 6 ? {
      syntheticScenarioProfile: kind.startsWith("town") ? "ai_town" : kind.startsWith("decision") ? "ai_decision" : "ai_pov",
      syntheticScenarioVisualKind: kind,
    } : {}) },
    text: "Diagnostic visual fixture, not a production episode or quality receipt.",
    causalInputBeatIds: [], sourceRefs: ["source-local-fixture"], transition: ["cut", "dissolve", "wipe", "match_cut"][index % 4],
  })),
});
// The existing renderer's explicit base kinds are broader than EpisodeGraph's
// story-kind enum. Keep this distinction visible in the retained fixture.
for (let index = 0; index < 6; index += 1) {
  (manifest.scenes[index] as unknown as { kind: string }).kind = kinds[index]!;
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sourcePaths = ["src/lib/sceneCompilerRender.ts", "src/remotion/sceneCompiler/SceneCompiler.tsx", "src/remotion/sceneCompiler/layoutProfile.ts"];
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async (file) => [file, hash(await readFile(file))])));
await writeFile(path.join(output, "input-source.json"), JSON.stringify({ sourceHashes, manifest }, null, 2));
const baselinePath = process.env.SCENE_PROOF_BASELINE_RESULTS;
const baseline = baselinePath ? JSON.parse(await readFile(baselinePath, "utf8")) as { samples: { frame: number; sha256: string }[] } : undefined;
preflightSceneLayout(manifest, resolveSceneLayout({ layoutProfile: SCENE_PORTRAIT_PROFILE }));
const serveUrl = await getSceneCompilerServeUrl();
const stressCases = [
  { name: "three-line-label", label: "Three careful choices transform this fictional world", characterIds: [] as string[], action: "A portrait label at its maximum admitted line count" },
  { name: "general-garden", label: "Two recurring characters tend the same garden", characterIds: ["character-constant", "character-second"], action: "Water the seed with sunlight in the garden" },
];
const stressFrames: { name: string; file: string }[] = [];
for (const stress of stressCases) {
  const stressManifest = { ...manifest, scenes: manifest.scenes.map((scene, index) => index === 0 ? { ...scene, kind: "question", label: stress.label, characterIds: stress.characterIds, visualState: { action: stress.action, props: [] } } : scene) } as SceneManifest;
  preflightSceneLayout(stressManifest, resolveSceneLayout({ layoutProfile: SCENE_PORTRAIT_PROFILE }));
  const stressProps = { manifest: stressManifest, width: 1080, height: 1920, layoutProfile: SCENE_PORTRAIT_PROFILE };
  const stressComposition = await selectComposition({ serveUrl, id: "SceneManifest", inputProps: stressProps, browserExecutable });
  const file = path.join(output, `stress-${stress.name}.png`);
  await renderStill({ serveUrl, composition: stressComposition, inputProps: stressProps, browserExecutable, frame: 18, output: file, imageFormat: "png", chromiumOptions: { gl: "angle" } });
  const tsv = execFileSync("tesseract", [file, "stdout", "--psm", "11", "tsv"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const words = tsv.trim().split("\n").slice(1).map((line) => line.split("\t")).filter((columns) => columns[0] === "5" && columns[11]?.trim() && Number(columns[7]) >= SCENE_PORTRAIT_LAYOUT.label.y).map((columns) => ({ text: columns[11]!, x: Number(columns[6]), y: Number(columns[7]), width: Number(columns[8]), height: Number(columns[9]) }));
  assert.equal(normalize(words.map((word) => word.text).join(" ")), normalize(stress.label));
  for (const word of words) assert.ok(rectContains(SCENE_PORTRAIT_LAYOUT.label, word));
  stressFrames.push({ name: stress.name, file });
}
if (process.env.SCENE_PROOF_STRESS_ONLY === "1") {
  await writeFile(path.join(output, "stress-results.json"), JSON.stringify({ sourceHashes, stressFrames }, null, 2));
  console.log(JSON.stringify({ output, stressFrames }));
  process.exit(0);
}
const inputProps = { manifest, width: 1920, height: 1080 };
const composition = await selectComposition({ serveUrl, id: "SceneManifest", inputProps, browserExecutable });
const samples: { kind: string; frame: number; file: string; sha256: string }[] = [];
for (const [index, kind] of kinds.entries()) {
  const frame = index * 30 + 18;
  const file = path.join(output, `landscape-${kind}.png`);
  await renderStill({ serveUrl, composition, inputProps, browserExecutable, frame, output: file, imageFormat: "png", chromiumOptions: { gl: "angle" } });
  samples.push({ kind, frame, file, sha256: hash(await readFile(file)) });
  if (baseline) assert.equal(samples.at(-1)!.sha256, baseline.samples.find((item) => item.frame === frame)?.sha256, `historical landscape pixels changed for ${kind}`);
}
const videos: { orientation: string; file: string; width: number; height: number; frames: number; videoDurationSec: number; containerDurationSec: number; sha256: string }[] = [];
const portraitSamples: { kind: string; frame: number; file: string; words: number }[] = [];
const transitionSamples: { frame: number; file: string; contrast: number }[] = [];
for (const orientation of ["portrait", "landscape"]) {
  const file = path.join(output, `${orientation}.mp4`);
  await renderSceneManifest({ manifest, outPath: file, browserExecutable, concurrency: 2, ...(orientation === "portrait" ? { layoutProfile: SCENE_PORTRAIT_PROFILE } : {}), log: (message) => console.log(`${orientation}: ${message}`) });
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" })) as { streams: { codec_type: string; width: number; height: number; nb_frames: string; duration: string }[]; format: { duration: string } };
  const video = probe.streams.find((stream) => stream.codec_type === "video")!;
  assert.deepEqual([video.width, video.height], orientation === "portrait" ? [1080, 1920] : [1920, 1080]);
  assert.equal(Number(video.nb_frames), 330);
  assert.ok(Math.abs(Number(video.duration) - 11) <= 1 / 30);
  // Existing Remotion output includes silent AAC padding. Pin video frames
  // exactly and retain the real container duration independently. The0.12s
  // bound is the established assert on final mux duration in
  // src/trigger/blocks/sceneCompilerBlocks.ts, not a new portrait tolerance.
  assert.ok(Number(probe.format.duration) >= Number(video.duration) && Number(probe.format.duration) - Number(video.duration) <= 0.12);
  videos.push({ orientation, file, width: video.width, height: video.height, frames: Number(video.nb_frames), videoDurationSec: Number(video.duration), containerDurationSec: Number(probe.format.duration), sha256: hash(await readFile(file)) });
  if (orientation !== "portrait") continue;
  for (const [index, kind] of kinds.entries()) {
    const frame = index * 30 + 18;
    const png = path.join(output, `portrait-${kind}.png`);
    execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", png]);
    const tsv = execFileSync("tesseract", [png, "stdout", "--psm", "11", "tsv"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const words = tsv.trim().split("\n").slice(1).map((line) => line.split("\t")).filter((columns) => columns[0] === "5" && Number(columns[10]) >= 25 && columns[11]?.trim()).map((columns) => ({ text: columns[11]!, x: Number(columns[6]), y: Number(columns[7]), width: Number(columns[8]), height: Number(columns[9]) }));
    const labelWords = words.filter((word) => word.y >= SCENE_PORTRAIT_LAYOUT.label.y);
    assert.ok(labelWords.length > 3, `actual encoded ${kind} label must be readable to OCR`);
    for (const word of labelWords) assert.ok(rectContains(SCENE_PORTRAIT_LAYOUT.label, word), `encoded label word leaves safe region: ${kind} ${word.text}`);
    assert.equal(normalize(labelWords.map((word) => word.text).join(" ")), normalize(labels[index]!), `encoded ${kind} label must retain every word`);
    if (index === 0) await negativeDisclosureControls(png);
    if (index >= 6) {
      // This fixed disclosure is uppercase. Restrict OCR to its actual glyph
      // alphabet so Arial capital I is not misclassified as lowercase l.
      // Region bounds and every required word remain exact assertions.
      const disclosure = readDisclosure(png);
      assertDisclosure(disclosure.words);
      await writeFile(path.join(output, `portrait-${kind}-disclosure.tsv`), disclosure.tsv);
    }
    portraitSamples.push({ kind, frame, file: png, words: words.length });
  }
  // Retain start/end plus every dissolve/wipe boundary and its hand-off window.
  const frames = new Set([0, 329]);
  for (let index = 1; index < kinds.length; index += 1) if ([1, 2].includes(index % 4)) for (const offset of [0, 4, 7, 11]) frames.add(index * 30 + offset);
  for (const frame of [...frames].sort((a, b) => a - b)) {
    const png = path.join(output, `transition-${String(frame).padStart(3, "0")}.png`);
    execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", png]);
    const contrast = visualContrast(png);
    assert.ok(contrast > 40, `transition ${frame} lost its artwork behind an opaque background`);
    transitionSamples.push({ frame, file: png, contrast });
  }
}
const finalHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async (file) => [file, hash(await readFile(file))])));
assert.deepEqual(finalHashes, sourceHashes, "rendered source changed during the proof");
const result = { mode: "held-native-portrait-foundation", output, sourceHashes, serveUrl, baselinePath, landscapePixelComparisons: baseline ? samples.length : 0, manifest: manifest as SceneManifest, samples, portraitSamples, stressFrames, transitionSamples, videos,
  limitations: ["Silent local visual diagnostic; narration/mux/production receipt/QA admission remain outside this stage.", "Six explicit base renderer kinds plus five schema-valid fictional-scenario variants; not an automaticcreator proof.", "Factual-evidence and children portrait grammar explicitly refused; unfinished follow-up work.", "Generic seeded illustrative graphics prove layout only, not topic-bound arithmetic, factual, or story capability. Existing story-kind mapping and semantic validation remain integration blockers."] };
assert.equal(samples.length, 11);
await writeFile(path.join(output, "results.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, mode: result.mode, samples: samples.length, portraitSamples: portraitSamples.length, transitionSamples: transitionSamples.length, landscapePixelComparisons: result.landscapePixelComparisons }));
