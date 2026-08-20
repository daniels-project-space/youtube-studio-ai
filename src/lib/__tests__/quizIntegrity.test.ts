import assert from "node:assert/strict";
import {
  assertQuizIntegrity,
  compactQuizRevealExplanation,
  orderQuizRoundsForDifficulty,
  quizIntegrityDefects,
  type QuizIntegrityRound,
} from "../quizIntegrity";

function round(over: Partial<QuizIntegrityRound> = {}): QuizIntegrityRound {
  const answer = over.answerLabel ?? "Paris";
  return {
    category: "capital_city",
    subjectId: "Q142",
    subject: "France",
    questionText: "Which city is the capital of France?",
    answerLabel: answer,
    options: [
      { label: answer, isCorrect: true },
      { label: "Lyon", isCorrect: false },
      { label: "Marseille", isCorrect: false },
      { label: "Bordeaux", isCorrect: false },
    ],
    notability: 1_000,
    revealExplanation: "France is a country in Western Europe.",
    ...over,
  };
}

// A complete source-derived sentence is retained; long encyclopedia text is
// reduced deterministically instead of asking a model to summarize it.
{
  assert.equal(
    compactQuizRevealExplanation({
      subject: "France",
      answerLabel: "Paris",
      sourceDescription: "France is a country in Western Europe. This second sentence is not needed on reveal.",
    }),
    "France is a country in Western Europe.",
  );
  const compact = compactQuizRevealExplanation({
    subject: "A very long subject name", answerLabel: "Answer", sourceDescription: "" });
  assert.ok(compact.startsWith("Correct answer: Answer."));
  assert.ok(compact.length <= 160);
}

// More familiar source subjects lead the episode. Equal scores remain stable,
// preserving the category plan's intended variety.
{
  const ordered = orderQuizRoundsForDifficulty([
    round({
      subjectId: "Q-hard", subject: "Hard", notability: 12, answerLabel: "Hard answer",
      options: [
        { label: "Hard answer", isCorrect: true }, { label: "Hard A", isCorrect: false },
        { label: "Hard B", isCorrect: false }, { label: "Hard C", isCorrect: false },
      ],
    }),
    round({
      subjectId: "Q-easy", subject: "Easy", notability: 900, answerLabel: "Easy answer",
      options: [
        { label: "Easy answer", isCorrect: true }, { label: "Easy A", isCorrect: false },
        { label: "Easy B", isCorrect: false }, { label: "Easy C", isCorrect: false },
      ],
    }),
    round({
      subjectId: "Q-mid", subject: "Middle", notability: 120, answerLabel: "Mid answer",
      options: [
        { label: "Mid answer", isCorrect: true }, { label: "Mid A", isCorrect: false },
        { label: "Mid B", isCorrect: false }, { label: "Mid C", isCorrect: false },
      ],
    }),
  ]);
  assert.deepEqual(ordered.map((item) => item.subjectId), ["Q-easy", "Q-mid", "Q-hard"]);
  assert.deepEqual(quizIntegrityDefects(ordered), []);
}

// Reusing a distractor makes a mixed video feel mechanically generated even
// when each individual round is factual, so it is a final-set failure.
{
  const repeated = orderQuizRoundsForDifficulty([
    round({ subjectId: "Q1", answerLabel: "Paris", notability: 900 }),
    round({
      subjectId: "Q2",
      subject: "Germany",
      answerLabel: "Berlin",
      notability: 100,
      options: [
        { label: "Berlin", isCorrect: true },
        { label: "Lyon", isCorrect: false },
        { label: "Munich", isCorrect: false },
        { label: "Hamburg", isCorrect: false },
      ],
    }),
  ]);
  assert.throws(() => assertQuizIntegrity(repeated), /repeats distractor "Lyon"/);
}

// A raw source description must become a bounded explanation before render;
// the gate rejects accidental omission on a checkpoint replay.
{
  const missing = round({ revealExplanation: "" });
  assert.ok(quizIntegrityDefects([missing]).some((defect) => defect.includes("reveal explanation")));
}

console.log("quizIntegrity: distractor, difficulty, and compact-reveal locks passed");
