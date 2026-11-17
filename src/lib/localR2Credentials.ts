/** Fetch only bucket-scoped, short-lived credentials from the private VPS broker. */
export async function localR2Credentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: Date }> {
  const token = env.YTA_R2_BROKER_TOKEN;
  if (!token || token.length < 32) throw new Error("Local R2 credential broker is not configured");
  let url: URL;
  try { url = new URL(env.YTA_R2_BROKER_URL ?? ""); }
  catch { throw new Error("Local R2 credential broker URL is invalid"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "172.30.240.1"].includes(url.hostname) ||
      url.port !== "39404" || url.pathname !== "/v1/credentials" || url.username || url.password || url.search || url.hash) {
    throw new Error("Local R2 credential broker URL is invalid");
  }
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  } catch {
    throw new Error("Local R2 credential broker is unavailable");
  }
  if (!response.ok) throw new Error("Local R2 credential broker refused the request");
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error("Local R2 credential response is invalid"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Local R2 credential response is invalid");
  const value = data as Record<string, unknown>;
  if ([value.accessKeyId, value.secretAccessKey, value.sessionToken].some(v => typeof v !== "string" || !v) ||
      typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now() + 60_000 || value.expiresAt > Date.now() + 14_400_000) {
    throw new Error("Local R2 credential response is invalid");
  }
  return { accessKeyId: value.accessKeyId as string, secretAccessKey: value.secretAccessKey as string,
    sessionToken: value.sessionToken as string, expiration: new Date(value.expiresAt) };
}
