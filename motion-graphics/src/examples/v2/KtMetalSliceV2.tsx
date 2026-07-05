/**
 * KtMetalSliceV2 — HERO (broadcast tier). Matches frame at_29-35.
 *
 * "HATRED." in heavy condensed bold, filled with POLISHED BRUSHED CHROME: a
 * multi-stop HORIZONTAL gradient with sharp dark->bright->dark value bands
 * (CHROME_BANDS) clipped to the glyphs, PLUS a narrow near-white REFLECTION
 * BAND that sweeps L->R across the letters over time. Crisper 3D bevel:
 * feSpecularLighting (animated azimuth) for the lit top edge + a dark bottom
 * emboss + thin dark outline + strong soft drop shadow. Revealed by a bright
 * white BAR that wipes L->R (clip-path inset 100%->0). Background: the new dense
 * dark-red BaroqueDamask + darker vignette + thin silver frame.
 *
 * Native Remotion path (no GSAP) — Easing.bezier eases + @remotion/motion-blur
 * Trail on the entrance. Deterministic.
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Trail } from "@remotion/motion-blur";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import {
  FilmGrain,
  Vignette,
  EASE_OUT,
  EASE_CUBIC,
  BaroqueDamask,
  CHROME_BANDS,
} from "./_shared";

const { fontFamily: oswald } = loadOswald();

export const KtMetalSliceV2: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Bar wipe: white bar sweeps L->R, revealing text behind it.
  const wipeStart = 12;
  const wipeDur = 26;
  const wipeP = interpolate(frame, [wipeStart, wipeStart + wipeDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const revealInset = interpolate(wipeP, [0, 1], [100, 0]);
  const barX = interpolate(wipeP, [0, 1], [-8, 100]); // % across
  const barOpacity = interpolate(
    frame,
    [wipeStart, wipeStart + 4, wipeStart + wipeDur - 4, wipeStart + wipeDur + 4],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Entrance lift + settle for the whole title block
  const lift = interpolate(frame, [wipeStart, wipeStart + 18], [26, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  // Moving specular sweep on the bevel: azimuth swings to drag the lit edge.
  const azimuth = interpolate(frame, [0, durationInFrames], [200, 340]);

  // The bright reflection band that sweeps across the glyphs after the reveal.
  // x is a 0..1920 px position; it travels from off-left to off-right and loops
  // gently so the chrome keeps glinting.
  const sweepStart = wipeStart + wipeDur - 6;
  const sweepRaw = interpolate(
    frame,
    [sweepStart, sweepStart + 70],
    [-520, 2400],
    { extrapolateLeft: "clamp", extrapolateRight: "extend", easing: EASE_CUBIC }
  );
  // a slow secondary glint so it never looks frozen
  const sweep2 = 600 + 1600 * (0.5 + 0.5 * Math.sin(frame * 0.06));
  const bandW = 150; // px width of the reflection band

  // Thin silver rule lines grow out from center
  const ruleW = interpolate(frame, [6, 30], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  const fontSize = 240;
  const TXT_X = 960;
  const TXT_Y = 600;
  const textProps = {
    x: TXT_X,
    y: TXT_Y,
    textAnchor: "middle" as const,
    fontFamily: oswald,
    fontWeight: 700,
    fontSize,
    letterSpacing: "6",
    style: { textTransform: "uppercase" as const },
  };

  const Title = (
    <svg
      width="1920"
      height="1080"
      viewBox="0 0 1920 1080"
      style={{ position: "absolute", inset: 0 }}
    >
      <defs>
        {/* HORIZONTAL brushed-chrome bands — sharp dark->bright->dark value
            steps so it reads as rolled metal, not a soft plastic gradient. */}
        <linearGradient id="ms-chrome" x1="0" y1="0" x2="1" y2="0">
          {CHROME_BANDS.map((b) => (
            <stop key={b.offset} offset={b.offset} stopColor={b.color} />
          ))}
        </linearGradient>
        {/* a faint vertical value falloff multiplied on top for cylinder feel */}
        <linearGradient id="ms-vshade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="22%" stopColor="rgba(255,255,255,0)" />
          <stop offset="78%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
        </linearGradient>

        {/* the moving reflection band (near-white, narrow) */}
        <linearGradient
          id="ms-refl"
          gradientUnits="userSpaceOnUse"
          x1={sweepRaw - bandW}
          y1="0"
          x2={sweepRaw + bandW}
          y2="0"
        >
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.95)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient
          id="ms-refl2"
          gradientUnits="userSpaceOnUse"
          x1={sweep2 - 90}
          y1="0"
          x2={sweep2 + 90}
          y2="0"
        >
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.5)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>

        {/* crisp bevel: specular-lit top edge + dark bottom emboss */}
        <filter id="ms-bevel" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="blur" />
          <feSpecularLighting
            in="blur"
            surfaceScale="6"
            specularConstant="1.15"
            specularExponent="26"
            lightingColor="#ffffff"
            result="spec"
          >
            <feDistantLight azimuth={azimuth} elevation={58} />
          </feSpecularLighting>
          <feComposite
            in="spec"
            in2="SourceAlpha"
            operator="in"
            result="specClip"
          />
          {/* dark emboss offset down for the bottom shadow edge */}
          <feOffset in="blur" dx="0" dy="3.5" result="soff" />
          <feFlood floodColor="rgba(0,0,0,0.6)" result="scol" />
          <feComposite in="scol" in2="soff" operator="in" result="emb" />
          <feComposite in="emb" in2="SourceAlpha" operator="in" result="embClip" />
          <feMerge>
            <feMergeNode in="embClip" />
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="specClip" />
          </feMerge>
        </filter>

        <clipPath id="ms-textclip">
          <text {...textProps}>HATRED.</text>
        </clipPath>
        <filter id="ms-dropshadow" x="-20%" y="-40%" width="140%" height="180%">
          <feDropShadow dx="0" dy="9" stdDeviation="12" floodColor="rgba(0,0,0,0.65)" />
        </filter>
      </defs>

      {/* thin dark outline underlay for crisp glyph edges */}
      <g filter="url(#ms-dropshadow)">
        <text
          {...textProps}
          fill="none"
          stroke="rgba(20,20,22,0.9)"
          strokeWidth={5}
        >
          HATRED.
        </text>
      </g>

      {/* base brushed-chrome fill, beveled */}
      <text {...textProps} fill="url(#ms-chrome)" filter="url(#ms-bevel)">
        HATRED.
      </text>

      {/* vertical cylinder shade + moving reflection bands, clipped to glyphs */}
      <g clipPath="url(#ms-textclip)">
        <rect x="0" y="380" width="1920" height="280" fill="url(#ms-vshade)" />
        <rect
          x="0"
          y="380"
          width="1920"
          height="280"
          fill="url(#ms-refl)"
          style={{ mixBlendMode: "screen" }}
        />
        <rect
          x="0"
          y="380"
          width="1920"
          height="280"
          fill="url(#ms-refl2)"
          style={{ mixBlendMode: "screen" }}
        />
      </g>
    </svg>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#1f0404", fontFamily: oswald }}>
      {/* dense dark-red baroque damask ground */}
      <BaroqueDamask
        bg="#1f0404"
        color="rgba(255,72,72,0.15)"
        accent="rgba(255,60,60,0.20)"
        opacity={0.95}
        tile={300}
        drift
        frame={frame}
      />
      {/* darker radial pool behind the title for contrast */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 52%, rgba(10,1,1,0) 30%, rgba(10,1,1,0.55) 100%)",
        }}
      />

      {/* thin silver frame border */}
      <AbsoluteFill style={{ padding: 26 }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            border: "2px solid rgba(210,210,210,0.55)",
            boxShadow: "inset 0 0 60px rgba(0,0,0,0.55)",
          }}
        />
      </AbsoluteFill>

      {/* top + bottom silver rule lines */}
      <div
        style={{
          position: "absolute",
          top: 360,
          left: "50%",
          width: `${ruleW * 0.86}%`,
          height: 4,
          background:
            "linear-gradient(90deg, transparent, #e8e8e8 20%, #fff 50%, #e8e8e8 80%, transparent)",
          transform: "translateX(-50%)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 636,
          left: "50%",
          width: `${ruleW * 0.86}%`,
          height: 4,
          background:
            "linear-gradient(90deg, transparent, #e8e8e8 20%, #fff 50%, #e8e8e8 80%, transparent)",
          transform: "translateX(-50%)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
        }}
      />

      {/* The metallic title, revealed by the bar wipe, with motion blur on lift */}
      <AbsoluteFill
        style={{
          clipPath: `inset(0 ${revealInset}% 0 0)`,
          transform: `translateY(${lift}px)`,
        }}
      >
        <Trail layers={4} lagInFrames={1.5} trailOpacity={0.3}>
          {Title}
        </Trail>
      </AbsoluteFill>

      {/* The bright white wipe bar that physically reveals the text */}
      <div
        style={{
          position: "absolute",
          top: 360,
          bottom: 444,
          left: `${barX}%`,
          width: 30,
          background:
            "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 60%, #fff 100%)",
          boxShadow: "0 0 40px 12px rgba(255,255,255,0.55)",
          opacity: barOpacity,
          transform: "translateX(-50%)",
        }}
      />

      <Vignette strength={0.82} />
      <FilmGrain opacity={0.05} />
    </AbsoluteFill>
  );
};
