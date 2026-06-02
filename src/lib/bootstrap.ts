/**
 * Runtime secret bootstrap. Hydrates process.env from the centralized vault for
 * every service the lofi pipeline needs, then arms the Higgsfield live gate.
 *
 * Idempotent: hydrateEnv only sets keys not already present, so an explicit
 * .env.local (or Trigger-deployed env var) always wins. No secret is ever
 * logged — only the count + key NAMES that were loaded.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hydrateEnv } from "@/lib/vault";

const SERVICES = [
  "cloudflare", // R2_*
  "youtube", // YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN (+ YOUTUBE_DATA_API_KEY)
  "mureka", // MUREKA_API_KEY
  "suno", // SUNO_API_KEY
  "replicate", // REPLICATE_API_TOKEN
  "telegram", // TELEGRAM_BOT_TOKEN (+ admin chat id)
  // Competitor-intelligence engine. hydrateEnv tolerates a missing service
  // (logs + continues), so these are safe even before the vault entries exist.
  "google", // GEMINI_API_KEY (Gemini 2.5 Flash + Vision)
  "anthropic", // ANTHROPIC_API_KEY (claude_flux thumbnail concept)
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
  // Higgsfield: hydrate the CLI credential so it runs hostless (in the Trigger
  // image) on your SUBSCRIPTION credits — replacing the old `higgsfield auth
  // login` on the VPS. Must run before the live gate so generate calls work.
  hydrateHiggsfieldCli(log);

  // Arm the Higgsfield CLI live gate.
  if (!process.env.HIGGSFIELD_LIVE) process.env.HIGGSFIELD_LIVE = "1";
  done = true;
  log(`bootstrap: hydrated ${loaded.length} keys`, { keys: loaded });
  return loaded;
}

/**
 * Write the Higgsfield CLI credential into a writable XDG config dir and point
 * the CLI at it + at the baked binary. The official `@higgsfield/cli` reads
 * `$XDG_CONFIG_HOME/higgsfield/credentials.json` = `{access_token, refresh_token}`
 * and auto-refreshes; that file alone authenticates anywhere (verified — not
 * IP/host-locked), so this is the hostless replacement for `higgsfield auth login`.
 *
 * Source (first that exists): HIGGSFIELD_CREDENTIALS_JSON (the raw blob), or
 * HIGGSFIELD_ACCESS_TOKEN + HIGGSFIELD_REFRESH_TOKEN. No secret is ever logged.
 */
function hydrateHiggsfieldCli(
  log: (msg: string, extra?: Record<string, unknown>) => void,
): void {
  let creds = process.env.HIGGSFIELD_CREDENTIALS_JSON;
  if (
    !creds &&
    process.env.HIGGSFIELD_ACCESS_TOKEN &&
    process.env.HIGGSFIELD_REFRESH_TOKEN
  ) {
    creds = JSON.stringify({
      access_token: process.env.HIGGSFIELD_ACCESS_TOKEN,
      refresh_token: process.env.HIGGSFIELD_REFRESH_TOKEN,
    });
  }
  if (!creds) {
    log("higgsfield: no CLI credentials in env — CLI will be unauthenticated");
    return;
  }

  // Use a writable XDG dir (container HOME may be read-only).
  const xdg = process.env.XDG_CONFIG_HOME ?? "/tmp/hf-config";
  process.env.XDG_CONFIG_HOME = xdg;
  const dir = join(xdg, "higgsfield");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials.json"), creds, { mode: 0o600 });
  } catch (e) {
    log(`higgsfield: failed to write credentials.json: ${e instanceof Error ? e.message : e}`);
    return;
  }

  // Point spawn() at the baked CLI wrapper if we can resolve it; else rely on
  // PATH ("higgsfield"). The wrapper is executable (shebang), so spawn works.
  if (!process.env.HIGGSFIELD_BIN) {
    try {
      // cwd-anchored require (works in both ESM and CJS bundles — avoids
      // import.meta, which Next may compile away).
      const req = createRequire(join(process.cwd(), "index.js"));
      const pkg = req.resolve("@higgsfield/cli/package.json");
      process.env.HIGGSFIELD_BIN = join(pkg, "..", "bin", "higgsfield.js");
    } catch {
      /* fall back to PATH lookup of `higgsfield` */
    }
  }
  log("higgsfield: CLI credentials hydrated", {
    xdg,
    bin: process.env.HIGGSFIELD_BIN ?? "higgsfield",
  });
}
