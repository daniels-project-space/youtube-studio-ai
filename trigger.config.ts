import { defineConfig } from "@trigger.dev/sdk";
import {
  ffmpeg,
  additionalPackages,
  additionalFiles,
  aptGet,
  syncEnvVars,
} from "@trigger.dev/build/extensions/core";

/**
 * Operator switches forwarded from the DEPLOY machine's env into the Trigger
 * project at deploy time (no dashboard clicking):
 *  - INTERNAL_QUERY_SECRET  — gates the youtubeAuth.getForChannel Convex query
 *    (must match the Convex deployment's env var of the same name),
 *  - IMAGE_DISABLE_GEMINI   — 1 → all image gen routes to fal FLUX (zero
 *    Google image spend; banana stays the default when unset),
 *  - VISION_DISABLE_GEMINI  — 1 → vision router never falls back to Gemini,
 *  - GROQ_API_KEY           — frees the vision chain's free tier when present.
 */
const FORWARDED_ENV = [
  "INTERNAL_QUERY_SECRET",
  "IMAGE_DISABLE_GEMINI",
  "VISION_DISABLE_GEMINI",
  "GROQ_API_KEY",
  "VAULT_ACCESS_TOKEN",
];

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
      "@ai-sdk/anthropic",
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
          "@remotion/noise@4.0.471",
          "@remotion/motion-blur@4.0.471",
          "@remotion/google-fonts@4.0.471",
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
          "scripts/mc_page_render.py",
          "scripts/mc_textplace.py",
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
    ],
  },
  maxDuration: 7200, // 2h ceiling; long-form (15-35 min) renders re-encode a lot.
});
