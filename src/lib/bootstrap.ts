/**
 * Runtime secret bootstrap. Hydrates process.env from the centralized vault for
 * every service the production pipeline needs.
 *
 * Idempotent: hydrateEnv only sets keys not already present, so an explicit
 * .env.local (or Trigger-deployed env var) always wins. No secret is ever
 * logged — only the count + key NAMES that were loaded.
 */
import { hydrateEnv } from "@/lib/vault";

const SERVICES = [
  "cloudflare", // R2_*
  "novita", // Novita render bridge + local persistent-disk Z-Image/LTX fleet
  "youtube", // YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN (+ YOUTUBE_DATA_API_KEY)
  "mureka", // MUREKA_API_KEY
  "suno", // SUNO_API_KEY
  "fish-audio", // FISH_AUDIO_API_KEY (narration_tts)
  "elevenlabs", // ELEVENLABS_API_KEY (narration_tts v3 expressive tier; Trigger env var holds the CURRENT key — vault entry may be stale, env wins)
  "pexels", // PEXELS_API_KEY (stock_footage — always-on baseline)
  "pixabay", // PIXABAY_API_KEY (federated stock — free, self-serve)
  "videvo", // VIDEVO_API_KEY (federated stock — partner; VIDEVO_API_BASE overridable)
  "replicate", // REPLICATE_API_TOKEN
  "fal", // FAL_KEY (FLUX1.1 [pro] thumbnail base via fal.ai)
  "groq", // Legacy only; YouTube intelligence and vision are pinned through OpenRouter.
  "openrouter", // OPENROUTER_API_KEY (non-Google pinned text + vision fleet)
  "telegram", // TELEGRAM_BOT_TOKEN (+ admin chat id)
  "browserbase", // BROWSERBASE_API_KEY/PROJECT_ID (+ optional CONTEXT_ID) — headless YouTube channel creation
  // Gemini is deliberately absent. Its credential is hydrated only by the
  // sealed Nano Banana thumbnail adapter after it presents its opaque runtime
  // capability. Loading it into every worker would let legacy/operator code
  // make direct Google calls outside that one admitted module.
  "google", // GOOGLE_* (places / app credentials)
  "langfuse", // LANGFUSE_PUBLIC_KEY/SECRET_KEY (Mastra agent tracing; optional)
  "assemblyai", // ASSEMBLYAI_API_KEY (captions SRT; optional — chapters work without)
  "ayrshare", // AYRSHARE_API_KEY (Phase 8 cross-post; optional)
] as const;

// Provider-specific workers can request only their own vault service. Salad is
// opt-in here so unrelated jobs never acquire its infrastructure credential.
type BootstrapService = (typeof SERVICES)[number] | "salad";
const hydratedServices = new Set<BootstrapService>();
const pendingServices = new Map<BootstrapService, Promise<string[]>>();

async function hydrateService(service: BootstrapService): Promise<string[]> {
  if (hydratedServices.has(service)) return [];
  const pending = pendingServices.get(service);
  if (pending) return pending;
  const request = hydrateEnv(service).then((keys) => {
    hydratedServices.add(service);
    return keys;
  });
  pendingServices.set(service, request);
  try {
    return await request;
  } finally {
    pendingServices.delete(service);
  }
}

/** Throw when quality-critical keys are absent after hydration. */
function requireKeys(keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `bootstrap: CRITICAL keys missing after vault hydration: ${missing.join(", ")} — ` +
        `refusing to run in silent-degrade mode (every downstream block would fall back to generic output). ` +
        `Check the vault services + network, then re-run.`,
    );
  }
}

/**
 * Hydrate each successful vault service once per process. Concurrent calls
 * share in-flight reads; failed reads are retried on the next invocation.
 * Returns loaded key names. Default order preserves existing alias precedence.
 * `opts.required` — env keys that MUST be present afterwards; missing → throw
 * (the alternative is a full run of silent generic fallbacks).
 * `opts.services` — opt into a narrow service set instead of the general worker
 * bootstrap. Gemini remains excluded; its sealed adapter is the only entry.
 */
export async function bootstrapSecrets(
  log: (msg: string, extra?: Record<string, unknown>) => void = () => {},
  opts?: { required?: string[]; services?: BootstrapService[] },
): Promise<string[]> {
  const loaded: string[] = [];
  const services = opts?.services ?? SERVICES;
  // Runtime callers must not bypass the sealed Gemini boundary by casting
  // arbitrary strings into the type-level allowlist. Validate before any read.
  if (services.some((svc) => svc !== "salad" && !(SERVICES as readonly string[]).includes(svc))) {
    throw new Error("bootstrap: unsupported vault service");
  }
  for (const svc of new Set(services)) {
    try {
      const keys = await hydrateService(svc);
      loaded.push(...keys);
    } catch {
      // Provider error bodies may contain credential values; never echo them.
      log(`bootstrap: vault hydrate ${svc} failed (continuing; retryable)`);
    }
  }
  // Default telegram chat to the admin chat id if not explicitly set.
  if (!process.env.TELEGRAM_CHAT_ID && process.env.TELEGRAM_ADMIN_CHAT_ID) {
    process.env.TELEGRAM_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
  }
  // Never promote the thumbnail-only Gemini credential to general Google SDK
  // variables. Non-thumbnail model routes must declare and use their own
  // provider credentials; otherwise a future SDK import could silently bypass
  // the sealed-thumbnail admission boundary.
  if (loaded.length) log(`bootstrap: hydrated ${loaded.length} keys`, { keys: loaded });
  if (opts?.required) requireKeys(opts.required);
  return loaded;
}
