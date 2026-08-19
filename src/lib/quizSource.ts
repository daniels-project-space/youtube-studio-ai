/**
 * quizSource — the shared Wikidata substrate for every quiz fact category.
 *
 * Extracted from quizYearFacts.ts (commit df1a257) when the quiz format grew
 * from one category ("guess the year") to several (capitals, currencies,
 * chemical symbols, atomic numbers, plus citation-grounded general knowledge).
 * Everything in here is category-agnostic: the transport, the entity-metadata
 * resolver, and the tone filter. quizYearFacts.ts re-exports the pieces its own
 * public API already promised, so nothing downstream had to change.
 *
 * WHY WIKIDATA, AND ONLY WIKIDATA
 * The 2026-08 quiz audits closed off every trivia dataset found in the wild:
 * CC BY-SA (ShareAlike is structurally incompatible with YouTube's Standard
 * License), NonCommercial, offline, unlicensed scraped third-party content, or
 * itself LLM-generated. Wikidata is the one source that survives: every
 * statement is CC0 1.0 (https://www.wikidata.org/wiki/Wikidata:Licensing), a
 * genuine public-domain dedication with no attribution or ShareAlike
 * obligation, and the SPARQL endpoint is free and unauthenticated.
 */

/** Wikidata's public SPARQL endpoint. Free, unauthenticated, CC0 data. */
export const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

/**
 * Wikidata asks every automated client to send a descriptive User-Agent with
 * contact info (https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy).
 * A generic or absent UA is throttled aggressively.
 */
export const WIKIDATA_USER_AGENT =
  "YouTubeStudioAI-QuizYear/1.0 (https://github.com/daniels-project-space/youtube-studio-ai)";

export function wikidataSourceUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/${qid}`;
}

export function qidFromUri(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

/**
 * Terms that make a fact unsuitable for an upbeat quiz channel. This is a TONE
 * filter, not a truth filter — the dropped facts are perfectly real, they are
 * simply not what this format is for. A channel that genuinely wants military
 * or disaster history should pass `allowSensitiveTopics: true` and own that
 * editorial decision explicitly rather than having it happen by default.
 */
export const SENSITIVE_TERMS: readonly string[] = [
  "war", "battle", "massacre", "genocide", "holocaust", "atrocity", "killed", "death",
  "deaths", "died", "fatal", "casualt", "murder", "assassinat", "execution", "shooting",
  "bombing", "bomb", "terror", "attack", "invasion", "uprising", "revolt", "riot",
  "famine", "epidemic", "pandemic", "plague", "outbreak", "disaster", "catastroph",
  "earthquake", "tsunami", "hurricane", "crash", "sinking", "wreck", "explosion",
  "slavery", "slave", "torture", "abuse", "rape", "suicide", "nuclear weapon",
  // Regime/abbreviation forms. Added after a live probe surfaced "Wolf's Lair"
  // ("one of Nazi Germany's military headquarters during WW2") passing the
  // filter cleanly: its description never contains the substring "war", only
  // the abbreviation. Substring matching on "war" cannot catch "WW2"/"WWII",
  // so the abbreviations and regime names are listed explicitly.
  "nazi", "hitler", "ww2", "wwii", "ww1", "wwi", "third reich", "reich",
  "fascist", "concentration camp", "gulag", "regime", "military", "wehrmacht",
  "dictator", "colonial", "apartheid", "internment",
];

/** True when the text reads as atrocity/disaster material. */
export function isSensitiveText(label: string, description: string): boolean {
  const haystack = `${label} ${description}`.toLowerCase();
  return SENSITIVE_TERMS.some((term) => haystack.includes(term));
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

export interface SparqlFetchOptions {
  /** Per-attempt timeout. Default 30s. */
  timeoutMs?: number;
  /** Total attempts including the first. Default 3. */
  retries?: number;
  log?: (msg: string) => void;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests so retry backoff does not really sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SparqlBinding {
  [key: string]: { value: string } | undefined;
}

/**
 * Run a SPARQL query with a bounded timeout and retry on TRANSIENT failure.
 * The public endpoint genuinely returns 429/500/502/504 under load — all four
 * were observed during development — so a single-shot fetch would make fact
 * sourcing flaky. 4xx other than 429 are permanent (bad query) and fail fast.
 */
export async function runSparql(
  query: string,
  options: SparqlFetchOptions = {},
): Promise<SparqlBinding[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = Math.max(1, options.retries ?? 3);
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleepImpl ?? defaultSleep;
  const log = options.log ?? (() => {});

  let lastError = "unknown";
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${WIKIDATA_SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
      const res = await doFetch(url, {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": WIKIDATA_USER_AGENT,
        },
        signal: controller.signal,
      });
      if (res.status === 200) {
        const body = (await res.json()) as { results?: { bindings?: SparqlBinding[] } };
        return body.results?.bindings ?? [];
      }
      lastError = `HTTP ${res.status}`;
      // 429 (rate limit) and 5xx are transient; other 4xx mean a bad query.
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`wikidata SPARQL permanent failure: HTTP ${res.status}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("wikidata SPARQL permanent")) throw e;
      lastError = e instanceof Error ? e.name || e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
    log(`wikidata: attempt ${attempt}/${retries} failed (${lastError})`);
    if (attempt < retries) await sleep(1_000 * 2 ** (attempt - 1));
  }
  throw new Error(`wikidata SPARQL failed after ${retries} attempts: ${lastError}`);
}

/* ------------------------------------------------------------------ *
 * Entity metadata — labels, aliases, descriptions
 * ------------------------------------------------------------------ */

export interface EntityMeta {
  label: string;
  description: string;
  /** skos:altLabel values — used to tolerate exonyms in cross-checks. */
  aliases: string[];
  /** Where the label came from. "none" means the entity is unusable on screen. */
  labelSource: "en" | "mul" | "sitelink" | "none";
}

/**
 * Resolve display metadata for a batch of QIDs.
 *
 * THREE THINGS THIS DOES THAT `SERVICE wikibase:label` DOES NOT.
 *
 * 1. It is a SEPARATE query keyed by QID. Live probing during the year build
 *    showed the label service returning bare QIDs ("Q94501") whenever it was
 *    combined with ORDER BY + LIMIT, which would have put a raw QID on screen.
 *
 * 2. It falls back `en` → `mul` → English-Wikipedia sitelink title. This exists
 *    because of a REAL, live-reproduced defect: Wikidata has migrated terms that
 *    are spelled identically across languages onto the `mul` ("multilingual")
 *    language code, and `euro` (Q4916) now has NO `rdfs:label @en` at all — only
 *    `@mul "euro"`, `@de "Euro"` and `@en-ca "Euro"`. A strict `LANG(?l) = "en"`
 *    filter therefore returns nothing for the euro, which in the currency
 *    category silently deleted the entire eurozone: 22 of 178 otherwise-clean
 *    countries (Germany, Italy, Spain, Finland, ...) rendered with an empty
 *    answer or were dropped as "unresolved label". The fallback recovers them.
 *    Measured live: of 156 distinct currency entities, exactly one (Q4916) is
 *    missing an `@en` label, and the enwiki sitelink title resolves it to "Euro".
 *
 * 3. It returns aliases, so a description cross-check can tolerate the exonym
 *    cases that are naming differences rather than data conflicts (Wikidata's
 *    English label for Q1044 is "Naoero" while Yaren District's description
 *    says "capital of Nauru"; likewise Myanmar/Burma).
 */
export async function resolveEntityMeta(
  qids: readonly string[],
  options: SparqlFetchOptions = {},
): Promise<Map<string, EntityMeta>> {
  const out = new Map<string, EntityMeta>();
  const unique = [...new Set(qids)].filter((q) => /^Q\d+$/.test(q));
  // 120 keeps the VALUES clause well inside the endpoint's practical limits;
  // larger batches were observed timing out during the year build.
  for (let i = 0; i < unique.length; i += 120) {
    const batch = unique.slice(i, i + 120);
    const values = batch.map((q) => `wd:${q}`).join(" ");
    const bindings = await runSparql(
      `SELECT ?item ?en ?mul ?desc ?alias ?article WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item rdfs:label ?en . FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item rdfs:label ?mul . FILTER(LANG(?mul) = "mul") }
  OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?item skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
}`,
      options,
    );
    for (const b of bindings) {
      const qid = qidFromUri(b.item?.value ?? "");
      if (!qid) continue;
      const sitelink = b.article?.value
        ? decodeURIComponent(b.article.value.split("/wiki/")[1] ?? "").replace(/_/g, " ")
        : "";
      const en = b.en?.value?.trim() ?? "";
      const mul = b.mul?.value?.trim() ?? "";
      const label = en || mul || sitelink;
      const existing = out.get(qid);
      if (existing) {
        // Aliases arrive as one row each; merge rather than overwrite.
        const alias = b.alias?.value?.trim();
        if (alias && !existing.aliases.includes(alias)) existing.aliases.push(alias);
        continue;
      }
      out.set(qid, {
        label,
        description: b.desc?.value?.trim() ?? "",
        aliases: b.alias?.value?.trim() ? [b.alias.value.trim()] : [],
        labelSource: en ? "en" : mul ? "mul" : sitelink ? "sitelink" : "none",
      });
    }
  }
  return out;
}

/** Lowercase, de-accent and strip punctuation — for comparing names, not display. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Word-boundary containment on normalized text.
 *
 * Deliberately NOT `String.includes`: a two-letter chemical symbol like "Ag"
 * matches inside "against", "age" and "agreement" as a raw substring, which
 * would make an answer look confirmed by a document that never mentions it.
 * Every containment check in the quiz path goes through this.
 */
export function containsPhrase(haystack: string, needle: string): boolean {
  const h = normalizeName(haystack);
  const n = normalizeName(needle);
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}($|\\s)`).test(h);
}
