/**
 * Vault client — reads secrets from the project-hub Convex `secrets` table.
 *
 * Apps never hardcode credentials; they pull at runtime from the centralized
 * vault, scoped to this app. The vault base URL itself is read from env
 * (VAULT_URL) with a sensible default; no secret values are ever logged.
 *
 * Endpoint contract (project-hub Convex):
 *   POST {VAULT_URL}/api/query  body { path, args, format:"json" }
 *   - secrets:listByService -> { status, value: Secret[] }
 *   - secrets:getOne        -> { status, value: Secret }   (note: nested .value)
 */

const DEFAULT_VAULT_URL = "https://fantastic-roadrunner-485.convex.cloud";

export interface VaultSecret {
  service: string;
  keyName: string;
  value: string;
  description?: string;
  scopes?: string[];
  aliases?: string[];
}

function vaultUrl(): string {
  return (process.env.VAULT_URL ?? DEFAULT_VAULT_URL).replace(/\/$/, "");
}

async function vaultQuery<T>(
  path: string,
  args: Record<string, unknown>,
): Promise<T> {
  const vaultToken = process.env.VAULT_ACCESS_TOKEN;
  if (!vaultToken) throw new Error("VAULT_ACCESS_TOKEN is not configured");
  const res = await fetch(`${vaultUrl()}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args: { ...args, vaultToken }, format: "json" }),
  });
  if (!res.ok) {
    throw new Error(`vault query failed: ${path} -> HTTP ${res.status}`);
  }
  const json = (await res.json()) as { status?: string; value?: T; errorMessage?: string };
  if (json.status && json.status !== "success") {
    throw new Error(`vault query error: ${path} -> ${json.errorMessage ?? json.status}`);
  }
  return json.value as T;
}

/**
 * List all secrets for a service, returned as a flat { keyName: value } map.
 * Aliases are also included as keys pointing at the same value.
 */
export async function listByService(
  service: string,
): Promise<Record<string, string>> {
  const secrets = await vaultQuery<VaultSecret[]>("secrets:listByService", {
    service,
  });
  const out: Record<string, string> = {};
  for (const s of secrets ?? []) {
    out[s.keyName] = s.value;
    for (const alias of s.aliases ?? []) out[alias] = s.value;
  }
  return out;
}

/**
 * Fetch a single secret value by service + keyName. `getOne` nests the secret
 * under `.value`, so the actual string is `value.value`.
 */
export async function getOne(
  service: string,
  keyName: string,
): Promise<string> {
  const secret = await vaultQuery<VaultSecret | null>("secrets:getOne", {
    service,
    keyName,
  });
  if (!secret || typeof secret.value !== "string") {
    throw new Error(`vault: secret not found ${service}/${keyName}`);
  }
  return secret.value;
}

/**
 * Hydrate process.env from a service's secrets (only keys not already set, so
 * an explicit .env.local always wins). Returns the keys that were loaded.
 */
export async function hydrateEnv(service: string): Promise<string[]> {
  const map = await listByService(service);
  const loaded: string[] = [];
  for (const [k, val] of Object.entries(map)) {
    if (!process.env[k]) {
      process.env[k] = val;
      loaded.push(k);
    }
  }
  return loaded;
}
