/**
 * SECRET / API-KEY REGISTRY — the single source of truth for WHAT external keys
 * the pipeline uses, WHAT each unlocks, WHO reads it, and HOW to access/store it.
 *
 * This holds NO secret values — only names, purpose and provenance. Values live
 * in the vaults (below). The Mastra orchestrator reads this so it KNOWS what it
 * needs before running a module, can tell the operator which key is missing, and
 * knows where every key is stored + how it's hydrated at runtime.
 *
 * THE VAULTS (where the VALUES live), in order of authority:
 *   1. Trigger.dev PROD env  — the RUNTIME vault the deployed pipeline reads.
 *        read/write: `GET|POST https://api.trigger.dev/api/v1/projects/$TRIGGER_PROJECT_REF/envvars/prod`
 *        with the PAT at /root/.config/trigger/config.json (on the VPS).
 *   2. Convex env (dev:astute-camel-689) — BACKUP. `npx convex env set|list` (VPS is authed).
 *   3. .env.local (local dev + VPS checkout) — for local/VPS script runs (gitignored).
 * A key is "available" to a process when it is in that process's env (process.env).
 */

export type KeyTier = "core" | "feature" | "optional" | "infra";

export interface KeySpec {
  /** The process.env variable name. */
  name: string;
  /** What this key unlocks — one line. */
  purpose: string;
  /** Modules/files that read it. */
  usedBy: readonly string[];
  /** core = pipeline is dead without it; feature = one capability degrades;
   *  optional = nice-to-have; infra = platform plumbing. */
  tier: KeyTier;
  /** Provider + where to obtain a key. */
  obtain: string;
  /** Free-form runtime notes (fallbacks, aliases). */
  notes?: string;
}

/** Every external key the pipeline reads (values NOT here — see THE VAULTS). */
export const KEY_REGISTRY: readonly KeySpec[] = [
  // ---- core: the pipeline cannot produce a video without these ----
  { name: "GEMINI_API_KEY", purpose: "Gemini LLM (planning, scripts, vision QA) + Banana image generation", usedBy: ["lib/gemini.ts", "lib/banana.ts", "all planners"], tier: "core", obtain: "aistudio.google.com → API key", notes: "GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_API_KEY are accepted aliases by the Google SDK." },
  { name: "FAL_KEY", purpose: "fal.ai — image cutout, depth maps, image-to-video", usedBy: ["lib/falImage.ts", "lib/documotion.ts", "lib/depth.ts"], tier: "core", obtain: "fal.ai/dashboard/keys" },
  { name: "TRIGGER_SECRET_KEY", purpose: "Trigger.dev runtime auth (task orchestration)", usedBy: ["trigger.config.ts", "src/trigger/**"], tier: "infra", obtain: "Trigger.dev dashboard → project → API keys", notes: "Local .env.local holds the DEV key; prod uses the vault." },

  // ---- feature: narration ----
  { name: "ELEVENLABS_API_KEY", purpose: "ElevenLabs v3 narration TTS (expressive, documentary-grade)", usedBy: ["lib/tts.ts"], tier: "feature", obtain: "elevenlabs.io → profile → API key", notes: "Preferred narration provider (synthNarration provider:'elevenlabs'). DOCU_ELEVEN_VOICE_ID overrides the default George voice." },
  { name: "FISH_AUDIO_API_KEY", purpose: "Fish Audio TTS — fallback narration when ElevenLabs absent", usedBy: ["lib/tts.ts"], tier: "feature", obtain: "fish.audio → API", notes: "synthNarration default provider; cheaper, less expressive." },

  // ---- feature: music ----
  { name: "SUNO_API_KEY", purpose: "Suno music generation (instrumental beds/underscore)", usedBy: ["lib/music.ts"], tier: "feature", obtain: "sunoapi.org → API key; credits: GET /api/v1/generate/credit", notes: "generateMusic falls back mureka↔suno automatically; either key enables music." },
  { name: "MUREKA_API_KEY", purpose: "Mureka music generation — alternate/primary music provider", usedBy: ["lib/music.ts"], tier: "feature", obtain: "mureka.ai → API", notes: "Paired with SUNO via the generateMusic provider fallback." },

  // ---- feature: stock footage ----
  { name: "PEXELS_API_KEY", purpose: "Pexels 4K stock video", usedBy: ["lib/footagecraft.ts"], tier: "feature", obtain: "pexels.com/api" },
  { name: "PIXABAY_API_KEY", purpose: "Pixabay stock video", usedBy: ["lib/footagecraft.ts"], tier: "feature", obtain: "pixabay.com/api/docs" },
  { name: "VIDEVO_API_KEY", purpose: "Videvo stock video", usedBy: ["lib/footagecraft.ts"], tier: "optional", obtain: "videvo.net API" },

  // ---- feature: cinematic / advanced video ----
  { name: "HIGGSFIELD_CREDENTIALS_JSON", purpose: "Higgsfield (soul/i2v) — cinematic shot engine", usedBy: ["lib/cinecraft.ts", "lib/higgsfield.ts"], tier: "feature", obtain: "higgsfield.ai account → credentials", notes: "ACCESS_TOKEN/REFRESH_TOKEN are the unpacked form; CREDENTIALS_JSON is the bundle used in prod." },
  { name: "REPLICATE_API_TOKEN", purpose: "Replicate model host (alt image/video/upscale)", usedBy: ["lib/replicate.ts"], tier: "optional", obtain: "replicate.com/account" },
  { name: "ASSEMBLYAI_API_KEY", purpose: "Transcription + forced word-alignment (whiteboard sync captions)", usedBy: ["lib/whiteboardSync.ts", "lib/transcribe.ts"], tier: "feature", obtain: "assemblyai.com" },

  // ---- feature: publishing + distribution ----
  { name: "YOUTUBE_DATA_API_KEY", purpose: "YouTube Data API — competitor/title research", usedBy: ["lib/youtube.ts", "lib/metacraft.ts"], tier: "feature", obtain: "Google Cloud console → YouTube Data API v3" },
  { name: "YOUTUBE_REFRESH_TOKEN", purpose: "OAuth refresh token — upload drafts + set thumbnails/metadata", usedBy: ["lib/youtube.ts"], tier: "feature", obtain: "OAuth consent flow (offline access)" },
  { name: "AYRSHARE_API_KEY", purpose: "Ayrshare — cross-post to social platforms", usedBy: ["lib/social.ts"], tier: "optional", obtain: "ayrshare.com" },

  // ---- feature: research / browsing ----
  { name: "BROWSERBASE_API_KEY", purpose: "Browserbase headless browser (research, scraping)", usedBy: ["lib/browserbase.ts"], tier: "optional", obtain: "browserbase.com", notes: "Needs BROWSERBASE_PROJECT_ID (+ optional CONTEXT_ID) alongside." },

  // ---- optional: observability + ops ----
  { name: "LANGFUSE_SECRET_KEY", purpose: "Langfuse LLM tracing (secret half)", usedBy: ["lib/observability.ts"], tier: "optional", obtain: "cloud.langfuse.com", notes: "Pairs with LANGFUSE_PUBLIC_KEY." },
  { name: "LANGFUSE_PUBLIC_KEY", purpose: "Langfuse LLM tracing (public half)", usedBy: ["lib/observability.ts"], tier: "optional", obtain: "cloud.langfuse.com" },
  { name: "TELEGRAM_BOT_TOKEN", purpose: "Telegram run notifications", usedBy: ["src/trigger/**"], tier: "optional", obtain: "@BotFather" },
] as const;

export interface KeyStatus extends KeySpec {
  present: boolean;
}

/** Runtime check: which keys are present in THIS process's env. */
export function keyStatus(): KeyStatus[] {
  return KEY_REGISTRY.map((k) => ({ ...k, present: Boolean(process.env[k.name]?.trim()) }));
}

/** Keys a module needs but that are absent from process.env (gates a clean preflight). */
export function missingForModules(moduleFiles: readonly string[]): KeySpec[] {
  const wants = (k: KeySpec) => k.usedBy.some((u) => moduleFiles.some((m) => u.includes(m) || m.includes(u)));
  return KEY_REGISTRY.filter((k) => wants(k) && !process.env[k.name]?.trim());
}

/** Markdown the orchestrator (or a human) can read: what every key is + presence. */
export function secretsManifest(): string {
  const rows = keyStatus()
    .map((k) => `| ${k.present ? "✅" : "❌"} | \`${k.name}\` | ${k.tier} | ${k.purpose} | ${k.obtain} |`)
    .join("\n");
  return [
    "# API-key registry (values live in the vaults, not here)",
    "",
    "| present | name | tier | purpose | obtain |",
    "|---|---|---|---|---|",
    rows,
    "",
    "Vaults: Trigger.dev prod env (runtime) · Convex env (backup) · .env.local (local/VPS).",
  ].join("\n");
}

/** Mastra tool: the orchestrator calls this to learn which keys exist, what each
 *  unlocks, and what is MISSING — so it knows what to get and how to access it. */
export async function secretsStatusTool() {
  const { createTool } = await import("@mastra/core/tools");
  const { z } = await import("zod");
  return createTool({
    id: "secrets_status",
    description:
      "Inspect the API-key registry: which external keys are present in this environment, what each one unlocks, " +
      "which modules need them, and how to obtain/store a missing one. Call before running a module to verify its keys.",
    inputSchema: z.object({
      moduleFiles: z.array(z.string()).optional().describe("Optional module file hints to report only the keys those modules need."),
    }),
    outputSchema: z.object({
      keys: z.array(z.object({ name: z.string(), present: z.boolean(), tier: z.string(), purpose: z.string(), obtain: z.string() })),
      missing: z.array(z.string()),
      manifest: z.string(),
    }),
    execute: async (input: { moduleFiles?: string[] }) => {
      const status = keyStatus();
      const missing = (input?.moduleFiles?.length ? missingForModules(input.moduleFiles) : status.filter((k) => !k.present && k.tier !== "optional")).map((k) => k.name);
      return {
        keys: status.map((k) => ({ name: k.name, present: k.present, tier: k.tier, purpose: k.purpose, obtain: k.obtain })),
        missing,
        manifest: secretsManifest(),
      };
    },
  });
}
