/**
 * webSearch — self-hosted SearXNG client for the Casefile true-crime research
 * pipeline. SearXNG runs on the VPS as a self-hosted meta-search backend; this
 * module is purely the HTTP client for its JSON search API.
 *
 * Endpoint/token are read from the environment at call time (never hardcoded)
 * so the eventual provisioning mechanism — vault-hydrated env, plain
 * systemd EnvironmentFile, whatever is decided later — can change without
 * touching this file. Deliberately NOT registered in bootstrap.ts's SERVICES
 * list: that list hydrates specifically from the central vault, and how this
 * integration gets its env vars is still an open decision.
 *
 * Fails closed: any misconfiguration, non-200 response, malformed body, or
 * timeout throws. An empty result array must only ever mean "genuinely zero
 * results" — never "the backend was unreachable."
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearxngResp {
  results?: { title?: string; url?: string; content?: string }[];
}

export async function searchWeb(
  query: string,
  opts: { limit?: number; timeoutMs?: number } = {},
): Promise<WebSearchResult[]> {
  const endpoint = process.env.SEARXNG_ENDPOINT;
  const token = process.env.SEARXNG_API_TOKEN;
  if (!endpoint) throw new Error("webSearch: SEARXNG_ENDPOINT is not set");
  if (!token) throw new Error("webSearch: SEARXNG_API_TOKEN is not set");

  const limit = opts.limit ?? 10;
  const timeoutMs = opts.timeoutMs ?? 8_000;

  const url = `${endpoint.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`webSearch: SearXNG request timed out after ${timeoutMs}ms`);
    }
    throw new Error(
      `webSearch: SearXNG request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`webSearch: SearXNG returned HTTP ${res.status}`);
  }

  let body: SearxngResp;
  try {
    body = (await res.json()) as SearxngResp;
  } catch (e) {
    throw new Error(
      `webSearch: SearXNG response body is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!Array.isArray(body.results)) {
    throw new Error("webSearch: SearXNG response is missing a results array");
  }

  const mapped: WebSearchResult[] = [];
  for (const r of body.results) {
    if (!r || typeof r.title !== "string" || typeof r.url !== "string") continue;
    mapped.push({ title: r.title, url: r.url, snippet: typeof r.content === "string" ? r.content : "" });
    if (mapped.length >= limit) break;
  }
  return mapped;
}
