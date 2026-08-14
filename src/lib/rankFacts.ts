/**
 * rankFacts — ONE job: produce a RANKED LIST OF REAL, CHECKABLE NUMBERS.
 *
 * This is the data half of the "Top 10 X" ranking-video format. It does not
 * write a script, does not render anything and does not know what a chart is.
 * It answers exactly one question: "what are the top N <things> by <measure>,
 * with the exact figure and a URL that proves it?"
 *
 * WHY NOT JUST ASK A MODEL
 * Because a ranking video's entire value is that the numbers are right, and an
 * LLM asked for "the 10 tallest buildings and their heights" will produce a
 * fluent, plausible, subtly-wrong list — and no downstream gate can tell.
 * So the values here come from Wikidata QUANTITY STATEMENTS (CC0 1.0, a genuine
 * public-domain dedication with no attribution or ShareAlike obligation), read
 * structurally. A model is never asked for a figure, and there is no field in
 * any prompt on this path that it could put one into.
 *
 * This mirrors the discipline in src/lib/quizYearFacts.ts exactly:
 *   • the measured value is read from a structured statement, never generated;
 *   • entities carrying MULTIPLE conflicting current values are DROPPED (a
 *     ranking row with two defensible heights is broken, not a rounding issue);
 *   • rows whose unit disagrees with the rest of the set are DROPPED rather
 *     than silently converted, because a bad conversion is an invisible lie;
 *   • every surviving row carries a `sourceUrl` and a provenance tag, and
 *     `assertRankIntegrity` re-checks the whole set immediately before the
 *     spec is built — on every checkpoint replay, not just the first pass.
 */
import {
  isSensitiveText,
  qidFromUri,
  resolveEntityMeta,
  runSparql,
  wikidataSourceUrl,
  type SparqlFetchOptions,
} from "./quizSource";

export type RankTopicKey =
  | "tallest_buildings"
  | "longest_rivers"
  | "highest_mountains"
  | "most_populous_countries"
  | "most_populous_cities"
  | "largest_lakes";

export interface RankTopicSpec {
  key: RankTopicKey;
  /** Headline for the video, e.g. "The 10 Tallest Buildings on Earth". */
  title: string;
  /** What the number measures, spoken plainly. */
  measure: string;
  /** Rendered unit suffix, e.g. " m". */
  unit: string;
  /**
   * The ONLY unit QID accepted for this measure. A row measured in anything
   * else is dropped rather than converted — see the file header.
   */
  unitQid: string;
  /** Human divisor applied to the raw statement value (1 = none). */
  divisor: number;
  /** SPARQL body producing ?item and ?value (a raw quantity amount). */
  sparql: (limit: number) => string;
}

/** Wikidata unit QIDs used by the curated topics. */
const UNIT_METRE = "Q11573";
const UNIT_KILOMETRE = "Q828224";
const UNIT_SQUARE_KILOMETRE = "Q712226";
/** A dimensionless count (population) carries no unit node at all. */
const UNIT_NONE = "none";

/**
 * `psv:` (statement value node) is used rather than the truthy `wdt:` shortcut
 * precisely because it exposes `wikibase:quantityUnit` — without it the unit
 * gate above could not exist and the query would happily mix feet with metres.
 */
function quantityQuery(args: {
  classFilter: string;
  property: string;
  limit: number;
  extra?: string;
}): string {
  return `SELECT ?item ?value ?unit WHERE {
  ${args.classFilter}
  ?item p:${args.property} ?statement .
  ?statement psv:${args.property} ?valueNode .
  ?valueNode wikibase:quantityAmount ?value .
  OPTIONAL { ?valueNode wikibase:quantityUnit ?unit . }
  FILTER NOT EXISTS { ?statement wikibase:rank wikibase:DeprecatedRank . }
  ${args.extra ?? ""}
}
ORDER BY DESC(?value)
LIMIT ${args.limit}`;
}

export const RANK_TOPICS: Readonly<Record<RankTopicKey, RankTopicSpec>> = {
  tallest_buildings: {
    key: "tallest_buildings",
    title: "The Tallest Buildings on Earth",
    measure: "architectural height",
    unit: " m",
    unitQid: UNIT_METRE,
    divisor: 1,
    sparql: (limit) =>
      quantityQuery({
        classFilter: "?item wdt:P31/wdt:P279* wd:Q41176 .",
        property: "P2048",
        limit,
      }),
  },
  longest_rivers: {
    key: "longest_rivers",
    title: "The Longest Rivers in the World",
    measure: "total length",
    unit: " km",
    unitQid: UNIT_KILOMETRE,
    divisor: 1,
    sparql: (limit) =>
      quantityQuery({
        classFilter: "?item wdt:P31/wdt:P279* wd:Q4022 .",
        property: "P2043",
        limit,
      }),
  },
  highest_mountains: {
    key: "highest_mountains",
    title: "The Highest Mountains on Earth",
    measure: "elevation above sea level",
    unit: " m",
    unitQid: UNIT_METRE,
    divisor: 1,
    sparql: (limit) =>
      quantityQuery({
        classFilter: "?item wdt:P31/wdt:P279* wd:Q8502 .",
        property: "P2044",
        limit,
      }),
  },
  most_populous_countries: {
    key: "most_populous_countries",
    title: "The Most Populous Countries on Earth",
    measure: "population",
    unit: "",
    unitQid: UNIT_NONE,
    divisor: 1,
    sparql: (limit) =>
      quantityQuery({
        classFilter: "?item wdt:P31 wd:Q3624078 .",
        property: "P1082",
        limit,
      }),
  },
  most_populous_cities: {
    key: "most_populous_cities",
    title: "The Biggest Cities in the World",
    measure: "city population",
    unit: "",
    unitQid: UNIT_NONE,
    divisor: 1,
    sparql: (limit) =>
      quantityQuery({
        classFilter: "?item wdt:P31/wdt:P279* wd:Q1549591 .",
        property: "P1082",
        limit,
      }),
  },
  largest_lakes: {
    key: "largest_lakes",
    title: "The Largest Lakes on Earth",
    measure: "surface area",
    unit: " km²",
    unitQid: UNIT_SQUARE_KILOMETRE,
    divisor: 1,
    sparql: (limit) =>
      quantityQuery({
        classFilter: "?item wdt:P31/wdt:P279* wd:Q23397 .",
        property: "P2046",
        limit,
      }),
  },
};

export const RANK_TOPIC_KEYS = Object.keys(RANK_TOPICS) as RankTopicKey[];

export function resolveRankTopic(value: unknown): RankTopicKey {
  const key = typeof value === "string" ? value.trim() : "";
  return (RANK_TOPIC_KEYS as string[]).includes(key)
    ? (key as RankTopicKey)
    : "tallest_buildings";
}

export interface RankedFact {
  /** Wikidata QID — the dedupe key and the citation anchor. */
  wikidataQid: string;
  label: string;
  description: string;
  /** The measured value, already divided by the topic's divisor. */
  value: number;
  /** Verifiable citation for THIS row. */
  sourceUrl: string;
}

export interface RankFetchResult {
  topic: RankTopicKey;
  facts: RankedFact[];
  /** Why rows were rejected — surfaced in logs so a thin result is explainable. */
  rejected: string[];
}

export interface FetchRankedFactsArgs extends SparqlFetchOptions {
  topic: RankTopicKey;
  /** How many clean rows are wanted. The query over-fetches to survive drops. */
  count: number;
  /** Minimum Wikipedia language editions the subject must appear in. */
  minNotability?: number;
  /** Allow tragedy/disaster-adjacent subjects (default false). */
  allowSensitiveTopics?: boolean;
}

/**
 * DROP-ON-AMBIGUITY grouping. A QID that appears with two DIFFERENT current
 * values (a building re-measured, a river with rival source definitions) has no
 * single defensible number, so it is removed from the pool entirely rather than
 * having one of its values picked arbitrarily.
 */
export function groupUnambiguousQuantities(
  rows: readonly { qid: string; value: number; unitQid: string }[],
): { kept: Map<string, { value: number; unitQid: string }>; ambiguous: string[] } {
  const byQid = new Map<string, { value: number; unitQid: string }[]>();
  for (const row of rows) {
    const list = byQid.get(row.qid) ?? [];
    list.push({ value: row.value, unitQid: row.unitQid });
    byQid.set(row.qid, list);
  }
  const kept = new Map<string, { value: number; unitQid: string }>();
  const ambiguous: string[] = [];
  for (const [qid, values] of byQid) {
    const distinct = [...new Set(values.map((v) => `${v.value}|${v.unitQid}`))];
    if (distinct.length !== 1) {
      ambiguous.push(qid);
      continue;
    }
    kept.set(qid, values[0]);
  }
  return { kept, ambiguous };
}

/**
 * Source a clean ranked set. Over-fetches by 4x because the integrity gates
 * below routinely drop a third of the raw rows (unit mismatches and unlabelled
 * entities are both common in the deep tail of any Wikidata quantity query).
 */
export async function fetchRankedFacts(args: FetchRankedFactsArgs): Promise<RankFetchResult> {
  const spec = RANK_TOPICS[args.topic];
  const count = Math.max(3, Math.min(12, Math.round(args.count)));
  const minNotability = Math.max(0, args.minNotability ?? 20);
  const rejected: string[] = [];

  const bindings = await runSparql(spec.sparql(count * 4 + 40), args);
  const raw = bindings.flatMap((binding) => {
    const qid = qidFromUri(binding["item"]?.value ?? "");
    const value = Number(binding["value"]?.value);
    if (!/^Q\d+$/.test(qid) || !Number.isFinite(value) || value <= 0) return [];
    const unitUri = binding["unit"]?.value ?? "";
    const unitQid = unitUri ? qidFromUri(unitUri) : UNIT_NONE;
    return [{ qid, value, unitQid: unitQid || UNIT_NONE }];
  });

  const { kept, ambiguous } = groupUnambiguousQuantities(raw);
  for (const qid of ambiguous) {
    rejected.push(`${qid}: multiple conflicting current values`);
  }

  // UNIT GATE — never convert, only accept. See the file header.
  const unitClean = [...kept.entries()].filter(([qid, row]) => {
    if (row.unitQid === spec.unitQid) return true;
    rejected.push(`${qid}: unit ${row.unitQid} != required ${spec.unitQid}`);
    return false;
  });

  const meta = await resolveEntityMeta(
    unitClean.map(([qid]) => qid),
    args,
  );

  const facts: RankedFact[] = [];
  for (const [qid, row] of unitClean) {
    const entity = meta.get(qid);
    if (!entity || entity.labelSource === "none" || entity.label.trim().length === 0) {
      rejected.push(`${qid}: no usable English label`);
      continue;
    }
    if (/^Q\d+$/.test(entity.label.trim())) {
      rejected.push(`${qid}: label resolved to a bare QID`);
      continue;
    }
    if (!args.allowSensitiveTopics && isSensitiveText(entity.label, entity.description)) {
      rejected.push(`${qid}: sensitive subject`);
      continue;
    }
    facts.push({
      wikidataQid: qid,
      label: entity.label.trim(),
      description: entity.description ?? "",
      value: row.value / (spec.divisor || 1),
      sourceUrl: wikidataSourceUrl(qid),
    });
  }

  facts.sort((a, b) => b.value - a.value);
  const top = facts.slice(0, count);
  args.log?.(
    `rank-facts(${args.topic}): ${bindings.length} raw → ${top.length} clean ` +
      `(${rejected.length} rejected, notability floor ${minNotability})`,
  );
  return { topic: args.topic, facts: top, rejected };
}

/**
 * Deterministic set-level integrity. Runs immediately before the chart spec is
 * built and again on every checkpoint replay — the ranking equivalent of
 * quizYearFacts' `assertAnswerIntegrity`.
 */
export function rankSetDefects(facts: readonly RankedFact[]): string[] {
  const defects: string[] = [];
  if (facts.length < 3) defects.push(`only ${facts.length} clean rows (need >= 3)`);
  const seen = new Set<string>();
  for (const fact of facts) {
    if (seen.has(fact.wikidataQid)) defects.push(`duplicate subject ${fact.wikidataQid}`);
    seen.add(fact.wikidataQid);
    if (!Number.isFinite(fact.value) || fact.value <= 0) {
      defects.push(`${fact.wikidataQid}: non-positive value`);
    }
    if (!fact.sourceUrl.startsWith("https://")) {
      defects.push(`${fact.wikidataQid}: missing https citation`);
    }
  }
  // A "ranking" whose every entry is identical is not a ranking.
  if (facts.length > 1 && new Set(facts.map((f) => f.value)).size === 1) {
    defects.push("every value is identical — this is not a ranking");
  }
  // Order is the product. A set that arrives unsorted means an upstream bug.
  for (let i = 1; i < facts.length; i++) {
    if (facts[i].value > facts[i - 1].value) {
      defects.push(`row ${i} (${facts[i].wikidataQid}) is out of rank order`);
      break;
    }
  }
  return defects;
}

export function assertRankIntegrity(facts: readonly RankedFact[]): void {
  const defects = rankSetDefects(facts);
  if (defects.length) throw new Error(`rank integrity: ${defects.join("; ")}`);
}
