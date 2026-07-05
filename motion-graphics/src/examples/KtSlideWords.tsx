/**
 * KtSlideWords — KINETIC TYPE slide-in.
 *
 * Beat 1 (dark-red ornate bg): thin white line "I don't know what you feel
 * about the" then bold "PRO$PERITY GOSPEL" (S in PROSPERITY rendered as $).
 * Each WORD slides in from left (translateX -50 -> 0) + fade, staggered ~4
 * frames apart with spring easing.
 * Beat 2 (~frame 80): bg shifts to deep blue, subtitle "The Health, Wealth,
 * and Prosperity Gospel" slides in.
 *
 * Deterministic: spring() per word keyed on frame - i*stagger.
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";

const { fontFamily: inter } = loadInter();
const { fontFamily: poppins } = loadPoppins();

const STAGGER = 4;

const SlideWord: React.FC<{
  children: React.ReactNode;
  index: number;
  startFrame: number;
  style?: React.CSSProperties;
}> = ({ children, index, startFrame, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - startFrame - index * STAGGER;
  const s = spring({ frame: local, fps, config: { damping: 200, mass: 0.6 } });
  const x = interpolate(s, [0, 1], [-60, 0]);
  const opacity = interpolate(s, [0, 1], [0, 1]);
  return (
    <span
      style={{
        display: "inline-block",
        transform: `translateX(${x}px)`,
        opacity,
        marginRight: "0.32em",
        ...style,
      }}
    >
      {children}
    </span>
  );
};

export const KtSlideWords: React.FC = () => {
  const frame = useCurrentFrame();

  // Background colour cross-fade red -> blue around frame 80.
  const toBlue = interpolate(frame, [78, 96], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bgRed = "radial-gradient(ellipse 80% 90% at 50% 40%, #4a0d0d, #1a0404 70%)";
  const bgBlue =
    "radial-gradient(ellipse 80% 90% at 50% 55%, #0d2a4a, #03101e 70%)";

  const line1 = "I don't know what you feel about the".split(" ");
  // "PROSPERITY" with S -> $  and "GOSPEL"
  const headline = ["PRO$PERITY", "GOSPEL"];
  const subtitle = "The Health, Wealth, and Prosperity Gospel".split(" ");

  // Beat-2 fade-out of beat-1 content.
  const beat1Fade = interpolate(frame, [80, 94], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ fontFamily: inter }}>
      {/* Cross-faded backgrounds. */}
      <AbsoluteFill style={{ backgroundImage: bgRed, opacity: 1 - toBlue }} />
      <AbsoluteFill style={{ backgroundImage: bgBlue, opacity: toBlue }} />

      {/* Subtle swirl ornament. */}
      <AbsoluteFill style={{ opacity: 0.1, mixBlendMode: "screen" }}>
        <svg width="100%" height="100%" viewBox="0 0 1920 1080">
          <path
            d="M 100 260 Q 500 120 960 260 T 1820 260"
            stroke="#cc8888"
            strokeWidth={2}
            fill="none"
          />
          <path
            d="M 100 820 Q 500 960 960 820 T 1820 820"
            stroke="#cc8888"
            strokeWidth={2}
            fill="none"
          />
        </svg>
      </AbsoluteFill>

      {/* BEAT 1 */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          opacity: beat1Fade,
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            textAlign: "center",
            fontWeight: 300,
            fontSize: 46,
            color: "#f2e9e9",
            marginBottom: 26,
          }}
        >
          {line1.map((w, i) => (
            <SlideWord key={i} index={i} startFrame={6}>
              {w}
            </SlideWord>
          ))}
        </div>
        <div
          style={{
            textAlign: "center",
            fontFamily: poppins,
            fontWeight: 800,
            fontSize: 132,
            lineHeight: 1.02,
            color: "#ffffff",
            letterSpacing: 1,
            textShadow: "0 8px 30px rgba(0,0,0,0.6)",
          }}
        >
          {headline.map((w, i) => (
            <SlideWord
              key={i}
              index={i}
              startFrame={30}
              style={{
                color: i === 0 ? "#f6d36b" : "#ffffff",
              }}
            >
              {w}
            </SlideWord>
          ))}
        </div>
      </AbsoluteFill>

      {/* BEAT 2 — subtitle over blue. */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: toBlue,
        }}
      >
        <div
          style={{
            maxWidth: 1300,
            textAlign: "center",
            fontFamily: poppins,
            fontWeight: 600,
            fontSize: 70,
            color: "#eaf2ff",
            textShadow: "0 6px 24px rgba(0,0,0,0.5)",
          }}
        >
          {subtitle.map((w, i) => (
            <SlideWord key={i} index={i} startFrame={92}>
              {w}
            </SlideWord>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
