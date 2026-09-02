import { defineConfig } from "@trigger.dev/sdk";
import type { BuildExtension } from "@trigger.dev/build/extensions";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ffmpeg,
  additionalPackages,
  additionalFiles,
  aptGet,
  syncEnvVars,
} from "@trigger.dev/build/extensions/core";

/**
 * PySceneDetect must be present before a task begins.  Unlike the legacy drawn
 * renderers, scene analysis has no task-time pip/bootstrap path: the exact
 * lock is injected into the base image, installed in a dedicated virtualenv,
 * and import-checked during the Trigger image build.
 *
 * `image.instructions` deliberately does this in Trigger's `base` stage. A
 * `BuildLayer.commands` pip install would run in its throw-away `build` stage
 * and would not be available to the final worker image.
 */
const QA_SCENE_ANALYSIS_LOCKFILE = "requirements/qa-scene-analysis.txt";
const QA_SCENE_ANALYSIS_VENV = "/opt/youtube-studio-qa-scene-analysis";
const PYSCENEDETECT_HEADLESS_VERSION = "0.7.1";
const OPENCV_PYTHON_HEADLESS_VERSION = "4.12.0.88";
const QA_NARRATION_PROOF_LOCKFILE = "requirements/qa-narration-proof.txt";
const QA_NARRATION_PROOF_VENV = "/opt/youtube-studio-qa-narration-proof";
const QA_NARRATION_PROOF_MODEL_DIR = `${QA_NARRATION_PROOF_VENV}/model`;
const FASTER_WHISPER_VERSION = "1.2.1";
const FASTER_WHISPER_SMALL_EN_REPOSITORY = "Systran/faster-whisper-small.en";
const FASTER_WHISPER_SMALL_EN_REVISION = "d1d751a5f8271d482d14ca55d9e2deeebbae577f";

function pinnedQaSceneAnalysis(): BuildExtension {
  return {
    name: "pinned-qa-scene-analysis",
    onBuildComplete(context) {
      if (context.target === "dev") return;

      // Trigger inserts image.instructions before its normal package-install
      // stage, so encode the locked requirements into the base image instead
      // of depending on a copied application file being available there.
      const lockBase64 = readFileSync(resolve(context.workingDir, QA_SCENE_ANALYSIS_LOCKFILE)).toString("base64");
      const writeLockProgram = [
        'const fs = require("node:fs");',
        `fs.writeFileSync("/tmp/qa-scene-analysis.txt", Buffer.from("${lockBase64}", "base64"));`,
      ].join(" ");
      const versionCheck = [
        "from importlib.metadata import version",
        "import cv2, scenedetect",
        `assert version('scenedetect-headless') == '${PYSCENEDETECT_HEADLESS_VERSION}'`,
        `assert version('opencv-python-headless') == '${OPENCV_PYTHON_HEADLESS_VERSION}'`,
      ].join("; ");

      context.addLayer({
        id: "pinned-qa-scene-analysis",
        image: {
          instructions: [
            "RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv && apt-get clean && rm -rf /var/lib/apt/lists/*",
            `RUN node -e ${JSON.stringify(writeLockProgram)}`,
            `RUN python3 -m venv ${QA_SCENE_ANALYSIS_VENV}`,
            `RUN ${QA_SCENE_ANALYSIS_VENV}/bin/python -m pip install --no-cache-dir --disable-pip-version-check --require-hashes --only-binary=:all: -r /tmp/qa-scene-analysis.txt && ${QA_SCENE_ANALYSIS_VENV}/bin/python -m pip check`,
            `RUN ${QA_SCENE_ANALYSIS_VENV}/bin/python -c ${JSON.stringify(versionCheck)}`,
            `ENV PATH=${QA_SCENE_ANALYSIS_VENV}/bin:$PATH`,
          ],
        },
      });
    },
  };
}

/**
 * Final-narration proof runs entirely in the worker: faster-whisper and its
 * English model are both hash/revision-pinned during image construction.  A
 * production task therefore has no model-download, API, or best-effort
 * fallback path when it verifies that a synthesized voice actually delivered
 * the approved narration.
 */
function pinnedQaNarrationProof(): BuildExtension {
  return {
    name: "pinned-qa-narration-proof",
    onBuildComplete(context) {
      if (context.target === "dev") return;
      const lockBase64 = readFileSync(resolve(context.workingDir, QA_NARRATION_PROOF_LOCKFILE)).toString("base64");
      const writeLockProgram = [
        'const fs = require("node:fs");',
        `fs.writeFileSync("/tmp/qa-narration-proof.txt", Buffer.from("${lockBase64}", "base64"));`,
      ].join(" ");
      const packageCheck = [
        "from importlib.metadata import version",
        "from faster_whisper import WhisperModel",
        `assert version('faster-whisper') == '${FASTER_WHISPER_VERSION}'`,
        `WhisperModel('${QA_NARRATION_PROOF_MODEL_DIR}', device='cpu', compute_type='int8')`,
      ].join("; ");
      const downloadModel = [
        "from huggingface_hub import snapshot_download",
        `snapshot_download(repo_id='${FASTER_WHISPER_SMALL_EN_REPOSITORY}', revision='${FASTER_WHISPER_SMALL_EN_REVISION}', local_dir='${QA_NARRATION_PROOF_MODEL_DIR}', allow_patterns=['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.*'])`,
      ].join("; ");
      context.addLayer({
        id: "pinned-qa-narration-proof",
        image: {
          instructions: [
            "RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv libgomp1 && apt-get clean && rm -rf /var/lib/apt/lists/*",
            `RUN node -e ${JSON.stringify(writeLockProgram)}`,
            `RUN python3 -m venv ${QA_NARRATION_PROOF_VENV}`,
            `RUN ${QA_NARRATION_PROOF_VENV}/bin/python -m pip install --no-cache-dir --disable-pip-version-check --require-hashes --only-binary=:all: -r /tmp/qa-narration-proof.txt && ${QA_NARRATION_PROOF_VENV}/bin/python -m pip check`,
            `RUN ${QA_NARRATION_PROOF_VENV}/bin/python -c ${JSON.stringify(downloadModel)}`,
            `RUN ${QA_NARRATION_PROOF_VENV}/bin/python -c ${JSON.stringify(packageCheck)}`,
            `ENV PATH=${QA_NARRATION_PROOF_VENV}/bin:$PATH`,
          ],
        },
      });
    },
  };
}

/**
 * Operator switches forwarded from the DEPLOY machine's env into the Trigger
 * project at deploy time (no dashboard clicking):
 *  - INTERNAL_QUERY_SECRET  — gates the youtubeAuth.getForChannel Convex query
 *    (must match the Convex deployment's env var of the same name),
 *  - STUDIO_CONVEX_JWT_PRIVATE_KEY — signs short-lived, owner-scoped Convex
 *    service identities for durable workers (ES256 PKCS#8 PEM),
 *  - GEMINI_API_KEY         — direct Nano Banana + Gemini runtime credential;
 *  - FAL_KEY                 — fal.ai credential for the remaining explicitly
 *    admitted legacy/thumbnail support routes (never forwarded to Vercel);
 *    vault bootstrap remains the credential fallback when it is absent at deploy,
 *  - IMAGE_DISABLE_GEMINI   — 1 → generic non-thumbnail still-image routes use
 *    fal FLUX; strict thumbnail generation deliberately ignores this switch,
 *  - VISION_DISABLE_GEMINI  — 1 → vision router never falls back to Gemini,
 *  - GROQ_API_KEY           — frees the vision chain's free tier when present.
 *  - STUDIO_AUTOPILOT / STUDIO_INSIGHTS_AUTOMATION — the fail-closed scheduled
 *    automation gates (src/lib/automationGate.ts). Only the exact value "on"
 *    enables a schedule. These MUST be forwarded: without them the gate reads
 *    `undefined` inside the Trigger runtime, so scheduled automation stays off
 *    in the cloud no matter what the operator configured. Forwarding is inert
 *    until the deploy machine actually sets them (syncEnvVars skips unset vars).
 *  - VAULT_URL              — override for the project-hub vault base URL used
 *    by bootstrapSecrets (src/lib/vault.ts). Its partner VAULT_ACCESS_TOKEN was
 *    already forwarded; without VAULT_URL a relocated vault silently keeps
 *    resolving to the hardcoded default inside workers.
 */
const FORWARDED_ENV = [
  "INTERNAL_QUERY_SECRET",
  "STUDIO_CONVEX_JWT_PRIVATE_KEY",
  "STUDIO_INTERNAL_API_TOKEN",
  "STUDIO_OWNER_ID",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_TOKEN_ENCRYPTION_KEY",
  "YOUTUBE_OAUTH_STATE_SECRET",
  "YOUTUBE_ALLOW_LEGACY_PLAINTEXT_TOKENS",
  // Direct cloud-only Novita control plane. These are intentionally forwarded
  // to Trigger workers only; Vercel never receives the provider API key.
  "NOVITA_API_KEY",
  "NOVITA_RENDER_WORKER_IMAGE",
  "NOVITA_RENDER_IMAGE_AUTH_ID",
  "NOVITA_RENDER_4090_PRODUCT_ID",
  "NOVITA_VERIFIED_4090_GPU_QUOTA",
  "NOVITA_RUNTIME_BUNDLE_KEY",
  "NOVITA_RUNTIME_BUNDLE_SHA256",
  "NOVITA_LTX_WORKER_OVERLAY_SHA256",
  "NOVITA_MODEL_MANIFEST_KEY",
  "NOVITA_MODEL_MANIFEST_SHA256",
  "NOVITA_RENDER_MAX_JOB_USD",
  "NOVITA_RENDER_MAX_FLEET_USD",
  "GEMINI_API_KEY",
  "FAL_KEY",
  "IMAGE_DISABLE_GEMINI",
  "VISION_DISABLE_GEMINI",
  "GROQ_API_KEY",
  "VAULT_ACCESS_TOKEN",
  "VAULT_URL",
  "STUDIO_AUTOPILOT",
  "STUDIO_INSIGHTS_AUTOMATION",
];

const SECRET_FORWARDED_ENV = new Set([
  "INTERNAL_QUERY_SECRET",
  "STUDIO_CONVEX_JWT_PRIVATE_KEY",
  "STUDIO_INTERNAL_API_TOKEN",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_TOKEN_ENCRYPTION_KEY",
  "YOUTUBE_OAUTH_STATE_SECRET",
  "NOVITA_API_KEY",
  "NOVITA_RENDER_WORKER_IMAGE",
  "NOVITA_RENDER_IMAGE_AUTH_ID",
  "GEMINI_API_KEY",
  "FAL_KEY",
  "GROQ_API_KEY",
  "VAULT_ACCESS_TOKEN",
]);

/**
 * Trigger.dev config for YouTube Studio AI.
 *
 * - project ref is the app's OWN Trigger project (not shared platform-jobs).
 *   It can be overridden via TRIGGER_PROJECT_REF for portability; the default
 *   is the provisioned ref for daniels-project-space-be0b.
 * - ffmpeg build extension bakes ffmpeg into the task image so the future
 *   `assemble` / `qa_light` blocks can stream_loop + ffprobe without extra setup.
 * - @higgsfield/cli is baked into the image (its postinstall pulls the
 *   linux/amd64 binary). This is what frees keyframes/loop_clips from the
 *   hand-authed VPS: the CLI runs in the cloud task and authenticates from an
 *   injected credentials.json (see src/lib/bootstrap.ts) using your SUBSCRIPTION
 *   credits — not the separate, empty platform API-key pool.
 * - additionalFiles bakes the in-app Remotion composition (src/remotion/**) into
 *   the image so @remotion/bundler can read the entry at runtime and render the
 *   title card in-process (intro_card → renderTitleCard). The .tsx source must be
 *   present because bundle() compiles it on the fly; node_modules ships the heavy
 *   renderer + Chromium-download (ensureBrowser) deps.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_vorkjqmnnpkzoiqqgbuu",
  // Trigger.dev's unspecified default is Node 21.7.3, which predates the
  // stable global WebSocket. @browserbasehq/stagehand 4.x's CDP client uses
  // the native global WebSocket directly (no polyfill) and declares
  // engines.node >= 22.18.0 — on the default runtime it throws
  // "WebSocket is not defined" as soon as it opens a CDP connection.
  // node-24 clears that floor with margin.
  runtime: "node-24",
  dirs: ["./src/trigger"],
  build: {
    // Keep the Remotion stack OUT of the esbuild bundle. If bundled, esbuild
    // walks into @remotion/bundler → @rspack/core and copies the host-resolved
    // native binding (e.g. @rspack/binding-win32-x64-msvc on Windows) into the
    // image, which then fails `npm i` on the Linux builder (EBADPLATFORM).
    // External → Trigger installs them fresh in the Linux image, resolving the
    // correct platform binaries; remotionRender.ts imports them dynamically.
    external: [
      "@remotion/bundler",
      "@remotion/renderer",
      "remotion",
      // Mastra agent stack + AI SDK — large dep trees with their own native/ESM
      // quirks; install in-image instead of bundling (mirrors the Remotion fix).
      "@mastra/core",
      "@mastra/langfuse",
      "@mastra/observability",
      "ai",
      "@ai-sdk/google",
      // Browserbase + Stagehand (cloud-browser channel creation) — heavy dep tree
      // with playwright/puppeteer-core natives; install in-image, import dynamically.
      "@browserbasehq/stagehand",
      "playwright",
      "playwright-core",
      "puppeteer-core",
      // pino-pretty transport spawns a worker that requires the module from disk.
      "pino",
      "pino-pretty",
      // Remotion composition dep — bundling it host-side broke the runtime
      // webpack of src/remotion on workers ("@remotion/noise" unresolved →
      // EVERY intro/outro TitleCard silently degraded to no-card).
      "@remotion/noise",
    ],
    extensions: [
      syncEnvVars(() =>
        FORWARDED_ENV.filter((n) => process.env[n]).map((name) => ({
          name,
          value: process.env[name] as string,
          isSecret: SECRET_FORWARDED_ENV.has(name),
        })),
      ),
      ffmpeg(),
      additionalPackages({
        packages: [
          "@higgsfield/cli@0.1.40",
          // Runtime-webpack dep of src/remotion (additionalFiles ships the raw
          // .tsx; nothing in the ESBUILD bundle imports these, so listing them
          // in `external` did NOT put them in the image — every intro/outro
          // TitleCard died on "@remotion/noise unresolved". additionalPackages
          // force-installs them into /app/node_modules.
          "@remotion/noise@4.0.506",
          "@remotion/motion-blur@4.0.506",
          "@remotion/google-fonts@4.0.506",
        ],
      }),
      additionalFiles({
        files: [
          "src/remotion/**",
          "src/assets/**",
          "public/fonts/**",
          // Python renderers for the drawn engines (whiteboard_scribe +
          // motion_comic). The engines spawn them via `python3 scripts/…`
          // relative to process.cwd(); without baking them in, every cloud run
          // burned the full art+TTS budget and THEN died at the render step.
          // Their pip deps install lazily at first use (src/lib/pydeps.ts),
          // gated by a $0-spend preflight at the top of each engine.
          "scripts/wb_scribe_sync.py",
          "scripts/whisper_align.py",
          // Production source-narration fidelity proof. The model itself is
          // prewarmed in pinnedQaNarrationProof(); this is only its receipt
          // producer, never a task-time package/model download.
          "scripts/narration_transcript_proof.py",
          "scripts/mc_page_render.py",
          "scripts/mc_textplace.py",
          "scripts/mc_font.py",
          // Evidence-only final-master scene analysis. Its locked runtime is
          // installed into the worker's base image by pinnedQaSceneAnalysis()
          // below; this bakes only the executable receipt producer.
          "scripts/shot_analysis.py",
          "requirements/qa-scene-analysis.txt",
          "requirements/qa-narration-proof.txt",
        ],
      }),
      // Headless-Chromium system libraries (Remotion renderTitleCard). The image
      // ships chrome-headless-shell but not its shared libs — without these the
      // browser fails to launch (libnspr4.so / libnss3 missing). Remotion's
      // documented Debian set.
      aptGet({
        packages: [
          // Python for audiobox-aesthetics (qa audio scoring; pip installs the
          // package at first use per machine — see src/lib/audioQa.ts).
          "python3",
          "python3-pip",
          // Independent local OCR for exact on-screen-text evidence. QA calls
          // the system binary directly and fails closed if it is unavailable;
          // no vision model or Google service is used to infer readability.
          "tesseract-ocr",
          "tesseract-ocr-eng",
          // Comic-page renderer typography (mc_page_render/mc_textplace);
          // the repo also bakes the OTF under src/assets/fonts as a fallback.
          "fonts-comic-neue",
          "libnss3",
          "libnspr4",
          "libdbus-1-3",
          "libatk1.0-0",
          "libatk-bridge2.0-0",
          "libgbm1",
          "libasound2",
          "libxrandr2",
          "libxkbcommon0",
          "libxfixes3",
          "libxcomposite1",
          "libxdamage1",
          "libpango-1.0-0",
          "libcairo2",
          "libcups2",
          "libatspi2.0-0",
        ],
      }),
      pinnedQaSceneAnalysis(),
      pinnedQaNarrationProof(),
    ],
  },
  maxDuration: 7200, // 2h ceiling; long-form (15-35 min) renders re-encode a lot.
});
