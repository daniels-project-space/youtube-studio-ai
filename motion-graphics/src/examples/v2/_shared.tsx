/**
 * _shared.tsx — V2 broadcast-grade GRADE + effect primitives.
 *
 * Pure, deterministic helpers shared by every V2 example comp. No
 * Math.random / Date.now — all jitter is frame-driven (noise2D) or sin().
 * Additive only: nothing here touches V1 or the golden pipeline.
 */
import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

/** Sharp "broadcast" ease-out (After-Effects-style overshoot-free settle). */
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
/** Slightly softer cubic ease-out for slower settles. */
export const EASE_CUBIC = Easing.out(Easing.cubic);

/**
 * Animated film grain. seed={Math.floor(frame)} is deterministic (same frame =>
 * same grain) yet changes every frame. Overlaid via mix-blend overlay.
 */
export const FilmGrain: React.FC<{ opacity?: number; freq?: number }> = ({
  opacity = 0.06,
  freq = 0.7,
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{ pointerEvents: "none", mixBlendMode: "overlay", opacity }}
    >
      <svg width="100%" height="100%">
        <filter id="v2-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={freq}
            numOctaves={2}
            seed={Math.floor(frame)}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#v2-grain)" />
      </svg>
    </AbsoluteFill>
  );
};

/** Radial vignette — darkens edges, focuses center. */
export const Vignette: React.FC<{ strength?: number }> = ({
  strength = 0.72,
}) => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background: `radial-gradient(ellipse 75% 75% at center, transparent 38%, rgba(0,0,0,${strength}) 100%)`,
    }}
  />
);

/** Letterbox cinematic bars (top + bottom). */
export const Letterbox: React.FC<{ height?: number }> = ({ height = 70 }) => (
  <>
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height,
        background: "#000",
        zIndex: 50,
      }}
    />
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height,
        background: "#000",
        zIndex: 50,
      }}
    />
  </>
);

/**
 * RGB-split / chromatic-aberration wrapper. Drives R/G/B drop-shadows + a
 * micro displacement so the aberration "spikes then settles" at a cut.
 * `amount` is in px; pass 0 for no effect.
 */
export const ChromaSplit: React.FC<{
  amount: number;
  children: React.ReactNode;
}> = ({ amount, children }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      filter: `drop-shadow(${amount}px 0 0 rgba(255,0,40,0.55)) drop-shadow(${-amount}px 0 0 rgba(0,200,255,0.55))`,
      transform: `translateX(${amount * 0.25}px)`,
    }}
  >
    {children}
  </div>
);

/** Scanline overlay for glitch/CRT feel. */
export const Scanlines: React.FC<{ opacity?: number }> = ({
  opacity = 0.12,
}) => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      opacity,
      backgroundImage:
        "repeating-linear-gradient(0deg, rgba(0,0,0,0.9) 0px, rgba(0,0,0,0.9) 1px, transparent 2px, transparent 4px)",
      mixBlendMode: "multiply",
    }}
  />
);

/**
 * Glitch envelope — returns a 0..1 intensity that pulses (driven by noise) and
 * spikes hard at the given burst frames. Deterministic.
 */
export const glitchEnvelope = (
  frame: number,
  bursts: number[],
  width = 4
): number => {
  let v = 0;
  for (const b of bursts) {
    const d = Math.abs(frame - b);
    if (d < width) v = Math.max(v, 1 - d / width);
  }
  return v;
};

/** Easing helper used widely: translateX slide-in with sharp ease-out. */
export const slideIn = (
  frame: number,
  start: number,
  dur: number,
  fromX: number
): { x: number; opacity: number } => {
  const p = interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  return { x: interpolate(p, [0, 1], [fromX, 0]), opacity: p };
};

/* ------------------------------------------------------------------ damask */

/**
 * Dense baroque/damask filigree background. One ornate acanthus/paisley
 * flourish unit is tiled via an SVG <pattern>, plus a handful of large hero
 * swirls for depth — matching the reference's dense brocade ground (not the
 * sparse swirls the earlier comps used).
 *
 * Fully deterministic: the optional slow drift is sin(frame)-driven only.
 *
 *   color   — stroke/fill colour of the ornament (rgba recommended)
 *   bg      — optional flat/gradient ground; if omitted the pattern is drawn
 *             transparent so the caller can layer it over its own ground.
 *   opacity — overall pattern opacity (texture should read ~0.10-0.5)
 *   drift   — if true, the tile slowly breathes/translates (very subtle)
 *   frame   — current frame (required when drift=true)
 *   accent  — colour for the large hero swirls (defaults to color)
 *   tile    — pattern tile size in px (smaller = denser). Default 300.
 */
export const BaroqueDamask: React.FC<{
  color?: string;
  accent?: string;
  bg?: string;
  opacity?: number;
  drift?: boolean;
  frame?: number;
  tile?: number;
}> = ({
  color = "rgba(255,90,90,0.16)",
  accent,
  bg,
  opacity = 0.9,
  drift = false,
  frame = 0,
  tile = 300,
}) => {
  const acc = accent ?? color;
  const dy = drift ? Math.sin(frame * 0.02) * 6 : 0;
  const dx = drift ? Math.cos(frame * 0.016) * 4 : 0;
  const breathe = drift ? 1 + 0.02 * Math.sin(frame * 0.014) : 1;
  // unique id per tile size so multiple instances on one page don't clash
  const pid = `bq-damask-${tile}`;
  return (
    <AbsoluteFill style={{ opacity }}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <pattern
            id={pid}
            x="0"
            y="0"
            width={tile}
            height={tile}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${dx} ${dy}) scale(${breathe})`}
          >
            {/* dense interlocking acanthus / paisley flourish, 4-fold so the
                tile reads as continuous brocade rather than isolated swirls */}
            <g
              fill="none"
              stroke={color}
              strokeWidth={tile * 0.026}
              strokeLinecap="round"
            >
              {/* central paisley teardrop with inner curl */}
              <path
                d={`M${tile * 0.5} ${tile * 0.16}
                    C ${tile * 0.74} ${tile * 0.2}, ${tile * 0.78} ${tile * 0.5}, ${tile * 0.5} ${tile * 0.56}
                    C ${tile * 0.3} ${tile * 0.6}, ${tile * 0.28} ${tile * 0.34}, ${tile * 0.46} ${tile * 0.34}
                    C ${tile * 0.58} ${tile * 0.34}, ${tile * 0.58} ${tile * 0.48}, ${tile * 0.5} ${tile * 0.48}`}
              />
              {/* four corner acanthus scrolls fanning toward the centre */}
              <path
                d={`M0 0 C ${tile * 0.22} ${tile * 0.1}, ${tile * 0.28} ${tile * 0.3}, ${tile * 0.16} ${tile * 0.42}
                    C ${tile * 0.08} ${tile * 0.5}, ${tile * 0.16} ${tile * 0.6}, ${tile * 0.26} ${tile * 0.56}`}
              />
              <path
                d={`M${tile} 0 C ${tile * 0.78} ${tile * 0.1}, ${tile * 0.72} ${tile * 0.3}, ${tile * 0.84} ${tile * 0.42}
                    C ${tile * 0.92} ${tile * 0.5}, ${tile * 0.84} ${tile * 0.6}, ${tile * 0.74} ${tile * 0.56}`}
              />
              <path
                d={`M0 ${tile} C ${tile * 0.22} ${tile * 0.9}, ${tile * 0.28} ${tile * 0.7}, ${tile * 0.16} ${tile * 0.58}`}
              />
              <path
                d={`M${tile} ${tile} C ${tile * 0.78} ${tile * 0.9}, ${tile * 0.72} ${tile * 0.7}, ${tile * 0.84} ${tile * 0.58}`}
              />
              {/* connective leaf veins between the flourishes */}
              <path
                d={`M${tile * 0.5} ${tile * 0.56} L ${tile * 0.5} ${tile * 0.82}
                    M ${tile * 0.34} ${tile * 0.72} Q ${tile * 0.5} ${tile * 0.64} ${tile * 0.66} ${tile * 0.72}`}
                strokeWidth={tile * 0.016}
              />
            </g>
            <g fill={color} opacity={0.5}>
              <circle cx={tile * 0.5} cy={tile * 0.3} r={tile * 0.03} />
              <circle cx={tile * 0.18} cy={tile * 0.18} r={tile * 0.018} />
              <circle cx={tile * 0.82} cy={tile * 0.18} r={tile * 0.018} />
            </g>
          </pattern>
        </defs>
        {bg && <rect width="1920" height="1080" fill={bg} />}
        <rect width="1920" height="1080" fill={`url(#${pid})`} />
        {/* a few large hero swirls anchored for baroque depth */}
        <g
          fill="none"
          stroke={acc}
          strokeWidth="20"
          strokeLinecap="round"
          opacity={0.7}
        >
          <path d="M1500 120 C 1820 240, 1480 600, 1700 840 C 1880 1020, 1520 1080, 1600 840" />
          <path d="M300 760 C -20 880, 360 1200, 160 1420" />
          <path d="M980 230 C 1080 200, 1140 290, 1080 360 C 1030 420, 950 380, 970 320" />
        </g>
      </svg>
    </AbsoluteFill>
  );
};

/* ----------------------------------------------------------- brushed chrome */

/**
 * Brushed-chrome text fill primitive. Returns an SVG <defs> gradient block +
 * the text node value as a reusable id. Kept as a hook-free helper that callers
 * compose into their own <svg>; here we expose the canonical multi-stop band
 * stop list + a sweeping highlight builder so KtMetalSliceV2 (and future
 * comps) can share the exact "polished metal, not plastic" recipe.
 *
 * The recipe: sharp dark->bright->dark value BANDS across the horizontal axis
 * (so the metal looks rolled/brushed), plus a narrow near-white reflection band
 * whose x-position is animated off `sweep` (a 0..1 progress).
 */
export const CHROME_BANDS: { offset: string; color: string }[] = [
  { offset: "0%", color: "#3a3a3a" },
  { offset: "14%", color: "#9a9a9a" },
  { offset: "26%", color: "#ffffff" },
  { offset: "40%", color: "#cfcfcf" },
  { offset: "54%", color: "#7a7a7a" },
  { offset: "70%", color: "#ffffff" },
  { offset: "84%", color: "#bdbdbd" },
  { offset: "100%", color: "#444444" },
];
