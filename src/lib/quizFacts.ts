/**
 * quizFacts — the multi-category fact engine behind the quiz format.
 *
 * WHAT THIS GENERALISES, AND WHY
 * quizYearFacts.ts (commit df1a257) proved one category end to end: "in what
 * year did X happen", sourced from a Wikidata time value, gated hard, and
 * rendered as four ABCD options with a countdown lock-in. Real trivia channels
 * mix question types inside ONE video, so the product shape is a single format
 * that draws a MIX of categories per video rather than a module per category.
 *
 * A category here is exactly five things:
 *   1. a SPARQL selection template (entity class + the property being asked),
 *   2. an answer-value TYPE (year | place | name | symbol | number),
 *   3. a deterministic question-phrasing template,
 *   4. a decoy strategy appropriate to that value type, and
 *   5. an optional per-category cross-check against the answer's own text.
 * Everything else — transport, ambiguity gating, label resolution, tone
 * filtering, provenance tagging, option integrity — is shared, so a new
 * category cannot opt out of the discipline the year build established.
 *
 * THE CENTRAL INVARIANT IS UNCHANGED: THE ANSWER IS NEVER MODEL-GUESSED.
 * Every `answerLabel` here is read from a Wikidata statement. An LLM may be
 * asked to PHRASE a question, but `phraseQuizQuestion`'s response schema has no
 * answer field, `questionTextDefects` rejects any phrasing that leaks the
 * answer, and every rendered option carries a `provenance` tag that
 * `assertQuizOptionIntegrity` checks before pixels exist.
 *
 * ---------------------------------------------------------------------------
 * GATES, AND THE REAL LIVE DEFECTS THAT MOTIVATED EACH ONE
 * Every number below was measured against the live endpoint while building this
 * module, not assumed. Wikidata is crowd-maintained; raw rows are NOT quiz-ready.
 *
 * G1 MULTI-VALUE AMBIGUITY (`groupUnambiguousValues`) — the direct
 *    generalisation of the year build's `groupUnambiguous`. Any subject with
 *    more than one distinct CURRENT value for the asked property is dropped,
 *    because a question with two defensible answers is broken. Live: 8 of 197
 *    sovereign states have multiple claimed capitals — South Africa (Cape Town,
 *    Pretoria, Bloemfontein), Bolivia (La Paz, Sucre), Malaysia (Kuala Lumpur,
 *    Putrajaya), Sri Lanka, Benin, Eswatini, Yemen, Palestine — and 19 of 197
 *    have multiple current currencies (Zimbabwe carries ten; El Salvador
 *    carries Bitcoin alongside the US dollar).
 *
 * G2 RANK + END-TIME (`currentStatements`) — new here, and load-bearing. The
 *    truthy `wdt:` path HIDES ambiguity rather than exposing it: `wdt:P36`
 *    returns one capital for Malaysia (Kuala Lumpur) and one for Benin
 *    (Porto-Novo), silently suppressing the seat-of-government value that the
 *    full `p:`/`ps:` statement path reveals. So selection walks full statements
 *    and filters deprecated rank plus `pq:P582` (end time) in JS. Without the
 *    end-time filter 41 of 197 countries look ambiguous purely because of
 *    historical capitals.
 *
 * G3 DISSOLVED SUBJECTS — `wdt:P576` (dissolved/abolished) is excluded in
 *    SPARQL. Live, `wd:Q3624078` ("sovereign state") includes the Russian
 *    Empire, whose currency statements are "ruble" and "gold rouble".
 *
 * G4 LABEL RESOLUTION (`resolveEntityMeta`, quizSource.ts) — en → mul →
 *    sitelink. Wikidata moved `euro`'s English label to the `mul` language
 *    code; a strict `@en` filter deleted 22 eurozone countries.
 *
 * G5 TEXT/DATA CONTRADICTION (`crossCheck` per category) — the generalisation
 *    of the year build's description-vs-structured-date check. Live catch:
 *    Q1832 (gadolinium) has the English description "chemical element with
 *    symbol H and atomic number 64" — the description names HYDROGEN's symbol.
 *    Structured `P246` says "Gd". The structured value is right and the text is
 *    wrong, and there is no way to tell which from inside a single statement,
 *    so the fact is dropped rather than shipped. For capitals the same gate
 *    reads the answer city's own description ("capital of <country>") and
 *    requires it to name the subject country, tolerating aliases so that
 *    Naoero/Nauru and Myanmar/Burma are not treated as conflicts.
 *
 * G6a DEGENERATE ANSWERS (`answerEqualsSubject`) — the answer must not BE the
 *    subject. Universal. Live: 6 of 189 capitals (Singapore, San Marino,
 *    Luxembourg, Vatican City, Monaco, Djibouti) are city-states whose capital
 *    IS the country, producing "What is the capital of Singapore?" →
 *    "Singapore". Correct, and worthless as a quiz round.
 *
 * G6b GIVEAWAY ANSWERS (`answerNamesSubject`) — PER-CATEGORY, because whether
 *    eponymy is a defect depends entirely on the category. ON for capitals
 *    (Mexico → Mexico City; 14 of 189) and currencies (Georgia → Georgian lari;
 *    90 of 178, so this gate is what makes the category honest — 88 survive).
 *    OFF for the element categories, where a symbol derived from the element's
 *    name is the whole point. This gate was originally a single global substring
 *    rule and, measured live, deleted 59 of 118 elements and 76 of 178
 *    currencies that were never degenerate at all — the same over-broad shape as
 *    G7 before it was scoped. Matching is on shared words and stems, never raw
 *    substrings, so "Tunisia → Tunis" and "Algeria → Algiers" survive.
 *
 * G7 CONTESTED SUBJECTS (`CONTESTED_SUBJECT_QIDS`) — an explicit, documented
 *    editorial denylist for subjects whose answer is internationally disputed
 *    rather than merely multi-valued (Israel/Jerusalem is the live example the
 *    tone filter cannot see: no sensitive term appears in either label or
 *    description). This is a TONE decision, like SENSITIVE_TERMS, not a claim
 *    about who is right.
 *
 * G8 TONE (`isSensitiveText`) — shared with the year build, applied to subject
 *    and answer text together.
 *
 * ---------------------------------------------------------------------------
 * CATEGORIES EVALUATED AND DROPPED (measured, not assumed)
 *
 * OFFICIAL LANGUAGE (`wdt:P37`) — DROPPED. 96 of 197 sovereign states (49%)
 * carry more than one current official language: Pakistan (Urdu, English),
 * Iraq (Arabic, Kurdish), Haiti, Sri Lanka, Afghanistan (six), Mali (six),
 * Taiwan (six). G1 would drop half the pool, which is survivable — but the
 * failure mode is ASYMMETRIC in a way G1 cannot see. G1 only detects
 * ambiguity that is RECORDED. For dates and capitals, a missing second value
 * is rare. For languages, incomplete recording is the norm, so a row that
 * looks clean is not evidence of a single true answer — it is often evidence
 * of a thin Wikidata item. The category is also politically loaded in several
 * of the countries that survive. Shipping it would mean asserting single
 * answers the data does not actually support.
 *
 * MOUNTAIN ELEVATION (`wdt:P2044`) — DROPPED. Of 65 mountains above the
 * notability floor, 6 carry multiple recorded elevations, and the spreads show
 * two different problems at once: Everest has 8848, 8848.86, 8844.43 and 8850
 * (survey-vintage disagreement, all defensible), Mont Blanc has six values
 * inside 4.4 m, and Q725591 has 2706 vs 4466 — a 1760 m spread that is simply
 * bad data. G1 drops all six, leaving 59 usable mountains, but the survivors
 * are the deeper problem: a four-option numeric grid asking for a height in
 * metres invites exactly the "my source says 8,849" argument the year build
 * refused to ship, and 59 subjects is too thin a pool to rotate a channel on.
 *
 * Both are recorded here rather than silently omitted, because the credibility
 * of this format comes from having actually checked.
 */
import {
  containsPhrase,
  isSensitiveText,
  normalizeName,
  qidFromUri,
  resolveEntityMeta,
  runSparql,
  wikidataSourceUrl,
  type EntityMeta,
  type SparqlFetchOptions,
} from "./quizSource";

export {
  WIKIDATA_SPARQL_ENDPOINT,
  WIKIDATA_USER_AGENT,
  SENSITIVE_TERMS,
  isSensitiveText,
  runSparql,
  wikidataSourceUrl,
  containsPhrase,
  normalizeName,
  type SparqlFetchOptions,
} from "./quizSource";

/* ------------------------------------------------------------------ *
 * Category model
 * ------------------------------------------------------------------ */

/**
 * What KIND of thing the answer is. This drives the decoy strategy: you cannot
 * generate a plausible wrong capital city the way you generate a plausible
 * wrong year, and inventing a fake place name would be worse than either.
 */
export type QuizAnswerType = "year" | "place" | "name" | "symbol" | "number";

export type QuizCategoryKey =
  | "capital_city"
  | "country_currency"
  | "element_symbol"
  | "element_atomic_number";

export interface QuizCategoryFact {
  categoryKey: QuizCategoryKey;
  answerType: QuizAnswerType;
  /** What the question is ABOUT, e.g. "France", "gold". */
  subjectLabel: string;
  subjectQid: string;
  subjectDescription: string;
  /**
   * THE ANSWER, exactly as it will appear on screen. Read from a Wikidata
   * statement value and nothing else.
   */
  answerLabel: string;
  /** Populated for `year` and `number` answers; the canonical numeric form. */
  answerNumber?: number;
  /** Set when the answer is an entity rather than a literal. */
  answerQid?: string;
  /** Verifiable citation for the SUBJECT, e.g. https://www.wikidata.org/wiki/Q142. */
  sourceUrl: string;
  /** Sitelink count — deterministic proxy for how widely known the subject is. */
  notability: number;
  /**
   * Opaque grouping key used ONLY to pick same-region decoys (continent QID for
   * countries). Never rendered, never cited.
   */
  decoyGroup?: string;
}

/** A real, sourced value that may be offered as a wrong option elsewhere. */
export interface QuizDecoyCandidate {
  label: string;
  qid?: string;
  number?: number;
  group?: string;
}

interface CategorySpec {
  key: QuizCategoryKey;
  label: string;
  answerType: QuizAnswerType;
  /** Deterministic, LLM-free question text. Always available. */
  ask: (subjectLabel: string) => string;
  /** What a phrasing model is told the question must ask for. */
  phrasingGoal: string;
  /**
   * SPARQL producing ?item ?val (?valLabel for literals) ?links, plus ?rank and
   * optional ?end so G2 can run in JS, plus optional ?group for decoy locality.
   */
  sparql: (opts: { minNotability: number; limit: number }) => string;
  /** True when ?val is an entity URI rather than a literal. */
  entityValued: boolean;
  /**
   * G6b. Drop facts whose answer names its own subject. ON only where eponymy is
   * a giveaway rather than the point of the question — see `answerNamesSubject`
   * for the measured per-category justification.
   */
  eponymGate: boolean;
  /**
   * G5. Return a conflict string when the answer's own text disagrees with the
   * structured value, or null when clean/silent. `subject` carries aliases so
   * exonyms are not mistaken for contradictions.
   */
  crossCheck?: (args: {
    subject: EntityMeta;
    subjectLabel: string;
    answerLabel: string;
    answerNumber?: number;
    answerMeta?: EntityMeta;
  }) => string | null;
}

/**
 * Countries whose answer for these categories is internationally DISPUTED
 * rather than simply recorded more than once.
 *
 * G1 already drops anything with two recorded values, which covers Palestine
 * and (by accident of recording) several others. This list exists for the case
 * G1 cannot see: Wikidata records exactly ONE capital for Israel (Jerusalem),
 * neither the label nor the description contains any term the tone filter
 * matches, and the fact is structurally immaculate — but "what is the capital
 * of Israel" is not a question an upbeat trivia channel should be asking as
 * though it were settled. Listed explicitly, with the reason, rather than
 * hidden inside a keyword list.
 */
export interface ContestedSubject {
  reason: string;
  /**
   * Categories the exclusion applies to. Omitted means ALL — used when it is
   * the subject's statehood itself that is disputed, so any "which country…"
   * framing inherits the dispute.
   *
   * Scoping this per-category was a correction forced by the first live run:
   * a flat list dropped Israel from the CURRENCY category too, with the reason
   * string "Jerusalem's status as capital is not internationally recognised".
   * The shekel is not disputed, and refusing to ask about it on capital-city
   * grounds is an over-broad gate rather than a careful one.
   */
  categories?: readonly QuizCategoryKey[];
}

export const CONTESTED_SUBJECT_QIDS: Readonly<Record<string, ContestedSubject>> = {
  Q801: {
    reason: "Israel — Jerusalem's status as capital is not internationally recognised",
    categories: ["capital_city"],
  },
  Q219060: {
    reason: "Palestine — competing capital claims (East Jerusalem / Ramallah)",
    categories: ["capital_city"],
  },
  Q865: { reason: "Taiwan — contested sovereignty makes the 'country' framing itself disputed" },
  Q1246: { reason: "Kosovo — partially recognised statehood" },
  Q40362: { reason: "Western Sahara / SADR — disputed territory" },
  Q23681: { reason: "Northern Cyprus — recognised by one UN member" },
};

/** True when this subject is off-limits for THIS category specifically. */
export function isContestedFor(subjectQid: string, category: QuizCategoryKey): boolean {
  const entry = CONTESTED_SUBJECT_QIDS[subjectQid];
  if (!entry) return false;
  return !entry.categories || entry.categories.includes(category);
}

/**
 * Selection queries stay deliberately SIMPLE — one class/property pattern, one
 * FILTER set. An earlier iteration of the year build pushed the ambiguity check
 * into SPARQL via GROUP BY / HAVING and the endpoint began returning 500/502/504
 * on the heavier queries. Grouping is therefore done in JS, which is cheaper for
 * the public endpoint and testable offline.
 *
 * Note `p:`/`ps:` rather than `wdt:` — see G2: the truthy path hides exactly the
 * ambiguity the gates exist to catch.
 */
function sovereignStateQuery(args: {
  property: string;
  minNotability: number;
  limit: number;
  withContinent?: boolean;
}): string {
  return `SELECT ?item ?val ?links ?rank ?end ${args.withContinent ? "?group" : ""} WHERE {
  ?item wdt:P31 wd:Q3624078 ;
        wikibase:sitelinks ?links .
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  ?item p:${args.property} ?st .
  ?st ps:${args.property} ?val ;
      wikibase:rank ?rank .
  OPTIONAL { ?st pq:P582 ?end }
  ${args.withContinent ? "OPTIONAL { ?item wdt:P30 ?group }" : ""}
  FILTER(?links >= ${args.minNotability})
}
LIMIT ${args.limit}`;
}

/** Match "capital of X" / "capital city of X" / "capital and largest city of X". */
const CAPITAL_CLAIM = /\bcapital\b[^.;]{0,40}?\b(?:of|in)\s+(?:the\s+)?([A-Za-zÀ-ɏ'’ .-]+)/i;
/** Match "…symbol Au…" and "…atomic number 79…" / "…atomic number of 79…". */
const SYMBOL_CLAIM = /\bsymbol\s+([A-Z][a-z]{0,2})\b/;
const ATOMIC_NUMBER_CLAIM = /\batomic\s+number\s+(?:of\s+)?(\d{1,3})\b/i;

function namesSubject(claimed: string, subject: EntityMeta, subjectLabel: string): boolean {
  const c = normalizeName(claimed);
  if (!c) return true;
  const candidates = [subjectLabel, subject.label, ...subject.aliases].map(normalizeName).filter(Boolean);
  return candidates.some((name) => c === name || c.includes(name) || name.includes(c));
}

export const QUIZ_CATEGORIES: Readonly<Record<QuizCategoryKey, CategorySpec>> = {
  /**
   * P36 = capital. Live shape: 197 sovereign states above the notability floor,
   * 189 with exactly one current capital, 8 dropped by G1.
   */
  capital_city: {
    key: "capital_city",
    label: "Capital cities",
    answerType: "place",
    ask: (l) => `What is the capital city of ${l}?`,
    phrasingGoal: "which CITY is the capital of the country named in the subject",
    entityValued: true,
    // Eponymy is the exception (14 of 189) — gate it.
    eponymGate: true,
    sparql: (o) => sovereignStateQuery({ property: "P36", withContinent: true, ...o }),
    // G5: the capital's own description usually states which country it is the
    // capital of. When it names a DIFFERENT country the two statements disagree
    // and we cannot tell which is right, so the fact is dropped. Silence is not
    // a conflict — 6 of 189 capitals simply do not state it (Jerusalem, Maputo,
    // Yamoussoukro, and the city-states G6 removes anyway).
    crossCheck: ({ subject, subjectLabel, answerMeta }) => {
      const desc = answerMeta?.description ?? "";
      const m = CAPITAL_CLAIM.exec(desc);
      if (!m) return null;
      if (namesSubject(m[1], subject, subjectLabel)) return null;
      return `capital's description says "capital of ${m[1].trim()}", subject is ${subjectLabel}`;
    },
  },

  /**
   * P38 = currency. Live shape: 197 states, 178 with exactly one current
   * currency, 19 dropped by G1 (Zimbabwe's ten, El Salvador's Bitcoin+USD,
   * Panama, Lesotho, Namibia, Liberia, Timor-Leste, ...), then a further 90
   * dropped by G6b because their currency is named after them. 88 survive.
   */
  country_currency: {
    key: "country_currency",
    label: "Currencies",
    answerType: "name",
    ask: (l) => `What is the official currency of ${l}?`,
    phrasingGoal: "which CURRENCY the country named in the subject uses",
    entityValued: true,
    // Eponymy is the NORM here (51%) and gives the grid away — gate it hard.
    eponymGate: true,
    sparql: (o) => sovereignStateQuery({ property: "P38", withContinent: true, ...o }),
  },

  /**
   * P246 = chemical symbol. Live shape: 118 elements above the floor, 118 clean
   * — the only category probed with ZERO multi-value ambiguity. The answer is a
   * literal, not an entity, so there is no label to resolve and no `mul` trap.
   */
  element_symbol: {
    key: "element_symbol",
    label: "Chemical symbols",
    answerType: "symbol",
    ask: (l) => `What is the chemical symbol for ${l}?`,
    phrasingGoal: "which one-or-two-letter CHEMICAL SYMBOL belongs to the element named in the subject",
    entityValued: false,
    // OFF: the symbol is derived from the name — that IS the question.
    eponymGate: false,
    sparql: (o) => `SELECT ?item ?val ?links WHERE {
  ?item wdt:P31 wd:Q11344 ;
        wdt:P246 ?val ;
        wikibase:sitelinks ?links .
  FILTER(?links >= ${o.minNotability})
}
LIMIT ${o.limit}`,
    // G5, and the single most valuable cross-check in this module: the element's
    // own English description states its symbol, so structured and prose values
    // can be compared directly. LIVE CATCH: Q1832 (gadolinium) is described as
    // "chemical element with symbol H and atomic number 64" — hydrogen's symbol
    // against gadolinium's atomic number. P246 says "Gd" and is correct, but a
    // fact whose own source text contradicts it is not one to put on screen
    // under a citation pointing at that same text.
    crossCheck: ({ answerLabel, subject }) => {
      const m = SYMBOL_CLAIM.exec(subject.description);
      if (!m) return null;
      return m[1] === answerLabel
        ? null
        : `description says symbol ${m[1]}, structured data says ${answerLabel}`;
    },
  },

  /**
   * P1086 = atomic number. Same immaculate pool as element_symbol, but a NUMERIC
   * answer type, which exercises the numeric decoy strategy on data that is
   * actually clean (unlike mountain elevation — see the drop notes above).
   */
  element_atomic_number: {
    key: "element_atomic_number",
    label: "Atomic numbers",
    answerType: "number",
    ask: (l) => `What is the atomic number of ${l}?`,
    phrasingGoal: "what the ATOMIC NUMBER of the element named in the subject is",
    entityValued: false,
    // OFF: a number can never name its subject.
    eponymGate: false,
    sparql: (o) => `SELECT ?item ?val ?links WHERE {
  ?item wdt:P31 wd:Q11344 ;
        wdt:P1086 ?val ;
        wikibase:sitelinks ?links .
  FILTER(?links >= ${o.minNotability})
}
LIMIT ${o.limit}`,
    crossCheck: ({ answerNumber, subject }) => {
      const m = ATOMIC_NUMBER_CLAIM.exec(subject.description);
      if (!m || answerNumber === undefined) return null;
      return Number(m[1]) === answerNumber
        ? null
        : `description says atomic number ${m[1]}, structured data says ${answerNumber}`;
    },
  },
};

export const QUIZ_CATEGORY_KEYS = Object.keys(QUIZ_CATEGORIES) as QuizCategoryKey[];

/* ------------------------------------------------------------------ *
 * Gates
 * ------------------------------------------------------------------ */

export interface RawStatementRow {
  subjectQid: string;
  /** Entity QID or literal, depending on the category. */
  value: string;
  numericValue?: number;
  notability: number;
  rank: "PreferredRank" | "NormalRank" | "DeprecatedRank" | string;
  /** pq:P582 end time, when the statement has one. */
  endTime?: string;
  group?: string;
}

/**
 * G2: keep only statements that are still current — non-deprecated and without
 * an end time. See the header: without this, 41 of 197 countries look ambiguous
 * purely because they have historical capitals recorded.
 */
export function currentStatements(rows: readonly RawStatementRow[]): RawStatementRow[] {
  return rows.filter((r) => !r.endTime && r.rank !== "DeprecatedRank");
}

/**
 * G1: one row per subject, and ONLY for subjects with a single distinct current
 * value. The direct generalisation of the year build's `groupUnambiguous` —
 * same rule, any value type.
 */
export function groupUnambiguousValues(rows: readonly RawStatementRow[]): {
  kept: RawStatementRow[];
  droppedAmbiguous: string[];
} {
  const bySubject = new Map<string, RawStatementRow[]>();
  for (const row of currentStatements(rows)) {
    if (!row.subjectQid || !row.value) continue;
    const list = bySubject.get(row.subjectQid);
    if (list) list.push(row);
    else bySubject.set(row.subjectQid, [row]);
  }
  const kept: RawStatementRow[] = [];
  const droppedAmbiguous: string[] = [];
  for (const [qid, list] of bySubject) {
    const distinct = new Set(list.map((r) => r.value));
    if (distinct.size !== 1) {
      droppedAmbiguous.push(qid);
      continue;
    }
    // Prefer a preferred-rank row when one exists; otherwise the first.
    kept.push(list.find((r) => r.rank === "PreferredRank") ?? list[0]);
  }
  return { kept, droppedAmbiguous };
}

/**
 * G6a: the answer IS the subject. A dead round in every category, so this gate
 * is universal. Live cases are the city-states — Singapore, San Marino,
 * Luxembourg, Vatican City, Monaco and Djibouti each have a capital equal to the
 * country name — 6 of 189 clean capitals.
 *
 * Note the deliberate use of EQUALITY, not substring containment. The first
 * version of this gate used `s.includes(a) || a.includes(s)`, which is a
 * capital-city intuition ("Singapore" appears inside "Singapore") applied to
 * value types where it means nothing. Measured against live Wikidata it deleted:
 *   · 59 of 118 chemical elements (50%), ZERO of them degenerate — a symbol is
 *     DERIVED from the element's name, so "lutetium → Lu", "nobelium → No" and
 *     "hydrogen → H" are the canonical form of the question, not a defect;
 *   · 76 of 178 currencies (43%), ZERO of them degenerate — "Georgia → Georgian
 *     lari", "India → Indian rupee", "Australia → Australian dollar" are killed
 *     purely by adjectival morphology;
 *   · and 8 of 189 capitals that were never degenerate either, including
 *     "Tunisia → Tunis", which is an accident of spelling rather than a giveaway.
 * Same failure shape as the contested-subject list before it was scoped: one
 * category's editorial rule silently applied to categories it does not fit.
 */
export function answerEqualsSubject(subjectLabel: string, answerLabel: string): boolean {
  const s = normalizeName(subjectLabel);
  const a = normalizeName(answerLabel);
  return !!s && s === a;
}

/**
 * G6b: the answer NAMES its own subject, so the round is solvable without
 * knowing anything — the viewer just matches the word in the question to the
 * word in the option. "What is the capital of Mexico?" → "Mexico City", next to
 * three decoys that do not say Mexico.
 *
 * This is a giveaway rule, not a truth rule: every fact it drops is CORRECT.
 * That is exactly why it is per-category (`CategorySpec.eponymGate`) rather than
 * global — whether eponymy is a defect depends entirely on the category:
 *   · capital_city  — ON. Eponymy is the EXCEPTION (14 of 189, 7%), so gating it
 *     costs almost nothing and removes the only rounds a viewer can free-ride.
 *   · country_currency — ON, and load-bearing. Eponymy is the NORM here (90 of
 *     178, 51%): Wikidata's currency labels embed the country adjective, and
 *     because decoys are drawn from the same continent they carry THEIR
 *     countries' adjectives too, so the grid reads "pick the one that matches
 *     the question". 88 non-eponymous currencies survive and are real rounds:
 *     Indonesia → rupiah, South Africa → rand, Cambodia → riel, Peru → sol,
 *     Papua New Guinea → kina, Malta → euro.
 *   · element_symbol / element_atomic_number — OFF. A symbol derived from the
 *     element's name is the entire content of the question.
 *
 * Matching is on shared WORDS and shared stems, never raw substrings. That
 * catches the eponyms ("Mexico → Mexico City", "El Salvador → San Salvador",
 * "Andorra → Andorra la Vella", "Georgia → Georgian lari") and the
 * shared-etymology pairs where the country is named after the city
 * ("Tunisia → Tunis"), while leaving unrelated names alone ("Peru → Lima").
 *
 * KNOWN RESIDUAL, stated rather than hidden: "Algeria → Algiers" is the same
 * etymological relationship as Tunisia/Tunis but diverges at the 4th character,
 * so no cheap prefix rule groups the two. It ships. This gate is a conservative
 * quality filter, not a correctness one — everything it drops is TRUE, and
 * everything it misses is still a correct, citable round.
 */
export const EPONYM_STEM_LENGTH = 4;

export function answerNamesSubject(subjectLabel: string, answerLabel: string): boolean {
  const subjectTokens = normalizeName(subjectLabel).split(" ").filter((t) => t.length >= EPONYM_STEM_LENGTH);
  const answerTokens = normalizeName(answerLabel).split(" ").filter((t) => t.length >= EPONYM_STEM_LENGTH);
  if (!subjectTokens.length || !answerTokens.length) return false;
  return subjectTokens.some((s) =>
    answerTokens.some((a) => {
      if (s === a) return true;
      // A shared FIXED-LENGTH stem catches the adjectival forms
      // ("Georgia"/"Georgian", "Turkey"/"Turkish", "Canada"/"Canadian",
      // "Barbados"/"Barbadian"). An earlier version compared
      // `min(len_s, len_a, 6)` characters, which is longer than the shared root
      // in exactly the cases that matter — a live probe caught "Turkey →
      // Turkish lira" and "Canada → Canadian dollar" shipping through it.
      return s.slice(0, EPONYM_STEM_LENGTH) === a.slice(0, EPONYM_STEM_LENGTH);
    }),
  );
}

export interface CategoryFactIntegrityOptions {
  allowSensitiveTopics?: boolean;
  allowContestedSubjects?: boolean;
}

/**
 * Every non-structural gate applied to one labelled candidate. Returns the list
 * of reasons the fact is unusable; empty means it passed.
 */
export function categoryFactDefects(
  fact: QuizCategoryFact,
  meta: { subject: EntityMeta; answer?: EntityMeta },
  options: CategoryFactIntegrityOptions = {},
): string[] {
  const defects: string[] = [];
  const spec = QUIZ_CATEGORIES[fact.categoryKey];
  if (!spec) return [`unknown category ${fact.categoryKey}`];

  const subject = fact.subjectLabel.trim();
  const answer = fact.answerLabel.trim();
  if (!subject) defects.push("empty subject label");
  if (!answer) defects.push("empty answer label");
  // G4's failure mode reaching the screen: the label service and the sitelink
  // fallback both came up empty, so the QID itself would be rendered.
  if (/^Q\d+$/.test(subject)) defects.push(`unresolved subject label (${subject})`);
  if (/^Q\d+$/.test(answer)) defects.push(`unresolved answer label (${answer})`);
  if (subject.length > 60) defects.push("subject label too long for a quiz card");
  if (answer.length > 42) defects.push("answer label too long for an option tile");
  if (!/^Q\d+$/.test(fact.subjectQid)) defects.push("malformed subject QID");
  if (fact.sourceUrl !== wikidataSourceUrl(fact.subjectQid)) {
    defects.push("sourceUrl does not match subject QID");
  }
  if ((fact.answerType === "year" || fact.answerType === "number") && !Number.isFinite(fact.answerNumber)) {
    defects.push("numeric answer has no numeric value");
  }

  // G6a — universal: the answer IS the subject.
  if (answerEqualsSubject(subject, answer)) {
    defects.push(`answer restates the subject (${subject} → ${answer})`);
  } else if (spec.eponymGate && answerNamesSubject(subject, answer)) {
    // G6b — per-category: the answer NAMES the subject, so the grid gives
    // itself away. Never applied to the element categories, where a symbol
    // derived from the element's name is the whole point of the question.
    defects.push(`answer names the subject, round is a giveaway (${subject} → ${answer})`);
  }

  // G7
  if (!options.allowContestedSubjects && isContestedFor(fact.subjectQid, fact.categoryKey)) {
    defects.push(`contested subject: ${CONTESTED_SUBJECT_QIDS[fact.subjectQid].reason}`);
  }

  // G5
  const conflict = spec.crossCheck?.({
    subject: meta.subject,
    subjectLabel: subject,
    answerLabel: answer,
    ...(fact.answerNumber !== undefined ? { answerNumber: fact.answerNumber } : {}),
    ...(meta.answer ? { answerMeta: meta.answer } : {}),
  });
  if (conflict) defects.push(`cross-check conflict: ${conflict}`);

  // G8
  if (
    !options.allowSensitiveTopics &&
    isSensitiveText(`${subject} ${answer}`, `${fact.subjectDescription} ${meta.answer?.description ?? ""}`)
  ) {
    defects.push("sensitive/tragedy content excluded by default");
  }
  return defects;
}

/* ------------------------------------------------------------------ *
 * Sourcing
 * ------------------------------------------------------------------ */

export interface FetchCategoryFactsArgs extends SparqlFetchOptions, CategoryFactIntegrityOptions {
  category: QuizCategoryKey;
  /** How many clean facts the caller wants. Default 10. */
  count?: number;
  /** Minimum sitelink count — how widely known the subject must be. */
  minNotability?: number;
  /** Subject QIDs already used by this channel; excluded for dedupe. */
  excludeQids?: readonly string[];
}

export interface FetchCategoryFactsResult {
  facts: QuizCategoryFact[];
  /**
   * Real, sourced values from this same category that were NOT selected as
   * answers. Decoys are drawn from here, so every wrong option on screen is a
   * genuine capital/currency/symbol rather than an invented string.
   */
  decoyPool: QuizDecoyCandidate[];
  /** Per-gate drop counts — surfaced so a thin harvest is diagnosable. */
  rejected: {
    ambiguousValue: number;
    unresolvedLabel: number;
    crossCheckConflict: number;
    /** G6a — the answer is the subject. */
    degenerate: number;
    /** G6b — the answer names the subject (eponym-gated categories only). */
    eponymous: number;
    contested: number;
    sensitive: number;
    /** Answer already used by an earlier fact in this same category. */
    duplicateAnswer: number;
    duplicate: number;
    other: number;
  };
  candidatesExamined: number;
}

export async function fetchCategoryFacts(
  args: FetchCategoryFactsArgs,
): Promise<FetchCategoryFactsResult> {
  const spec = QUIZ_CATEGORIES[args.category];
  if (!spec) throw new Error(`unknown quiz category: ${args.category}`);
  const count = Math.max(1, Math.min(50, args.count ?? 10));
  const log = args.log ?? (() => {});
  const rejected = {
    ambiguousValue: 0,
    unresolvedLabel: 0,
    crossCheckConflict: 0,
    degenerate: 0,
    eponymous: 0,
    contested: 0,
    sensitive: 0,
    duplicateAnswer: 0,
    duplicate: 0,
    other: 0,
  };

  const bindings = await runSparql(
    spec.sparql({
      minNotability: args.minNotability ?? 40,
      // These pools are small and bounded (≈200 countries, 118 elements), so a
      // flat generous limit beats the year build's count*40 heuristic: one query
      // sweeps the whole pool and the gates run over all of it.
      limit: 900,
    }),
    args,
  );

  const rows: RawStatementRow[] = bindings
    .map((b) => {
      const raw = b.val?.value ?? "";
      const value = spec.entityValued ? qidFromUri(raw) : raw;
      const numeric = Number(raw);
      return {
        subjectQid: qidFromUri(b.item?.value ?? ""),
        value,
        ...(spec.answerType === "number" && Number.isFinite(numeric) ? { numericValue: numeric } : {}),
        notability: Number(b.links?.value ?? 0),
        // Literal-valued categories query the truthy path and have no ?rank, so
        // default to NormalRank rather than dropping every row.
        rank: (b.rank?.value ?? "").split("#")[1] || "NormalRank",
        ...(b.end?.value ? { endTime: b.end.value } : {}),
        ...(b.group?.value ? { group: qidFromUri(b.group.value) } : {}),
      } as RawStatementRow;
    })
    .filter((r) => /^Q\d+$/.test(r.subjectQid) && r.value);

  const grouped = groupUnambiguousValues(rows);
  rejected.ambiguousValue = grouped.droppedAmbiguous.length;

  const exclude = new Set(args.excludeQids ?? []);
  const ordered = grouped.kept
    .filter((r) => !exclude.has(r.subjectQid))
    .sort((a, b) => b.notability - a.notability);
  rejected.duplicate = grouped.kept.length - ordered.length;

  if (!ordered.length) {
    return { facts: [], decoyPool: [], rejected, candidatesExamined: rows.length };
  }

  // Resolve display metadata for every subject, every entity-valued answer and
  // every decoy-grouping entity in ONE batched pass.
  const needed = [
    ...ordered.map((r) => r.subjectQid),
    ...(spec.entityValued ? ordered.map((r) => r.value) : []),
  ];
  const meta = await resolveEntityMeta(needed, args);

  const facts: QuizCategoryFact[] = [];
  const decoyPool: QuizDecoyCandidate[] = [];
  const seenAnswers = new Set<string>();
  /** Answers already SELECTED as a round's truth (superset guard, see below). */
  const usedAnswers = new Set<string>();

  for (const row of ordered) {
    const subjectMeta = meta.get(row.subjectQid);
    if (!subjectMeta || !subjectMeta.label) {
      rejected.unresolvedLabel += 1;
      continue;
    }
    const answerMeta = spec.entityValued ? meta.get(row.value) : undefined;
    const answerLabel = spec.entityValued ? (answerMeta?.label ?? "") : row.value;
    if (!answerLabel) {
      rejected.unresolvedLabel += 1;
      continue;
    }

    const fact: QuizCategoryFact = {
      categoryKey: spec.key,
      answerType: spec.answerType,
      subjectLabel: subjectMeta.label,
      subjectQid: row.subjectQid,
      subjectDescription: subjectMeta.description,
      answerLabel,
      ...(row.numericValue !== undefined ? { answerNumber: row.numericValue } : {}),
      ...(spec.entityValued ? { answerQid: row.value } : {}),
      sourceUrl: wikidataSourceUrl(row.subjectQid),
      notability: row.notability,
      ...(row.group ? { decoyGroup: row.group } : {}),
    };

    const defects = categoryFactDefects(fact, { subject: subjectMeta, ...(answerMeta ? { answer: answerMeta } : {}) }, args);
    if (defects.length) {
      if (defects.some((d) => d.startsWith("cross-check"))) rejected.crossCheckConflict += 1;
      else if (defects.some((d) => d.startsWith("answer restates"))) rejected.degenerate += 1;
      else if (defects.some((d) => d.startsWith("answer names"))) rejected.eponymous += 1;
      else if (defects.some((d) => d.startsWith("contested"))) rejected.contested += 1;
      else if (defects.some((d) => d.startsWith("sensitive"))) rejected.sensitive += 1;
      else if (defects.some((d) => d.includes("unresolved"))) rejected.unresolvedLabel += 1;
      else rejected.other += 1;
      log(`quizFacts[${spec.key}]: dropped ${row.subjectQid} (${defects.join("; ")})`);
      continue;
    }

    // Everything that SURVIVES the gates is a legitimate decoy for a different
    // subject in the same category, whether or not it is selected as an answer.
    const answerKey = normalizeName(answerLabel);
    const answerAlreadyPooled = seenAnswers.has(answerKey);
    if (!answerAlreadyPooled) {
      seenAnswers.add(answerKey);
      decoyPool.push({
        label: answerLabel,
        ...(fact.answerQid ? { qid: fact.answerQid } : {}),
        ...(fact.answerNumber !== undefined ? { number: fact.answerNumber } : {}),
        ...(fact.decoyGroup ? { group: fact.decoyGroup } : {}),
      });
    }

    // Never SELECT two facts with the same answer. Live driver: 22 eurozone
    // countries (Malta, Monaco, Montenegro, San Marino, Vatican City, ...) all
    // answer "euro", so a two-currency video could otherwise ask two different
    // questions with the same option highlighted twice. The duplicate is still
    // a perfectly good decoy, which is why it stays in the pool above.
    if (answerAlreadyPooled && usedAnswers.has(answerKey)) {
      rejected.duplicateAnswer += 1;
      continue;
    }
    if (facts.length < count) {
      usedAnswers.add(answerKey);
      facts.push(fact);
    }
  }

  log(
    `quizFacts[${spec.key}]: ${facts.length}/${count} clean from ${rows.length} raw rows ` +
      `(pool=${decoyPool.length} ambiguous=${rejected.ambiguousValue} crossCheck=${rejected.crossCheckConflict} ` +
      `degenerate=${rejected.degenerate} eponymous=${rejected.eponymous} contested=${rejected.contested} ` +
      `dupAnswer=${rejected.duplicateAnswer} unresolvedLabel=${rejected.unresolvedLabel})`,
  );
  return { facts, decoyPool, rejected, candidatesExamined: rows.length };
}

/* ------------------------------------------------------------------ *
 * Question text — the LLM may phrase, but never supply, the answer
 * ------------------------------------------------------------------ */

export interface QuizQuestion {
  fact: QuizCategoryFact;
  /** On-screen prompt. Cannot contain the answer, by construction. */
  questionText: string;
  phrasedByModel: boolean;
}

/** Matches a plausible historical year, 1500–2029. */
const YEAR_PATTERN = /\b(1[5-9]\d{2}|20[0-2]\d)\b/g;

export function deterministicCategoryQuestion(fact: QuizCategoryFact): string {
  return QUIZ_CATEGORIES[fact.categoryKey].ask(fact.subjectLabel);
}

/**
 * Reject a phrasing that could corrupt or spoil the answer.
 *
 * The year build's rule was "no four-digit number". Generalised, the rule is
 * "the question may not contain the answer, in any form its value type can
 * take": the literal answer text for place/name/symbol answers, any four-digit
 * number for years, and any standalone number for numeric answers. Combined
 * with a response schema that has no answer field, there is no path by which a
 * model-produced value can become the answer.
 */
export function questionTextDefects(fact: QuizCategoryFact, questionText: string): string[] {
  const defects: string[] = [];
  const text = questionText.trim();
  if (!text) return ["empty question text"];
  if (text.length < 12) defects.push("question too short");
  if (text.length > 160) defects.push("question too long for a quiz card");
  if (!text.includes("?")) defects.push("question is not phrased as a question");

  if (fact.answerType === "year") {
    const years = [...text.matchAll(YEAR_PATTERN)].map((m) => m[1]);
    if (years.length) {
      defects.push(
        years.includes(String(fact.answerNumber))
          ? `question spoils the answer (contains ${fact.answerNumber})`
          : `question contains an unsourced year (${years.join(", ")})`,
      );
    }
    if (/\b\d{4}\b/.test(text)) defects.push("question contains a four-digit number");
  } else if (fact.answerType === "number") {
    if (fact.answerNumber !== undefined && new RegExp(`\\b${fact.answerNumber}\\b`).test(text)) {
      defects.push(`question spoils the answer (contains ${fact.answerNumber})`);
    }
  } else if (containsPhrase(text, fact.answerLabel)) {
    // Word-boundary, not substring — see containsPhrase. "Au" must not be
    // flagged inside "about", and must be flagged when it stands alone.
    defects.push(`question spoils the answer (contains "${fact.answerLabel}")`);
  }
  return defects;
}

export interface PhraseQuizQuestionArgs {
  fact: QuizCategoryFact;
  critiqueBrief?: string;
  /**
   * Model call. NOTE the return type: `{ question: string }` and nothing else.
   * There is deliberately no answer field for a model to populate.
   */
  askModel?: (prompt: string) => Promise<{ question?: unknown }>;
  log?: (msg: string) => void;
}

export async function phraseQuizQuestion(args: PhraseQuizQuestionArgs): Promise<QuizQuestion> {
  const { fact } = args;
  const spec = QUIZ_CATEGORIES[fact.categoryKey];
  const fallback: QuizQuestion = {
    fact,
    questionText: deterministicCategoryQuestion(fact),
    phrasedByModel: false,
  };
  if (!args.askModel) return fallback;
  const log = args.log ?? (() => {});

  const prompt =
    `You write ONE line of on-screen text for a multiple-choice quiz video.\n\n` +
    (args.critiqueBrief ? `${args.critiqueBrief}\n` : "") +
    `SUBJECT: ${fact.subjectLabel}\n` +
    (fact.subjectDescription ? `CONTEXT: ${fact.subjectDescription}\n` : "") +
    `THE QUESTION MUST ASK: ${spec.phrasingGoal}\n\n` +
    `Write a short, punchy question.\n` +
    `HARD RULES:\n` +
    `- NEVER write the answer, or any part of it, or a hint that narrows it to one option.\n` +
    `- NEVER write any year or any four-digit number.\n` +
    `- One sentence, under 140 characters, ending in a question mark.\n` +
    `- Plain viewer-facing language. No preamble, no quotes around it.\n\n` +
    `Return JSON: {"question": "..."}`;

  try {
    const raw = await args.askModel(prompt);
    const candidate = typeof raw?.question === "string" ? raw.question.trim() : "";
    if (!candidate) {
      log(`quizFacts: model returned no question for ${fact.subjectQid} — deterministic text`);
      return fallback;
    }
    const defects = questionTextDefects(fact, candidate);
    if (defects.length) {
      log(`quizFacts: rejected model phrasing (${defects.join("; ")}) — deterministic text`);
      return fallback;
    }
    return { fact, questionText: candidate, phrasedByModel: true };
  } catch (e) {
    log(`quizFacts: phrasing model failed (${e instanceof Error ? e.message : e}) — deterministic text`);
    return fallback;
  }
}

/* ------------------------------------------------------------------ *
 * Options — exactly one sourced truth, three inert decoys
 * ------------------------------------------------------------------ */

/**
 * PROVENANCE IS PART OF THE TYPE, not a convention.
 *
 * A four-option quiz puts three WRONG values on screen next to the real one.
 * Tagging every option makes the distinction impossible to lose: any code that
 * needs the truth filters on `provenance === "wikidata-sourced"`, and
 * `assertQuizOptionIntegrity` proves that exactly one option carries that tag
 * and that its value equals the sourced value. A decoy can therefore never be
 * promoted to an answer by a refactor, a serialisation round-trip or a
 * checkpoint replay.
 *
 * The tag values are unchanged from the year build so a stored checkpoint from
 * before this refactor still reads correctly.
 */
export type QuizOptionProvenance = "wikidata-sourced" | "generated-decoy";

export interface QuizOption {
  /** Rendered text for this option. */
  label: string;
  /** Numeric form for year/number answers; absent otherwise. */
  value?: number;
  isCorrect: boolean;
  provenance: QuizOptionProvenance;
}

export const QUIZ_OPTION_COUNT = 4;
/** Minimum gap between numeric options. Below this the question gets debatable. */
export const MIN_OPTION_GAP_YEARS = 3;
/** Widest a year decoy may sit from the truth — still period-plausible. */
export const MAX_OPTION_SPREAD_YEARS = 40;

/**
 * Small deterministic PRNG (mulberry32) seeded from the subject QID.
 *
 * Determinism matters for more than tidiness: the question set is frozen into a
 * content-addressed checkpoint, so a healer replay MUST regenerate identical
 * options. `Math.random()` would make a replayed video disagree with the one
 * already rendered.
 */
export function seededRandom(seed: string): () => number {
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
 * Numeric decoys (year + number): period-plausible neighbours on both sides of
 * the truth, never closer than `minGap`, never outside [floor, ceiling], so the
 * answer is neither arguable nor findable by spotting the one plausible value.
 */
function numericDecoys(args: {
  value: number;
  rand: () => number;
  minGap: number;
  maxSpread: number;
  floor: number;
  ceiling: number;
}): number[] {
  const chosen = [args.value];
  const fits = (c: number) =>
    c >= args.floor &&
    c <= args.ceiling &&
    Number.isFinite(c) &&
    chosen.every((v) => Math.abs(v - c) >= args.minGap);

  let guard = 0;
  while (chosen.length < QUIZ_OPTION_COUNT && guard++ < 500) {
    const magnitude = args.minGap + Math.floor(args.rand() * (args.maxSpread - args.minGap + 1));
    const candidate = args.value + (args.rand() < 0.5 ? -magnitude : magnitude);
    if (fits(candidate)) chosen.push(candidate);
  }
  // Degenerate ranges (a value at the very edge of the allowed window) fall back
  // to a deterministic outward walk so we always return four distinct values.
  let step = args.minGap;
  while (chosen.length < QUIZ_OPTION_COUNT && step < args.minGap * 200) {
    for (const sign of [1, -1]) {
      const candidate = args.value + sign * step;
      if (chosen.length < QUIZ_OPTION_COUNT && fits(candidate)) chosen.push(candidate);
    }
    step += args.minGap;
  }
  return chosen.slice(1);
}

/**
 * Name-shaped decoys (place / name / symbol): drawn from the REAL sourced pool,
 * never invented.
 *
 * Two rules beyond "not the answer":
 *  - SAME-REGION PREFERENCE. Decoys sharing the fact's `decoyGroup` (continent)
 *    are used first, so "capital of Peru" does not offer Oslo, Tokyo and Cairo
 *    and give itself away by geography.
 *  - CONFUSABILITY GUARD. A decoy sharing a significant word with the answer is
 *    skipped. This is not cosmetic: Wikidata's currency pool contains both
 *    "West African CFA franc" and "Central African CFA franc", and Ghana's
 *    "Ghana cedi" sits next to "Ghana Pesewa". Offering one as the wrong answer
 *    to the other's question produces a round the viewer can legitimately argue
 *    about, which is the exact failure the year build's MIN_OPTION_GAP existed
 *    to prevent, in name space instead of number space.
 */
function nameDecoys(args: {
  fact: QuizCategoryFact;
  pool: readonly QuizDecoyCandidate[];
  rand: () => number;
}): string[] {
  const answerNorm = normalizeName(args.fact.answerLabel);
  const answerTokens = new Set(answerNorm.split(" ").filter((t) => t.length > 3));

  const usable = args.pool.filter((c) => {
    const n = normalizeName(c.label);
    if (!n || n === answerNorm) return false;
    if (args.fact.answerQid && c.qid && c.qid === args.fact.answerQid) return false;
    // Never offer the subject itself as a wrong answer — it reads as a typo.
    if (n === normalizeName(args.fact.subjectLabel)) return false;
    if (c.label.length > 42) return false;
    const tokens = n.split(" ").filter((t) => t.length > 3);
    if (tokens.some((t) => answerTokens.has(t))) return false;
    return true;
  });

  const sameRegion = args.fact.decoyGroup
    ? usable.filter((c) => c.group === args.fact.decoyGroup)
    : [];
  const rest = usable.filter((c) => !sameRegion.includes(c));

  const pick = (from: QuizDecoyCandidate[], out: string[]) => {
    const bag = [...from];
    while (bag.length && out.length < QUIZ_OPTION_COUNT - 1) {
      const idx = Math.floor(args.rand() * bag.length);
      const [taken] = bag.splice(idx, 1);
      if (!out.some((existing) => normalizeName(existing) === normalizeName(taken.label))) {
        out.push(taken.label);
      }
    }
  };
  const out: string[] = [];
  pick(sameRegion, out);
  pick(rest, out);
  return out;
}

/**
 * Build the four on-screen options for a fact: the sourced answer plus three
 * decoys appropriate to its value type.
 *
 * Throws when the pool cannot supply three usable decoys, rather than padding
 * with invented values — the caller drops the round instead. An invented place
 * name on screen would be worse than one fewer question.
 */
export function buildQuizOptions(
  fact: QuizCategoryFact,
  opts: { pool?: readonly QuizDecoyCandidate[]; nowYear?: number } = {},
): QuizOption[] {
  const rand = seededRandom(`${fact.subjectQid}:${fact.answerLabel}`);
  const options: QuizOption[] = [
    {
      label: fact.answerLabel,
      ...(fact.answerNumber !== undefined ? { value: fact.answerNumber } : {}),
      isCorrect: true,
      provenance: "wikidata-sourced",
    },
  ];

  if (fact.answerType === "year" || fact.answerType === "number") {
    const value = fact.answerNumber;
    if (value === undefined) throw new Error(`quiz options: ${fact.subjectQid} has no numeric answer`);
    const isYear = fact.answerType === "year";
    const decoys = numericDecoys({
      value,
      rand,
      minGap: isYear ? MIN_OPTION_GAP_YEARS : Math.max(1, Math.round(Math.abs(value) * 0.06) || 1),
      maxSpread: isYear ? MAX_OPTION_SPREAD_YEARS : Math.max(3, Math.round(Math.abs(value) * 0.45) || 3),
      floor: isYear ? 1400 : 1,
      ceiling: isYear ? (opts.nowYear ?? new Date().getUTCFullYear()) : Math.max(value * 3, value + 20),
    });
    if (decoys.length < QUIZ_OPTION_COUNT - 1) {
      throw new Error(`quiz options: could not build ${QUIZ_OPTION_COUNT - 1} numeric decoys for ${fact.subjectQid}`);
    }
    for (const d of decoys) {
      options.push({ label: String(d), value: d, isCorrect: false, provenance: "generated-decoy" });
    }
  } else {
    const decoys = nameDecoys({ fact, pool: opts.pool ?? [], rand });
    if (decoys.length < QUIZ_OPTION_COUNT - 1) {
      throw new Error(
        `quiz options: only ${decoys.length} usable decoys for ${fact.subjectQid} ` +
          `(${fact.categoryKey}); refusing to invent the rest`,
      );
    }
    for (const d of decoys) {
      options.push({ label: d, isCorrect: false, provenance: "generated-decoy" });
    }
  }

  // Shuffle deterministically so the truth is not always in position 0.
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

/**
 * Prove the option set is safe to render: exactly one sourced option, its value
 * equal to the sourced fact, no duplicate or confusable options, and no decoy
 * ever flagged correct. Throws — a violation here would put a wrong answer on
 * screen under a citation that says otherwise.
 */
export function assertQuizOptionIntegrity(
  options: readonly QuizOption[],
  fact: QuizCategoryFact,
): void {
  if (options.length !== QUIZ_OPTION_COUNT) {
    throw new Error(`quiz options: expected ${QUIZ_OPTION_COUNT}, got ${options.length}`);
  }
  const sourced = options.filter((o) => o.provenance === "wikidata-sourced");
  if (sourced.length !== 1) {
    throw new Error(`quiz options: expected exactly 1 sourced option, got ${sourced.length}`);
  }
  if (sourced[0].label !== fact.answerLabel) {
    throw new Error(`quiz options: sourced option "${sourced[0].label}" != Wikidata answer "${fact.answerLabel}"`);
  }
  if (fact.answerNumber !== undefined && sourced[0].value !== fact.answerNumber) {
    throw new Error(`quiz options: sourced value ${sourced[0].value} != Wikidata value ${fact.answerNumber}`);
  }
  const correct = options.filter((o) => o.isCorrect);
  if (correct.length !== 1 || correct[0].provenance !== "wikidata-sourced") {
    throw new Error("quiz options: the correct option must be the sourced one");
  }
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      const a = options[i];
      const b = options[j];
      if (normalizeName(a.label) === normalizeName(b.label)) {
        throw new Error(`quiz options: duplicate option "${a.label}"`);
      }
      if (
        a.value !== undefined &&
        b.value !== undefined &&
        (fact.answerType === "year"
          ? Math.abs(a.value - b.value) < MIN_OPTION_GAP_YEARS
          : a.value === b.value)
      ) {
        throw new Error(`quiz options: ${a.value} and ${b.value} are too close to distinguish`);
      }
    }
  }
}

/**
 * Final assertion before render. Throws rather than returning defects because by
 * this point a mismatch would mean the answer on screen disagrees with the cited
 * source — never something to degrade past.
 */
export function assertQuizAnswerIntegrity(question: QuizQuestion, sourceFact: QuizCategoryFact): void {
  if (question.fact.subjectQid !== sourceFact.subjectQid) {
    throw new Error(
      `quiz answer integrity: subject drift (${question.fact.subjectQid} vs ${sourceFact.subjectQid})`,
    );
  }
  if (question.fact.answerLabel !== sourceFact.answerLabel) {
    throw new Error(
      `quiz answer integrity: answer drift ("${question.fact.answerLabel}" vs sourced "${sourceFact.answerLabel}")`,
    );
  }
  if (question.fact.answerNumber !== sourceFact.answerNumber) {
    throw new Error(
      `quiz answer integrity: numeric drift (${question.fact.answerNumber} vs sourced ${sourceFact.answerNumber})`,
    );
  }
  const defects = questionTextDefects(sourceFact, question.questionText);
  if (defects.length) {
    throw new Error(`quiz answer integrity: ${defects.join("; ")}`);
  }
}
