/** Runs the real cast AND block; only provider, process and storage I/O are fixtures. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { MotionComicResult, MotionComicStoryboard } from "../../motionComic";
import type { Block, StageContext } from "@/engine/types";

const require = createRequire(import.meta.url);
const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>;
};
type Builder = {
  onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string } | undefined): void;
  onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string }): void;
};
type Asset = { kind: string; r2Key: string; meta?: Record<string, unknown> };
type Runtime = {
  root: string;
  finalDuration: number;
  probeFailure?: Error;
  normalizeFailure?: boolean;
  mediaFile?: string;
  nativeProbe?: (path: string) => Promise<number>;
  commands: string[][];
  probes: string[];
  assets: Asset[];
  uploads: Array<{ key: string; path: string; sha256: string }>;
  events: string[];
};
const stateKey = "__ysaMotionComicDurationIo";
type FixtureGlobal = typeof globalThis & { [stateKey]?: object };

export async function loadMotionComicDurationHarness() {
  const seams: Record<string, string> = {
    "node:child_process": `export const spawn=(...a)=>io.spawn(...a); export const execFile=(...a)=>io.execFile(...a);`,
    "@/agents/mastra": `export const agentJson=()=>{throw new Error('unexpected planner provider request')};`,
    "@/lib/anthropic": `export const hasAnthropicKey=()=>true; export const claudeJsonPro=()=>{throw new Error('unexpected critic provider request')};`,
    "@/lib/vision": `export const VISION_GATE_MAX_TOKENS=1000; export const visionLocal=()=>{throw new Error('unexpected vision request')};`,
    "@/lib/music": `export const generateMusic=()=>{throw new Error('unexpected music request')};`,
    "@/lib/pydeps": `export const preflightPythonRenderer=async()=>{};`,
    "@/lib/novitaRenderFarm": `export const hasNovitaRenderFarmConfig=()=>true;`,
    "@/lib/novitaMedia": `export const createAttestedNovitaImageGenerator=()=>async()=>Buffer.from('local panel fixture');`,
    "@/lib/ffmpeg": `export const ffprobeDuration=(p)=>io.duration(p); export const normalizeAudioOnly=(a,b)=>io.normalize(a,b); export const probe=async()=>({hasAudio:true,durationSec:11}); export const measureAudio=async()=>({integratedLufs:-14,windowMeanDb:-16});`,
    "@/lib/files": `export const makeRunTempDir=async()=>io.root;`,
    "@/lib/storage": `export const getObjectBytes=async()=>Buffer.from(JSON.stringify(io.checkpoint)); export const putObject=async()=>{}; export const putObjectFromFile=(key,path)=>io.upload(key,path);`,
    "@/lib/studioConvexHttpClient": `export class StudioConvexHttpClient { async mutation(_api,args){io.assets.push(args);return 'local-asset'} }`,
  };
  const compiled = await build({
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    define: { "process.env.ELEVENLABS_API_KEY": JSON.stringify("local-fixture-never-sent"), "process.env.NEXT_PUBLIC_CONVEX_URL": JSON.stringify("https://local-fixture.invalid") },
    stdin: { contents: 'export {castMotionComic} from "./src/lib/motionComic"; export {motionComicBlock} from "./src/trigger/blocks/motionComicBlocks";', resolveDir: process.cwd(), loader: "ts" },
    plugins: [{ name: "duration-io-only", setup(builder: Builder) {
      builder.onResolve({ filter: /^(node:child_process|@\/)/ }, ({ path }) => seams[path] ? { path, namespace: "duration-io" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "duration-io" }, ({ path }) => ({ loader: "js", contents: `const io=globalThis.${stateKey};\n${seams[path]}` }));
    } }],
  });
  let current: Runtime;
  const story: MotionComicStoryboard = {
    title: "Local duration transport fixture", logline: "A local clock fixture.", narratorVoiceId: "narrator", characters: [],
    panels: Array.from({ length: 4 }, () => ({
      visual: { environment: "ancient_ruins", era: "ancient", subjects: [], objects: ["artifact"], action: "watchful_pause", relations: [], mood: "mysterious", lighting: "moonlight" },
      characters: [], shot: "wide", lines: [{ speaker: "narrator", text: "The stones remembered every signal across the quiet valley." }],
    })),
  };
  const materialize = async (path: string) => {
    await mkdir(dirname(path), { recursive: true });
    if (current.mediaFile) await copyFile(current.mediaFile, path);
    else await writeFile(path, "local-process-output");
  };
  const io = {
    get root() { return current.root; },
    get assets() { return current.assets; },
    checkpoint: { version: "motion-comic-storyboard/v3", outcome: { story, planner: { id: "local-fixture", provenance: "local storage transport, not creative approval" }, critique: { accepted: true, score: 1, iterations: 1, issues: [] } } },
    async duration(path: string) {
      current.probes.push(path); current.events.push(`probe:${basename(path)}`);
      if (basename(path) !== "final.mp4") return 1.7;
      if (current.probeFailure) throw current.probeFailure;
      return current.nativeProbe ? current.nativeProbe(path) : current.finalDuration;
    },
    async normalize(input: string, output: string) {
      current.events.push("normalize");
      if (current.normalizeFailure) throw new Error("local normalization transport failure");
      await copyFile(input, output);
    },
    async upload(key: string, path: string) {
      const bytes = await readFile(path);
      current.uploads.push({ key, path, sha256: createHash("sha256").update(bytes).digest("hex") });
      current.events.push(`upload:${basename(path)}`);
    },
    execFile(...args: unknown[]) {
      const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
      queueMicrotask(() => callback(null, "", "lavfi.signalstats.YAVG=128"));
    },
    spawn(command: string, args: string[]) {
      current.commands.push([command, ...args]);
      assert.ok(command === "ffmpeg" || command === "python3", `unexpected process ${command}`);
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
      queueMicrotask(async () => {
        try {
          if (command === "python3") {
            assert.equal(args[0], join("scripts", "mc_page_render.py"));
            await materialize(args[3]);
            await writeFile(join(current.root, "motion_comic_review_timeline.json"), JSON.stringify({ version: "motion-comic-review/v1", bubbles: [] }));
          } else {
            await materialize(args.at(-1)!);
          }
          current.events.push(`process:${command}:${basename(args.at(-1)!)}`);
          child.emit("close", 0);
        } catch (error) { child.emit("error", error); }
      });
      return child;
    },
  };
  const previous = (globalThis as FixtureGlobal)[stateKey];
  (globalThis as FixtureGlobal)[stateKey] = io;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
  const entry = compiledModule.exports as {
    castMotionComic(args: { brief: object; plan: MotionComicStoryboard; runDir: string; outPath: string; generateImage(): Promise<Buffer> }): Promise<MotionComicResult>;
    motionComicBlock: Block;
  };
  return {
    get evidence() { return current; },
    async run(root: string, options: Partial<Pick<Runtime, "finalDuration" | "probeFailure" | "normalizeFailure" | "mediaFile" | "nativeProbe">> = {}, throughBlock = false) {
      current = { root: resolve(root), finalDuration: 31.021995, commands: [], probes: [], assets: [], uploads: [], events: [], ...options };
      await mkdir(current.root, { recursive: true });
      // Cache hits prevent all voice/music network I/O. The unchanged cast
      // still constructs its timeline, runs its process boundaries and probes.
      for (let i = 0; i < 4; i++) await materialize(join(current.root, `line_${i}_0.mp3`));
      await materialize(join(current.root, "music.mp3"));
      const fetchBefore = globalThis.fetch;
      globalThis.fetch = async () => { throw new Error("duration fixture forbids every network request"); };
      try {
        const result = throughBlock
          ? await entry.motionComicBlock.run({
            ownerId: "duration-owner", channelId: "duration-channel", runId: "duration-run",
            keyPrefix: "owner/duration-owner/channel/duration-channel/", stageBudgetUsd: 100,
            params: { panels: 4 }, store: { topic: story.title, channelName: "Local duration fixture" }, log: () => {},
          } as unknown as StageContext)
          : await entry.castMotionComic({ brief: { topic: story.title, panels: 4, music: false }, plan: story, runDir: current.root, outPath: join(current.root, "final.mp4"), generateImage: async () => Buffer.from("local panel fixture") });
        return { result: result as unknown as Readonly<Record<string, unknown>>, evidence: current };
      } finally { globalThis.fetch = fetchBefore; }
    },
    dispose() { (globalThis as FixtureGlobal)[stateKey] = previous; },
  };
}
