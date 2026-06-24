import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { frameToMs } from "./types";
import type { SpeechSegment, SpeechTheme } from "./types";

/**
 * Top-right "channel bug": a white circle reading `index/total` with a progress
 * ring that fills across the active segment — the reference's `1/8 … 8/8`.
 */
export const ChannelBug: React.FC<{
  segments: SpeechSegment[];
  theme: SpeechTheme;
}> = ({ segments, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frameToMs(frame, fps);

  const seg =
    segments.find((s) => t >= s.start && t < s.end) ??
    segments[segments.length - 1];
  if (!seg) return null;

  const prog = Math.max(
    0,
    Math.min(1, (t - seg.start) / Math.max(1, seg.end - seg.start)),
  );
  const size = 86;
  const R = 31;
  const C = 2 * Math.PI * R;

  return (
    <div
      style={{
        position: "absolute",
        top: 42,
        right: 52,
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: theme.fontFamily,
      }}
    >
      <svg
        width={size}
        height={size}
        style={{ position: "absolute", top: 0, left: 0, transform: "rotate(-90deg)" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={R}
          fill="rgba(0,0,0,0.18)"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth={3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={R}
          fill="none"
          stroke={theme.accent}
          strokeWidth={3}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - prog)}
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          color: theme.captionColor,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: 0.5,
          textShadow: "0 1px 6px rgba(0,0,0,0.7)",
        }}
      >
        {seg.index}/{seg.total}
      </span>
    </div>
  );
};
