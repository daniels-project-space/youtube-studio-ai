import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * Transparent quote overlay (alpha). A dark scrim fades in (focus pull on the
 * blurred background, which ffmpeg applies underneath), then the quote rises +
 * fades in — bold serif, with important words in yellow. Fades out at the end.
 * Self-contained (only `remotion` core) so it bundles for cloud rendering.
 */
export type QuoteOverlayProps = {
  quote: string;
  highlights?: string[];
};

const YELLOW = "#ffe14d";
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

export const QuoteOverlay: React.FC<QuoteOverlayProps> = ({ quote, highlights }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const hi = new Set((highlights ?? []).map(norm).filter(Boolean));

  const scrim = interpolate(frame, [0, 20], [0, 0.55], { extrapolateRight: "clamp" });
  const rise = interpolate(spring({ frame, fps, config: { damping: 200 } }), [0, 1], [36, 0]);
  const appear = interpolate(frame, [8, 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const words = quote.split(/\s+/);
  const fontSize = Math.round(width * 0.044);

  return (
    <AbsoluteFill style={{ opacity: fadeOut, fontFamily: "Georgia, 'Times New Roman', serif" }}>
      {/* scrim — darkens the (ffmpeg-blurred) background */}
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: scrim }} />
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 12%",
        }}
      >
        <div
          style={{
            transform: `translateY(${rise}px)`,
            opacity: appear,
            textAlign: "center",
            fontWeight: 700,
            fontSize,
            lineHeight: 1.35,
            color: "#f5f3ee",
            textShadow: "0 4px 28px rgba(0,0,0,0.7)",
          }}
        >
          <span style={{ color: YELLOW, fontSize: Math.round(fontSize * 1.5) }}>“</span>
          {words.map((w, i) => (
            <span key={i} style={{ color: hi.has(norm(w)) ? YELLOW : "#f5f3ee" }}>
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
          <span style={{ color: YELLOW, fontSize: Math.round(fontSize * 1.5) }}>”</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
