import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { frameToMs } from "./types";
import type { SpeechSegment } from "./types";

/**
 * Small lower-third in the bottom-left showing the current speaker's name. Fades
 * in when a new speaker's cut begins, holds a few seconds, fades out. Suppressed
 * when the same speaker continues into the next cut (no re-popping the same name).
 */
export const SpeakerNameTag: React.FC<{
  segments: SpeechSegment[];
  fontFamily?: string;
  accent?: string;
}> = ({ segments, fontFamily = '"Helvetica Neue", Helvetica, Arial, sans-serif', accent = "#ffd27a" }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frameToMs(frame, fps);

  const idx = segments.findIndex((s) => t >= s.start && t < s.end);
  if (idx < 0) return null;
  const seg = segments[idx];
  if (!seg.label) return null;
  // don't re-show if the previous cut was the same speaker
  if (idx > 0 && segments[idx - 1].label === seg.label) return null;

  const into = t - seg.start;
  const SHOW = 3400, FIN = 360, FOUT = 480;
  if (into < 0 || into > SHOW) return null;
  const opacity =
    into < FIN
      ? interpolate(into, [0, FIN], [0, 1], { extrapolateRight: "clamp" })
      : into > SHOW - FOUT
        ? interpolate(into, [SHOW - FOUT, SHOW], [1, 0], { extrapolateLeft: "clamp" })
        : 1;

  const fontSize = Math.round(width * 0.0185);
  return (
    <div
      style={{
        position: "absolute",
        left: "5%",
        bottom: "28%",
        display: "flex",
        alignItems: "center",
        gap: fontSize * 0.55,
        opacity,
        fontFamily,
      }}
    >
      <div style={{ width: 3, height: fontSize * 1.25, backgroundColor: accent, boxShadow: `0 0 10px ${accent}aa` }} />
      <span
        style={{
          fontSize,
          fontWeight: 600,
          letterSpacing: 2.5,
          textTransform: "uppercase",
          color: "#fff",
          textShadow: "0 2px 12px rgba(0,0,0,0.95)",
        }}
      >
        {seg.label}
      </span>
    </div>
  );
};
