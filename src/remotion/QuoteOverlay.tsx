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
  /** Approved Studio template preset; never arbitrary CSS or code. */
  presentation?: "editorial_glass" | "ink_card" | "signal_card";
};

const YELLOW = "#ffe14d";
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

export const QuoteOverlay: React.FC<QuoteOverlayProps> = ({ quote, highlights, presentation = "editorial_glass" }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const hi = new Set((highlights ?? []).map(norm).filter(Boolean));
  // These are intentionally a closed, accessibility-checked preset set. A
  // Studio template may select presentation language but cannot inject CSS,
  // suppress the quote, or change the timing/safe-area contract.
  const theme = presentation === "ink_card"
    ? { accent: "#f1c86b", scrim: 0.46, panel: "rgba(20, 17, 12, 0.82)", border: "rgba(241, 200, 107, 0.52)", family: "Georgia, 'Times New Roman', serif" }
    : presentation === "signal_card"
      ? { accent: "#78c5ff", scrim: 0.42, panel: "rgba(8, 23, 40, 0.80)", border: "rgba(120, 197, 255, 0.55)", family: "'Helvetica Neue', Arial, sans-serif" }
      : { accent: YELLOW, scrim: 0.38, panel: "transparent", border: "transparent", family: "Georgia, 'Times New Roman', serif" };

  // Very slow, calm fades (≈2s at 30fps) so the quote eases in and out gently.
  const scrim = interpolate(frame, [0, 60], [0, theme.scrim], { extrapolateRight: "clamp" });
  const rise = interpolate(spring({ frame, fps, config: { damping: 200, stiffness: 45 } }), [0, 1], [44, 0]);
  const appear = interpolate(frame, [14, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [durationInFrames - 50, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const words = quote.split(/\s+/);
  const fontSize = Math.round(width * 0.044);

  return (
    <AbsoluteFill style={{ opacity: fadeOut, fontFamily: theme.family }}>
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
            background: theme.panel,
            border: `1px solid ${theme.border}`,
            borderRadius: presentation === "editorial_glass" ? 0 : Math.round(width * 0.008),
            boxShadow: presentation === "editorial_glass" ? "none" : "0 16px 48px rgba(0,0,0,0.38)",
            padding: presentation === "editorial_glass" ? 0 : `${Math.round(width * 0.024)}px ${Math.round(width * 0.032)}px`,
          }}
        >
          <span style={{ color: theme.accent, fontSize: Math.round(fontSize * 1.5) }}>“</span>
          {words.map((w, i) => (
            <span key={i} style={{ color: hi.has(norm(w)) ? theme.accent : "#f5f3ee" }}>
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
          <span style={{ color: theme.accent, fontSize: Math.round(fontSize * 1.5) }}>”</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
