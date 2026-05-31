/**
 * Runtime secret bootstrap. Hydrates process.env from the centralized vault for
 * every service the lofi pipeline needs, then arms the Higgsfield live gate.
 *
 * Idempotent: hydrateEnv only sets keys not already present, so an explicit
 * .env.local (or Trigger-deployed env var) always wins. No secret is ever
 * logged — only the count + key NAMES that were loaded.
 */
import { hydrateEnv } from "@/lib/vault";

const SERVICES = [
  "cloudflare", // R2_*
  "youtube", // YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN
  "mureka", // MUREKA_API_KEY
  "suno", // SUNO_API_KEY
  "replicate", // REPLICATE_API_TOKEN
  "telegram", // TELEGRAM_BOT_TOKEN (+ admin chat id)
];

let done = false;

/** Hydrate vault secrets once per process. Returns loaded key names. */
export async function bootstrapSecrets(
  log: (msg: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<string[]> {
  if (done) return [];
  const loaded: string[] = [];
  for (const svc of SERVICES) {
    try {
      const keys = await hydrateEnv(svc);
      loaded.push(...keys);
    } catch (e) {
      log(`bootstrap: vault hydrate ${svc} failed (continuing): ${e instanceof Error ? e.message : e}`);
    }
  }
  // Default telegram chat to the admin chat id if not explicitly set.
  if (!process.env.TELEGRAM_CHAT_ID && process.env.TELEGRAM_ADMIN_CHAT_ID) {
    process.env.TELEGRAM_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
  }
  // Arm the Higgsfield CLI live gate (the CLI session is already authed on host).
  if (!process.env.HIGGSFIELD_LIVE) process.env.HIGGSFIELD_LIVE = "1";
  done = true;
  log(`bootstrap: hydrated ${loaded.length} keys`, { keys: loaded });
  return loaded;
}
