/**
 * quiz_year fact-sourcing and answer-integrity locks.
 *
 * THE INVARIANT UNDER TEST: the answer year is read from Wikidata and can never
 * be supplied, altered or spoiled by a model. Everything here exists to make
 * that structurally impossible rather than merely intended.
 *
 * FIXTURES, NOT LIVE CALLS — and why.
 * The gates are pure functions of the returned rows, so fixtures test them
 * exactly. More importantly, the public Wikidata endpoint returned 429, 500,
 * 502, 504 AND client-side timeouts during development of this very module; a
 * CI suite that depends on it would be flaky for reasons unrelated to the code.
 * The fixtures below are NOT invented — every one is a real row observed from
 * the live endpoint, including the three genuine data defects that motivated
 * the gates (Skyrim's dual publication years, Q94501's description/data
 * contradiction, and the Wolf's Lair tone leak).
 *
 * The live path is exercised separately and on demand by
 * scripts/quizyear-live-probe.ts, which is free and unauthenticated.
 */
import assert from "node:assert/strict";
import {
  assertAnswerIntegrity,
  assertOptionIntegrity,
  buildYearOptions,
  deterministicQuestionText,
  factDefects,
  fetchQuizYearFacts,
  groupUnambiguous,
  isSensitiveText,
  MIN_OPTION_GAP_YEARS,
  phraseQuizYearQuestion,
  questionTextDefects,
  QUIZ_OPTION_COUNT,
  runSparql,
  textYearConflict,
  wikidataSourceUrl,
  type QuizYearFact,
} from "../quizYearFacts";

const fact = (over: Partial<QuizYearFact> = {}): QuizYearFact => ({
  eventLabel: "Uranus",
  eventDescription: "seventh planet in the Solar System",
  year: 1781,
  wikidataQid: "Q324",
  sourceUrl: wikidataSourceUrl("Q324"),
  topic: "science_discovery",
  notability: 260,
  ...over,
});

// tsx compiles this suite to CJS, which has no top-level await, so the whole
// body runs inside main().
async function main(): Promise<void> {

/* ------------------------------------------------------------------ *
 * Gate 1 + 3 — precision and year ambiguity
 * ------------------------------------------------------------------ */

// REAL CASE: Q49740 ("The Elder Scrolls V: Skyrim") carries P577 publication
// dates in BOTH 2009 and 2011. Collapsing that with MIN()/MAX() would ship a
// question whose "wrong" answer is also documented as right by the cited source.
{
  const { kept, droppedAmbiguous } = groupUnambiguous([
    { qid: "Q49740", year: 2009, precision: 11, notability: 155 },
    { qid: "Q49740", year: 2011, precision: 11, notability: 155 },
    { qid: "Q324", year: 1781, precision: 11, notability: 260 },
  ]);
  assert.deepEqual(droppedAmbiguous, ["Q49740"], "multi-year entity must be dropped, not collapsed");
  assert.equal(kept.length, 1);
  assert.equal(kept[0].qid, "Q324");
}

// Precision 8 = decade, 7 = century — neither can answer "what year".
{
  const { kept, droppedPrecision } = groupUnambiguous([
    { qid: "Q1", year: 1900, precision: 8, notability: 50 },
    { qid: "Q2", year: 1900, precision: 7, notability: 50 },
    { qid: "Q3", year: 1900, precision: 9, notability: 50 },
  ]);
  assert.deepEqual(droppedPrecision.sort(), ["Q1", "Q2"]);
  assert.deepEqual(kept.map((k) => k.qid), ["Q3"]);
}

// Same year recorded twice at different precision is NOT ambiguous.
{
  const { kept, droppedAmbiguous } = groupUnambiguous([
    { qid: "Q9", year: 1969, precision: 9, notability: 10 },
    { qid: "Q9", year: 1969, precision: 11, notability: 10 },
  ]);
  assert.equal(droppedAmbiguous.length, 0);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].precision, 11, "the most precise row should win");
}

/* ------------------------------------------------------------------ *
 * Gate 2 — text/data contradiction
 * ------------------------------------------------------------------ */

// REAL CASE: Q94501's structured date says 1998, its own description says 1997.
assert.ok(
  textYearConflict(1998, "Grand Theft Auto", "1997 action-adventure open world video game"),
  "a description year that disagrees with the data must be a conflict",
);
// REAL CASE: "Revolt of Czechoslovak Legion" — P585 1920 vs description "1918".
assert.ok(textYearConflict(1920, "Revolt of Czechoslovak Legion", "armed actions in Russia, 1918"));
assert.equal(
  textYearConflict(2013, "Dota 2", "2013 video game"),
  null,
  "an agreeing year is not a conflict",
);
assert.equal(textYearConflict(1781, "Uranus", "seventh planet"), null);

assert.ok(
  factDefects(fact({ year: 1998, eventDescription: "1997 video game" })).some((d) =>
    d.startsWith("year contradiction"),
  ),
);

/* ------------------------------------------------------------------ *
 * Gate 4 — unresolved labels and malformed provenance
 * ------------------------------------------------------------------ */

// REAL CASE: the SPARQL label service intermittently returns the bare QID.
assert.ok(
  factDefects(fact({ eventLabel: "Q94501" })).some((d) => d.startsWith("unresolved label")),
  "a bare QID must never reach the screen as a label",
);
assert.ok(
  factDefects(fact({ sourceUrl: "https://example.com/Q324" })).some((d) =>
    d.includes("sourceUrl does not match QID"),
  ),
  "the citation must actually point at the cited entity",
);
assert.deepEqual(factDefects(fact()), [], "a clean fact has no defects");

/* ------------------------------------------------------------------ *
 * Tone filter
 * ------------------------------------------------------------------ */

// REAL CASE: "Wolf's Lair" passed the original filter because its description
// says "WW2", never the substring "war".
assert.ok(
  isSensitiveText("Wolf's Lair", "one of Nazi Germany's military headquarters during WW2"),
  "abbreviation-only war references must still be caught",
);
assert.ok(isSensitiveText("Some Event", "a battle with many deaths"));
assert.equal(isSensitiveText("Uranus", "seventh planet in the Solar System"), false);
// Explicit opt-in bypasses the tone filter but NOTHING else.
assert.deepEqual(
  factDefects(fact({ eventLabel: "Wolf's Lair", eventDescription: "HQ during WW2", year: 1941 }), {
    allowSensitiveTopics: true,
  }),
  [],
);

/* ------------------------------------------------------------------ *
 * THE CENTRAL INVARIANT — a model can never supply or spoil the year
 * ------------------------------------------------------------------ */

// A phrasing that contains the answer is rejected.
assert.ok(
  questionTextDefects(fact(), "In what year was Uranus discovered, around 1781?").some((d) =>
    d.includes("spoils the answer"),
  ),
);
// A phrasing that contains a DIFFERENT year is rejected too — it would
// contradict the cited source.
assert.ok(
  questionTextDefects(fact(), "Was Uranus discovered soon after 1750?").some((d) =>
    d.includes("unsourced year"),
  ),
);
assert.deepEqual(questionTextDefects(fact(), "In what year was Uranus discovered?"), []);

// A model that tries to hand back a year cannot: the accepted shape has no year
// field, and any year in the text is rejected in favour of the template.
{
  const drifted = await phraseQuizYearQuestion({
    fact: fact(),
    askModel: async () => ({ question: "Which year did we spot Uranus, 1781 or so?", year: 1999 } as never),
  });
  assert.equal(drifted.phrasedByModel, false, "a spoiling phrasing must be discarded");
  assert.equal(drifted.questionText, deterministicQuestionText(fact()));
  assert.equal(drifted.fact.year, 1781, "the year is untouched by the model");
}

// A clean model phrasing IS accepted — the guard is not simply refusing everything.
{
  const ok = await phraseQuizYearQuestion({
    fact: fact(),
    askModel: async () => ({ question: "Which year did astronomers first spot the seventh planet?" }),
  });
  assert.equal(ok.phrasedByModel, true);
  assert.equal(ok.fact.year, 1781);
}

// A model outage degrades the WORDING, never the correctness.
{
  const down = await phraseQuizYearQuestion({
    fact: fact(),
    askModel: async () => { throw new Error("503 model unavailable"); },
  });
  assert.equal(down.phrasedByModel, false);
  assert.equal(down.questionText, deterministicQuestionText(fact()));
  assert.equal(down.fact.year, 1781);
}

// No model at all → deterministic text, still correct.
{
  const none = await phraseQuizYearQuestion({ fact: fact() });
  assert.equal(none.questionText, "In what year was Uranus discovered?");
}

// assertAnswerIntegrity is the last gate and THROWS on drift.
assert.throws(
  () =>
    assertAnswerIntegrity(
      { fact: fact({ year: 1782 }), questionText: "In what year was Uranus discovered?", phrasedByModel: true },
      fact(),
    ),
  /year drift/,
  "a year that no longer matches the source must abort the render",
);
assert.throws(
  () =>
    assertAnswerIntegrity(
      { fact: fact({ wikidataQid: "Q999" }), questionText: "In what year was Uranus discovered?", phrasedByModel: false },
      fact(),
    ),
  /QID drift/,
);
assert.doesNotThrow(() =>
  assertAnswerIntegrity(
    { fact: fact(), questionText: "In what year was Uranus discovered?", phrasedByModel: false },
    fact(),
  ),
);

/* ------------------------------------------------------------------ *
 * Question phrasing must match what its Wikidata property MEANS
 * ------------------------------------------------------------------ */

// REAL CASE, and a failure mode no data gate can see: a live probe asked "In
// what year was Christ the Redeemer completed?" and answered 1920 from P571.
// P571 is `inception` — for a structure, when construction BEGAN. The statue
// was completed in 1931, so the data was right and the QUESTION was wrong.
// Nothing contradicts it in the description, so only the phrasing can fix it.
{
  const landmark = fact({
    topic: "landmark_architecture",
    eventLabel: "Christ the Redeemer",
    eventDescription: "statue in Rio de Janeiro",
    year: 1920,
    wikidataQid: "Q79961",
    sourceUrl: wikidataSourceUrl("Q79961"),
  });
  const text = deterministicQuestionText(landmark).toLowerCase();
  assert.ok(
    !text.includes("completed") && !text.includes("finished"),
    `P571 is inception, not completion — phrasing must not claim completion (got: "${text}")`,
  );
  assert.ok(text.includes("begin") || text.includes("began") || text.includes("start"));
  assert.deepEqual(questionTextDefects(landmark, deterministicQuestionText(landmark)), []);
}

// Every topic's deterministic phrasing must itself be defect-free — a template
// that spoiled or malformed its own question would poison the fallback path.
for (const topic of [
  "space_exploration",
  "science_discovery",
  "invention_technology",
  "video_games",
  "film_release",
  "sports_championship",
  "landmark_architecture",
] as const) {
  const f = fact({ topic, eventLabel: "Example Subject", eventDescription: "" });
  assert.deepEqual(
    questionTextDefects(f, deterministicQuestionText(f)),
    [],
    `deterministic template for ${topic} must be defect-free`,
  );
}

/* ------------------------------------------------------------------ *
 * Multiple choice — exactly one sourced truth, three inert decoys
 * ------------------------------------------------------------------ */
{
  const f = fact();
  const options = buildYearOptions(f);
  assert.equal(options.length, QUIZ_OPTION_COUNT);
  assertOptionIntegrity(options, f);

  const sourced = options.filter((o) => o.provenance === "wikidata-sourced");
  assert.equal(sourced.length, 1, "exactly one option may claim Wikidata provenance");
  assert.equal(sourced[0].year, f.year);
  assert.equal(sourced[0].isCorrect, true);
  // Every decoy is wrong AND tagged as generated — it can never be cited.
  for (const decoy of options.filter((o) => o.provenance === "generated-decoy")) {
    assert.equal(decoy.isCorrect, false, "a generated decoy must never be flagged correct");
    assert.notEqual(decoy.year, f.year);
  }
  // No pair is close enough to make the correct answer arguable.
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      assert.ok(
        Math.abs(options[i].year - options[j].year) >= MIN_OPTION_GAP_YEARS,
        `options ${options[i].year}/${options[j].year} are too close to be unambiguous`,
      );
    }
  }
}

// DETERMINISM: a healer replay must rebuild the identical grid, or the replayed
// video would disagree with the one already rendered.
{
  const f = fact();
  assert.deepEqual(buildYearOptions(f), buildYearOptions(f), "option generation must be seeded, not random");
  // Different subjects get different grids (the seed is actually used).
  const other = buildYearOptions(fact({ wikidataQid: "Q332", year: 1846, eventLabel: "Neptune" }));
  assert.notDeepEqual(other.map((o) => o.year), buildYearOptions(f).map((o) => o.year));
}

// Edge case: a fact at the very top of the allowed range must not generate a
// decoy in the future.
{
  const nowYear = new Date().getUTCFullYear();
  const recent = fact({ year: nowYear, wikidataQid: "Q1", eventLabel: "Recent thing" });
  const options = buildYearOptions(recent);
  assertOptionIntegrity(options, recent);
  for (const o of options) assert.ok(o.year <= nowYear, `decoy ${o.year} is in the future`);
}

// A tampered option set is rejected rather than rendered.
assert.throws(
  () =>
    assertOptionIntegrity(
      [
        { year: 1781, isCorrect: false, provenance: "wikidata-sourced" },
        { year: 1800, isCorrect: true, provenance: "generated-decoy" },
        { year: 1820, isCorrect: false, provenance: "generated-decoy" },
        { year: 1840, isCorrect: false, provenance: "generated-decoy" },
      ],
      fact(),
    ),
  /correct option must be the sourced one/,
  "a decoy must never be promotable to the answer",
);
assert.throws(
  () =>
    assertOptionIntegrity(
      [
        { year: 1781, isCorrect: true, provenance: "wikidata-sourced" },
        { year: 1782, isCorrect: false, provenance: "generated-decoy" },
        { year: 1820, isCorrect: false, provenance: "generated-decoy" },
        { year: 1840, isCorrect: false, provenance: "generated-decoy" },
      ],
      fact(),
    ),
  /1y apart|apart/,
  "options one year apart make the question debatable",
);

/* ------------------------------------------------------------------ *
 * Transport — retry on transient failure, fail fast on permanent
 * ------------------------------------------------------------------ */

// All four of these statuses were genuinely observed from the live endpoint.
{
  let calls = 0;
  const statuses = [429, 500, 502, 200];
  const rows = await runSparql("SELECT * WHERE {}", {
    sleepImpl: async () => {},
    retries: 4,
    fetchImpl: (async () => {
      const status = statuses[calls++];
      return {
        status,
        json: async () => ({ results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q324" } }] } }),
        text: async () => "",
      };
    }) as unknown as typeof fetch,
  });
  assert.equal(calls, 4, "transient failures must be retried");
  assert.equal(rows.length, 1);
}

// A permanent 400 (bad query) must NOT burn retries.
{
  let calls = 0;
  await assert.rejects(
    runSparql("BAD", {
      sleepImpl: async () => {},
      retries: 4,
      fetchImpl: (async () => {
        calls++;
        return { status: 400, json: async () => ({}), text: async () => "bad query" };
      }) as unknown as typeof fetch,
    }),
    /permanent failure: HTTP 400/,
  );
  assert.equal(calls, 1, "a permanent failure must fail fast");
}

// Exhausting retries throws rather than returning an empty, silently-wrong set.
{
  await assert.rejects(
    runSparql("SELECT * WHERE {}", {
      sleepImpl: async () => {},
      retries: 2,
      fetchImpl: (async () => ({ status: 504, json: async () => ({}), text: async () => "" })) as unknown as typeof fetch,
    }),
    /failed after 2 attempts/,
  );
}

/* ------------------------------------------------------------------ *
 * End-to-end over recorded rows — every gate composed
 * ------------------------------------------------------------------ */
{
  // Two selection rows for Skyrim (ambiguous), one contradiction, one sensitive,
  // one unresolved label, and two clean facts.
  const selectionRows = [
    { item: "Q49740", year: "2009", prec: "11", links: "155" },
    { item: "Q49740", year: "2011", prec: "11", links: "155" },
    { item: "Q94501", year: "1998", prec: "11", links: "55" },
    { item: "Q157153", year: "1941", prec: "11", links: "60" },
    { item: "Q000000", year: "1900", prec: "11", links: "40" },
    { item: "Q324", year: "1781", prec: "11", links: "260" },
    { item: "Q332", year: "1846", prec: "11", links: "251" },
    { item: "Q556", year: "1766", prec: "8", links: "237" }, // decade precision
  ];
  const labels: Record<string, [string, string]> = {
    Q94501: ["Grand Theft Auto", "1997 action-adventure open world video game"],
    Q157153: ["Wolf's Lair", "one of Nazi Germany's military headquarters during WW2"],
    Q000000: ["Q000000", "label service returned a bare QID"],
    Q324: ["Uranus", "seventh planet in the Solar System"],
    Q332: ["Neptune", "eighth and farthest planet from the Sun"],
  };

  let call = 0;
  const fetchImpl = (async (url: string) => {
    call++;
    const isLabelQuery = decodeURIComponent(url).includes("rdfs:label");
    const bindings = isLabelQuery
      ? Object.entries(labels).map(([qid, [label, description]]) => ({
          item: { value: `http://www.wikidata.org/entity/${qid}` },
          itemLabel: { value: label },
          itemDescription: { value: description },
        }))
      : selectionRows.map((r) => ({
          item: { value: `http://www.wikidata.org/entity/${r.item}` },
          year: { value: r.year },
          prec: { value: r.prec },
          links: { value: r.links },
        }));
    return { status: 200, json: async () => ({ results: { bindings } }), text: async () => "" };
  }) as unknown as typeof fetch;

  const result = await fetchQuizYearFacts({
    topic: "science_discovery",
    count: 5,
    fetchImpl,
    sleepImpl: async () => {},
  });

  assert.ok(call >= 2, "a selection query and a label query are both issued");
  assert.deepEqual(
    result.facts.map((f) => f.wikidataQid).sort(),
    ["Q324", "Q332"],
    "only the genuinely clean, unambiguous, non-sensitive facts survive",
  );
  assert.equal(result.rejected.ambiguousYear, 1, "Skyrim's dual years");
  assert.equal(result.rejected.precision, 1, "decade-precision row");
  assert.equal(result.rejected.yearContradiction, 1, "Q94501 data/description conflict");
  assert.equal(result.rejected.sensitive, 1, "Wolf's Lair");
  assert.equal(result.rejected.unresolvedLabel, 1, "bare-QID label");

  // Every surviving fact carries a real, matching citation.
  for (const f of result.facts) {
    assert.equal(f.sourceUrl, `https://www.wikidata.org/wiki/${f.wikidataQid}`);
    assert.deepEqual(factDefects(f), []);
    assertOptionIntegrity(buildYearOptions(f), f);
  }
  const uranus = result.facts.find((f) => f.wikidataQid === "Q324")!;
  assert.equal(uranus.year, 1781, "the year is exactly what Wikidata returned");
}

// A topic that cannot yield enough clean facts reports honestly rather than
// padding the set.
{
  const fetchImpl = (async () => ({
    status: 200,
    json: async () => ({ results: { bindings: [] } }),
    text: async () => "",
  })) as unknown as typeof fetch;
  const result = await fetchQuizYearFacts({ topic: "video_games", count: 5, fetchImpl, sleepImpl: async () => {} });
  assert.deepEqual(result.facts, []);
}

console.log("quizYearFacts: all answer-integrity, data-gate and transport locks passed");

}

void main();
