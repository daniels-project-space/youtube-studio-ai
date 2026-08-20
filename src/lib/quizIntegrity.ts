/**
 * Provider-free release quality checks shared by quiz renderers.
 *
 * Fact sourcing proves that a single round is true. This module proves that a
 * SET of otherwise-valid rounds still feels intentional: familiar subjects go
 * first, a decoy does not keep reappearing, and every reveal has a compact
 * factual context line. It deliberately knows nothing about a quiz provider or
 * renderer, so another trivia composition can adopt the same gate.
 */

export const QUIZ_REVEAL_EXPLANATION_MAX_CHARS = 160;

export interface QuizIntegrityOption {
  label: string;
  isCorrect: boolean;
}

export interface QuizIntegrityRound {
  category: string;
  subjectId: string;
  subject: string;
  questionText: string;
  answerLabel: string;
  options: readonly QuizIntegrityOption[];
  /** Sitelinks / other deterministic familiarity proxy from the source. */
  notability?: number;
  /** Compact source context shown only after the answer is locked in. */
  revealExplanation?: string;
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function compactText(value: string, maxChars = QUIZ_REVEAL_EXPLANATION_MAX_CHARS): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  const slice = collapsed.slice(0, Math.max(1, maxChars - 1));
  const wordBoundary = slice.lastIndexOf(" ");
  return `${(wordBoundary >= 24 ? slice.slice(0, wordBoundary) : slice).trim()}…`;
}

/**
 * A source description is useful during the 2–10 second reveal only when it
 * fits as one legible thought. Use its first sentence, never a model summary;
 * when Wikidata has no description, retain the exact subject and answer rather
 * than inventing an explanation.
 */
export function compactQuizRevealExplanation(args: {
  subject: string;
  answerLabel: string;
  sourceDescription?: string;
}): string {
  const source = String(args.sourceDescription ?? "").replace(/\s+/g, " ").trim();
  const firstSentence = source.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? source;
  if (firstSentence.length >= 12) return compactText(firstSentence);
  return compactText(`Correct answer: ${args.answerLabel}. ${args.subject}.`);
}

/** Lower is easier. Notability is an intentionally modest familiarity proxy. */
export function quizDifficultyScore(round: QuizIntegrityRound): number {
  const notability = Number.isFinite(round.notability)
    ? Math.max(0, Math.min(10_000, Number(round.notability)))
    : 0;
  // Long answer labels are slightly harder to scan; they only break ties among
  // similarly familiar subjects and never substitute for factual source data.
  const scanPenalty = Math.min(80, normalized(round.answerLabel).length * 2);
  return 10_000 - notability + scanPenalty;
}

/**
 * Stable easy-to-hard ordering. Equal scores retain the category-interleaved
 * plan that the caller supplied, so variety is not sacrificed for the curve.
 */
export function orderQuizRoundsForDifficulty<T extends QuizIntegrityRound>(rounds: readonly T[]): T[] {
  return rounds
    .map((round, index) => ({ round, index }))
    .sort((a, b) => quizDifficultyScore(a.round) - quizDifficultyScore(b.round) || a.index - b.index)
    .map(({ round }) => round);
}

/**
 * Final release gate for the already-sourced set. It does not try to repair
 * facts or make new distractors: a compromised set must be re-authored, not
 * silently made up at the renderer boundary.
 */
export function quizIntegrityDefects(rounds: readonly QuizIntegrityRound[]): string[] {
  const defects: string[] = [];
  const seenDistractors = new Map<string, string>();
  const seenAnswers = new Map<string, string>();

  for (const round of rounds) {
    const identity = round.subjectId || round.subject;
    const correct = round.options.filter((option) => option.isCorrect);
    if (correct.length !== 1 || normalized(correct[0]?.label ?? "") !== normalized(round.answerLabel)) {
      defects.push(`${identity}: correct option does not match the sourced answer`);
    }
    if (round.options.length !== 4) defects.push(`${identity}: expected four options`);

    const explanation = String(round.revealExplanation ?? "").trim();
    if (explanation.length < 12 || explanation.length > QUIZ_REVEAL_EXPLANATION_MAX_CHARS) {
      defects.push(`${identity}: reveal explanation must be compact and non-empty`);
    }

    const answerKey = `${round.category}:${normalized(round.answerLabel)}`;
    const previousAnswer = seenAnswers.get(answerKey);
    if (previousAnswer) defects.push(`${identity}: repeats answer from ${previousAnswer}`);
    else seenAnswers.set(answerKey, identity);

    for (const option of round.options) {
      if (option.isCorrect) continue;
      const key = normalized(option.label);
      if (!key) {
        defects.push(`${identity}: empty distractor`);
        continue;
      }
      const previous = seenDistractors.get(key);
      if (previous) defects.push(`${identity}: repeats distractor "${option.label}" from ${previous}`);
      else seenDistractors.set(key, identity);
    }
  }

  // The ordering function makes this a concrete release assertion instead of a
  // planning preference. Only compare source-backed familiarity values; legacy
  // checkpoints without them remain readable but cannot pretend to have a
  // difficulty curve.
  const scored = rounds.filter((round) => Number.isFinite(round.notability));
  for (let index = 1; index < scored.length; index++) {
    if (quizDifficultyScore(scored[index]) < quizDifficultyScore(scored[index - 1])) {
      defects.push(`${scored[index].subjectId}: difficulty regresses after ${scored[index - 1].subjectId}`);
    }
  }
  return defects;
}

export function assertQuizIntegrity(rounds: readonly QuizIntegrityRound[]): void {
  const defects = quizIntegrityDefects(rounds);
  if (defects.length) throw new Error(`quiz integrity: ${defects.join("; ")}`);
}
