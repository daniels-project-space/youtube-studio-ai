import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { optionText, roundFrames, sourceCitationLabel, type QuizYearOptionView, type QuizYearRound } from "./QuizYear";
import {
  portraitOptionFontSize,
  portraitQuestionFontSize,
  preflightQuizYearPortraitProof,
  QUIZ_YEAR_PORTRAIT_INTRO_FRAMES,
  QUIZ_YEAR_PORTRAIT_OUTRO_FRAMES,
  QUIZ_YEAR_PORTRAIT_REGIONS,
  type PortraitRect,
  type QuizYearPortraitProofProps,
} from "./portraitLayout";

export type { QuizYearPortraitProofProps } from "./portraitLayout";

const DEFAULT_PALETTE = ["#09111f", "#67e8f9", "#f8fafc"];
const CORRECT_GREEN = "#5eea94";
const LETTERS = ["A", "B", "C", "D"] as const;

function styleForRect(rect: PortraitRect): React.CSSProperties {
  return {
    position: "absolute",
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function activeRoundAtFrame(rounds: QuizYearRound[], frame: number): {
  round: QuizYearRound;
  localFrame: number;
  index: number;
} | null {
  let cursor = QUIZ_YEAR_PORTRAIT_INTRO_FRAMES;
  for (const [index, round] of rounds.entries()) {
    const frames = roundFrames(round);
    if (frame < cursor + frames) return { round, localFrame: frame - cursor, index };
    cursor += frames;
  }
  return null;
}

const PortraitBackground: React.FC<{ accent: string; frame: number }> = ({ accent, frame }) => {
  const lift = interpolate(frame % 180, [0, 180], [30, 65]);
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 50% 16%, rgba(103,232,249,0.17), transparent 31%), " +
          "radial-gradient(circle at 18% 88%, rgba(79,70,229,0.24), transparent 36%), #09111f",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -190,
          top: lift,
          width: 470,
          height: 470,
          borderRadius: "50%",
          border: `1px solid ${accent}26`,
          boxShadow: `0 0 180px ${accent}12`,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -205,
          bottom: 160 - lift,
          width: 550,
          height: 550,
          borderRadius: "50%",
          border: `1px solid ${accent}22`,
        }}
      />
    </AbsoluteFill>
  );
};

const Countdown: React.FC<{ progress: number; secondsLeft: number; accent: string; ink: string }> = ({
  progress,
  secondsLeft,
  accent,
  ink,
}) => {
  const size = 164;
  const stroke = 11;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const urgent = secondsLeft <= 3;
  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        margin: "0 auto",
      }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={`${ink}26`} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={urgent ? "#fb7185" : accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * (1 - progress)} ${circumference}`}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: urgent ? "#fb7185" : ink,
          fontSize: 62,
          fontWeight: 900,
          fontVariantNumeric: "tabular-nums",
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
        }}
      >
        {Math.max(0, Math.ceil(secondsLeft))}
      </div>
    </div>
  );
};

const PortraitOptionTile: React.FC<{
  option: QuizYearOptionView;
  letter: string;
  rect: PortraitRect;
  revealed: boolean;
  revealFrame: number;
  index: number;
  accent: string;
  ink: string;
}> = ({ option, letter, rect, revealed, revealFrame, index, accent, ink }) => {
  const { fps } = useVideoConfig();
  const text = optionText(option);
  const win = revealed && option.isCorrect;
  const lose = revealed && !option.isCorrect;
  const lock = spring({
    frame: Math.max(0, revealFrame - index * 2),
    fps,
    config: { damping: 14, mass: 0.55 },
    durationInFrames: 18,
  });
  return (
    <div
      style={{
        ...styleForRect(rect),
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "24px 24px",
        borderRadius: 26,
        boxSizing: "border-box",
        border: `2px solid ${win ? CORRECT_GREEN : lose ? `${ink}1a` : `${ink}35`}`,
        background: win ? `${CORRECT_GREEN}1c` : `${ink}0d`,
        boxShadow: win ? `0 18px 58px ${CORRECT_GREEN}33` : "0 10px 34px rgba(0,0,0,0.18)",
        opacity: lose ? 0.42 : 1,
        transform: win ? `scale(${interpolate(lock, [0, 1], [1, 1.025])})` : "scale(1)",
      }}
    >
      <div
        style={{
          width: 60,
          height: 60,
          flexShrink: 0,
          borderRadius: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#07131e",
          background: win ? CORRECT_GREEN : accent,
          fontSize: 30,
          fontWeight: 900,
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
        }}
      >
        {letter}
      </div>
      <div
        style={{
          flex: 1,
          color: win ? CORRECT_GREEN : ink,
          fontSize: portraitOptionFontSize(text),
          fontWeight: 800,
          lineHeight: 1.08,
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {text}
      </div>
    </div>
  );
};

const IntroCard: React.FC<{ title: string; accent: string; ink: string; frame: number }> = ({ title, accent, ink, frame }) => {
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 17, mass: 0.8 }, durationInFrames: 24 });
  return (
    <>
      <div style={{ ...styleForRect(QUIZ_YEAR_PORTRAIT_REGIONS.header), color: `${ink}9e`, textAlign: "center", fontSize: 25, fontWeight: 800, letterSpacing: 6, fontFamily: "Inter, Helvetica, Arial, sans-serif" }}>
        {title.toUpperCase()}
      </div>
      <div
        style={{
          position: "absolute",
          left: 88,
          right: 88,
          top: 576,
          color: ink,
          textAlign: "center",
          fontSize: 84,
          lineHeight: 0.98,
          fontWeight: 900,
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
          transform: `translateY(${interpolate(enter, [0, 1], [38, 0])}px)`,
          opacity: enter,
        }}
      >
        3 QUICK QUESTIONS.
        <br />
        <span style={{ color: accent }}>ONE SCORE.</span>
      </div>
      <div style={{ position: "absolute", left: 120, right: 120, top: 910, color: `${ink}b8`, textAlign: "center", fontSize: 31, fontWeight: 700, lineHeight: 1.24, fontFamily: "Inter, Helvetica, Arial, sans-serif", opacity: enter }}>
        Pick before the timer hits zero — then see the source-backed answer.
      </div>
      <div style={{ position: "absolute", left: 252, right: 252, top: 1170, border: `1px solid ${accent}75`, borderRadius: 999, padding: "23px 24px", color: accent, textAlign: "center", fontSize: 27, letterSpacing: 3, fontWeight: 900, fontFamily: "Inter, Helvetica, Arial, sans-serif", opacity: enter }}>
        READY? LET&apos;S PLAY
      </div>
    </>
  );
};

const OutroCard: React.FC<{ accent: string; ink: string; frame: number }> = ({ accent, ink, frame }) => {
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 17, mass: 0.8 }, durationInFrames: 20 });
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: "Inter, Helvetica, Arial, sans-serif", opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [24, 0])}px)` }}>
      <div style={{ color: `${ink}9e`, fontSize: 26, letterSpacing: 6, fontWeight: 900 }}>FINAL SCORE</div>
      <div style={{ marginTop: 34, color: ink, fontSize: 78, lineHeight: 0.98, fontWeight: 900 }}>HOW MANY<br />DID YOU GET?</div>
      <div style={{ marginTop: 56, color: accent, fontSize: 30, fontWeight: 800 }}>COMMENT YOUR SCORE · PLAY AGAIN</div>
    </div>
  );
};

const ActiveRound: React.FC<{
  round: QuizYearRound;
  index: number;
  localFrame: number;
  totalRounds: number;
  accent: string;
  ink: string;
}> = ({ round, index, localFrame, totalRounds, accent, ink }) => {
  const { fps } = useVideoConfig();
  const countdownFrames = Math.round(round.countdownSeconds * fps);
  const revealed = localFrame >= countdownFrames;
  const revealFrame = localFrame - countdownFrames;
  const enter = spring({ frame: localFrame, fps, config: { damping: 20 }, durationInFrames: 16 });
  const countdownProgress = Math.min(1, localFrame / countdownFrames);
  const secondsLeft = Math.max(0, (countdownFrames - localFrame) / fps);
  const regionValues = [
    QUIZ_YEAR_PORTRAIT_REGIONS.optionA,
    QUIZ_YEAR_PORTRAIT_REGIONS.optionB,
    QUIZ_YEAR_PORTRAIT_REGIONS.optionC,
    QUIZ_YEAR_PORTRAIT_REGIONS.optionD,
  ];
  const explanation = round.revealExplanation ?? round.subtext ?? "";

  return (
    <>
      <div style={{ ...styleForRect(QUIZ_YEAR_PORTRAIT_REGIONS.header), display: "flex", alignItems: "center", justifyContent: "space-between", color: `${ink}8d`, fontSize: 23, letterSpacing: 3, fontWeight: 800, fontFamily: "Inter, Helvetica, Arial, sans-serif" }}>
        <span>QUICK QUIZ</span>
        <span>{index + 1} / {totalRounds}</span>
      </div>
      <div style={{ ...styleForRect(QUIZ_YEAR_PORTRAIT_REGIONS.category), color: accent, textAlign: "center", fontSize: 29, letterSpacing: 5, fontWeight: 900, fontFamily: "Inter, Helvetica, Arial, sans-serif", opacity: enter }}>
        {(round.categoryPrompt ?? "WHAT YEAR?").toUpperCase()}
      </div>
      <div style={{ ...styleForRect(QUIZ_YEAR_PORTRAIT_REGIONS.question), color: ink, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", fontSize: portraitQuestionFontSize(round.questionText), lineHeight: 1.12, fontWeight: 900, fontFamily: "Inter, Helvetica, Arial, sans-serif", overflowWrap: "anywhere", wordBreak: "break-word", opacity: enter }}>
        {round.questionText}
      </div>
      {round.options.map((option, optionIndex) => (
        <PortraitOptionTile
          key={`${optionText(option)}-${optionIndex}`}
          option={option}
          letter={LETTERS[optionIndex]}
          rect={regionValues[optionIndex]}
          revealed={revealed}
          revealFrame={revealFrame}
          index={optionIndex}
          accent={accent}
          ink={ink}
        />
      ))}
      {!revealed ? (
        <div style={styleForRect(QUIZ_YEAR_PORTRAIT_REGIONS.countdown)}>
          <Countdown progress={countdownProgress} secondsLeft={secondsLeft} accent={accent} ink={ink} />
        </div>
      ) : (
        <div style={{ ...styleForRect(QUIZ_YEAR_PORTRAIT_REGIONS.countdown), color: CORRECT_GREEN, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 900, letterSpacing: 3, fontFamily: "Inter, Helvetica, Arial, sans-serif", opacity: interpolate(revealFrame, [0, 8], [0, 1], { extrapolateRight: "clamp" }) }}>
          TIME&apos;S UP
        </div>
      )}
      {revealed ? (
        <>
          <div style={{ ...styleForRect(QUIZ_YEAR_PORTRAIT_REGIONS.reveal), display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", opacity: interpolate(revealFrame, [8, 20], [0, 1], { extrapolateRight: "clamp" }), fontFamily: "Inter, Helvetica, Arial, sans-serif" }}>
            <div style={{ color: ink, fontSize: 38, lineHeight: 1.08, fontWeight: 900 }}>{round.subject}</div>
            <div style={{ color: `${ink}bf`, fontSize: 28, lineHeight: 1.16, fontWeight: 600, marginTop: 14, overflowWrap: "anywhere", wordBreak: "break-word" }}>{explanation}</div>
          </div>
          <div style={{ ...styleForRect(QUIZ_YEAR_PORTRAIT_REGIONS.source), display: "flex", alignItems: "center", justifyContent: "center", color: `${ink}bb`, fontSize: 25, fontWeight: 700, letterSpacing: 1.4, fontFamily: "Inter, Helvetica, Arial, sans-serif", opacity: interpolate(revealFrame, [13, 25], [0, 1], { extrapolateRight: "clamp" }) }}>
            SOURCE · {sourceCitationLabel(round.sourceUrl).toUpperCase()}
          </div>
        </>
      ) : null}
    </>
  );
};

/**
 * Local proof component only. Do not use this component as evidence that a
 * quiz_short channel family, route, or automatic release policy exists.
 */
export const QuizYearPortraitProof: React.FC<QuizYearPortraitProofProps> = (props) => {
  const frame = useCurrentFrame();
  const rounds = props.rounds ?? [];
  const [background = DEFAULT_PALETTE[0], accent = DEFAULT_PALETTE[1], ink = DEFAULT_PALETTE[2]] =
    props.palette && props.palette.length >= 3 ? props.palette : DEFAULT_PALETTE;
  const report = preflightQuizYearPortraitProof({ ...props, rounds });
  const outroStart = report.durationFrames - QUIZ_YEAR_PORTRAIT_OUTRO_FRAMES;
  const active = frame >= QUIZ_YEAR_PORTRAIT_INTRO_FRAMES && frame < outroStart ? activeRoundAtFrame(rounds, frame) : null;

  return (
    <AbsoluteFill style={{ backgroundColor: background }}>
      <PortraitBackground accent={accent} frame={frame} />
      {frame < QUIZ_YEAR_PORTRAIT_INTRO_FRAMES ? (
        <IntroCard title={(props.title ?? "QUICK QUIZ").trim()} accent={accent} ink={ink} frame={frame} />
      ) : null}
      {active ? <ActiveRound {...active} totalRounds={rounds.length} accent={accent} ink={ink} /> : null}
      {frame >= outroStart ? <OutroCard accent={accent} ink={ink} frame={frame - outroStart} /> : null}
    </AbsoluteFill>
  );
};
