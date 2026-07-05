/**
 * GlitchChroma — GLITCH + CHROMATIC ABERRATION.
 *
 * Self-contained source: a stylized "megachurch stage" built from CSS gradients
 * + light shapes, with a slow Ken-Burns zoom. SVG filter performs an RGB channel
 * split (feColorMatrix isolates R and B channels, feOffset displaces them
 * horizontally, feBlend screen) plus datamosh jitter driven by @remotion/noise
 * noise2D. Aberration intensifies then settles; brief displacement/scanline
 * bursts at a few deterministic frames.
 *
 * Deterministic: offsets from useCurrentFrame() + noise2D(seed, frame*k).
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { noise2D } from "@remotion/noise";
import { loadFont } from "@remotion/google-fonts/Oswald";

const { fontFamily } = loadFont();

export const GlitchChroma: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Ken-Burns slow zoom on the scene.
  const zoom = interpolate(frame, [0, 150], [1.0, 1.12]);
  const pan = interpolate(frame, [0, 150], [0, -30]);

  // Base aberration: intensifies (0-40) then settles (40-150).
  const baseAberr = interpolate(
    frame,
    [0, 40, 150],
    [2, 16, 5],
    { extrapolateRight: "clamp" }
  );

  // Noise-driven jitter on top of base. noise2D returns [-1,1].
  const jitterR = noise2D("redchan", frame * 0.18, 0) * 6;
  const jitterB = noise2D("bluechan", frame * 0.18, 99) * 6;

  // Deterministic datamosh BURSTS at specific frames.
  const burstFrames = [22, 23, 24, 61, 62, 96, 97, 98, 128];
  const isBurst = burstFrames.includes(frame);
  const burstKick = isBurst
    ? noise2D("burst", frame, 0) * 28 + 18
    : 0;

  const offR = baseAberr + jitterR + burstKick;
  const offB = baseAberr + jitterB + burstKick;

  // Vertical glitch slice displacement during bursts.
  const sliceShift = isBurst ? noise2D("slice", frame, 7) * 40 : 0;

  // Scanline opacity flickers slightly.
  const scanOpacity =
    0.08 + 0.05 * (noise2D("scan", frame * 0.4, 3) * 0.5 + 0.5);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", fontFamily }}>
      <svg width="0" height="0">
        <defs>
          <filter id="chroma" x="-20%" y="-20%" width="140%" height="140%">
            {/* Isolate RED channel */}
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="red"
            />
            {/* Isolate GREEN channel (kept centered) */}
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="green"
            />
            {/* Isolate BLUE channel */}
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="blue"
            />
            <feOffset in="red" dx={offR} dy="0" result="redShift" />
            <feOffset in="blue" dx={-offB} dy="0" result="blueShift" />
            <feBlend in="redShift" in2="green" mode="screen" result="rg" />
            <feBlend in="rg" in2="blueShift" mode="screen" />
          </filter>
        </defs>
      </svg>

      {/* SCENE wrapped in the chromatic filter. */}
      <AbsoluteFill style={{ filter: "url(#chroma)" }}>
        <AbsoluteFill
          style={{
            transform: `scale(${zoom}) translateX(${pan + sliceShift}px)`,
            transformOrigin: "center center",
          }}
        >
          {/* Megachurch stage: dark hall + spotlights + stage glow. */}
          <AbsoluteFill
            style={{
              backgroundImage:
                "linear-gradient(180deg, #0a0a14 0%, #14101e 55%, #241526 100%)",
            }}
          />
          {/* Big stage backlight bloom */}
          <AbsoluteFill
            style={{
              backgroundImage:
                "radial-gradient(ellipse 50% 40% at 50% 62%, rgba(255,180,80,0.55), transparent 60%)",
            }}
          />
          {/* Spotlight cones */}
          <svg width="100%" height="100%" viewBox="0 0 1920 1080">
            <defs>
              <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255,240,200,0.55)" />
                <stop offset="100%" stopColor="rgba(255,240,200,0)" />
              </linearGradient>
            </defs>
            {[480, 760, 1160, 1440].map((x, i) => (
              <polygon
                key={i}
                points={`${x},60 ${x - 120},760 ${x + 120},760`}
                fill="url(#cone)"
                opacity={0.6}
              />
            ))}
            {/* crowd silhouette band */}
            <rect x="0" y="900" width="1920" height="180" fill="#05030a" />
            {Array.from({ length: 26 }).map((_, i) => {
              const cx = 40 + i * 74;
              const h = 60 + (noise2D("crowd", i, 0) * 0.5 + 0.5) * 40;
              return (
                <ellipse
                  key={i}
                  cx={cx}
                  cy={920}
                  rx={26}
                  ry={h}
                  fill="#0a0610"
                />
              );
            })}
          </svg>
          {/* Stage title */}
          <AbsoluteFill
            style={{
              justifyContent: "center",
              alignItems: "center",
              marginTop: -40,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 150,
                letterSpacing: 6,
                color: "#fff6e6",
                textShadow: "0 0 50px rgba(255,200,120,0.6)",
              }}
            >
              SALVATION
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
      </AbsoluteFill>

      {/* Scanlines overlay (outside filter so they stay crisp). */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 1px, transparent 2px, transparent 4px)",
          opacity: scanOpacity,
          mixBlendMode: "multiply",
          pointerEvents: "none",
        }}
      />
      {/* Burst flash */}
      {isBurst && (
        <AbsoluteFill
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            mixBlendMode: "screen",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
