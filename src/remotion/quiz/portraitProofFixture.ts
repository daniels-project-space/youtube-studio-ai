import type { QuizYearRound } from "./QuizYear";
import {
  QUIZ_YEAR_PORTRAIT_HEIGHT,
  QUIZ_YEAR_PORTRAIT_WIDTH,
  portraitQuizYearTotalFrames,
  type QuizYearPortraitProofProps,
} from "./portraitLayout";

/**
 * Deliberately dense but valid copy for a local visual proof. It is neither a
 * planned upload nor a source of channel content; it exercises the longest
 * supported question, option, reveal, and title zones in one 44-second reel.
 */
export const QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE: QuizYearPortraitProofProps = {
  title: "THE DEFINITIVE HISTORY QUICK QUIZ",
  width: QUIZ_YEAR_PORTRAIT_WIDTH,
  height: QUIZ_YEAR_PORTRAIT_HEIGHT,
  palette: ["#09111f", "#67e8f9", "#f8fafc"],
  rounds: [
    {
      categoryPrompt: "WHICH TREATY?",
      questionText:
        "Which 1987 agreement created the international framework for phasing out chemicals that damage the ozone layer while allowing scientific updates?",
      options: [
        { label: "Montreal Protocol", isCorrect: true },
        { label: "Kyoto Protocol", isCorrect: false },
        { label: "Paris Agreement", isCorrect: false },
        { label: "Basel Convention", isCorrect: false },
      ],
      subject: "Montreal Protocol",
      revealExplanation:
        "It set a global phase-out schedule for ozone-depleting substances and is updated as scientific evidence changes.",
      sourceUrl: "https://www.unep.org/ozonaction/who-we-are/about-montreal-protocol",
      countdownSeconds: 7,
      revealSeconds: 6,
    },
    {
      categoryPrompt: "WHICH CAPITAL?",
      questionText:
        "Which capital on the Ottawa River did Queen Victoria choose in 1857 as Canada’s permanent seat of government?",
      options: [
        { label: "Ottawa, Ontario", isCorrect: true },
        { label: "Kingston, Ontario", isCorrect: false },
        { label: "Quebec City, Quebec", isCorrect: false },
        { label: "Toronto, Ontario", isCorrect: false },
      ],
      subject: "Ottawa, Ontario",
      revealExplanation:
        "Queen Victoria chose Ottawa as a compromise location between the established English- and French-speaking centres.",
      sourceUrl: "https://www.canada.ca/en/canadian-heritage/services/capital-canada.html",
      countdownSeconds: 7,
      revealSeconds: 6,
    },
    {
      categoryPrompt: "WHICH DISCOVERY?",
      questionText:
        "Which element, isolated by Marie and Pierre Curie from pitchblende residue, was named after the country of Marie Curie’s birth?",
      options: [
        { label: "Polonium", isCorrect: true },
        { label: "Radium", isCorrect: false },
        { label: "Francium", isCorrect: false },
        { label: "Ruthenium", isCorrect: false },
      ],
      subject: "Polonium",
      revealExplanation:
        "The Curies announced polonium in 1898 and named it in recognition of Poland, Marie Curie’s homeland.",
      sourceUrl: "https://www.rsc.org/periodic-table/element/84/polonium",
      countdownSeconds: 7,
      revealSeconds: 6,
    },
  ],
};

export const QUIZ_YEAR_PORTRAIT_WORST_CASE_DURATION_FRAMES = portraitQuizYearTotalFrames(
  QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE.rounds as QuizYearRound[]
);
