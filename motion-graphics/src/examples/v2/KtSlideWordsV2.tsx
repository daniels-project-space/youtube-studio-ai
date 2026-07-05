/**
 * KtSlideWordsV2 — kinetic type, broadcast tier. Matches frame at_29-25.
 *
 * Muted grey (#c9c9c9) heavy condensed caps (Anton), stacked lines. Each WORD
 * slides in from the left (translateX -60 -> 0) + fade with a sharp ease-out
 * and Trail motion blur, ~4f stagger. Soft drop shadow. BG: dark-red radial +
 * a large faint rotating spiral/damask ornament, heavy vignette + grain.
 * Final beat shifts bg to deep blue for the subtitle line.
 *
 * Native Remotion path. Deterministic.
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { FilmGrain, Vignette, EASE_OUT, BaroqueDamask } from "./_shared";

const { fontFamily: anton } = loadAnton();
const { fontFamily: oswald } = loadOswald();

const STAGGER = 4;

const SlideWord: React.FC<{
  children: React.ReactNode;
  index: number;
  startFrame: number;
  accent?: boolean;
}> = ({ children, index, startFrame, accent }) => {
  const frame = useCurrentFrame();
  const t = frame - startFrame - index * STAGGER;
  const p = interpolate(t, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const x = interpolate(p, [0, 1], [-60, 0]);
  const opacity = p;
  // directional motion blur: strong while moving, 0 once settled. Keeps inline
  // layout intact (per-word <Trail> collapses the flex flow).
  const mb = interpolate(p, [0, 0.6, 1], [10, 4, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <span
      style={{
        display: "inline-block",
        transform: `translateX(${x}px)`,
        opacity,
        marginRight: "0.3em",
        color: accent ? "#e7c84a" : "#c9c9c9",
        textShadow: "0 6px 14px rgba(0,0,0,0.6)",
        filter: mb > 0.1 ? `blur(${mb}px)` : "none",
      }}
    >
      {children}
    </span>
  );
};

/** Dense dark-red baroque damask ornament behind the words (subtle texture). */
const DamaskBG: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <BaroqueDamask
      color="rgba(255,70,70,0.11)"
      accent="rgba(255,60,60,0.15)"
      opacity={0.85}
      tile={280}
      drift
      frame={frame}
    />
  );
};

export const KtSlideWordsV2: React.FC = () => {
  const frame = useCurrentFrame();

  // bg red -> deep blue for the final subtitle beat
  const blueMix = interpolate(frame, [110, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bgInner = blueMix > 0
    ? `rgba(${Math.round(140 - 120 * blueMix)},${Math.round(20 + 30 * blueMix)},${Math.round(20 + 90 * blueMix)},1)`
    : "#8c1414";
  const bgOuter = blueMix > 0
    ? `rgba(${Math.round(42 - 30 * blueMix)},${Math.round(6 + 14 * blueMix)},${Math.round(6 + 60 * blueMix)},1)`
    : "#240505";

  // main words fade out as subtitle comes in
  const mainOpacity = interpolate(frame, [108, 124], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subStart = 126;
  const subP = interpolate(frame, [subStart, subStart + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  const lines: { words: { t: string; accent?: boolean }[] }[] = [
    { words: [{ t: "I" }, { t: "DON'T" }] },
    { words: [{ t: "KNOW" }] },
    { words: [{ t: "WHAT" }, { t: "YOU" }, { t: "FEEL" }] },
    { words: [{ t: "ABOUT" }, { t: "THE" }] },
    { words: [{ t: "PRO$PERITY", accent: true }, { t: "GOSPEL", accent: true }] },
  ];

  let runningIndex = 0;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 70% 70% at 50% 42%, ${bgInner}, ${bgOuter})`,
        fontFamily: anton,
      }}
    >
      <DamaskBG />

      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: mainOpacity,
          transform: `scale(${interpolate(frame, [0, 100], [1.0, 1.04])})`,
        }}
      >
        {lines.map((line, li) => {
          const startFrame = 6;
          return (
            <div
              key={li}
              style={{
                fontSize: 126,
                lineHeight: 1.0,
                letterSpacing: 2,
                textTransform: "uppercase",
                fontWeight: 400,
                whiteSpace: "nowrap",
              }}
            >
              {line.words.map((w) => {
                const idx = runningIndex++;
                return (
                  <SlideWord
                    key={idx}
                    index={idx}
                    startFrame={startFrame}
                    accent={w.accent}
                  >
                    {w.t}
                  </SlideWord>
                );
              })}
            </div>
          );
        })}
      </AbsoluteFill>

      {/* deep-blue subtitle beat */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          opacity: subP,
          transform: `translateY(${interpolate(subP, [0, 1], [30, 0])}px)`,
        }}
      >
        <div
          style={{
            fontFamily: oswald,
            fontWeight: 600,
            fontSize: 70,
            color: "#dfe6f2",
            textAlign: "center",
            letterSpacing: 1,
            textShadow: "0 6px 16px rgba(0,0,0,0.6)",
            maxWidth: 1300,
          }}
        >
          The Health, Wealth, and Prosperity Gospel
        </div>
      </AbsoluteFill>

      <Vignette strength={0.78 + 0.05 * Math.sin(frame * 0.05)} />
      <FilmGrain opacity={0.06} />
    </AbsoluteFill>
  );
};
