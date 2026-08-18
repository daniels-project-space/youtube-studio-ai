/**
 * webSearch — Browserbase-driven web search for the Casefile true-crime
 * research pipeline.
 *
 * SearXNG (a self-hosted meta-search backend) was decommissioned along with
 * the VPS infrastructure that ran it. This module now drives a real headless
 * Chrome session via `withStagehand()` (src/lib/browserbase.ts) to a public
 * search engine's server-rendered HTML results page and parses them.
 * ZERO new secrets: Browserbase is already a provisioned service
 * (BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID), already hydrated into every
 * Trigger.dev worker via bootstrap.ts's SERVICES list, and already used in
 * production by youtubeRecoveryBrowser.ts / youtubeCreateChannel.ts.
 *
 * Engine choice — DuckDuckGo was tried first (no API key, historically
 * simple markup) via `html.duckduckgo.com/html/`, but it serves an image
 * CAPTCHA ("Unfortunately, bots use DuckDuckGo too" / an `anomaly.js`
 * challenge) on every request from this deployment's outbound IP range.
 * That is an IP-reputation gate enforced before any HTML is served, not a
 * JS/UA fingerprint check — a real browser is no more able to get past it
 * than curl was in testing, so it was rejected outright (see the report for
 * this change). Bing's server-rendered HTML (`www.bing.com/search`) returned
 * clean, unblocked, parseable results in the same testing and is used
 * instead. Bing wraps every organic result link in a `bing.com/ck/a`
 * click-tracking redirect; `decodeBingRedirectUrl` below reverses that
 * encoding (verified against live markup) so callers get the real
 * destination URL, not a bing.com URL.
 *
 * Fails closed: Browserbase not configured, navigation/timeout failure, or a
 * page structure that cannot be confidently parsed (missing results
 * container, or result items that don't match the expected shape) all throw.
 * An empty array is returned ONLY when Bing's results container rendered
 * normally but genuinely contains zero organic result items — never as a
 * stand-in for "the page didn't parse."
 */

import { withStagehand } from "@/lib/browserbase";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface BingPage {
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
}
interface BingContext {
  newPage(url?: string): Promise<BingPage>;
}
interface BingStagehand {
  context: BingContext;
}

const RESULTS_CONTAINER_RE = /<ol[^>]*\bid="b_results"[^>]*>([\s\S]*?)<\/ol>/i;
const RESULT_ITEM_RE = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
const TITLE_RE = /<h2[^>]*>\s*<a[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i;
const SNIPPET_RE = /<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i;

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCharCode(Number(dec)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/**
 * Decodes Bing's `www.bing.com/ck/a?...&u=a1<base64>&...` click-tracking
 * wrapper back to the real destination URL: strip the `a1` prefix from the
 * `u` query param, pad the remaining unpadded standard-base64 string, and
 * decode. Verified against live Bing HTML fetched during this change (see
 * the report for a worked example). Returns undefined — never throws — for
 * anything that isn't a decodable external `ck/a` link, so a single odd item
 * degrades to "skip this item" rather than failing the whole parse; a page
 * where every item degrades this way still trips the "malformed" throw
 * further down in parseBingResults.
 */
function decodeBingRedirectUrl(rawHref: string): string | undefined {
  const href = decodeHtmlEntities(rawHref);
  let url: URL;
  try {
    url = new URL(href, "https://www.bing.com");
  } catch {
    return undefined;
  }
  if (!/(^|\.)bing\.com$/i.test(url.hostname)) {
    return /^https?:\/\//i.test(href) ? href : undefined;
  }
  const u = url.searchParams.get("u");
  if (!u || !u.startsWith("a1")) return undefined;
  const b64 = u.slice(2);
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  let decoded: string;
  try {
    decoded = Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return undefined;
  }
  return /^https?:\/\//i.test(decoded) ? decoded : undefined;
}

/**
 * Pure HTML parser — no network/browser access, no Browserbase dependency.
 * Unit-tested directly against saved/real Bing markup so the extraction
 * logic can be exercised without a live Browserbase session.
 *
 * Fail-closed rules:
 *  - No `#b_results` container anywhere in the page -> throw (blocked,
 *    consent wall, CAPTCHA, or markup changed beyond recognition).
 *  - Container present, zero `<li class="b_algo">` items -> return [].
 *    Bing's own SERP shell only renders `#b_results` for a normal query
 *    response, so an empty-but-present container is treated as a genuine
 *    "no results" page rather than a parse failure.
 *  - Container present with items, but none of them yield a usable
 *    title+url -> throw (the shell rendered but item markup drifted).
 */
export function parseBingResults(html: string, limit = 10): WebSearchResult[] {
  const containerMatch = RESULTS_CONTAINER_RE.exec(html);
  if (!containerMatch) {
    throw new Error(
      "webSearch: Bing results container (#b_results) not found — page structure is unrecognized (blocked, consent wall, or markup changed)",
    );
  }

  const itemMatches = [...containerMatch[1].matchAll(RESULT_ITEM_RE)];
  if (itemMatches.length === 0) {
    return [];
  }

  const out: WebSearchResult[] = [];
  let unparsed = 0;
  for (const item of itemMatches) {
    const itemHtml = item[1];
    const titleMatch = TITLE_RE.exec(itemHtml);
    const url = titleMatch ? decodeBingRedirectUrl(titleMatch[1]) : undefined;
    const title = titleMatch ? stripTags(titleMatch[2]) : "";
    if (!url || !title) {
      unparsed++;
      continue;
    }
    const snippetMatch = SNIPPET_RE.exec(itemHtml);
    out.push({ title, url, snippet: snippetMatch ? stripTags(snippetMatch[1]) : "" });
    if (out.length >= limit) break;
  }

  if (out.length === 0 && unparsed > 0) {
    throw new Error(
      `webSearch: Bing results container had ${itemMatches.length} item(s) but none matched the expected title/link shape — markup likely changed`,
    );
  }
  return out;
}

export type SearchWebOptions = { limit?: number; timeoutMs?: number };
export type SearchWebFn = (query: string, opts?: SearchWebOptions) => Promise<WebSearchResult[]>;

async function browserbaseSearchWeb(
  query: string,
  opts: SearchWebOptions = {},
): Promise<WebSearchResult[]> {
  const limit = opts.limit ?? 10;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`;
  const log = (m: string, x?: Record<string, unknown>) => console.log(`[websearch] ${m}`, x ?? "");

  // withStagehand() already throws its own descriptive error when Browserbase
  // is not configured (BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID) — that
  // env/config resolution belongs to browserbase.ts alone and is not
  // duplicated here.
  const { value } = await withStagehand(async (shU) => {
    const sh = shU as BingStagehand;
    const page = await sh.context.newPage("about:blank");
    await page.goto(url, { timeout: timeoutMs });
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    return parseBingResults(html, limit);
  }, log);

  return value;
}

let activeSearchWebImpl: SearchWebFn = browserbaseSearchWeb;

export function searchWeb(query: string, opts: SearchWebOptions = {}): Promise<WebSearchResult[]> {
  return activeSearchWebImpl(query, opts);
}

/**
 * Test-only seam. Real callers (e.g. casefileCaseResearcher.ts) import and
 * call `searchWeb` directly and are never touched by this — it only lets a
 * test swap what `searchWeb` delegates to, so integration tests can exercise
 * a real caller's handling of WebSearchResult[] without a live Browserbase
 * session. Pass `null` to restore the real Browserbase-driven implementation.
 * Not used by any production code path.
 */
export function __setSearchWebImplementationForTests(impl: SearchWebFn | null): void {
  activeSearchWebImpl = impl ?? browserbaseSearchWeb;
}
