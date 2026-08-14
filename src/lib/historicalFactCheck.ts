/**
 * historicalFactCheck — ONE job: DECIDE WHETHER A SPECIFIC CLAIMED FACT IS
 * SUPPORTED BY A CHECKABLE SOURCE, and say where.
 *
 * It sources nothing, writes nothing and renders nothing. It takes claims that
 * already exist and returns a verdict plus provenance for each one. That is the
 * whole scope.
 *
 * WHY THIS IS NOT OPTIONAL POLISH
 * The format this serves is a first-person history vlog, and YouTube files that
 * under "Education". A confidently-delivered wrong date is not a quality nit
 * there: it is the comment section, the credibility of every other episode, and
 * eventually the channel. Meanwhile the thing generating the facts is a
 * language model, whose failure mode is producing a fluent, plausible, subtly
 * wrong number that no downstream gate can smell.
 *
 * THE DISCIPLINE IS BORROWED, NOT INVENTED
 * src/lib/quizYearFacts.ts and src/lib/rankFacts.ts already established how
 * this codebase handles "a number a video will assert":
 *   • the value is read from a STRUCTURED Wikidata statement, never generated;
 *   • an entity carrying multiple conflicting current values is DROPPED, not
 *     arbitrated (a fact with two defensible answers is broken, not rounded);
 *   • every surviving item carries a resolvable source URL and a provenance tag;
 *   • an integrity assert re-checks the set immediately before use.
 *
 * The adaptation here is the DIRECTION. Those modules source a whole round and
 * hand it to a writer. This one runs the other way: a writer has already made a
 * claim, and this module asks Wikidata whether the claim survives contact with
 * the structured record. The three verdicts are deliberately asymmetric:
 *
 *   verified    — a structured statement was found and it MATCHES. Shippable.
 *   contradicted— a structured statement was found and it DISAGREES. This is
 *                 the dangerous case and it is a HARD FAIL, because it means
 *                 the model asserted something checkably false.
 *   unsupported — no structured statement was found at all. This is NOT the
 *                 same as false: Wikidata's coverage of "London Bridge was the
 *                 only crossing until 1750" is simply not there. Unsupported
 *                 claims are capped, not banned, and are reported so an
 *                 operator can see exactly how much of an episode is
 *                 un-machine-checkable.
 *
 * Conflating "unsupported" with "false" would be its own kind of dishonesty —
 * it would let a module that cannot check most historical prose claim it did.
 *
 * The only network dependency is the same free, unauthenticated, CC0 Wikidata
 * SPARQL endpoint the quiz lane already uses, through the same client, with the
 * same retry policy. No new provider, no key, no spend.
 */
import { qidFromUri, runSparql, wikidataSourceUrl, type SparqlFetchOptions } from "./quizSource";

export const FACT_CHECK_VERSION = "historical-fact-check/v1" as const;

/**
 * The kinds of claim that are STRUCTURALLY checkable. A claim must declare its
 * kind, which is the point: it forces the writer to say what it is asserting
 * before it asserts it, and an unclassifiable assertion is exactly the kind
 * that should not be delivered as a confident "fun fact".
 */
export type FactClaimKind =
  /** "X happened in YEAR" — inception, opening, construction, death, battle. */
  | "year"
  /** "X is N <unit>" — height, length, population. */
  | "quantity";

export interface FactClaim {
  /** Stable id so a verdict can be traced back to the sentence that made it. */
  id: string;
  kind: FactClaimKind;
  /**
   * The claim as the audience will hear it. Carried through verbatim so a
   * report reads as prose rather than as a row of QIDs.
   */
  text: string;
  /**
   * The Wikidata entity the claim is ABOUT. A QID when the writer knows one;
   * otherwise a label this module resolves. Label resolution is deliberately
   * strict (see `resolveClaimSubject`) — a fuzzy match to the wrong entity
   * would produce a confident verdict about a different thing entirely, which
   * is worse than no verdict.
   */
  subject: string;
  /** The asserted value: a year for `year`, a number for `quantity`. */
  value: number;
  /**
   * Wikidata property to check, e.g. "P571" (inception), "P2048" (height).
   * Required: guessing the property from the prose is how a check silently
   * validates the wrong statement.
   */
  property: string;
  /**
   * Absolute tolerance. A year claim defaults to 0 (a date is a date); a
   * quantity defaults to 1% of the asserted value, because a rounded height is
   * a normal editorial choice and not an error.
   */
  tolerance?: number;
}

export type FactVerdictStatus = "verified" | "contradicted" | "unsupported";

export interface FactVerdict {
  claimId: string;
  status: FactVerdictStatus;
  /** The claim text, echoed so a report is readable without a join. */
  text: string;
  /** What the structured record actually said, when anything was found. */
  sourceValue?: number;
  /** Resolvable https URL proving the source value. Present iff a value was found. */
  sourceUrl?: string;
  /** How the answer was obtained. Mirrors rankFacts' provenance tagging. */
  provenance: "wikidata-statement" | "no-structured-statement";
  /** Human-readable explanation. Always populated; this is what an operator reads. */
  detail: string;
}

export interface FactCheckReport {
  version: typeof FACT_CHECK_VERSION;
  checkedAt: number;
  verdicts: FactVerdict[];
  verified: number;
  contradicted: number;
  unsupported: number;
}

/** Default ceiling on the share of claims that may be un-machine-checkable. */
export const DEFAULT_MAX_UNSUPPORTED_RATIO = 0.5;

function defaultTolerance(claim: FactClaim): number {
  if (typeof claim.tolerance === "number" && Number.isFinite(claim.tolerance)) {
    return Math.abs(claim.tolerance);
  }
  // A year is a year. A measurement is allowed to be rounded.
  return claim.kind === "year" ? 0 : Math.abs(claim.value) * 0.01;
}

export function factClaimDefects(value: unknown): string[] {
  const defects: string[] = [];
  const claim = (value ?? {}) as Record<string, unknown>;
  if (typeof claim["id"] !== "string" || !claim["id"].trim()) defects.push("fact claim has no id");
  if (claim["kind"] !== "year" && claim["kind"] !== "quantity") {
    defects.push(`fact claim has an uncheckable kind "${String(claim["kind"])}"`);
  }
  if (typeof claim["text"] !== "string" || claim["text"].trim().length < 8) {
    defects.push("fact claim has no readable text");
  }
  if (typeof claim["subject"] !== "string" || !claim["subject"].trim()) {
    defects.push("fact claim names no subject to look up");
  }
  if (typeof claim["property"] !== "string" || !/^P\d+$/.test(String(claim["property"]).trim())) {
    defects.push(
      `fact claim property "${String(claim["property"])}" is not a Wikidata property id — ` +
        "inferring the property from the prose would silently check a different statement",
    );
  }
  const value_ = claim["value"];
  if (typeof value_ !== "number" || !Number.isFinite(value_)) {
    defects.push("fact claim has no finite asserted value");
  }
  return defects;
}

/** Keep only the claims that are well-formed enough to be checkable at all. */
export function usableFactClaims(values: readonly unknown[]): FactClaim[] {
  return values.filter((value) => factClaimDefects(value).length === 0) as FactClaim[];
}

function escapeSparqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");
}

/**
 * Resolve a subject to exactly ONE QID.
 *
 * A QID passes through untouched. A label is resolved by EXACT English label
 * match, and a label matching more than one entity is REFUSED rather than
 * arbitrated — "Cambridge" is a city and a university and a Massachusetts town,
 * and picking one would produce a confident verdict about the wrong thing.
 */
export async function resolveClaimSubject(
  subject: string,
  options: SparqlFetchOptions = {},
): Promise<string | undefined> {
  const trimmed = subject.trim();
  if (/^Q\d+$/.test(trimmed)) return trimmed;
  const rows = await runSparql(
    `SELECT ?item WHERE {
       ?item rdfs:label "${escapeSparqlString(trimmed)}"@en .
       FILTER NOT EXISTS { ?item wdt:P31 wd:Q4167410 }
     } LIMIT 5`,
    options,
  );
  const qids = [...new Set(rows.map((row) => qidFromUri(row["item"]?.value ?? "")).filter(Boolean))];
  // Zero → nothing to check. More than one → ambiguous, refuse.
  return qids.length === 1 ? qids[0] : undefined;
}

/**
 * Read the structured value(s) for one property of one entity.
 *
 * Returns EVERY distinct current value, not a chosen one. The caller drops
 * multi-valued entities exactly the way `groupUnambiguousQuantities` does in
 * rankFacts — arbitration is the thing this discipline refuses to do.
 */
export async function readStructuredValues(args: {
  qid: string;
  property: string;
  kind: FactClaimKind;
  options?: SparqlFetchOptions;
}): Promise<number[]> {
  const { qid, property, kind } = args;
  const select =
    kind === "year"
      ? `SELECT ?value WHERE { wd:${qid} p:${property} ?st . ?st ps:${property} ?date .
           BIND(YEAR(?date) AS ?value) FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank } } LIMIT 20`
      : `SELECT ?value WHERE { wd:${qid} p:${property} ?st . ?st psv:${property} ?node .
           ?node wikibase:quantityAmount ?value . FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank } } LIMIT 20`;
  const rows = await runSparql(select, args.options ?? {});
  const values = rows
    .map((row) => Number(row["value"]?.value))
    .filter((value) => Number.isFinite(value));
  return [...new Set(values)];
}

/**
 * Check ONE claim. Never throws on a source failure — a flaky endpoint must
 * produce `unsupported` (and be visible in the report), not crash a run that
 * has already paid for a script.
 */
export async function checkFactClaim(
  claim: FactClaim,
  options: SparqlFetchOptions = {},
): Promise<FactVerdict> {
  const base = { claimId: claim.id, text: claim.text } as const;
  let qid: string | undefined;
  try {
    qid = await resolveClaimSubject(claim.subject, options);
  } catch (e) {
    return {
      ...base,
      status: "unsupported",
      provenance: "no-structured-statement",
      detail: `subject lookup failed (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  if (!qid) {
    return {
      ...base,
      status: "unsupported",
      provenance: "no-structured-statement",
      detail: `"${claim.subject}" did not resolve to exactly one Wikidata entity — an ambiguous or unknown subject is not checkable`,
    };
  }

  let values: number[];
  try {
    values = await readStructuredValues({ qid, property: claim.property, kind: claim.kind, options });
  } catch (e) {
    return {
      ...base,
      status: "unsupported",
      provenance: "no-structured-statement",
      detail: `statement lookup failed (${e instanceof Error ? e.message : String(e)})`,
    };
  }

  if (values.length === 0) {
    return {
      ...base,
      status: "unsupported",
      provenance: "no-structured-statement",
      detail: `${qid} carries no ${claim.property} statement — this claim cannot be machine-checked, which is not the same as it being wrong`,
    };
  }
  if (values.length > 1) {
    // Same rule as rankFacts: two defensible values means the fact is broken,
    // not that one of them should be picked.
    return {
      ...base,
      status: "unsupported",
      sourceUrl: wikidataSourceUrl(qid),
      provenance: "no-structured-statement",
      detail: `${qid} carries ${values.length} conflicting ${claim.property} values (${values.join(", ")}) — refusing to arbitrate`,
    };
  }

  const sourceValue = values[0];
  const tolerance = defaultTolerance(claim);
  const matches = Math.abs(sourceValue - claim.value) <= tolerance;
  return {
    ...base,
    status: matches ? "verified" : "contradicted",
    sourceValue,
    sourceUrl: wikidataSourceUrl(qid),
    provenance: "wikidata-statement",
    detail: matches
      ? `${qid} ${claim.property} = ${sourceValue}, within tolerance ${tolerance} of the claimed ${claim.value}`
      : `${qid} ${claim.property} = ${sourceValue}, but the script claims ${claim.value} (tolerance ${tolerance})`,
  };
}

/** Check a set of claims and summarise. Sequential on purpose: the endpoint is free and shared. */
export async function checkFactClaims(
  claims: readonly FactClaim[],
  options: SparqlFetchOptions = {},
): Promise<FactCheckReport> {
  const verdicts: FactVerdict[] = [];
  for (const claim of claims) {
    verdicts.push(await checkFactClaim(claim, options));
  }
  return {
    version: FACT_CHECK_VERSION,
    checkedAt: Date.now(),
    verdicts,
    verified: verdicts.filter((verdict) => verdict.status === "verified").length,
    contradicted: verdicts.filter((verdict) => verdict.status === "contradicted").length,
    unsupported: verdicts.filter((verdict) => verdict.status === "unsupported").length,
  };
}

/**
 * THE GATE. Mirrors `assertRankIntegrity`: it re-reads the finished report and
 * refuses to let the run continue if the episode is not defensible.
 *
 *   • ANY contradicted claim is fatal, with no ratio and no override. The model
 *     asserted something the structured record disagrees with, and there is no
 *     amount of other correct facts that makes shipping it acceptable.
 *   • Unsupported claims are capped by RATIO rather than count, so a longer
 *     episode is not penalised for having more facts in it.
 */
export function assertFactCheckIntegrity(
  report: FactCheckReport,
  options: { maxUnsupportedRatio?: number } = {},
): void {
  const contradicted = report.verdicts.filter((verdict) => verdict.status === "contradicted");
  if (contradicted.length) {
    throw new Error(
      `historical fact check FAILED: ${contradicted.length} claim(s) contradicted by the structured record — ` +
        contradicted.map((verdict) => `[${verdict.claimId}] ${verdict.detail}`).join("; "),
    );
  }
  const total = report.verdicts.length;
  if (total === 0) return;
  const ceiling = options.maxUnsupportedRatio ?? DEFAULT_MAX_UNSUPPORTED_RATIO;
  const ratio = report.unsupported / total;
  if (ratio > ceiling) {
    throw new Error(
      `historical fact check FAILED: ${report.unsupported}/${total} claims (${(ratio * 100).toFixed(0)}%) could not be ` +
        `checked against any structured source, over the ${(ceiling * 100).toFixed(0)}% ceiling. An education-category ` +
        "episode built mostly from unverifiable assertions is a credibility risk, not a style choice.",
    );
  }
}

/**
 * The operator-facing summary line. Deliberately reports unsupported claims
 * explicitly rather than folding them into "passed" — the whole point is that
 * the limits of the check are visible.
 */
export function factCheckSummary(report: FactCheckReport): string {
  return (
    `${report.verified} verified, ${report.contradicted} contradicted, ${report.unsupported} unsupported ` +
    `of ${report.verdicts.length} claim(s)`
  );
}
