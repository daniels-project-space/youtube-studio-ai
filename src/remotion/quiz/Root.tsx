import React from "react";
import { Composition } from "remotion";
import { QuizYear, type QuizYearProps, totalFrames } from "./QuizYear";
import { QuizYearPortraitProof, type QuizYearPortraitProofProps } from "./QuizYearPortraitProof";
import { QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE } from "./portraitProofFixture";
import {
  preflightQuizYearPortraitProof,
  QUIZ_YEAR_PORTRAIT_HEIGHT,
  QUIZ_YEAR_PORTRAIT_WIDTH,
} from "./portraitLayout";

/**
 * ISOLATED quiz Remotion root — deliberately NOT registered in
 * src/remotion/Root.tsx.
 *
 * The quiz catalog entry's own gate list has always demanded an "isolated
 * Remotion bundle", and the reason is structural rather than stylistic: the
 * shared root at src/remotion/Root.tsx registers eight sibling compositions
 * (TitleCard, DocuMotion, CinematicSpeech, MotivationalSpeech, ...), and
 * `bundle()` compiles ALL of them for every render. A type error, a bad import
 * or a heavy dependency added to any one sibling breaks the quiz render even
 * though the quiz composition itself is untouched. This root registers exactly
 * one composition, so the quiz lane's blast radius is its own file.
 */
export const QuizRemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="QuizYear"
        component={QuizYear}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ rounds: [], palette: [], title: "" } as QuizYearProps}
        calculateMetadata={({ props }) => {
          const p = props as unknown as QuizYearProps;
          return {
            durationInFrames: totalFrames(p.rounds ?? []),
            fps: 30,
            width: p.width ?? 1920,
            height: p.height ?? 1080,
            props,
          };
        }}
      />
      {/*
       * The production ID is selected only by the supervised QuizShort route.
       * Keeping the legacy proof ID preserves local layout-review tooling while
       * ensuring no automatic route can confuse a proof render with a release.
       */}
      <Composition
        id="QuizYearPortrait"
        component={QuizYearPortraitProof}
        durationInFrames={1320}
        fps={30}
        width={QUIZ_YEAR_PORTRAIT_WIDTH}
        height={QUIZ_YEAR_PORTRAIT_HEIGHT}
        defaultProps={QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE as QuizYearPortraitProofProps}
        calculateMetadata={({ props }) => {
          const p = props as unknown as QuizYearPortraitProofProps;
          const preflight = preflightQuizYearPortraitProof(p);
          return {
            durationInFrames: preflight.durationFrames,
            fps: 30,
            width: QUIZ_YEAR_PORTRAIT_WIDTH,
            height: QUIZ_YEAR_PORTRAIT_HEIGHT,
            props,
          };
        }}
      />
      <Composition
        id="QuizYearPortraitProof"
        component={QuizYearPortraitProof}
        durationInFrames={1320}
        fps={30}
        width={QUIZ_YEAR_PORTRAIT_WIDTH}
        height={QUIZ_YEAR_PORTRAIT_HEIGHT}
        defaultProps={QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE as QuizYearPortraitProofProps}
        calculateMetadata={({ props }) => {
          const p = props as unknown as QuizYearPortraitProofProps;
          const preflight = preflightQuizYearPortraitProof(p);
          return {
            durationInFrames: preflight.durationFrames,
            fps: 30,
            width: QUIZ_YEAR_PORTRAIT_WIDTH,
            height: QUIZ_YEAR_PORTRAIT_HEIGHT,
            props,
          };
        }}
      />
    </>
  );
};
