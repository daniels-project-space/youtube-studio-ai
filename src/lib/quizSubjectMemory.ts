/**
 * Durable, channel-scoped question identity for the deterministic QuizYear
 * route. Topic rotation alone is not enough: a later visit to the same topic
 * must not silently reuse the same Wikidata subject as an earlier episode.
 */
export const QUIZ_SUBJECT_MEMORY_PREFIX = "quiz-subject/v1";

export interface QuizSubjectMemoryEntry {
  runId: string;
  subjectId: string;
}

/** QIDs are the only subject identifiers emitted by the certified source path. */
export function isQuizSubjectId(value: unknown): value is string {
  return typeof value === "string" && /^Q[1-9]\d*$/.test(value);
}

export function quizSubjectMemoryKey(args: QuizSubjectMemoryEntry): string {
  if (!args.runId.trim()) throw new Error("Quiz subject memory requires a run id");
  if (!isQuizSubjectId(args.subjectId)) {
    throw new Error("Quiz subject memory requires a canonical Wikidata QID");
  }
  return `${QUIZ_SUBJECT_MEMORY_PREFIX}/${args.runId}/${args.subjectId}`;
}

export function parseQuizSubjectMemoryKey(value: unknown): QuizSubjectMemoryEntry | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split("/");
  if (parts.length !== 4 || `${parts[0]}/${parts[1]}` !== QUIZ_SUBJECT_MEMORY_PREFIX) return undefined;
  const [runId, subjectId] = [parts[2]?.trim(), parts[3]];
  if (!runId || !isQuizSubjectId(subjectId)) return undefined;
  return { runId, subjectId };
}

/**
 * Keeps the current run retry-safe while excluding every QID previously
 * committed by the same channel. Sorting makes source selection deterministic.
 */
export function quizSubjectIdsUsedByOtherRuns(
  keys: readonly unknown[],
  currentRunId: string,
): string[] {
  return [...new Set(
    keys
      .map(parseQuizSubjectMemoryKey)
      .filter((entry): entry is QuizSubjectMemoryEntry => Boolean(entry && entry.runId !== currentRunId))
      .map((entry) => entry.subjectId),
  )].sort();
}
