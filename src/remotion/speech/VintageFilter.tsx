import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { SpeechTheme } from "./types";

/**
 * Wraps the footage (children) in the vintage broadcast look:
 * desaturation + contrast, a cold blue tint, animated film grain (frame-seeded
 * feTurbulence), an edge vignette, and a thin inset broadcast border.
 * Self-contained — only `remotion` core — so it bundles for cloud rendering.
 */
export const VintageFilter: React.FC<{
  theme: SpeechTheme;
  children?: React.ReactNode;
}> = ({ theme, children }) => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame) % 73; // reseed grain each frame so it shimmers

  return (
    <AbsoluteFill style={{ backgroundColor: "#05060a" }}>
      {/* footage: desaturate + lift contrast for the old-broadcast feel */}
      <AbsoluteFill
        style={{
          filter: `grayscale(${theme.grayscale}) contrast(1.12) brightness(0.97)`,
        }}
      >
        {children}
      </AbsoluteFill>

      {/* cold blue tint — colorizes the now-grayscale frame */}
      <AbsoluteFill
        style={{
          backgroundColor: "#173b66",
          mixBlendMode: "color",
          opacity: theme.blueTint,
        }}
      />

      {/* animated film grain */}
      <AbsoluteFill style={{ opacity: theme.grain, mixBlendMode: "overlay" }}>
        <svg width="100%" height="100%" preserveAspectRatio="none">
          <filter id={`grain-${seed}`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={seed}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
        </svg>
      </AbsoluteFill>

      {/* edge vignette */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,${theme.vignette}) 100%)`,
        }}
      />

      {/* thin inset broadcast border */}
      {theme.border && (
        <div
          style={{
            position: "absolute",
            inset: 16,
            border: "2px solid rgba(255,255,255,0.22)",
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
