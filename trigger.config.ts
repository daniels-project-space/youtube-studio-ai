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
 *  - STUDIO_CONVEX_JWT_PRIVATE_KEY — signs short-lived, owner-scoped Convex
 *    service identities for durable workers (ES256 PKCS#8 PEM),
 *  - GEMINI_API_KEY         — direct Nano Banana + Gemini runtime credential;
 *  - FAL_KEY                 — fal.ai credential for explicitly enabled
 *    Visual Matter Nano Banana 2 reference-image packs (never forwarded to Vercel),
 *  - FAL_NANO_BANANA_2_COST_USD — operator-reviewed per-image ledger rate;
 *    vault bootstrap remains the credential fallback when FAL_KEY is absent at deploy,
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
  "NOVITA_MODEL_MANIFEST_KEY",
  "NOVITA_MODEL_MANIFEST_SHA256",
  "NOVITA_RENDER_MAX_JOB_USD",
  "NOVITA_RENDER_MAX_FLEET_USD",
  "GEMINI_API_KEY",
  "FAL_KEY",
  "FAL_NANO_BANANA_2_COST_USD",
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
          "scripts/mc_page_render.py",
          "scripts/mc_textplace.py",
          "scripts/mc_font.py",
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
