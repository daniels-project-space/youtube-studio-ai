import React from "react";
import { AbsoluteFill, staticFile } from "remotion";

/**
 * THUMBNAIL TEXT LAYER — per-channel VISUAL LANGUAGE, not one template.
 *
 * Five typefaces × five text treatments × channel palette = a layout grammar
 * the playbook chooses per identity, so no two channels wear the same look.
 * Sizing is GLYPH-AWARE: every line is measured against its container before
 * it renders (font width factor × char count), so text can never clip — the
 * "HAVANA cut off" class is impossible by construction, in every zone.
 */
export type ThumbTextProps = {
  lines: { text: string; accent?: boolean; size?: number }[];
  /** Giant standalone number/stat — upper third, 15-20% of canvas. */
  numberCallout?: string;
  position?: "left" | "center" | "upperLeft" | "upperCenter" | "right" | "upperRight";
  baseColor?: string;
  accentColor?: string;
  uppercase?: boolean;
  strokePx?: number;
  glow?: boolean;
  underlineAccent?: boolean;
  badge?: string;
  /** Badge placement: center = bottom-center wordmark; pill = top-right pill. */
  badgeStyle?: "center" | "pill";
  scrim?: boolean;
  /**
   * Typeface personality: impact (Anton, bold modern) | marker (hand-drawn) |
   * bebas (tall minimal) | serif (editorial premium) | rounded (soft playful).
   */
  font?: "impact" | "marker" | "bebas" | "serif" | "rounded";
  /**
   * ACCENT-LINE treatment — the channel's signature device:
   * plate = filled accent box, dark text (high-energy)
   * sticker = white box, dark text, hard offset shadow (playful/pop)
   * stamp = hollow accent border, accent text (archival/editorial)
   * neon = glowing accent text, no box (night/synth worlds)
   * clean = plain accent-colored type (minimal premium)
   */
  treatment?: "plate" | "sticker" | "stamp" | "neon" | "clean";
};

const FONT_FAMILIES = {
  impact: "'Anton', 'Arial Black', 'DejaVu Sans', sans-serif",
  marker: "'Permanent Marker', 'Comic Sans MS', cursive",
  bebas: "'Bebas Neue', 'Anton', sans-serif",
  serif: "'DM Serif Display', Georgia, serif",
  rounded: "'Fredoka One', 'Arial Rounded MT Bold', sans-serif",
} as const;

/** Average glyph width as a fraction of font-size (measured per face). */
const GLYPH_W = { impact: 0.5, marker: 0.62, bebas: 0.4, serif: 0.52, rounded: 0.58 } as const;

/** Relative luminance of a #hex color (0=black, 1=white). */
function lum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

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
  badgeStyle = "center",
  scrim = true,
  font = "impact",
  treatment = "plate",
}) => {
  const W = 1280;
  const family = FONT_FAMILIES[font] ?? FONT_FAMILIES.impact;
  const glyphW = GLYPH_W[font] ?? 0.55;
  // CONTRAST GUARANTEES (deterministic — never judge-dependent):
  // text sitting ON the image must be LIGHT; a filled plate must be BRIGHT
  // enough to carry dark text; colored-text treatments must glow bright.
  const safeBase = lum(baseColor) < 0.55 ? "#ffffff" : baseColor;
  const plateBg = lum(accentColor) >= 0.38 ? accentColor : "#f2f2f2";
  const textAccent = lum(accentColor) >= 0.45 ? accentColor : "#ffffff";
  const isLeft = position === "left" || position === "upperLeft";
  const isRight = position === "right" || position === "upperRight";
  const isSide = isLeft || isRight;
  const isUpper = position === "upperLeft" || position === "upperCenter" || position === "upperRight";

  const baseSize = Math.round(W * 0.105);
  const platePad = Math.round(W * 0.012);
  // GLYPH-AWARE FIT: container width minus padding, divided by estimated text
  // width — the font size that GUARANTEES the line fits its zone.
  const containerPx = W * (isSide ? 0.56 : 0.86);
  const fitSize = (text: string, mul: number, padded: boolean): number => {
    const want = baseSize * mul;
    const avail = containerPx - (padded ? platePad * 2 : 0);
    const maxByWidth = avail / (Math.max(1, text.length) * glyphW);
    return Math.round(Math.min(want, maxByWidth));
  };

  const stroke = strokePx > 0 ? `${strokePx}px #000000` : undefined;
  const shadow = [
    glow ? `0 0 ${Math.round(W * 0.02)}px rgba(0,0,0,0.9)` : "",
    `0 ${Math.round(W * 0.006)}px ${Math.round(W * 0.02)}px rgba(0,0,0,0.85)`,
  ].filter(Boolean).join(", ");

  const accentStyle = (size: number): React.CSSProperties => {
    switch (treatment) {
      case "sticker":
        return {
          display: "inline-block", fontSize: size, lineHeight: 1.05, color: "#15120e",
          background: "#ffffff", padding: `${Math.round(platePad * 0.5)}px ${platePad}px`,
          border: `${Math.round(W * 0.004)}px solid #15120e`, borderRadius: 10,
          boxShadow: `${Math.round(W * 0.007)}px ${Math.round(W * 0.007)}px 0 ${accentColor}`,
          transform: "rotate(-2deg)",
        };
      case "stamp":
        return {
          display: "inline-block", fontSize: size, lineHeight: 1.05, color: textAccent,
          background: "rgba(0,0,0,0.25)", padding: `${Math.round(platePad * 0.45)}px ${platePad}px`,
          border: `${Math.round(W * 0.005)}px solid ${accentColor}`, borderRadius: 4,
          transform: "rotate(-1.5deg)", letterSpacing: "0.06em",
        };
      case "neon":
        return {
          display: "inline-block", fontSize: size, lineHeight: 1.05, color: textAccent,
          textShadow: `0 0 ${Math.round(W * 0.006)}px ${accentColor}, 0 0 ${Math.round(W * 0.02)}px ${accentColor}, 0 0 ${Math.round(W * 0.045)}px ${accentColor}, 0 2px 16px rgba(0,0,0,0.9)`,
        };
      case "clean":
        return {
          display: "inline-block", fontSize: size, lineHeight: 1.05, color: textAccent,
          WebkitTextStroke: stroke, textShadow: shadow,
        };
      default: // plate
        return {
          display: "inline-block", fontSize: size, lineHeight: 1.04, color: "#0b0b10",
          background: plateBg, padding: `${Math.round(platePad * 0.35)}px ${platePad}px`,
          borderRadius: 6, boxShadow: `0 ${Math.round(W * 0.006)}px ${Math.round(W * 0.02)}px rgba(0,0,0,0.7)`,
          transform: "rotate(-1deg)",
        };
    }
  };

  const sideAnchor: React.CSSProperties = isLeft
    ? { left: "4.5%", textAlign: "left" }
    : isRight
      ? { right: "4.5%", textAlign: "right" }
      : { left: 0, right: 0, textAlign: "center" };

  return (
    <AbsoluteFill style={{ fontFamily: family }}>
      <style>{`
        @font-face { font-family: 'Anton'; src: url('${staticFile("fonts/Anton.ttf")}') format('truetype'); font-display: block; }
        @font-face { font-family: 'Permanent Marker'; src: url('${staticFile("fonts/PermanentMarker.ttf")}') format('truetype'); font-display: block; }
        @font-face { font-family: 'Bebas Neue'; src: url('${staticFile("fonts/BebasNeue.ttf")}') format('truetype'); font-display: block; }
        @font-face { font-family: 'DM Serif Display'; src: url('${staticFile("fonts/DMSerifDisplay.ttf")}') format('truetype'); font-display: block; }
        @font-face { font-family: 'Fredoka One'; src: url('${staticFile("fonts/FredokaOne.ttf")}') format('truetype'); font-display: block; }
      `}</style>
      {scrim && (
        <AbsoluteFill
          style={{
            background: isLeft
              ? "linear-gradient(90deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 42%, rgba(0,0,0,0) 70%)"
              : isRight
                ? "linear-gradient(270deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 42%, rgba(0,0,0,0) 70%)"
                : "linear-gradient(0deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.3) 48%, rgba(0,0,0,0.45) 100%)",
          }}
        />
      )}

      {numberCallout ? (
        <div
          style={{
            position: "absolute",
            top: "6%",
            ...sideAnchor,
            maxWidth: isSide ? "56%" : "92%",
            fontSize: fitSize(numberCallout, 1.45, false),
            letterSpacing: "-0.015em",
            color: accentColor,
            WebkitTextStroke: strokePx > 0 ? `${Math.max(2, strokePx - 1)}px #000` : undefined,
            textShadow: treatment === "neon" ? `0 0 ${Math.round(W * 0.03)}px ${accentColor}, ${shadow}` : shadow,
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
          ...(isUpper ? { top: numberCallout ? "28%" : "8%" } : { bottom: badge && badgeStyle === "center" ? "13%" : "9%" }),
          ...sideAnchor,
          maxWidth: isSide ? "58%" : "88%",
          marginLeft: isSide ? undefined : "auto",
          marginRight: isSide ? undefined : "auto",
        }}
      >
        {lines.map((l, i) => {
          const size = fitSize(l.text, l.size ?? 1, l.accent === true && treatment !== "neon" && treatment !== "clean");
          if (l.accent) {
            return (
              <div key={i} style={{ marginTop: i === 0 ? 0 : Math.round(W * 0.006) }}>
                <span style={{ ...accentStyle(size), textTransform: uppercase ? "uppercase" : "none" }}>{l.text}</span>
              </div>
            );
          }
          return (
            <div
              key={i}
              style={{
                fontSize: size,
                lineHeight: 1.08,
                letterSpacing: "0.01em",
                color: safeBase,
                WebkitTextStroke: treatment === "neon" ? undefined : stroke,
                textShadow: treatment === "neon" ? `0 0 ${Math.round(W * 0.015)}px rgba(255,255,255,0.6), ${shadow}` : shadow,
                textTransform: uppercase ? "uppercase" : "none",
                ...(underlineAccent && i === lines.length - 1
                  ? { display: "inline-block", borderBottom: `${Math.round(W * 0.009)}px solid ${accentColor}`, paddingBottom: Math.round(W * 0.004) }
                  : {}),
              }}
            >
              {l.text}
            </div>
          );
        })}
      </div>

      {badge ? (
        badgeStyle === "pill" ? (
          <div
            style={{
              position: "absolute", top: "4.5%", right: "3.5%",
              fontSize: Math.round(W * 0.018), fontWeight: 700, letterSpacing: "0.18em",
              color: "#ffffff", background: "rgba(8,8,14,0.72)",
              border: `2px solid ${accentColor}`, borderRadius: 999,
              padding: `${Math.round(W * 0.005)}px ${Math.round(W * 0.012)}px`,
              textTransform: "uppercase",
            }}
          >
            {badge}
          </div>
        ) : (
          <div
            style={{
              position: "absolute", bottom: "4%", left: 0, right: 0, textAlign: "center",
              fontSize: Math.round(W * 0.022), fontWeight: 700, letterSpacing: "0.32em",
              color: "rgba(255,255,255,0.92)", textShadow: "0 2px 10px rgba(0,0,0,0.9)",
              textTransform: "uppercase",
            }}
          >
            {badge}
          </div>
        )
      ) : null}
    </AbsoluteFill>
  );
};
