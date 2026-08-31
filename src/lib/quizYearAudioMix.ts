/**
 * QuizYear is intentionally narration-free: the game board is carried by a
 * licensed/generated instrumental bed. A valid AAC stream is not enough—a
 * silent mux would make an otherwise legible short unusable. Keep this small
 * final-master assertion separate from provider generation and from the
 * renderer-only proof composition.
 */
export const QUIZ_YEAR_AUDIO_MIX_EVIDENCE_VERSION = "quiz-year-audible-mix/v1";
export const QUIZ_YEAR_MIN_INTEGRATED_LUFS = -48;
export const QUIZ_YEAR_MIN_WINDOW_MEAN_DB = -55;

export type QuizYearAudibleMixEvidence = Readonly<{
  version: typeof QUIZ_YEAR_AUDIO_MIX_EVIDENCE_VERSION;
  integratedLufs: number;
  windowMeanDb: number;
}>;

export function assertQuizYearAudibleMix(measurement: {
  readonly integratedLufs: number | null;
  readonly windowMeanDb: number | null;
}): QuizYearAudibleMixEvidence {
  const integratedLufs = measurement.integratedLufs;
  const windowMeanDb = measurement.windowMeanDb;
  if (
    typeof integratedLufs !== "number" || !Number.isFinite(integratedLufs) ||
    typeof windowMeanDb !== "number" || !Number.isFinite(windowMeanDb)
  ) {
    throw new Error("quiz_year: final master audio could not be measured");
  }
  if (integratedLufs < QUIZ_YEAR_MIN_INTEGRATED_LUFS) {
    throw new Error(
      `quiz_year: final master integrated loudness ${integratedLufs.toFixed(1)} LUFS is below the audible-mix floor ` +
      `${QUIZ_YEAR_MIN_INTEGRATED_LUFS} LUFS`,
    );
  }
  if (windowMeanDb < QUIZ_YEAR_MIN_WINDOW_MEAN_DB) {
    throw new Error(
      `quiz_year: final master opening-bed mean ${windowMeanDb.toFixed(1)} dB is below the audible-mix floor ` +
      `${QUIZ_YEAR_MIN_WINDOW_MEAN_DB} dB`,
    );
  }
  return Object.freeze({
    version: QUIZ_YEAR_AUDIO_MIX_EVIDENCE_VERSION,
    integratedLufs,
    windowMeanDb,
  });
}
