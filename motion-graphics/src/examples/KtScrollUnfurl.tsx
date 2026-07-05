/**
 * KtScrollUnfurl — PARCHMENT SCROLL list.
 *
 * Red ornate bg + silhouette horn-blower (SVG) on the left. 4 parchment scrolls
 * unfurl top->bottom one after another (scaleY 0->1, transform-origin top,
 * spring overshoot), each revealing serif text. Staggered ~25 frames/scroll.
 *
 * Deterministic: spring() keyed on frame - i*stagger.
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/EBGaramond";

const { fontFamily } = loadFont();

const LINES = [
  "Believe this message",
  "Your pigs won't die",
  "Your wife won't have miscarriages",
  "and you'll have rings on your fingers",
];

const STAGGER = 25;

const Scroll: React.FC<{ index: number; text: string }> = ({ index, text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - index * STAGGER;
  const s = spring({
    frame: local,
    fps,
    config: { damping: 14, mass: 0.9, stiffness: 110 },
  });
  const scaleY = interpolate(s, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });
  const textOpacity = interpolate(local, [10, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: 1020,
        marginBottom: 20,
        transform: `scaleY(${scaleY})`,
        transformOrigin: "top center",
      }}
    >
      <div
        style={{
          position: "relative",
          padding: "26px 70px",
          borderRadius: 6,
          background:
            "linear-gradient(180deg, #efe2c0 0%, #e7d6ad 45%, #dcc795 100%)",
          boxShadow:
            "0 10px 24px rgba(0,0,0,0.45), inset 0 0 60px rgba(150,110,60,0.25)",
          // paper texture via layered gradients
          backgroundBlendMode: "multiply",
        }}
      >
        {/* rolled ends */}
        <div
          style={{
            position: "absolute",
            left: -22,
            top: "50%",
            transform: "translateY(-50%)",
            width: 22,
            height: "118%",
            borderRadius: 6,
            background: "linear-gradient(90deg, #8a6a3a, #c9a96a)",
            boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: -22,
            top: "50%",
            transform: "translateY(-50%)",
            width: 22,
            height: "118%",
            borderRadius: 6,
            background: "linear-gradient(90deg, #c9a96a, #8a6a3a)",
            boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
          }}
        />
        <p
          style={{
            margin: 0,
            textAlign: "center",
            fontFamily,
            fontWeight: 600,
            fontStyle: "italic",
            fontSize: 48,
            color: "#3a2410",
            opacity: textOpacity,
          }}
        >
          {text}
        </p>
      </div>
    </div>
  );
};

export const KtScrollUnfurl: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#1a0606",
        backgroundImage:
          "radial-gradient(ellipse 75% 85% at 60% 45%, #4a0d0d, #1a0404 70%)",
      }}
    >
      {/* Ornate corner swirls. */}
      <AbsoluteFill style={{ opacity: 0.12, mixBlendMode: "screen" }}>
        <svg width="100%" height="100%" viewBox="0 0 1920 1080">
          <g stroke="#cc8888" strokeWidth={2} fill="none">
            <path d="M 60 120 Q 240 40 420 120" />
            <path d="M 1500 960 Q 1680 1040 1860 960" />
          </g>
        </svg>
      </AbsoluteFill>

      {/* Silhouette horn-blower on the left. */}
      <svg
        style={{ position: "absolute", left: 60, bottom: 40 }}
        width={360}
        height={720}
        viewBox="0 0 360 720"
      >
        <g fill="#0a0202">
          {/* body */}
          <path d="M 150 260 q -40 10 -52 70 l -8 360 q 60 18 120 0 l -6 -360 q -10 -56 -54 -70 z" />
          {/* head */}
          <circle cx={158} cy={210} r={46} />
          {/* arm up to horn */}
          <path d="M 188 300 q 70 -30 130 -70 l 14 22 q -56 44 -126 78 z" />
          {/* horn (long trumpet) */}
          <path d="M 300 210 q 34 -8 60 -2 l 0 40 q -30 8 -64 4 q 6 -22 4 -42 z" />
          <rect x={250} y={224} width={70} height={14} rx={6} />
        </g>
      </svg>

      {/* Scroll stack. */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "flex-end",
          paddingRight: 120,
          flexDirection: "column",
        }}
      >
        {LINES.map((t, i) => (
          <Scroll key={i} index={i} text={t} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
