import React from "react";
import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { frameToMs } from "./types";
import type { SpeechSegment } from "./types";

/**
 * Cinematic frame — the upgraded look (replaces the primitive vintage TV).
 * Full-frame footage with a teal/orange film grade, halation/bloom on the
 * highlights, fine film grain, a strong vignette, anamorphic letterbox bars,
 * and a small corner sigil + segment progress ring. Captions render as
 * `children` ON TOP of the grade (kept crisp), but BELOW the letterbox bars.
 *
 * Self-contained (remotion core + system fonts) so it bundles for cloud render.
 */
export type CinematicTheme = {
  /** anamorphic bar height as a fraction of height (0.11 ≈ 2.2:1 on 16:9). */
  bar: number;
  grain: number;
  vignette: number;
  bloom: number;
  /** teal pushed into shadows. */
  teal: string;
  /** warm pushed into highlights. */
  warm: string;
  accent: string;
  fontFamily: string;
  /** small mark drawn in the corner sigil. */
  sigil: string;
};

export const CINEMATIC_THEME: CinematicTheme = {
  bar: 0.11,
  grain: 0.05,
  vignette: 0.36,
  bloom: 0.09,
  teal: "#0c3b4a",
  warm: "#ffb46b",
  accent: "#ffd27a",
  fontFamily:
    '"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, sans-serif',
  sigil: "✦",
};

// ONE static monochrome noise tile (the browser rasterises the turbulence once
// and caches it). We animate only background-position for grain shimmer — this
// is ~free per frame, unlike per-frame feTurbulence which re-rasterises and made
// long renders take hours.
const GRAIN_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export const CinematicFrame: React.FC<{
  videoSrc?: string;
  segments?: SpeechSegment[];
  muteSource?: boolean;
  theme?: Partial<CinematicTheme>;
  children?: React.ReactNode;
}> = ({ videoSrc, segments = [], muteSource, theme: override, children }) => {
  const t = { ...CINEMATIC_THEME, ...(override ?? {}) };
  const frame = useCurrentFrame();
  const { fps, height, width, durationInFrames } = useVideoConfig();
  const ms = frameToMs(frame, fps);
  const barH = Math.round(height * t.bar);

  // slow cinematic push-in on the footage (1.0 → 1.06 across the clip)
  const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.06], {
    extrapolateRight: "clamp",
  });
  // gentle fade from black at the very start
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ opacity: fadeIn }}>
        {/* base footage — graded */}
        <AbsoluteFill
          style={{
            filter: "contrast(1.03) saturate(0.97) brightness(0.995)",
            transform: `scale(${zoom})`,
          }}
        >
          {videoSrc ? (
            <OffthreadVideo
              src={videoSrc}
              muted={muteSource}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <AbsoluteFill
              style={{
                background:
                  "radial-gradient(ellipse at 50% 40%, #20303a 0%, #0c141a 60%, #05080b 100%)",
              }}
            />
          )}
        </AbsoluteFill>

        {/* teal in the shadows (near-natural) */}
        <AbsoluteFill
          style={{ backgroundColor: t.teal, mixBlendMode: "soft-light", opacity: 0.1 }}
        />
        {/* warm light in the highlights (near-natural) */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at 50% 38%, ${t.warm} 0%, transparent 55%)`,
            mixBlendMode: "soft-light",
            opacity: 0.09,
          }}
        />

        {/* fine film grain — static noise texture shifted per-frame (cheap) */}
        <AbsoluteFill
          style={{
            opacity: t.grain,
            mixBlendMode: "overlay",
            backgroundImage: GRAIN_URI,
            backgroundRepeat: "repeat",
            backgroundSize: "180px 180px",
            backgroundPosition: `${(frame * 7) % 180}px ${(frame * 13) % 180}px`,
          }}
        />

        {/* cinematic vignette */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,${t.vignette}) 100%)`,
          }}
        />

        {/* captions etc. — crisp, above the grade */}
        {children}
      </AbsoluteFill>

      {/* anamorphic letterbox bars (over everything) */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: barH, background: "#000" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: barH, background: "#000" }} />

      {/* corner sigil + segment progress */}
      <CornerSigil segments={segments} ms={ms} theme={t} barH={barH} width={width} />
    </AbsoluteFill>
  );
};

const CornerSigil: React.FC<{
  segments: SpeechSegment[];
  ms: number;
  theme: CinematicTheme;
  barH: number;
  width: number;
}> = ({ segments, ms, theme, barH, width }) => {
  const seg =
    segments.find((s) => ms >= s.start && ms < s.end) ?? segments[segments.length - 1];
  const size = 64;
  const R = 26;
  const C = 2 * Math.PI * R;
  const prog = seg
    ? Math.max(0, Math.min(1, (ms - seg.start) / Math.max(1, seg.end - seg.start)))
    : 0;
  return (
    <div
      style={{
        position: "absolute",
        top: barH + 26,
        right: 48,
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: theme.fontFamily,
        color: "rgba(255,255,255,0.92)",
      }}
    >
      <span style={{ fontSize: 26, color: theme.accent, textShadow: "0 0 12px rgba(0,0,0,0.6)" }}>
        {theme.sigil}
      </span>
      {seg && (
        <div style={{ position: "relative", width: size, height: size }}>
          <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={2.5} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={R}
              fill="none"
              stroke={theme.accent}
              strokeWidth={2.5}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - prog)}
              strokeLinecap="round"
            />
          </svg>
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            {seg.index}/{seg.total}
          </span>
        </div>
      )}
    </div>
  );
};
