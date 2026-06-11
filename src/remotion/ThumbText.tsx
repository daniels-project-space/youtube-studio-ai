import React from "react";
import { AbsoluteFill } from "remotion";

/**
 * THUMBNAIL TEXT LAYER — a single transparent frame of real typography,
 * replacing ffmpeg drawtext (one font, flat white, no devices) with the
 * editorial language top thumbnails actually use: per-word accent color,
 * a giant number callout (the finance credibility trigger), accent
 * underline/rule, stroke + glow, badge mark. Composited over the AI base.
 */
export type ThumbTextProps = {
  /** Title lines (1-3 words each works best). accent = render in accentColor. */
  lines: { text: string; accent?: boolean; size?: number }[];
  /** Giant standalone number/stat (e.g. "10,000%") — upper third, 15-20% of canvas. */
  numberCallout?: string;
  position?: "left" | "center" | "upperLeft" | "upperCenter";
  baseColor?: string;
  accentColor?: string;
  uppercase?: boolean;
  /** Hard outline width (px at 1280-wide); 0 = none. */
  strokePx?: number;
  glow?: boolean;
  /** Accent rule under the LAST line. */
  underlineAccent?: boolean;
  /** Small brand mark, bottom-center. */
  badge?: string;
  /** Dark gradient scrim behind the text zone for guaranteed contrast. */
  scrim?: boolean;
};

const FONT_STACK =
  "'Arial Black', 'Arial Bold', 'Helvetica Neue', 'DejaVu Sans', sans-serif";

export const ThumbText: React.FC<ThumbTextProps> = ({
  lines,
  numberCallout,
  position = "left",
  baseColor = "#ffffff",
  accentColor = "#ffd400",
  uppercase = true,
  strokePx = 6,
  glow = true,
  underlineAccent = true,
  badge,
  scrim = true,
}) => {
  const W = 1280;
  const isLeft = position === "left" || position === "upperLeft";
  const isUpper = position === "upperLeft" || position === "upperCenter";

  // Judge-calibrated: 0.085 left secondary lines under-weighted next to the
  // number callout (tournament fix note on all 3 candidates) — lines must hit
  // like headlines, not captions.
  const baseSize = Math.round(W * 0.108);
  const stroke = strokePx > 0
    ? `${strokePx}px #000000`
    : undefined;
  const shadow = [
    glow ? `0 0 ${Math.round(W * 0.02)}px rgba(0,0,0,0.9)` : "",
    `0 ${Math.round(W * 0.006)}px ${Math.round(W * 0.02)}px rgba(0,0,0,0.85)`,
  ].filter(Boolean).join(", ");

  return (
    <AbsoluteFill style={{ fontFamily: FONT_STACK }}>
      {scrim && (
        <AbsoluteFill
          style={{
            background: isLeft
              ? "linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.28) 38%, rgba(0,0,0,0) 62%)"
              : "linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0.35) 100%)",
          }}
        />
      )}

      {numberCallout ? (
        <div
          style={{
            position: "absolute",
            top: "6%",
            ...(isLeft ? { left: "4.5%" } : { left: 0, right: 0, textAlign: "center" as const }),
            fontSize: Math.round(W * 0.155),
            fontWeight: 900,
            letterSpacing: "-0.015em",
            color: accentColor,
            WebkitTextStroke: strokePx > 0 ? `${Math.max(2, strokePx - 1)}px #000` : undefined,
            textShadow: shadow,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {numberCallout}
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          ...(isUpper
            ? { top: numberCallout ? "28%" : "8%" }
            : { bottom: badge ? "13%" : "9%" }),
          ...(isLeft ? { left: "4.5%", textAlign: "left" as const } : { left: 0, right: 0, textAlign: "center" as const }),
          maxWidth: isLeft ? "62%" : "92%",
          marginLeft: isLeft ? 0 : "auto",
          marginRight: isLeft ? 0 : "auto",
        }}
      >
        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              fontSize: Math.round(baseSize * (l.size ?? 1)),
              fontWeight: 900,
              lineHeight: 1.06,
              letterSpacing: "0.005em",
              color: l.accent ? accentColor : baseColor,
              WebkitTextStroke: stroke,
              textShadow: shadow,
              textTransform: uppercase ? ("uppercase" as const) : ("none" as const),
            }}
          >
            {l.text}
          </div>
        ))}
        {underlineAccent && lines.length > 0 ? (
          <div
            style={{
              width: Math.round(W * 0.16),
              height: Math.round(W * 0.008),
              background: accentColor,
              marginTop: Math.round(W * 0.012),
              borderRadius: 4,
              boxShadow: "0 2px 12px rgba(0,0,0,0.8)",
              ...(isLeft ? {} : { marginLeft: "auto", marginRight: "auto" }),
            }}
          />
        ) : null}
      </div>

      {badge ? (
        <div
          style={{
            position: "absolute",
            bottom: "4%",
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: Math.round(W * 0.022),
            fontWeight: 700,
            letterSpacing: "0.32em",
            color: "rgba(255,255,255,0.92)",
            textShadow: "0 2px 10px rgba(0,0,0,0.9)",
            textTransform: "uppercase",
          }}
        >
          {badge}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
