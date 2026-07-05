/**
 * KtMetalSlice — HERO SHOT ("HATRED." look).
 *
 * Ornate dark-red background + thin silver border frame. Center word "HATRED."
 * in heavy condensed bold (Anton), filled with an animated metallic silver
 * gradient (background-clip:text), revealed by a horizontal bar-wipe + animated
 * clip-path inset reveal. Two thin animated rule lines bracket the word.
 *
 * Deterministic: all motion from useCurrentFrame() + interpolate/spring.
 * Reference language: documentary lyric-video hero card.
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Anton";

const { fontFamily } = loadFont();

export const KtMetalSlice: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  // Metallic shimmer: scroll the gradient background-position across the text.
  const shimmer = interpolate(frame, [0, 150], [0, 300], {
    extrapolateRight: "extend",
  });

  // Bar-wipe sweep: a bright vertical bar travels left -> right (frames 8-44).
  const barProgress = interpolate(frame, [8, 44], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const barX = interpolate(barProgress, [0, 1], [-10, 110]);
  const barOpacity = interpolate(
    barProgress,
    [0, 0.15, 0.85, 1],
    [0, 1, 1, 0]
  );

  // Clip-path reveal: text revealed from left as bar passes. inset right X 100->0.
  const revealRight = interpolate(frame, [10, 46], [100, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Subtle scale settle on the whole word.
  const settle = spring({
    frame: frame - 8,
    fps,
    config: { damping: 200, mass: 0.8 },
  });
  const scale = interpolate(settle, [0, 1], [1.06, 1]);

  // Rule lines grow outward from center.
  const ruleProgress = spring({
    frame: frame - 40,
    fps,
    config: { damping: 200 },
  });
  const ruleWidth = interpolate(ruleProgress, [0, 1], [0, 520]);

  // Border frame fade-in.
  const frameOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  const metalGradient =
    "linear-gradient(100deg, #6d6d6d 0%, #cfcfcf 18%, #ffffff 32%, #9a9a9a 48%, #efefef 64%, #777 82%, #c9c9c9 100%)";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#1a0606",
        backgroundImage:
          "radial-gradient(ellipse 70% 80% at 50% 45%, #4a0d0d 0%, #2a0808 45%, #120303 100%)",
        justifyContent: "center",
        alignItems: "center",
        fontFamily,
      }}
    >
      {/* Ornate swirl shapes (subtle, behind everything). */}
      <AbsoluteFill style={{ opacity: 0.14, mixBlendMode: "screen" }}>
        <svg width="100%" height="100%" viewBox="0 0 1920 1080">
          <g stroke="#b85c5c" strokeWidth={2} fill="none">
            <path d="M 200 200 Q 480 60 760 200 T 1320 200" opacity={0.5} />
            <path d="M 200 880 Q 480 1020 760 880 T 1320 880" opacity={0.5} />
            <circle cx={300} cy={540} r={180} opacity={0.3} />
            <circle cx={1620} cy={540} r={180} opacity={0.3} />
          </g>
        </svg>
      </AbsoluteFill>

      {/* Thin silver border frame. */}
      <div
        style={{
          position: "absolute",
          inset: 48,
          border: "2px solid rgba(214,214,214,0.55)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
          opacity: frameOpacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 60,
          border: "1px solid rgba(180,120,120,0.4)",
          opacity: frameOpacity,
        }}
      />

      {/* Top rule line. */}
      <div
        style={{
          position: "absolute",
          top: 360,
          width: ruleWidth,
          height: 2,
          background:
            "linear-gradient(90deg, transparent, #d6d6d6, transparent)",
        }}
      />

      {/* Word with metallic fill + clip-path reveal. */}
      <div style={{ position: "relative", transform: `scale(${scale})` }}>
        <h1
          style={{
            margin: 0,
            fontSize: 230,
            lineHeight: 1,
            letterSpacing: 4,
            backgroundImage: metalGradient,
            backgroundSize: "300% 100%",
            backgroundPosition: `${shimmer}% 50%`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            clipPath: `inset(0 ${revealRight}% 0 0)`,
            filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.6))",
          }}
        >
          HATRED.
        </h1>

        {/* Bright bar-wipe sweeping across. */}
        <div
          style={{
            position: "absolute",
            top: -20,
            bottom: -20,
            left: `${barX}%`,
            width: 14,
            background:
              "linear-gradient(90deg, transparent, #ffffff 40%, #fff 60%, transparent)",
            opacity: barOpacity,
            filter: "blur(2px)",
            boxShadow: "0 0 40px 10px rgba(255,255,255,0.5)",
          }}
        />
      </div>

      {/* Bottom rule line. */}
      <div
        style={{
          position: "absolute",
          top: 720,
          width: ruleWidth,
          height: 2,
          background:
            "linear-gradient(90deg, transparent, #d6d6d6, transparent)",
        }}
      />
    </AbsoluteFill>
  );
};
