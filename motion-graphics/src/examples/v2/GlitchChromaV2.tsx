/**
 * GlitchChromaV2 — RGB-split / datamosh glitch, broadcast tier.
 *
 * Self-contained high-contrast scene: a stylized "megachurch stage" built from
 * gradients + stage lights + a crowd silhouette, with a slow push-in (Ken
 * Burns). Over it: strong chromatic aberration (R/G/B channel offset) driven by
 * @remotion/noise, with brief violent bursts at a few frames; feDisplacementMap
 * datamosh; scanlines; cinematic teal grade + LETTERBOX bars (ref at_1-11).
 * The aberration spikes then settles.
 *
 * Native Remotion path. Deterministic (noise2D seeded by frame).
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { noise2D } from "@remotion/noise";
import {
  FilmGrain,
  Vignette,
  Letterbox,
  Scanlines,
  ChromaSplit,
  glitchEnvelope,
} from "./_shared";

/** Stylized megachurch stage — gradients, light cones, crowd silhouette. */
const StageScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // slow push-in Ken Burns
  const scale = interpolate(frame, [0, durationInFrames], [1.04, 1.18]);
  const lightSweep = interpolate(frame, [0, durationInFrames], [-10, 10]);
  return (
    <AbsoluteFill
      style={{ transform: `scale(${scale})`, transformOrigin: "center 45%" }}
    >
      {/* stage gradient — clearly lit, readable teal stage */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, #3a7a8c 0%, #2c6072 42%, #244e5c 72%, #1c3e49 100%)",
        }}
      />
      {/* big back light bloom (softer, doesn't blow out the scene) */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "4%",
          width: 760,
          height: 620,
          transform: "translateX(-50%)",
          background:
            "radial-gradient(ellipse, rgba(180,240,255,0.7) 0%, rgba(90,190,215,0.25) 40%, transparent 72%)",
          filter: "blur(12px)",
        }}
      />
      {/* light cones from a rig (clearly visible) */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        {[-1, 0, 1].map((k) => (
          <polygon
            key={k}
            points={`${960 + k * 200 + lightSweep * (k + 2)},20 ${700 + k * 280},1080 ${1220 + k * 280},1080`}
            fill="rgba(180,235,250,0.18)"
          />
        ))}
      </svg>
      {/* bright stage platform band where the speaker stands */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "58%",
          height: 130,
          background:
            "linear-gradient(180deg, transparent, rgba(150,225,245,0.4) 55%, rgba(80,170,195,0.6))",
          filter: "blur(8px)",
        }}
      />
      {/* crowd silhouette — dark against the lit stage, clearly in frame */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} viewBox="0 0 1920 1080" preserveAspectRatio="none">
        <g fill="#04161c">
          <rect x="0" y="830" width="1920" height="250" />
          {Array.from({ length: 26 }).map((_, i) => {
            const x = 30 + i * 73;
            const h = 80 + ((i * 37) % 50);
            return <ellipse key={i} cx={x} cy={840 - h * 0.2} rx={28} ry={h} />;
          })}
        </g>
      </svg>
      {/* lone speaker figure on the bright platform, rim-lit silhouette */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} viewBox="0 0 1920 1080" preserveAspectRatio="none">
        <g fill="#031318" stroke="rgba(190,245,255,0.7)" strokeWidth="2.5">
          <ellipse cx="960" cy="560" rx="32" ry="42" />
          <path d="M914 636 C 914 614 1006 614 1006 636 L 998 770 L 922 770 Z" />
          {/* raised arm */}
          <path d="M1000 660 C 1040 640 1060 600 1058 568 L 1044 566 C 1040 600 1018 638 988 654 Z" />
        </g>
      </svg>
    </AbsoluteFill>
  );
};

export const GlitchChromaV2: React.FC = () => {
  const frame = useCurrentFrame();

  // micro-glitch cadence — frequent brief RGB-split ticks across the whole comp
  const MICRO = [10, 22, 34, 46, 58, 70, 82, 94, 106, 120, 134];
  // the single STRONGER datamosh burst (a hard spike mid-comp)
  const HARD = 72;

  // base aberration: noise-driven low-level shimmer + frequent micro bursts
  const base = 1.6 + 2.4 * Math.abs(noise2D("ca", frame * 0.12, 0));
  const micro = glitchEnvelope(frame, MICRO, 3) * 16;
  const hard = glitchEnvelope(frame, [HARD], 7) * 30; // dominant burst
  // settle: overall aberration decays after the opening
  const settle = interpolate(frame, [0, 40], [1.7, 0.8], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ca = (base + micro + hard) * settle;

  // datamosh slice offset (horizontal RGB tear). Micro tears at every tick +
  // one big feDisplacementMap spike at the HARD burst.
  const tear = Math.max(
    glitchEnvelope(frame, MICRO, 3),
    glitchEnvelope(frame, [HARD], 6)
  );
  const tearY = (noise2D("tear", frame * 0.3, 0) * 0.5 + 0.5) * 100;
  const dispScale =
    glitchEnvelope(frame, MICRO, 3) * 16 + glitchEnvelope(frame, [HARD], 6) * 60;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* displacement datamosh filter applied to whole scene at bursts */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id="gc-datamosh">
          <feTurbulence type="turbulence" baseFrequency="0.012 0.04" numOctaves="2" seed={Math.floor(frame)} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={dispScale} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <AbsoluteFill style={{ filter: dispScale > 0.5 ? "url(#gc-datamosh)" : "none" }}>
        <ChromaSplit amount={ca}>
          <StageScene />
        </ChromaSplit>
      </AbsoluteFill>

      {/* horizontal tear slice during bursts */}
      {tear > 0.1 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${tearY}%`,
            height: `${6 + tear * 30}px`,
            background: "rgba(180,230,240,0.12)",
            mixBlendMode: "screen",
            transform: `translateX(${(noise2D("sl", frame * 0.5, 0)) * 40}px)`,
          }}
        />
      )}

      {/* cinematic teal grade — soft tint that keeps luminance */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(20,70,90,0.22), rgba(0,20,28,0.3))",
          mixBlendMode: "soft-light",
          pointerEvents: "none",
          opacity: 0.7,
        }}
      />
      {/* crisper scanlines: a tight 2px CRT line pattern on top of the base */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          opacity: 0.16,
          mixBlendMode: "multiply",
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.95) 0px, rgba(0,0,0,0.95) 1px, transparent 1px, transparent 2px)",
        }}
      />
      <Scanlines opacity={0.1} />
      <Vignette strength={0.42} />
      <FilmGrain opacity={0.06} />
      <Letterbox height={72} />
    </AbsoluteFill>
  );
};
