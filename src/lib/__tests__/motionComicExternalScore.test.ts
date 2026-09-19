import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import type { castMotionComic, MotionComicStoryboard } from "../motionComic";
import type { MotionComicExternalScore } from "../motionComicScore";
import { ffprobeDuration, normalizeAudioOnly } from "../ffmpeg";

const require = createRequire(import.meta.url);
type Builder = {
  onResolve(options: { filter: RegExp }, callback: (args: { path: string; importer: string }) => { path: string; namespace: string } | undefined): void;
  onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string }): void;
};
const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>;
};
const exec = promisify(execFile);
const stateKey = "__motionComicExternalScoreTest";
const globalFixture = globalThis as typeof globalThis & { [stateKey]?: unknown };

async function main() {
  const root = await mkdtemp(join(tmpdir(), "motion-comic-external-"));
  const previousFetch = globalThis.fetch, previousState = globalFixture[stateKey];
  const calls = { music: 0, planner: 0, image: 0, network: 0 };
  globalThis.fetch = async () => { calls.network++; throw new Error("network forbidden"); };
  const audio = join(root, "voice.wav"), video = join(root, "video.mp4"), scorePath = join(root, "score.wav");
  let currentRoot = root;
  let mutateScore = false;
  const io = {
    calls,
    duration: (path: string) => basename(path) === "final.mp4" ? ffprobeDuration(path) : Promise.resolve(1.7),
    normalize: normalizeAudioOnly,
    execFile(...args: unknown[]) {
      const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
      queueMicrotask(() => callback(null, "", "lavfi.signalstats.YAVG=128"));
    },
    spawn(command: string, args: string[]) {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
      queueMicrotask(async () => {
        try {
          if (command === "python3") {
            await copyFile(video, args[3]);
            await writeFile(join(currentRoot, "motion_comic_review_timeline.json"), JSON.stringify({ version: "motion-comic-review/v1", bubbles: [] }));
          } else {
            assert.equal(command, "ffmpeg");
            await copyFile(audio, args.at(-1)!);
          }
          child.emit("close", 0);
        } catch (error) { child.emit("error", error); }
      });
      return child;
    },
  };
  globalFixture[stateKey] = io;
  try {
    for (const [path, input] of [[audio, "sine=frequency=440:sample_rate=48000:duration=6"], [scorePath, "sine=frequency=1000:sample_rate=48000:duration=1"]]) {
      await exec("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", input, "-c:a", "pcm_f32le", path]);
    }
    await exec("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=25:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
    const bytes = await readFile(scorePath);
    const score: MotionComicExternalScore = { path: scorePath, byteLength: bytes.length, contentSha256: createHash("sha256").update(bytes).digest("hex"), playback: "once", gain: 0.5, targetLufs: -14 };
    const seams: Record<string, string> = {
      "node:child_process": "export const spawn=(...a)=>io.spawn(...a);export const execFile=(...a)=>io.execFile(...a);",
      "@/agents/mastra": "export const agentJson=()=>{io.calls.planner++;throw new Error('planner forbidden')};",
      "@/lib/music": "export const generateMusic=()=>{io.calls.music++;throw new Error('music provider forbidden')};",
      "@/lib/creativeText": "export const hasCreativeTextKey=()=>true;",
      "@/lib/vision": "export const VISION_GATE_MAX_TOKENS=1000;export const visionLocal=()=>{throw new Error('vision forbidden')};",
      "@/lib/pydeps": "export const preflightPythonRenderer=async()=>{};",
      "@/lib/novitaRenderFarm": "export const hasNovitaRenderFarmConfig=()=>true;",
      "@/lib/ffmpeg": "export const ffprobeDuration=(p)=>io.duration(p);export const normalizeAudioOnly=(...a)=>io.normalize(...a);",
    };
    const compiled = await build({
      absWorkingDir: process.cwd(), bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      define: { "process.env.ELEVENLABS_API_KEY": JSON.stringify("fixture-not-sent") },
      stdin: { contents: 'export {castMotionComic} from "./src/lib/motionComic";', resolveDir: process.cwd(), loader: "ts" },
      plugins: [{ name: "comic-only-heavy-io-fixtures", setup(builder: Builder) {
        builder.onResolve({ filter: /^(node:child_process|@\/)/ }, ({ path, importer }) => {
          // The score helper and its FFmpeg normalization remain REAL.
          if (importer.endsWith("/motionComic.ts") && seams[path]) return { path, namespace: "comic-fixture" };
          return undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "comic-fixture" }, ({ path }) => ({ loader: "js", contents: `const io=globalThis.${stateKey};\n${seams[path]}` }));
      } }],
    });
    const compiledModule = { exports: {} as { castMotionComic: typeof castMotionComic } };
    new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
    const cast = compiledModule.exports.castMotionComic;
    const story: MotionComicStoryboard = {
      title: "Local score fixture", logline: "Local fixture only.", narratorVoiceId: "narrator", characters: [],
      panels: Array.from({ length: 4 }, () => ({
        visual: { environment: "ancient_ruins", era: "ancient", subjects: [], objects: ["artifact"], action: "watchful_pause", relations: [], mood: "mysterious", lighting: "moonlight" },
        characters: [], shot: "wide", lines: [{ speaker: "narrator", text: "The stones remembered every signal across the quiet valley." }],
      })),
    };
    const generateImage = async () => {
      calls.image++;
      if (mutateScore) {
        const altered = Buffer.from(bytes); altered[altered.length - 1] ^= 1; await writeFile(scorePath, altered);
      }
      return Buffer.from("image I/O fixture");
    };
    const run = async (name: string, supplied: MotionComicExternalScore, cache: boolean, brief = {}) => {
      currentRoot = join(root, name); await mkdir(currentRoot);
      for (let i = 0; i < 4; i++) await copyFile(audio, join(currentRoot, `line_${i}_0.mp3`));
      if (cache) await writeFile(join(currentRoot, "music.mp3"), "hostile stale legacy score");
      return cast({ brief: { topic: story.title, panels: 4, ...brief }, externalScore: supplied, runDir: currentRoot, outPath: join(currentRoot, "final.mp4"), plan: story, generateImage });
    };
    for (const cache of [false, true]) {
      const result = await run(cache ? "warm" : "cold", score, cache);
      assert.equal(result.musicGenerations, 0);
      assert.equal(result.externalScore?.contentSha256, score.contentSha256);
      assert.equal(result.externalScore?.byteLength, score.byteLength);
      assert.equal(calls.music, 0, "a swallowed generator exception would still increment this trap");
      assert.equal(calls.network, 0);
    }
    const imageCount = calls.image;
    await assert.rejects(() => run("missing", { ...score, path: join(root, "missing.wav") }, true), /ENOENT/);
    await assert.rejects(() => run("wrong-hash", { ...score, contentSha256: "0".repeat(64) }, true), /hash mismatch/);
    await assert.rejects(() => run("disabled", score, false, { music: false }), /conflicts/);
    await assert.rejects(() => run("prompt", score, false, { musicPrompt: "invent another score" }), /conflicts/);
    // No approved plan: invalid input must still fail before the real planner branch.
    await assert.rejects(() => cast({ brief: { topic: story.title }, externalScore: { ...score, contentSha256: "0".repeat(64) }, runDir: root, outPath: join(root, "no-plan.mp4"), generateImage }), /hash mismatch/);
    assert.equal(calls.image, imageCount);
    assert.equal(calls.planner, 0);
    mutateScore = true;
    await assert.rejects(() => run("mutated-during-render", score, true), /hash mismatch/);
    assert.equal(calls.music, 0);
    assert.equal(calls.network, 0);
    console.log("motionComicExternalScore: real cast + real score mux, cold/hostile cache, pre-spend refusal, conflicts and mid-render mutation passed");
  } finally {
    globalThis.fetch = previousFetch; globalFixture[stateKey] = previousState;
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
