import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * Self-contained title card (no external font/particle deps so it bundles
 * cleanly inside the app for cloud rendering). Channel name springs in over a
 * palette gradient, subtitle fades up, whole card fades out at the end.
 */
export type TitleCardProps = {
  title: string;
  subtitle?: string;
  palette?: string[];
};

export const TitleCard: React.FC<TitleCardProps> = ({
  title,
  subtitle,
  palette,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const cols =
    palette && palette.length >= 2 ? palette.slice(0, 3) : ["#0a0a1a", "#2a1a3a", "#10242a"];

  const titleSpring = spring({ frame, fps, config: { damping: 200 } });
  const titleY = interpolate(titleSpring, [0, 1], [40, 0]);
  const titleOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const subOpacity = interpolate(frame, [14, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 18, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${cols.join(", ")})`,
        opacity: fadeOut,
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 8%",
          textAlign: "center",
        }}
      >
        <div
          style={{
            transform: `translateY(${titleY}px)`,
            opacity: titleOpacity,
            color: "#f5f3ee",
            fontSize: Math.round(width * 0.06),
            fontWeight: 700,
            letterSpacing: "0.5px",
            textShadow: "0 4px 30px rgba(0,0,0,0.5)",
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: 24,
              opacity: subOpacity,
              color: "rgba(245,243,238,0.82)",
              fontSize: Math.round(width * 0.022),
              fontStyle: "italic",
              letterSpacing: "1px",
            }}
          >
            {subtitle}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
