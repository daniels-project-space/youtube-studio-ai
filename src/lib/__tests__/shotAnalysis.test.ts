import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import triggerConfig from "../../../trigger.config";
import {
  analyzeShotBoundaries,
  buildShotAnalysisInvocation,
  DEFAULT_SHOT_ANALYSIS_CONFIG,
  OPENCV_PYTHON_HEADLESS_VERSION,
  PYSCENEDETECT_HEADLESS_VERSION,
  SHOT_ANALYSIS_PYTHON,
  type ShotAnalysisReceipt,
} from "@/lib/shotAnalysis";

const SOURCE_HASH = "a".repeat(64);

function receipt(overrides: Partial<ShotAnalysisReceipt> = {}): ShotAnalysisReceipt {
  return {
    schemaVersion: "1.0.0",
    provider: "pyscenedetect",
    detector: "adaptive",
    versions: {
      scenedetectHeadless: PYSCENEDETECT_HEADLESS_VERSION,
      opencvPythonHeadless: OPENCV_PYTHON_HEADLESS_VERSION,
    },
    config: { ...DEFAULT_SHOT_ANALYSIS_CONFIG },
    source: { sha256: SOURCE_HASH, byteLength: 4096 },
    scenes: [{ startFrame: 0, endFrameExclusive: 120, startSec: 0, endSecExclusive: 5 }],
    ...overrides,
  };
}

async function sceneAnalysisBuildLayers(target: "deploy" | "dev") {
  const config = triggerConfig as unknown as {
    build?: { extensions?: Array<{ name: string; onBuildComplete?: (context: unknown, manifest: unknown) => Promise<void> | void }> };
  };
  const extension = config.build?.extensions?.find((candidate) => candidate.name === "pinned-qa-scene-analysis");
  assert(extension?.onBuildComplete, "Trigger config must include the pinned QA scene-analysis build extension");

  const layers: Array<{ id: string; image?: { instructions?: string[] } }> = [];
  await extension.onBuildComplete({
    target,
    workingDir: process.cwd(),
    logger: { debug() {}, log() {}, warn() {}, progress() {}, spinner() { return { message() {}, stop() {} }; } },
    addLayer(layer: { id: string; image?: { instructions?: string[] } }) { layers.push(layer); },
    registerPlugin() {},
    resolvePath: async () => undefined,
    config: {},
  }, {});
  return layers;
}

async function main(): Promise<void> {
  const invocation = buildShotAnalysisInvocation({
    videoPath: "/tmp/final-master.mp4",
    sourceSha256: SOURCE_HASH,
  });
  assert.equal(invocation.command, SHOT_ANALYSIS_PYTHON);
  assert.deepEqual(invocation.config, DEFAULT_SHOT_ANALYSIS_CONFIG);
  assert.match(invocation.args.join(" "), /scripts\/shot_analysis\.py/);
  assert.doesNotMatch(
    invocation.args.join(" "),
    /\b(?:pip3?|install|ensurePyDeps)\b/i,
    "runtime analysis must call only the baked executable, never a lazy installer",
  );

  let observedCommand = "";
  let observedArgs: readonly string[] = [];
  const analyzed = analyzeShotBoundaries({
    videoPath: "/tmp/final-master.mp4",
    sourceSha256: SOURCE_HASH,
    runner(command, args) {
      observedCommand = command;
      observedArgs = args;
      return { status: 0, stdout: JSON.stringify(receipt()), stderr: "" };
    },
  });
  assert.equal(observedCommand, SHOT_ANALYSIS_PYTHON);
  assert.doesNotMatch(observedArgs.join(" "), /\b(?:pip3?|install|ensurePyDeps)\b/i);
  assert.equal(analyzed.versions.scenedetectHeadless, PYSCENEDETECT_HEADLESS_VERSION);
  assert.equal(analyzed.source.sha256, SOURCE_HASH, "the receipt must bind the exact final-master bytes");

  assert.throws(
    () => analyzeShotBoundaries({
      videoPath: "/tmp/final-master.mp4",
      sourceSha256: SOURCE_HASH,
      runner: () => ({ status: 1, stdout: "", stderr: "No module named scenedetect" }),
    }),
    /runtime pip fallback is forbidden/i,
    "unavailable production dependencies must fail closed instead of attempting a task-time install",
  );
  assert.throws(
    () => analyzeShotBoundaries({
      videoPath: "/tmp/final-master.mp4",
      sourceSha256: SOURCE_HASH,
      runner: () => ({ status: 0, stdout: JSON.stringify(receipt({ source: { sha256: "b".repeat(64), byteLength: 4096 } })), stderr: "" }),
    }),
    /source SHA-256/i,
    "a receipt for different bytes must be rejected",
  );
  assert.throws(
    () => analyzeShotBoundaries({
      videoPath: "/tmp/final-master.mp4",
      sourceSha256: SOURCE_HASH,
      config: { adaptiveThreshold: 4 },
      runner: () => ({ status: 0, stdout: JSON.stringify(receipt()), stderr: "" }),
    }),
    /configuration/i,
    "a receipt must record the exact detector settings that generated it",
  );

  const deployLayers = await sceneAnalysisBuildLayers("deploy");
  assert.equal(deployLayers.length, 1, "deploy builds must materialize the scene-analysis base-image layer");
  assert.deepEqual(await sceneAnalysisBuildLayers("dev"), [], "local dev must not pretend the production runtime is available");
  const layer = deployLayers[0]!;
  assert.equal(layer.id, "pinned-qa-scene-analysis");
  const instructions = layer.image?.instructions?.join("\n") ?? "";
  assert.match(instructions, /python3 python3-pip python3-venv/);
  assert.match(instructions, /--require-hashes/);
  assert.match(instructions, /--only-binary=:all:/);
  assert.match(instructions, new RegExp(`scenedetect-headless'.*${PYSCENEDETECT_HEADLESS_VERSION}`));
  assert.match(instructions, new RegExp(`opencv-python-headless'.*${OPENCV_PYTHON_HEADLESS_VERSION}`));
  assert.match(instructions, /ENV PATH=\/opt\/youtube-studio-qa-scene-analysis\/bin:\$PATH/);

  const runtimeAdapter = readFileSync(resolve(process.cwd(), "src/lib/shotAnalysis.ts"), "utf8");
  const runtimeScript = readFileSync(resolve(process.cwd(), "scripts/shot_analysis.py"), "utf8");
  assert.doesNotMatch(runtimeAdapter, /\b(?:pip3?)\s+install\b/i);
  assert.doesNotMatch(runtimeScript, /\b(?:pip3?)\s+install\b/i);
  assert.doesNotMatch(runtimeAdapter, /ensurePyDeps/);
  assert.doesNotMatch(runtimeScript, /ensurePyDeps/);

  const lock = readFileSync(resolve(process.cwd(), "requirements/qa-scene-analysis.txt"), "utf8");
  const encodedLock = instructions.match(/Buffer\.from\(\\?"([A-Za-z0-9+/=]+)\\?", \\?"base64\\?"\)/)?.[1];
  assert(encodedLock, "the production build layer must embed the fully hashed lock before application files are copied");
  assert.equal(Buffer.from(encodedLock, "base64").toString("utf8"), lock, "the build layer must install the exact committed lock");
  assert.match(lock, new RegExp(`scenedetect-headless==${PYSCENEDETECT_HEADLESS_VERSION}`));
  assert.match(lock, new RegExp(`opencv-python-headless==${OPENCV_PYTHON_HEADLESS_VERSION}`));
  console.log("shot analysis test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
