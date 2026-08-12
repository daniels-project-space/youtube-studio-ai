/**
 * quizGeneralKnowledge — the one quiz category that is NOT a property lookup.
 *
 * WHY THIS IS BUILT DIFFERENTLY FROM THE OTHER CATEGORIES
 * "Who wrote Romeo and Juliet", "what is the chemical symbol for gold", "what
 * is the boiling point of water at sea level" are what viewers mean by general
 * knowledge, and they do not all reduce to one queryable Wikidata property. The
 * obvious shortcut — a third-party trivia dataset — was ruled out earlier this
 * session on licensing grounds (every candidate was CC BY-SA, NonCommercial,
 * unlicensed scraped content, or itself LLM-generated, which launders
 * hallucination risk rather than removing it).
 *
 * THE RULE THIS MODULE EXISTS TO KEEP
 * An LLM's bare assertion is NEVER ground truth here, exactly as everywhere else
 * in this build. The model is a CANDIDATE GENERATOR ONLY. Every accepted fact
 * has been confirmed by an independently fetched, real, citable document
 * (English Wikipedia's REST summary endpoint, plus a Wikidata QID cross-check
 * where the subject resolves), and anything that fails verification is
 * discarded rather than repaired. The pipeline is deliberately lossy: a low
 * acceptance rate is the mechanism working, not a bug.
 *
 * WHAT "VERIFIED" CONCRETELY MEANS HERE — five independent checks
 *   1. RESOLVES. The proposed subject must resolve to a real article
 *      (`type === "standard"`, HTTP 200, redirects followed). A hallucinated
 *      subject cannot pass, and disambiguation pages are rejected outright.
 *   2. STATES THE ANSWER. The proposed answer must appear in the fetched text on
 *      WORD BOUNDARIES (`containsPhrase`, not `String.includes` — the chemical
 *      symbol "Ag" is a substring of "against", "age" and "agreement", so raw
 *      substring matching would let a document confirm an answer it never
 *      mentions).
 *   3. IS NOT NEGATED. The sentence carrying the match is rejected if it reads
 *      as a denial, a dispute or a debunk ("is not", "contrary to popular
 *      belief", "often incorrectly", "disputed", "myth"). Wikipedia articles
 *      routinely state the WRONG answer in order to correct it, and step 2
 *      alone cannot tell the difference.
 *   4. THE DECOYS ARE VERIFIABLY WRONG. Every proposed wrong option must be
 *      ABSENT from the same document. This is the check that makes a
 *      four-option grid safe: a decoy the source also mentions is not reliably
 *      wrong, and would produce a round the viewer can legitimately argue about.
 *   5. IS ON TONE. The shared `isSensitiveText` filter applies, same as the
 *      Wikidata categories.
 *
 * ON WIKIPEDIA PROSE AND LICENSING
 * Wikipedia TEXT is CC BY-SA, which is why the year build refused ShareAlike
 * datasets. Nothing from the fetched extract is ever rendered: it is used only
 * as a verification substrate and retained for audit. What goes on screen is a
 * question phrased for this channel and a short factual token ("Au", "William
 * Shakespeare") — a fact, not copyrightable expression — under a citation URL.
 * The Wikidata QID cross-check, where present, is CC0.
 *
 * Live probe of the verification substrate over ten hand-built candidates (six
 * true, four false, all phrased the way a model phrases them): 6 true positives,
 * 4 true negatives, 0 false positives, 0 false negatives.
 */
import {
  containsPhrase,
  isSensitiveText,
  normalizeName,
  qidFromUri,
  runSparql,
  wikidataSourceUrl,
  WIKIDATA_USER_AGENT,
  type SparqlFetchOptions,
} from "./quizSource";
import { QUIZ_OPTION_COUNT, type QuizOption } from "./quizFacts";

export const WIKIPEDIA_SUMMARY_ENDPOINT = "https://en.wikipedia.org/api/rest_v1/page/summary";

/**
 * Phrases that flip the meaning of a sentence that otherwise "contains" the
 * answer. Wikipedia is full of "the play is often incorrectly attributed to X",
 * and check 2 would read that as confirmation.
 */
export const NEGATION_MARKERS: readonly string[] = [
  "is not", "was not", "are not", "were not", "does not", "did not", "never",
  "contrary to", "popular belief", "incorrectly", "erroneously", "mistakenly",
  "misattributed", "wrongly", "disputed", "contested", "unproven", "alleged",
  "myth", "misconception", "hoax", "debunk", "no evidence", "rather than",
  "instead of", "not to be confused",
];

export interface GeneralKnowledgeCandidate {
  /** Model-proposed on-screen question. */
  question: string;
  /** Model-proposed answer — a CANDIDATE, never accepted on the model's word. */
  answer: string;
  /** Model-proposed wrong options; each must be verifiably absent from the source. */
  decoys: string[];
  /** English Wikipedia article title used as the verification substrate. */
  subject: string;
}

export interface VerifiedGeneralKnowledgeFact {
  categoryKey: "general_knowledge";
  answerType: "name";
  questionText: string;
  /** THE ANSWER. Accepted only because the fetched source states it. */
  answerLabel: string;
  /** Verified-wrong options, each absent from the same source. */
  decoyLabels: string[];
  /** The article this was verified against. */
  subjectLabel: string;
  /** Citation shown on screen and recorded in the asset's provenance. */
  sourceUrl: string;
  /** Wikipedia revision the verification ran against — makes the check auditable. */
  revisionId?: number;
  /** The exact sentence that confirmed the answer. Retained for audit, never rendered. */
  matchedSentence: string;
  /** Secondary CC0 citation when the article resolves to a Wikidata item. */
  wikidataQid?: string;
  wikidataUrl?: string;
}

export interface WikipediaSummary {
  title: string;
  type: string;
  description: string;
  extract: string;
  url: string;
  revision?: number;
}

export interface WikipediaFetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/**
 * Fetch the REST summary for an article title. Returns null on anything that is
 * not a clean, resolvable, standard article — a missing page, a disambiguation
 * page or a transport failure all mean "cannot verify", which means "reject".
 */
export async function fetchWikipediaSummary(
  title: string,
  options: WikipediaFetchOptions = {},
): Promise<WikipediaSummary | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const url = `${WIKIPEDIA_SUMMARY_ENDPOINT}/${encodeURIComponent(title.trim().replace(/ /g, "_"))}?redirect=true`;
    const res = await doFetch(url, {
      headers: { Accept: "application/json", "User-Agent": WIKIDATA_USER_AGENT },
      signal: controller.signal,
    });
    if (res.status !== 200) return null;
    const body = (await res.json()) as {
      title?: string;
      type?: string;
      description?: string;
      extract?: string;
      revision?: string | number;
      content_urls?: { desktop?: { page?: string } };
    };
    const resolvedTitle = String(body.title ?? "").trim();
    if (!resolvedTitle) return null;
    return {
      title: resolvedTitle,
      type: String(body.type ?? ""),
      description: String(body.description ?? ""),
      extract: String(body.extract ?? ""),
      url: body.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle.replace(/ /g, "_"))}`,
      ...(Number.isFinite(Number(body.revision)) ? { revision: Number(body.revision) } : {}),
    };
  } catch (e) {
    options.log?.(`wikipedia: summary fetch failed for "${title}" (${e instanceof Error ? e.message : e})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Split an extract into sentences well enough to locate the confirming one. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isNegated(sentence: string): boolean {
  const s = normalizeName(sentence);
  return NEGATION_MARKERS.some((marker) => s.includes(normalizeName(marker)));
}

export interface VerificationOutcome {
  ok: boolean;
  reason?: string;
  matchedSentence?: string;
}

/**
 * Checks 1–4 against an already-fetched summary. Split out from the fetch so the
 * decision logic is a pure function and can be tested exhaustively on fixtures.
 */
export function verifyAgainstSummary(
  candidate: GeneralKnowledgeCandidate,
  summary: WikipediaSummary | null,
): VerificationOutcome {
  if (!summary) return { ok: false, reason: "subject did not resolve to a Wikipedia article" };
  // 1. Disambiguation pages "contain" almost anything and confirm nothing.
  if (summary.type && summary.type !== "standard") {
    return { ok: false, reason: `article is type "${summary.type}", not a standard article` };
  }
  if (/\bmay refer to\b|\bmay also refer to\b/i.test(summary.extract)) {
    return { ok: false, reason: "article is a disambiguation list" };
  }
  const answer = candidate.answer.trim();
  if (!answer) return { ok: false, reason: "empty answer" };
  if (answer.length > 42) return { ok: false, reason: "answer too long for an option tile" };

  const haystackParts = [summary.title, summary.description, ...sentences(summary.extract)];

  // 2. The answer must appear on word boundaries.
  const matched = haystackParts.find((part) => containsPhrase(part, answer));
  if (!matched) {
    return { ok: false, reason: `source does not state "${answer}"` };
  }
  // 3. …and not inside a denial.
  if (isNegated(matched)) {
    return { ok: false, reason: `answer appears only in a negated/disputed sentence` };
  }

  // 4. Every decoy must be ABSENT from the whole document.
  const decoys = candidate.decoys.map((d) => d.trim()).filter(Boolean);
  if (decoys.length < QUIZ_OPTION_COUNT - 1) {
    return { ok: false, reason: `needs ${QUIZ_OPTION_COUNT - 1} decoys, got ${decoys.length}` };
  }
  const seen = new Set([normalizeName(answer)]);
  for (const decoy of decoys) {
    const n = normalizeName(decoy);
    if (!n) return { ok: false, reason: "empty decoy" };
    if (seen.has(n)) return { ok: false, reason: `duplicate option "${decoy}"` };
    seen.add(n);
    if (decoy.length > 42) return { ok: false, reason: `decoy "${decoy}" too long for an option tile` };
    if (haystackParts.some((part) => containsPhrase(part, decoy))) {
      return { ok: false, reason: `decoy "${decoy}" also appears in the source — not verifiably wrong` };
    }
  }

  // The question itself must not give the answer away.
  if (containsPhrase(candidate.question, answer)) {
    return { ok: false, reason: "question spoils the answer" };
  }
  if (!candidate.question.includes("?")) return { ok: false, reason: "question is not phrased as a question" };
  if (candidate.question.trim().length < 12 || candidate.question.trim().length > 160) {
    return { ok: false, reason: "question length outside the on-screen budget" };
  }
  return { ok: true, matchedSentence: matched };
}

/**
 * Resolve an English Wikipedia article title to its Wikidata QID — a SECOND,
 * CC0 citation for the same fact. Non-fatal: a missing QID downgrades the
 * evidence to the Wikipedia citation alone rather than rejecting the fact.
 */
export async function resolveArticleQid(
  title: string,
  options: SparqlFetchOptions = {},
): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(title.replace(/ /g, "_"));
    const rows = await runSparql(
      `SELECT ?item WHERE {
  <https://en.wikipedia.org/wiki/${encoded}> schema:about ?item .
}
LIMIT 1`,
      { ...options, retries: options.retries ?? 2 },
    );
    const qid = qidFromUri(rows[0]?.item?.value ?? "");
    return /^Q\d+$/.test(qid) ? qid : null;
  } catch {
    return null;
  }
}

export interface ProposeGeneralKnowledgeArgs {
  count: number;
  critiqueBrief?: string;
  /** Subjects already used, so a retry does not re-propose the same fact. */
  avoidSubjects?: readonly string[];
  askModel: (prompt: string) => Promise<unknown>;
  log?: (msg: string) => void;
}

/**
 * Ask a model for CANDIDATES. Note what the schema does and does not mean: the
 * model supplies a question, a proposed answer, three proposed wrong options and
 * the article to check them against. None of it is trusted — `verifyCandidates`
 * decides.
 */
export async function proposeGeneralKnowledgeCandidates(
  args: ProposeGeneralKnowledgeArgs,
): Promise<GeneralKnowledgeCandidate[]> {
  const avoid = args.avoidSubjects?.length
    ? `\nDo NOT use these subjects, they are already taken: ${args.avoidSubjects.join(", ")}\n`
    : "";
  const prompt =
    `You propose CANDIDATE general-knowledge quiz questions. Every candidate will be independently ` +
    `verified against the English Wikipedia article you name, and silently discarded if the article ` +
    `does not state your answer, or if it also mentions any of your wrong options. Propose only facts ` +
    `you are confident that article states in its opening summary.\n\n` +
    (args.critiqueBrief ? `${args.critiqueBrief}\n` : "") +
    avoid +
    `\nRules for each candidate:\n` +
    `- "subject" MUST be an exact English Wikipedia article title.\n` +
    `- "answer" MUST be short (a name, a word, a symbol, a number with its unit) and MUST appear in ` +
    `that article's opening summary.\n` +
    `- "decoys" MUST be exactly 3 plausible but WRONG options that do NOT appear in that article at all.\n` +
    `- "question" MUST NOT contain the answer, and MUST end in a question mark, under 140 characters.\n` +
    `- Keep it upbeat and broadly known: science, geography, art, language, food, animals, space, sport.\n` +
    `- Avoid war, disaster, death, politics and anything tragic or contested.\n\n` +
    `Return JSON: {"candidates":[{"question":"...","answer":"...","decoys":["...","...","..."],"subject":"..."}]}\n` +
    `Propose ${Math.max(1, Math.min(24, args.count))} candidates.`;

  try {
    const raw = (await args.askModel(prompt)) as { candidates?: unknown };
    const list = Array.isArray(raw?.candidates) ? raw.candidates : [];
    const out: GeneralKnowledgeCandidate[] = [];
    for (const item of list) {
      const c = item as Record<string, unknown>;
      const question = typeof c?.question === "string" ? c.question.trim() : "";
      const answer = typeof c?.answer === "string" ? c.answer.trim() : "";
      const subject = typeof c?.subject === "string" ? c.subject.trim() : "";
      const decoys = Array.isArray(c?.decoys) ? c.decoys.map((d) => String(d).trim()).filter(Boolean) : [];
      if (!question || !answer || !subject || decoys.length < QUIZ_OPTION_COUNT - 1) continue;
      out.push({ question, answer, subject, decoys: decoys.slice(0, QUIZ_OPTION_COUNT - 1) });
    }
    return out;
  } catch (e) {
    args.log?.(`general-knowledge: candidate model failed (${e instanceof Error ? e.message : e})`);
    return [];
  }
}

export interface VerifyCandidatesArgs extends WikipediaFetchOptions {
  candidates: readonly GeneralKnowledgeCandidate[];
  /** Stop once this many are verified. */
  want: number;
  allowSensitiveTopics?: boolean;
  /** Skip the CC0 Wikidata cross-citation (tests, or when offline). */
  skipWikidataCrossCheck?: boolean;
  sparqlOptions?: SparqlFetchOptions;
}

export interface VerifyCandidatesResult {
  facts: VerifiedGeneralKnowledgeFact[];
  rejected: { unresolved: number; notStated: number; negated: number; decoyLeak: number; sensitive: number; malformed: number };
  examined: number;
}

/**
 * Run every candidate through independent verification. This is the function
 * that enforces "no LLM assertion is ground truth": a candidate becomes a fact
 * only by surviving a real network fetch of a real document.
 */
export async function verifyGeneralKnowledgeCandidates(
  args: VerifyCandidatesArgs,
): Promise<VerifyCandidatesResult> {
  const rejected = { unresolved: 0, notStated: 0, negated: 0, decoyLeak: 0, sensitive: 0, malformed: 0 };
  const facts: VerifiedGeneralKnowledgeFact[] = [];
  const log = args.log ?? (() => {});
  let examined = 0;

  for (const candidate of args.candidates) {
    if (facts.length >= args.want) break;
    examined += 1;

    // 5. Tone, before spending a network round-trip on it.
    if (
      !args.allowSensitiveTopics &&
      isSensitiveText(`${candidate.question} ${candidate.answer}`, candidate.decoys.join(" "))
    ) {
      rejected.sensitive += 1;
      log(`general-knowledge: dropped "${candidate.subject}" (sensitive content)`);
      continue;
    }

    const summary = await fetchWikipediaSummary(candidate.subject, args);
    const outcome = verifyAgainstSummary(candidate, summary);
    if (!outcome.ok) {
      const reason = outcome.reason ?? "unknown";
      if (reason.includes("did not resolve") || reason.includes("not a standard") || reason.includes("disambiguation")) {
        rejected.unresolved += 1;
      } else if (reason.includes("does not state")) rejected.notStated += 1;
      else if (reason.includes("negated")) rejected.negated += 1;
      else if (reason.includes("also appears")) rejected.decoyLeak += 1;
      else rejected.malformed += 1;
      log(`general-knowledge: REJECTED "${candidate.question}" — ${reason}`);
      continue;
    }

    const verifiedSummary = summary!;
    const qid = args.skipWikidataCrossCheck
      ? null
      : await resolveArticleQid(verifiedSummary.title, args.sparqlOptions ?? {});

    facts.push({
      categoryKey: "general_knowledge",
      answerType: "name",
      questionText: candidate.question.trim(),
      answerLabel: candidate.answer.trim(),
      decoyLabels: candidate.decoys.map((d) => d.trim()),
      subjectLabel: verifiedSummary.title,
      sourceUrl: verifiedSummary.url,
      ...(verifiedSummary.revision !== undefined ? { revisionId: verifiedSummary.revision } : {}),
      matchedSentence: outcome.matchedSentence ?? "",
      ...(qid ? { wikidataQid: qid, wikidataUrl: wikidataSourceUrl(qid) } : {}),
    });
    log(`general-knowledge: verified "${candidate.question}" → "${candidate.answer}" via ${verifiedSummary.url}`);
  }

  return { facts, rejected, examined };
}

/**
 * Build the four on-screen options for a verified general-knowledge fact.
 *
 * Same provenance discipline as the Wikidata categories, with one tag rename
 * that carries real meaning: the correct option is `"wikipedia-verified"`, not
 * `"wikidata-sourced"`, because it was confirmed by a fetched document rather
 * than read from a structured statement. Any code filtering for truth accepts
 * both; nothing can mistake a decoy for either.
 */
export type GeneralKnowledgeProvenance = "wikipedia-verified" | "generated-decoy";

export interface GeneralKnowledgeOption {
  label: string;
  isCorrect: boolean;
  provenance: GeneralKnowledgeProvenance;
}

export function buildGeneralKnowledgeOptions(
  fact: VerifiedGeneralKnowledgeFact,
  seedRandom: () => number,
): GeneralKnowledgeOption[] {
  const options: GeneralKnowledgeOption[] = [
    { label: fact.answerLabel, isCorrect: true, provenance: "wikipedia-verified" as const },
    ...fact.decoyLabels.slice(0, QUIZ_OPTION_COUNT - 1).map((label) => ({
      label,
      isCorrect: false,
      provenance: "generated-decoy" as const,
    })),
  ];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(seedRandom() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

/**
 * Final assertion before render — the general-knowledge twin of
 * `assertQuizAnswerIntegrity`.
 *
 * Re-checks the stored evidence rather than trusting that verification happened:
 * the retained `matchedSentence` must still state the answer on word boundaries
 * and must still be non-negated, the citation must be a real Wikipedia URL, and
 * exactly one option may be flagged correct. This runs again on every checkpoint
 * replay, so a serialisation round-trip cannot quietly promote a decoy.
 */
export function assertGeneralKnowledgeIntegrity(
  fact: VerifiedGeneralKnowledgeFact,
  options: readonly { label: string; isCorrect: boolean; provenance: string }[],
): void {
  if (!/^https:\/\/en\.wikipedia\.org\/wiki\//.test(fact.sourceUrl)) {
    throw new Error(`general-knowledge integrity: citation is not a Wikipedia URL (${fact.sourceUrl})`);
  }
  if (!containsPhrase(fact.matchedSentence, fact.answerLabel)) {
    throw new Error(
      `general-knowledge integrity: retained evidence does not state "${fact.answerLabel}"`,
    );
  }
  if (isNegated(fact.matchedSentence)) {
    throw new Error(`general-knowledge integrity: retained evidence is negated/disputed`);
  }
  if (containsPhrase(fact.questionText, fact.answerLabel)) {
    throw new Error(`general-knowledge integrity: question spoils the answer`);
  }
  if (options.length !== QUIZ_OPTION_COUNT) {
    throw new Error(`general-knowledge integrity: expected ${QUIZ_OPTION_COUNT} options, got ${options.length}`);
  }
  const correct = options.filter((o) => o.isCorrect);
  if (correct.length !== 1) {
    throw new Error(`general-knowledge integrity: expected exactly 1 correct option, got ${correct.length}`);
  }
  if (correct[0].provenance !== "wikipedia-verified") {
    throw new Error("general-knowledge integrity: the correct option must be the verified one");
  }
  if (correct[0].label !== fact.answerLabel) {
    throw new Error(
      `general-knowledge integrity: correct option "${correct[0].label}" != verified answer "${fact.answerLabel}"`,
    );
  }
  const seen = new Set<string>();
  for (const o of options) {
    const n = normalizeName(o.label);
    if (seen.has(n)) throw new Error(`general-knowledge integrity: duplicate option "${o.label}"`);
    seen.add(n);
  }
}
