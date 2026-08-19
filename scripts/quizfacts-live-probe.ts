/**
 * Live probe for the multi-category quiz fact engine.
 *
 * The CI suite (src/lib/__tests__/quizFacts.test.ts) runs on recorded fixtures
 * because the public Wikidata endpoint genuinely returns 429/500/502/504 under
 * load. This script is how the LIVE path stays exercised: it is free,
 * unauthenticated, writes nothing, and prints real question/answer/citation
 * triples plus the per-gate drop counts for every category.
 *
 * Usage:
 *   npx tsx scripts/quizfacts-live-probe.ts            # all Wikidata categories
 *   npx tsx scripts/quizfacts-live-probe.ts capital_city country_currency
 *
 * The general-knowledge category is NOT probed here: it needs a candidate
 * generator (an LLM call), so it would not be free. Its verification substrate
 * is probed instead — a handful of known-true and known-false claims are run
 * through the real Wikipedia endpoint to confirm the checker still separates
 * them.
 */
import {
  buildQuizOptions,
  deterministicCategoryQuestion,
  fetchCategoryFacts,
  QUIZ_CATEGORY_KEYS,
  type QuizCategoryKey,
} from "../src/lib/quizFacts";
import {
  fetchWikipediaSummary,
  verifyAgainstSummary,
  type GeneralKnowledgeCandidate,
} from "../src/lib/quizGeneralKnowledge";

const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const categories = (requested.length ? requested : QUIZ_CATEGORY_KEYS).filter(
  (c): c is QuizCategoryKey => (QUIZ_CATEGORY_KEYS as string[]).includes(c),
);

async function probeCategory(category: QuizCategoryKey): Promise<void> {
  console.log(`\n${"=".repeat(72)}\n${category}\n${"=".repeat(72)}`);
  const started = Date.now();
  try {
    const result = await fetchCategoryFacts({
      category,
      count: 6,
      minNotability: category.startsWith("element") ? 60 : 40,
      retries: 4,
      timeoutMs: 60_000,
      log: (m) => console.log(`  · ${m}`),
    });
    console.log(
      `\n  raw rows examined: ${result.candidatesExamined}  ` +
        `clean facts: ${result.facts.length}  decoy pool: ${result.decoyPool.length}  ` +
        `(${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
    console.log(`  gate drops: ${JSON.stringify(result.rejected)}`);
    if (!result.facts.length) {
      console.log("  NO CLEAN FACTS — investigate before shipping this category.");
      return;
    }
    console.log("");
    for (const fact of result.facts) {
      let options: string;
      try {
        options = buildQuizOptions(fact, { pool: result.decoyPool })
          .map((o) => `${o.isCorrect ? "*" : " "}${o.label}`)
          .join("  |  ");
      } catch (e) {
        options = `!! ${e instanceof Error ? e.message : e}`;
      }
      console.log(`  Q: ${deterministicCategoryQuestion(fact)}`);
      console.log(`  A: ${fact.answerLabel}`);
      console.log(`  options: ${options}`);
      console.log(`  cite: ${fact.sourceUrl}\n`);
    }
  } catch (e) {
    console.log(`  FAILED: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Known-true and known-false claims run against the REAL Wikipedia endpoint.
 * A false positive here (a wrong answer accepted) is the failure that matters —
 * it would mean an LLM's bare assertion could reach the screen.
 */
const VERIFICATION_PROBES: { candidate: GeneralKnowledgeCandidate; expected: boolean }[] = [
  {
    expected: true,
    candidate: {
      question: "Who wrote this tragedy about two feuding families?",
      answer: "William Shakespeare",
      decoys: ["Christopher Marlowe", "Ben Jonson", "John Webster"],
      subject: "Romeo and Juliet",
    },
  },
  {
    expected: true,
    candidate: {
      question: "Which artist painted this Renaissance portrait?",
      answer: "Leonardo da Vinci",
      decoys: ["Michelangelo", "Donatello", "Caravaggio"],
      subject: "Mona Lisa",
    },
  },
  {
    expected: true,
    candidate: {
      question: "What two-letter symbol do chemists use for this precious metal?",
      answer: "Au",
      decoys: ["Ag", "Pb", "Sn"],
      subject: "Gold",
    },
  },
  {
    expected: false,
    candidate: {
      question: "Who wrote this tragedy about two feuding families?",
      answer: "Christopher Marlowe",
      decoys: ["Ben Jonson", "John Webster", "Thomas Kyd"],
      subject: "Romeo and Juliet",
    },
  },
  {
    expected: false,
    candidate: {
      question: "Which city is the seat of government here?",
      answer: "Sydney",
      decoys: ["Perth", "Adelaide", "Hobart"],
      subject: "Australia",
    },
  },
  {
    expected: false,
    candidate: {
      question: "Which entirely invented place is this?",
      answer: "Somewhere",
      decoys: ["Elsewhere", "Nowhere", "Anywhere"],
      subject: "Zzzqqxx Not A Real Article 12345",
    },
  },
];

async function probeVerification(): Promise<void> {
  console.log(`\n${"=".repeat(72)}\ngeneral_knowledge — verification substrate (live Wikipedia)\n${"=".repeat(72)}`);
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const { candidate, expected } of VERIFICATION_PROBES) {
    const summary = await fetchWikipediaSummary(candidate.subject, { log: () => {} });
    const outcome = verifyAgainstSummary(candidate, summary);
    const correct = outcome.ok === expected;
    if (!correct && outcome.ok) falsePositives++;
    if (!correct && !outcome.ok) falseNegatives++;
    console.log(
      `  [${correct ? "OK " : "BAD"}] expected=${expected ? "accept" : "reject"} got=${outcome.ok ? "accept" : "reject"}` +
        `  "${candidate.answer}" via ${candidate.subject}` +
        (outcome.reason ? `\n         reason: ${outcome.reason}` : "") +
        (outcome.matchedSentence ? `\n         evidence: ${outcome.matchedSentence.slice(0, 140)}` : "") +
        (summary ? `\n         cite: ${summary.url} (rev ${summary.revision ?? "?"})` : ""),
    );
  }
  console.log(
    `\n  FALSE POSITIVES (wrong answer accepted): ${falsePositives}   ` +
      `false negatives (true answer rejected): ${falseNegatives}`,
  );
  if (falsePositives > 0) {
    console.log("  A false positive means an unverified claim could reach the screen. Fix before shipping.");
  }
}

async function main(): Promise<void> {
  for (const category of categories) await probeCategory(category);
  if (!requested.length || requested.includes("general_knowledge")) await probeVerification();
}

void main();
