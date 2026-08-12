import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * One "guess the year" round, rendered as standard game-show multiple choice:
 * four options (A/B/C/D) sit on screen while a ring timer depletes, then time
 * runs out and the correct option locks in.
 *
 * The ANSWER arrives as `options[i].isCorrect` — computed upstream from a
 * Wikidata time value. This component never derives, infers or reorders a
 * correct answer; it prints what it is given alongside the `sourceUrl` that
 * proves it. The three wrong options are generated decoys and carry no
 * citation, which is why only the correct one is ever shown with a source.
 */
export interface QuizYearOptionView {
  year: number;
  isCorrect: boolean;
}

export interface QuizYearRound {
  /** On-screen prompt. Verified to contain no four-digit number upstream. */
  questionText: string;
  /** Four options, pre-shuffled upstream (deterministically, by QID seed). */
  options: QuizYearOptionView[];
  /** Subject label, shown on the reveal. */
  subject: string;
  /** Short Wikidata description, shown small under the subject. */
  subtext?: string;
  /** Verifiable citation for the CORRECT option only. */
  sourceUrl: string;
  /** Seconds the viewer gets to answer. */
  countdownSeconds: number;
  /** Seconds the reveal stays up. */
  revealSeconds: number;
}

export interface QuizYearProps {
  /**
   * Optional so the type is assignable to Remotion's
   * `LooseComponentType<Record<string, unknown>>` when registered in Root.tsx —
   * the same shape the shared root's compositions use. The component treats an
   * absent list as an empty one.
   */
  rounds?: QuizYearRound[];
  /** Channel palette; [bg, accent, ink] with sensible fallbacks. */
  palette?: string[];
  title?: string;
  width?: number;
  height?: number;
}

const FPS = 30;
const LETTERS = ["A", "B", "C", "D"] as const;

/** Frame budget per round — kept in one place so render + metadata agree. */
export function roundFrames(round: QuizYearRound): number {
  return (
    Math.max(1, Math.round(round.countdownSeconds * FPS)) +
    Math.max(1, Math.round(round.revealSeconds * FPS))
  );
}

export function totalFrames(rounds: QuizYearRound[]): number {
  return Math.max(1, rounds.reduce((sum, r) => sum + roundFrames(r), 0));
}

const DEFAULT_PALETTE = ["#0d1226", "#ffd23f", "#f7f7ff"];
const CORRECT_GREEN = "#2ecc71";

/** Depleting ring timer. Pure SVG so the bundle stays dependency-free. */
const CountdownRing: React.FC<{
  progress: number;
  accent: string;
  ink: string;
  secondsLeft: number;
  size?: number;
}> = ({ progress, accent, ink, secondsLeft, size = 150 }) => {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * (1 - progress);
  const urgent = secondsLeft <= 3;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={`${ink}22`} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={urgent ? "#ff4d4d" : accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 58,
          fontWeight: 800,
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
          color: urgent ? "#ff4d4d" : ink,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {Math.max(0, Math.ceil(secondsLeft))}
      </div>
    </div>
  );
};

/**
 * One A/B/C/D tile. During the countdown every tile is neutral. After time is
 * up the correct tile locks in green and the rest dim — the standard
 * "time's up, here's the answer" beat.
 */
const OptionTile: React.FC<{
  letter: string;
  option: QuizYearOptionView;
  revealed: boolean;
  revealLocal: number;
  palette: string[];
  index: number;
}> = ({ letter, option, revealed, revealLocal, palette, index }) => {
  const [, accent, ink] = palette;
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: Math.max(0, revealed ? 999 : 0),
    fps,
    config: { damping: 200 },
    durationInFrames: 1,
  });
  // Lock-in pulse on the correct tile.
  const lock = revealed
    ? spring({ frame: revealLocal - index * 0, fps, config: { damping: 11, mass: 0.6 }, durationInFrames: 22 })
    : 0;
  const win = revealed && option.isCorrect;
  const lose = revealed && !option.isCorrect;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 26,
        padding: "26px 34px",
        borderRadius: 22,
        border: `3px solid ${win ? CORRECT_GREEN : lose ? `${ink}18` : `${ink}30`}`,
        background: win ? `${CORRECT_GREEN}22` : lose ? `${ink}06` : `${ink}0d`,
        opacity: lose ? 0.42 : 1,
        transform: win ? `scale(${interpolate(lock, [0, 1], [1, 1.05])})` : "scale(1)",
        boxShadow: win ? `0 12px 48px ${CORRECT_GREEN}44` : "none",
        // referenced so the spring above is not dead code in any build mode
        outlineColor: `rgba(0,0,0,${enter * 0})`,
      }}
    >
      <div
        style={{
          width: 62,
          height: 62,
          flexShrink: 0,
          borderRadius: 14,
          background: win ? CORRECT_GREEN : `${accent}`,
          color: "#10131f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 32,
          fontWeight: 900,
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
        }}
      >
        {letter}
      </div>
      <div
        style={{
          fontSize: 62,
          fontWeight: 800,
          color: win ? CORRECT_GREEN : ink,
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {option.year}
      </div>
    </div>
  );
};

const RoundView: React.FC<{
  round: QuizYearRound;
  local: number;
  countdownFrames: number;
  palette: string[];
}> = ({ round, local, countdownFrames, palette }) => {
  const [, accent, ink] = palette;
  const { fps } = useVideoConfig();
  const revealed = local >= countdownFrames;
  const revealLocal = local - countdownFrames;
  const enter = spring({ frame: local, fps, config: { damping: 200 }, durationInFrames: 16 });
  const progress = Math.min(1, local / countdownFrames);
  const secondsLeft = Math.max(0, (countdownFrames - local) / fps);
  const options = (round.options ?? []).slice(0, 4);

  return (
    <AbsoluteFill style={{ padding: "70px 110px", justifyContent: "center", gap: 34 }}>
      {/* QUESTION */}
      <div
        style={{
          fontSize: 30,
          letterSpacing: 8,
          fontWeight: 700,
          color: accent,
          textAlign: "center",
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
          opacity: enter,
        }}
      >
        WHAT YEAR?
      </div>
      <div
        style={{
          fontSize: 58,
          lineHeight: 1.18,
          fontWeight: 800,
          textAlign: "center",
          color: ink,
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
          maxWidth: 1560,
          alignSelf: "center",
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`,
        }}
      >
        {round.questionText}
      </div>

      {/* OPTIONS + TIMER */}
      <div style={{ display: "flex", alignItems: "center", gap: 56, justifyContent: "center" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 22,
            flex: "0 1 1180px",
          }}
        >
          {options.map((o, i) => (
            <OptionTile
              key={`${o.year}-${i}`}
              letter={LETTERS[i] ?? "?"}
              option={o}
              revealed={revealed}
              revealLocal={revealLocal}
              palette={palette}
              index={i}
            />
          ))}
        </div>
        {!revealed ? (
          <CountdownRing progress={progress} accent={accent} ink={ink} secondsLeft={secondsLeft} />
        ) : (
          <div
            style={{
              width: 150,
              textAlign: "center",
              fontSize: 30,
              fontWeight: 900,
              color: CORRECT_GREEN,
              fontFamily: "Inter, Helvetica, Arial, sans-serif",
              opacity: interpolate(revealLocal, [0, 8], [0, 1], { extrapolateRight: "clamp" }),
            }}
          >
            TIME&apos;S UP
          </div>
        )}
      </div>

      {/* REVEAL CONTEXT — only after lock-in */}
      {revealed ? (
        <div
          style={{
            textAlign: "center",
            opacity: interpolate(revealLocal, [10, 26], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              color: ink,
              fontFamily: "Inter, Helvetica, Arial, sans-serif",
            }}
          >
            {round.subject}
          </div>
          {round.subtext ? (
            <div
              style={{
                fontSize: 26,
                color: `${ink}aa`,
                marginTop: 8,
                fontFamily: "Inter, Helvetica, Arial, sans-serif",
              }}
            >
              {round.subtext}
            </div>
          ) : null}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const QuizYear: React.FC<QuizYearProps> = ({ rounds, palette, title }) => {
  const frame = useCurrentFrame();
  const pal = palette && palette.length >= 3 ? palette : DEFAULT_PALETTE;
  const [bg, accent, ink] = pal;
  const list = rounds ?? [];

  let cursor = 0;
  let active: { round: QuizYearRound; local: number; index: number } | null = null;
  for (let i = 0; i < list.length; i++) {
    const len = roundFrames(list[i]);
    if (frame < cursor + len) {
      active = { round: list[i], local: frame - cursor, index: i };
      break;
    }
    cursor += len;
  }

  if (!active) return <AbsoluteFill style={{ backgroundColor: bg }} />;

  const countdownFrames = Math.max(1, Math.round(active.round.countdownSeconds * FPS));
  const revealed = active.local >= countdownFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      <AbsoluteFill
        style={{ background: `radial-gradient(circle at 50% 40%, ${accent}1a 0%, transparent 62%)` }}
      />
      {title ? (
        <div
          style={{
            position: "absolute",
            top: 40,
            width: "100%",
            textAlign: "center",
            fontSize: 24,
            letterSpacing: 5,
            color: `${ink}66`,
            fontFamily: "Inter, Helvetica, Arial, sans-serif",
            fontWeight: 600,
          }}
        >
          {title.toUpperCase()}
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          top: 40,
          right: 56,
          fontSize: 24,
          color: `${ink}66`,
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
          fontWeight: 700,
        }}
      >
        {active.index + 1}/{list.length}
      </div>
      <RoundView
        round={active.round}
        local={active.local}
        countdownFrames={countdownFrames}
        palette={pal}
      />
      {/* Citation for the CORRECT option, shown once it is locked in. The three
          decoys are generated and deliberately carry no source. */}
      {revealed ? (
        <div
          style={{
            position: "absolute",
            bottom: 34,
            width: "100%",
            textAlign: "center",
            fontSize: 20,
            color: `${ink}77`,
            fontFamily: "Inter, Helvetica, Arial, sans-serif",
          }}
        >
          source: {active.round.sourceUrl}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
