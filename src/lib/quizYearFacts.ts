/**
 * quizYearFacts — deterministic "guess the year" fact sourcing from Wikidata.
 *
 * WHY WIKIDATA, AND ONLY WIKIDATA
 * The 2026-08 quiz audits closed off every trivia dataset found in the wild:
 * CC BY-SA (ShareAlike is structurally incompatible with YouTube's Standard
 * License), NonCommercial, offline, unlicensed scraped third-party content, or
 * itself LLM-generated (which launders hallucination risk rather than removing
 * it). Wikidata is the one source that survives: every statement is released
 * under CC0 1.0 (https://www.wikidata.org/wiki/Wikidata:Licensing), a genuine
 * public-domain dedication with no attribution or ShareAlike obligation, and
 * the SPARQL endpoint is free and unauthenticated.
 *
 * THE CENTRAL INVARIANT: THE YEAR IS NEVER MODEL-GUESSED.
 * Every `year` in this module is read from a Wikidata time value's `timeValue`
 * and nothing else. An LLM may be asked to PHRASE a question more engagingly,
 * but `phraseQuizYearQuestion`'s response schema has no year field at all, so
 * there is no channel through which a model could supply one, and
 * `questionTextDefects` additionally rejects any phrasing that contains a
 * four-digit year (it would either spoil the answer or contradict the source).
 * On any defect the caller falls back to `deterministicQuestionText`, which is
 * pure string assembly over the Wikidata label. See
 * src/lib/__tests__/quizYearFacts.test.ts for the locks.
 *
 * DATA-INTEGRITY GATES (all deterministic, all applied in JS)
 * Wikidata is crowd-maintained, so raw rows are NOT quiz-ready. Live probing
 * during development surfaced three separate real failure modes, each of which
 * would have shipped a wrong or unanswerable question:
 *   1. AMBIGUOUS YEARS — "The Elder Scrolls V: Skyrim" (Q49740) carries P577
 *      publication dates in both 2009 and 2011 (per-platform releases). A quiz
 *      question with two defensible answers is broken, so any entity resolving
 *      to more than one distinct year is DROPPED (`groupUnambiguous`).
 *   2. TEXT/DATA CONTRADICTION — Q94501's structured date says 1998 while its
 *      own English description says "1997 action-adventure open world video
 *      game"; likewise "Revolt of Czechoslovak Legion" has P585 1920 against a
 *      description reading "armed actions in Russia, 1918". Any four-digit year
 *      in the label or description that disagrees with the structured year is
 *      treated as an unresolved contradiction and the fact is DROPPED.
 *   3. LOW DATE PRECISION — Wikidata encodes precision on every time value
 *      (11 = day, 10 = month, 9 = year, 8 = decade, 7 = century). Anything
 *      coarser than 9 cannot answer "what year", so precision < 9 is DROPPED.
 * A fourth gate covers presentation rather than truth: the SPARQL label service
 * intermittently returns the bare QID instead of a label under ORDER BY, so a
 * label matching /^Q\d+$/ is DROPPED rather than shown to a viewer.
 *
 * TOPIC SAFETY
 * Topics are an ALLOWLIST of upbeat categories (space, discovery, invention,
 * games, film, sport, landmarks). A generic "historical event" sweep was tried
 * first and returned almost entirely revolts, uprisings and colonial wars, so
 * it is deliberately not offered. `SENSITIVE_TERMS` additionally drops any
 * individual fact whose text reads as atrocity/disaster/death-toll material,
 * which is how a stray "Great Fire of ..." landmark gets filtered even inside
 * an otherwise safe topic.
 */

/**
 * TRANSPORT, TONE FILTER AND LABEL RESOLUTION NOW LIVE IN quizSource.ts.
 * They were extracted verbatim when the quiz format grew from this one category
 * to several (see quizFacts.ts), so capitals, currencies and chemical symbols
 * run through the same retrying SPARQL client and the same sensitivity list
 * this module established. Everything this module's public API already promised
 * is re-exported below, so no caller or test had to change.
 */
import {
  isSensitiveText,
  qidFromUri,
  resolveEntityMeta,
  runSparql,
  wikidataSourceUrl,
  type SparqlFetchOptions,
} from "./quizSource";

export {
  WIKIDATA_SPARQL_ENDPOINT,
  WIKIDATA_USER_AGENT,
  SENSITIVE_TERMS,
  isSensitiveText,
  runSparql,
  wikidataSourceUrl,
  type SparqlFetchOptions,
} from "./quizSource";

/** Minimum acceptable Wikidata time precision: 9 = year. 11 = day, 10 = month. */
export const MIN_DATE_PRECISION = 9;

export type QuizYearTopicKey =
  | "space_exploration"
  | "science_discovery"
  | "invention_technology"
  | "video_games"
  | "film_release"
  | "sports_championship"
  | "landmark_architecture";

export interface QuizYearFact {
  /** English rdfs:label, verbatim from Wikidata. */
  eventLabel: string;
  /** English schema:description, verbatim from Wikidata ("" when absent). */
  eventDescription: string;
  /** THE ANSWER. Read from the structured time value only — never from an LLM. */
  year: number;
  /** e.g. "Q324". */
  wikidataQid: string;
  /** Verifiable citation, e.g. "https://www.wikidata.org/wiki/Q324". */
  sourceUrl: string;
  topic: QuizYearTopicKey;
  /** Sitelink count — deterministic proxy for how widely known the subject is. */
  notability: number;
}

interface TopicSpec {
  key: QuizYearTopicKey;
  /** Human phrasing stem used by the deterministic (non-LLM) question text. */
  ask: (label: string) => string;
  /** SPARQL body producing ?item ?year ?links ?prec, pre-label. */
  sparql: (opts: { minNotability: number; yearMin: number; yearMax: number; limit: number }) => string;
}

/**
 * Selection queries are kept deliberately SIMPLE — a single class/property
 * pattern, one FILTER set, ORDER BY notability. An earlier iteration pushed the
 * ambiguity check into SPARQL via GROUP BY / HAVING(COUNT(DISTINCT ?y) = 1) and
 * the endpoint began returning 500/502/504 on the heavier queries. Grouping is
 * therefore done in JS (`groupUnambiguous`), which is both cheaper for the
 * public endpoint and easier to test offline. `?prec` and the raw per-row year
 * are selected rather than aggregated so the JS side can see every candidate
 * date an entity has and reject genuine ambiguity instead of silently
 * collapsing it with MIN().
 */
function selectionQuery(args: {
  classes: string;
  dateProperty: string;
  minNotability: number;
  yearMin: number;
  yearMax: number;
  limit: number;
}): string {
  return `SELECT ?item ?year ?links ?prec WHERE {
  VALUES ?cls { ${args.classes} }
  ?item wdt:P31 ?cls ;
        p:${args.dateProperty}/psv:${args.dateProperty} [ wikibase:timeValue ?d ; wikibase:timePrecision ?prec ] ;
        wikibase:sitelinks ?links .
  BIND(YEAR(?d) AS ?year)
  FILTER(?prec >= ${MIN_DATE_PRECISION})
  FILTER(?year >= ${args.yearMin} && ?year <= ${args.yearMax})
  FILTER(?links >= ${args.minNotability})
}
ORDER BY DESC(?links)
LIMIT ${args.limit}`;
}

export const QUIZ_YEAR_TOPICS: Readonly<Record<QuizYearTopicKey, TopicSpec>> = {
  space_exploration: {
    key: "space_exploration",
    ask: (l) => `In what year did the ${l} mission launch?`,
    // Q2133344 space mission, Q55916641 space probe. P619 = launch date.
    sparql: (o) => selectionQuery({ classes: "wd:Q2133344 wd:Q55916641", dateProperty: "P619", ...o }),
  },
  science_discovery: {
    key: "science_discovery",
    ask: (l) => `In what year was ${l} discovered?`,
    // P575 "time of discovery or invention" is the exact property — no subclass
    // traversal. An earlier attempt walked wdt:P31/wdt:P279* from Q101333
    // ("invention") and drifted into bus manufacturers and finance companies.
    sparql: (o) => selectionQuery({ classes: "wd:Q634 wd:Q3863 wd:Q11344 wd:Q2695280", dateProperty: "P575", ...o }),
  },
  invention_technology: {
    key: "invention_technology",
    ask: (l) => `In what year was the ${l} invented?`,
    sparql: (o) => selectionQuery({ classes: "wd:Q2996394 wd:Q17781833 wd:Q15401930", dateProperty: "P575", ...o }),
  },
  video_games: {
    key: "video_games",
    ask: (l) => `In what year was the video game ${l} released?`,
    sparql: (o) => selectionQuery({ classes: "wd:Q7889", dateProperty: "P577", ...o }),
  },
  film_release: {
    key: "film_release",
    ask: (l) => `In what year was the film ${l} released?`,
    sparql: (o) => selectionQuery({ classes: "wd:Q11424", dateProperty: "P577", ...o }),
  },
  sports_championship: {
    key: "sports_championship",
    ask: (l) => `In what year was the ${l} held?`,
    // Q27020041 sports season, Q18608583 recurring sporting event edition.
    sparql: (o) => selectionQuery({ classes: "wd:Q27020041 wd:Q18608583", dateProperty: "P580", ...o }),
  },
  landmark_architecture: {
    key: "landmark_architecture",
    // "begun", NOT "completed". P571 is `inception` — "when the subject came
    // into existence" — which for a structure is when construction STARTED.
    // A live probe asked "In what year was Christ the Redeemer completed?" and
    // answered 1920 from P571; the statue was actually completed in 1931, and
    // 1920 is when work began. The data was right and the QUESTION was wrong,
    // which is a failure mode none of the data gates can see: no year appears
    // in the description, so there is nothing to contradict. The only fix is to
    // phrase every question to match what its property actually means.
    ask: (l) => `In what year did work on the ${l} begin?`,
    // Q4989906 monument, Q811979 architectural structure, Q57821 fortification
    // are the landmark-shaped classes. Q41176 ("building") was tried first and
    // leaked universities and research institutes to the top of the notability
    // ordering ("In what year was the Imperial College London completed?" — a
    // real probe result, and the wrong verb for an organisation), so it is
    // deliberately excluded.
    sparql: (o) => selectionQuery({ classes: "wd:Q4989906 wd:Q811979", dateProperty: "P571", ...o }),
  },
};

export const QUIZ_YEAR_TOPIC_KEYS = Object.keys(QUIZ_YEAR_TOPICS) as QuizYearTopicKey[];

/** Matches a plausible historical year, 1500–2029. */
const YEAR_PATTERN = /\b(1[5-9]\d{2}|20[0-2]\d)\b/g;

export interface RawWikidataRow {
  qid: string;
  year: number;
  precision: number;
  notability: number;
}

/**
 * Gate 1 + 3: drop rows below year precision, then drop any QID that resolves
 * to more than one distinct year. Returns one row per unambiguous QID.
 *
 * Real case this exists for: Q49740 (Skyrim) carries P577 values in both 2009
 * and 2011. MIN()/MAX() would silently pick one and ship a question whose
 * "wrong" answer is also documented as right by the very source cited on screen.
 */
export function groupUnambiguous(rows: readonly RawWikidataRow[]): {
  kept: RawWikidataRow[];
  droppedAmbiguous: string[];
  droppedPrecision: string[];
} {
  const droppedPrecision: string[] = [];
  const byQid = new Map<string, RawWikidataRow[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.year) || !Number.isFinite(row.precision)) continue;
    if (row.precision < MIN_DATE_PRECISION) {
      droppedPrecision.push(row.qid);
      continue;
    }
    const list = byQid.get(row.qid);
    if (list) list.push(row);
    else byQid.set(row.qid, [row]);
  }
  const kept: RawWikidataRow[] = [];
  const droppedAmbiguous: string[] = [];
  for (const [qid, list] of byQid) {
    const years = new Set(list.map((r) => r.year));
    if (years.size !== 1) {
      droppedAmbiguous.push(qid);
      continue;
    }
    // Prefer the most precise row for the surviving year.
    const best = list.reduce((a, b) => (b.precision > a.precision ? b : a));
    kept.push(best);
  }
  return { kept, droppedAmbiguous, droppedPrecision };
}

/**
 * Gate 2: any four-digit year appearing in the label or description must agree
 * with the structured year. Returns a human-readable conflict, or null if clean.
 *
 * Real cases: Q94501 (structured 1998 vs description "1997 ... video game") and
 * "Revolt of Czechoslovak Legion" (P585 1920 vs description "...Russia, 1918").
 */
export function textYearConflict(
  year: number,
  label: string,
  description: string,
): string | null {
  const haystack = `${label} ${description}`;
  for (const match of haystack.matchAll(YEAR_PATTERN)) {
    const found = Number(match[1]);
    if (found !== year) {
      return `text says ${found}, structured data says ${year}`;
    }
  }
  return null;
}

export interface FactIntegrityOptions {
  allowSensitiveTopics?: boolean;
}

/**
 * Gate 2 + 4 + tone, applied to a labelled candidate. Returns the list of
 * reasons the fact is unusable; empty means it passed every check.
 */
export function factDefects(
  fact: QuizYearFact,
  options: FactIntegrityOptions = {},
): string[] {
  const defects: string[] = [];
  const label = fact.eventLabel.trim();
  if (!label) defects.push("empty label");
  // The SPARQL label service intermittently returns the bare QID under
  // ORDER BY; that must never reach a viewer's screen.
  if (/^Q\d+$/.test(label)) defects.push(`unresolved label (${label})`);
  if (label.length > 90) defects.push("label too long for a quiz card");
  if (!Number.isInteger(fact.year)) defects.push("year is not an integer");
  if (!/^Q\d+$/.test(fact.wikidataQid)) defects.push("malformed QID");
  if (fact.sourceUrl !== wikidataSourceUrl(fact.wikidataQid)) {
    defects.push("sourceUrl does not match QID");
  }
  const conflict = textYearConflict(fact.year, label, fact.eventDescription);
  if (conflict) defects.push(`year contradiction: ${conflict}`);
  if (!options.allowSensitiveTopics && isSensitiveText(label, fact.eventDescription)) {
    defects.push("sensitive/tragedy content excluded by default");
  }
  return defects;
}

/* ------------------------------------------------------------------ *
 * Fact sourcing
 * ------------------------------------------------------------------ */

export interface FetchQuizYearFactsArgs extends SparqlFetchOptions, FactIntegrityOptions {
  topic: QuizYearTopicKey;
  /** How many clean facts the caller wants. Default 10. */
  count?: number;
  /** Minimum sitelink count — how widely known the subject must be. Default 25. */
  minNotability?: number;
  yearMin?: number;
  yearMax?: number;
  /** QIDs already used by this channel; excluded for dedupe. */
  excludeQids?: readonly string[];
}

export interface FetchQuizYearFactsResult {
  facts: QuizYearFact[];
  /** Per-gate drop counts — surfaced so a thin harvest is diagnosable. */
  rejected: {
    precision: number;
    ambiguousYear: number;
    yearContradiction: number;
    sensitive: number;
    unresolvedLabel: number;
    duplicate: number;
  };
  candidatesExamined: number;
}

/**
 * Fetch, then hard-filter, real guess-the-year facts for one topic.
 *
 * Over-fetches (4x the requested count) because the integrity gates genuinely
 * reject a large fraction of raw rows; the caller asks for clean facts, not
 * attempts.
 */
export async function fetchQuizYearFacts(
  args: FetchQuizYearFactsArgs,
): Promise<FetchQuizYearFactsResult> {
  const spec = QUIZ_YEAR_TOPICS[args.topic];
  if (!spec) throw new Error(`unknown quiz-year topic: ${args.topic}`);
  const count = Math.max(1, Math.min(50, args.count ?? 10));
  const log = args.log ?? (() => {});
  const rejected = {
    precision: 0,
    ambiguousYear: 0,
    yearContradiction: 0,
    sensitive: 0,
    unresolvedLabel: 0,
    duplicate: 0,
  };

  const selection = spec.sparql({
    minNotability: args.minNotability ?? 25,
    yearMin: args.yearMin ?? 1600,
    yearMax: args.yearMax ?? new Date().getUTCFullYear() - 1,
    // Over-fetch HARD. Rows are per-date, not per-entity: a video game with
    // eight per-platform release dates consumes eight rows and then usually
    // fails the ambiguity gate anyway. A live probe at count*20 returned 100
    // rows that collapsed to roughly 20 distinct games and yielded ZERO clean
    // facts, so the floor matters more than the multiplier here.
    limit: Math.min(600, Math.max(200, count * 40)),
  });
  const rawBindings = await runSparql(selection, args);
  const rows: RawWikidataRow[] = rawBindings.map((b) => ({
    qid: qidFromUri(b.item?.value ?? ""),
    year: Number(b.year?.value),
    precision: Number(b.prec?.value),
    notability: Number(b.links?.value ?? 0),
  })).filter((r) => /^Q\d+$/.test(r.qid));

  const grouped = groupUnambiguous(rows);
  rejected.precision = grouped.droppedPrecision.length;
  rejected.ambiguousYear = grouped.droppedAmbiguous.length;

  const exclude = new Set(args.excludeQids ?? []);
  const ordered = grouped.kept
    .filter((r) => !exclude.has(r.qid))
    .sort((a, b) => b.notability - a.notability);
  rejected.duplicate = grouped.kept.length - ordered.length;

  if (!ordered.length) {
    return { facts: [], rejected, candidatesExamined: rows.length };
  }

  // Label in batches, keep going until we have `count` clean facts.
  //
  // `resolveEntityMeta` replaced a strict `rdfs:label @en` query here. That
  // filter had a blind spot this module shared with every other category:
  // Wikidata has begun migrating labels that are spelled identically across
  // languages onto the `mul` language code, and an entity whose English label
  // has moved there returns NOTHING for `LANG(?l) = "en"` — it was silently
  // counted as `unresolvedLabel` and dropped. The shared resolver falls back
  // en → mul → English-Wikipedia sitelink title, so those subjects come back.
  const facts: QuizYearFact[] = [];
  const batchSize = Math.min(120, Math.max(count * 4, 20));
  for (let i = 0; i < ordered.length && facts.length < count; i += batchSize) {
    const batch = ordered.slice(i, i + batchSize);
    const byQid = await resolveEntityMeta(batch.map((r) => r.qid), args);
    for (const row of batch) {
      if (facts.length >= count) break;
      const meta = byQid.get(row.qid);
      if (!meta || !meta.label) {
        rejected.unresolvedLabel += 1;
        continue;
      }
      const fact: QuizYearFact = {
        eventLabel: meta.label,
        eventDescription: meta.description,
        year: row.year,
        wikidataQid: row.qid,
        sourceUrl: wikidataSourceUrl(row.qid),
        topic: args.topic,
        notability: row.notability,
      };
      const defects = factDefects(fact, args);
      if (defects.length) {
        if (defects.some((d) => d.startsWith("year contradiction"))) rejected.yearContradiction += 1;
        else if (defects.some((d) => d.startsWith("sensitive"))) rejected.sensitive += 1;
        else rejected.unresolvedLabel += 1;
        log(`wikidata: dropped ${row.qid} (${defects.join("; ")})`);
        continue;
      }
      facts.push(fact);
    }
  }

  log(
    `wikidata[${args.topic}]: ${facts.length}/${count} clean from ${rows.length} raw ` +
      `(ambiguous=${rejected.ambiguousYear} contradiction=${rejected.yearContradiction} ` +
      `sensitive=${rejected.sensitive} precision=${rejected.precision})`,
  );
  return { facts, rejected, candidatesExamined: rows.length };
}

/* ------------------------------------------------------------------ *
 * Question text — the LLM may phrase, but never supply, the answer
 * ------------------------------------------------------------------ */

export interface QuizYearQuestion {
  /** The sourced fact. `fact.year` is the ONLY answer the renderer ever reads. */
  fact: QuizYearFact;
  /** On-screen prompt. Contains no year by construction. */
  questionText: string;
  /** True when an LLM phrasing was accepted; false when the template was used. */
  phrasedByModel: boolean;
}

/**
 * Pure, LLM-free question text. Always available, always safe — this is the
 * fallback whenever a model phrasing fails `questionTextDefects`, so a model
 * outage or a bad paraphrase degrades the wording, never the correctness.
 */
export function deterministicQuestionText(fact: QuizYearFact): string {
  return QUIZ_YEAR_TOPICS[fact.topic].ask(fact.eventLabel);
}

/**
 * Reject a phrasing that could corrupt or spoil the answer.
 *
 * The single most important rule: NO four-digit year may appear in the question
 * text. If it equals the answer the question is spoiled; if it differs it
 * contradicts the cited source. Either way the phrasing is discarded and the
 * deterministic template is used instead. Combined with a response schema that
 * has no year field, there is no path by which a model-produced number can
 * become the answer.
 */
export function questionTextDefects(fact: QuizYearFact, questionText: string): string[] {
  const defects: string[] = [];
  const text = questionText.trim();
  if (!text) return ["empty question text"];
  if (text.length < 12) defects.push("question too short");
  if (text.length > 160) defects.push("question too long for a quiz card");
  if (!text.includes("?")) defects.push("question is not phrased as a question");

  const years = [...text.matchAll(YEAR_PATTERN)].map((m) => m[1]);
  if (years.length) {
    defects.push(
      years.includes(String(fact.year))
        ? `question spoils the answer (contains ${fact.year})`
        : `question contains an unsourced year (${years.join(", ")})`,
    );
  }
  // A bare digit run of 4 that slipped past YEAR_PATTERN's range is still a
  // number the viewer could read as the answer.
  if (/\b\d{4}\b/.test(text)) defects.push("question contains a four-digit number");
  return defects;
}

export interface PhraseQuizYearQuestionArgs {
  fact: QuizYearFact;
  /** Channel doctrine block from `channelCritiqueBrief`. */
  critiqueBrief?: string;
  /**
   * Model call. NOTE the return type: `{ question: string }` and nothing else.
   * There is deliberately no year field for a model to populate.
   */
  askModel?: (prompt: string) => Promise<{ question?: unknown }>;
  log?: (msg: string) => void;
}

/**
 * Ask a model to phrase the question more engagingly, then verify it did not
 * touch the answer. Falls back to `deterministicQuestionText` on ANY defect,
 * on a malformed response, or on a model error.
 */
export async function phraseQuizYearQuestion(
  args: PhraseQuizYearQuestionArgs,
): Promise<QuizYearQuestion> {
  const { fact } = args;
  const fallback: QuizYearQuestion = {
    fact,
    questionText: deterministicQuestionText(fact),
    phrasedByModel: false,
  };
  if (!args.askModel) return fallback;
  const log = args.log ?? (() => {});

  const prompt =
    `You write ONE line of on-screen text for a "guess the year" quiz video.\n\n` +
    (args.critiqueBrief ? `${args.critiqueBrief}\n` : "") +
    `SUBJECT: ${fact.eventLabel}\n` +
    (fact.eventDescription ? `CONTEXT: ${fact.eventDescription}\n` : "") +
    `TOPIC: ${fact.topic}\n\n` +
    `Write a short, punchy question asking the viewer WHAT YEAR this happened.\n` +
    `HARD RULES:\n` +
    `- NEVER write any year or any four-digit number. Not the answer, not a hint, not a range.\n` +
    `- Do not reveal or imply the answer.\n` +
    `- One sentence, under 140 characters, ending in a question mark.\n` +
    `- Plain viewer-facing language. No preamble, no quotes around it.\n\n` +
    `Return JSON: {"question": "..."}`;

  try {
    const raw = await args.askModel(prompt);
    const candidate = typeof raw?.question === "string" ? raw.question.trim() : "";
    if (!candidate) {
      log("quiz-year: model returned no question — using deterministic text");
      return fallback;
    }
    const defects = questionTextDefects(fact, candidate);
    if (defects.length) {
      log(`quiz-year: rejected model phrasing (${defects.join("; ")}) — using deterministic text`);
      return fallback;
    }
    return { fact, questionText: candidate, phrasedByModel: true };
  } catch (e) {
    log(`quiz-year: phrasing model failed (${e instanceof Error ? e.message : e}) — deterministic text`);
    return fallback;
  }
}

/* ------------------------------------------------------------------ *
 * Multiple-choice options — exactly one sourced truth, three inert decoys
 * ------------------------------------------------------------------ */

/**
 * PROVENANCE IS PART OF THE TYPE, not a convention.
 *
 * A four-option quiz puts three WRONG years on screen next to the real one.
 * Those decoys are invented by this module — they are NOT Wikidata statements
 * and must never be cited, logged as facts, or written into an asset's
 * provenance record. Tagging every option with `provenance` makes the
 * distinction impossible to lose: any code that needs the truth filters on
 * `provenance === "wikidata-sourced"`, and `assertOptionIntegrity` proves that
 * exactly one option carries that tag and that its year equals the sourced
 * year. A decoy can therefore never be promoted to an answer by a refactor,
 * a serialisation round-trip, or a checkpoint replay.
 */
export type YearOptionProvenance = "wikidata-sourced" | "generated-decoy";

export interface QuizYearOption {
  year: number;
  /** True for exactly one option — the Wikidata-sourced year. */
  isCorrect: boolean;
  provenance: YearOptionProvenance;
}

/** Minimum gap between any two options. Below this the question gets debatable. */
export const MIN_OPTION_GAP_YEARS = 3;
/** Widest a decoy may sit from the truth — still period-plausible. */
export const MAX_OPTION_SPREAD_YEARS = 40;
export const QUIZ_OPTION_COUNT = 4;

/**
 * Small deterministic PRNG (mulberry32) seeded from the QID.
 *
 * Determinism matters for more than tidiness: the question set is frozen into a
 * content-addressed checkpoint, so a healer replay MUST regenerate byte-identical
 * options. `Math.random()` would make a replayed video disagree with the one
 * already rendered.
 */
function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the four on-screen year options for a fact: the sourced year plus three
 * generated decoys.
 *
 * Decoy rules, all enforced rather than hoped for:
 *  - every option is at least MIN_OPTION_GAP_YEARS from every other, so no pair
 *    is close enough for the "correct" answer to be arguable;
 *  - decoys stay within MAX_OPTION_SPREAD_YEARS so the set reads as a real
 *    period rather than being solvable by spotting the one plausible century;
 *  - no decoy may land in the future, and none may precede `floorYear`;
 *  - decoys are placed on BOTH sides of the truth where the range allows, so
 *    the answer is not systematically the earliest or the latest option.
 */
export function buildYearOptions(
  fact: QuizYearFact,
  opts: { floorYear?: number; nowYear?: number } = {},
): QuizYearOption[] {
  const nowYear = opts.nowYear ?? new Date().getUTCFullYear();
  const floorYear = opts.floorYear ?? 1400;
  const rand = seededRandom(`${fact.wikidataQid}:${fact.year}`);
  const chosen: number[] = [fact.year];

  const fits = (candidate: number): boolean => {
    if (candidate > nowYear || candidate < floorYear) return false;
    return chosen.every((y) => Math.abs(y - candidate) >= MIN_OPTION_GAP_YEARS);
  };

  let guard = 0;
  while (chosen.length < QUIZ_OPTION_COUNT && guard++ < 500) {
    const magnitude =
      MIN_OPTION_GAP_YEARS +
      Math.floor(rand() * (MAX_OPTION_SPREAD_YEARS - MIN_OPTION_GAP_YEARS + 1));
    const sign = rand() < 0.5 ? -1 : 1;
    const candidate = fact.year + sign * magnitude;
    if (fits(candidate)) chosen.push(candidate);
  }
  // Degenerate ranges (a fact at the very edge of the allowed window) fall back
  // to a deterministic outward walk so we always return four distinct years.
  let step = MIN_OPTION_GAP_YEARS;
  while (chosen.length < QUIZ_OPTION_COUNT && step < 400) {
    for (const sign of [1, -1]) {
      const candidate = fact.year + sign * step;
      if (chosen.length < QUIZ_OPTION_COUNT && fits(candidate)) chosen.push(candidate);
    }
    step += MIN_OPTION_GAP_YEARS;
  }

  const options: QuizYearOption[] = chosen.map((year) => ({
    year,
    isCorrect: year === fact.year,
    provenance: year === fact.year ? "wikidata-sourced" : "generated-decoy",
  }));

  // Shuffle deterministically so the truth is not always in position 0.
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

/**
 * Prove the option set is safe to render: exactly one sourced option, its year
 * equal to the sourced fact, no duplicate or too-close years, and no decoy ever
 * flagged correct. Throws — a violation here would put a wrong answer on screen
 * under a citation that says otherwise.
 */
export function assertOptionIntegrity(
  options: readonly QuizYearOption[],
  sourceFact: QuizYearFact,
): void {
  if (options.length !== QUIZ_OPTION_COUNT) {
    throw new Error(`quiz-year options: expected ${QUIZ_OPTION_COUNT}, got ${options.length}`);
  }
  const sourced = options.filter((o) => o.provenance === "wikidata-sourced");
  if (sourced.length !== 1) {
    throw new Error(`quiz-year options: expected exactly 1 sourced option, got ${sourced.length}`);
  }
  if (sourced[0].year !== sourceFact.year) {
    throw new Error(
      `quiz-year options: sourced option ${sourced[0].year} != Wikidata year ${sourceFact.year}`,
    );
  }
  const correct = options.filter((o) => o.isCorrect);
  if (correct.length !== 1 || correct[0].provenance !== "wikidata-sourced") {
    throw new Error("quiz-year options: the correct option must be the sourced one");
  }
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      const gap = Math.abs(options[i].year - options[j].year);
      if (gap < MIN_OPTION_GAP_YEARS) {
        throw new Error(
          `quiz-year options: ${options[i].year} and ${options[j].year} are only ${gap}y apart (min ${MIN_OPTION_GAP_YEARS})`,
        );
      }
    }
  }
}

/**
 * Final assertion before render. Throws rather than returning defects because
 * by this point a mismatch would mean the answer on screen disagrees with the
 * cited source — never something to degrade past.
 */
export function assertAnswerIntegrity(question: QuizYearQuestion, sourceFact: QuizYearFact): void {
  if (question.fact.wikidataQid !== sourceFact.wikidataQid) {
    throw new Error(
      `quiz-year answer integrity: QID drift (${question.fact.wikidataQid} vs ${sourceFact.wikidataQid})`,
    );
  }
  if (question.fact.year !== sourceFact.year) {
    throw new Error(
      `quiz-year answer integrity: year drift (${question.fact.year} vs sourced ${sourceFact.year})`,
    );
  }
  const defects = questionTextDefects(sourceFact, question.questionText);
  if (defects.length) {
    throw new Error(`quiz-year answer integrity: ${defects.join("; ")}`);
  }
}
