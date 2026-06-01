import React, { useMemo } from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadPlayfairDisplay } from "@remotion/google-fonts/PlayfairDisplay";
import {
  Particles,
  Spawner,
  Behavior,
  GradientTransition,
  AnimatedText,
} from "remotion-bits";

const { fontFamily: poppinsFont } = loadPoppins();
const { fontFamily: playfairFont } = loadPlayfairDisplay();

// ==========================================
// SEEDED RANDOM
// ==========================================
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ==========================================
// EXPANDING RING BURST
// ==========================================
const ExpandingRings: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const rings = [
    { delay: 8, color: "rgba(167,139,250,0.25)", duration: 90 },
    { delay: 16, color: "rgba(251,191,36,0.18)", duration: 100 },
    { delay: 28, color: "rgba(232,121,249,0.15)", duration: 110 },
    { delay: 45, color: "rgba(96,165,250,0.12)", duration: 95 },
  ];

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 30, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      {rings.map((ring, i) => {
        const localFrame = Math.max(0, frame - ring.delay);
        const progress = Math.min(1, localFrame / ring.duration);
        const scale = 0.2 + progress * 3.5;
        const opacity =
          progress < 0.15
            ? progress / 0.15
            : progress > 0.6
              ? (1 - progress) / 0.4
              : 1;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: 400,
              height: 400,
              borderRadius: "50%",
              border: `2px solid ${ring.color}`,
              transform: `scale(${scale})`,
              opacity: opacity * fadeOut * 0.7,
              boxShadow: `0 0 30px ${ring.color}, inset 0 0 30px ${ring.color.replace(/[\d.]+\)/, "0.05)")}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ==========================================
// ANIMATED GEOMETRIC LINES
// ==========================================
const GeometricLines: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const time = frame / fps;

  const fadeIn = interpolate(frame, [5, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 25, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const lines = useMemo(() => {
    const rand = seededRandom(99);
    return Array.from({ length: 12 }, (_, i) => ({
      x: rand() * 1920,
      y: rand() * 1080,
      angle: rand() * 360,
      length: rand() * 300 + 100,
      speed: rand() * 0.3 + 0.1,
      delay: rand() * 30,
      color:
        i % 4 === 0
          ? "rgba(167,139,250,0.12)"
          : i % 4 === 1
            ? "rgba(251,191,36,0.08)"
            : i % 4 === 2
              ? "rgba(232,121,249,0.07)"
              : "rgba(96,165,250,0.06)",
      thickness: rand() * 1.5 + 0.5,
    }));
  }, []);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080">
        {lines.map((line, i) => {
          const localFrame = Math.max(0, frame - line.delay);
          const drawProgress = Math.min(1, localFrame / 50);
          const drift = Math.sin(time * line.speed + i) * 20;
          const rad = (line.angle * Math.PI) / 180;
          const x1 = line.x + drift;
          const y1 = line.y;
          const x2 = x1 + Math.cos(rad) * line.length * drawProgress;
          const y2 = y1 + Math.sin(rad) * line.length * drawProgress;

          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={line.color}
              strokeWidth={line.thickness}
              opacity={fadeIn * fadeOut}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

// ==========================================
// FLOATING ORBS (soft large bokeh)
// ==========================================
const FloatingOrbs: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const time = frame / fps;

  const fadeIn = interpolate(frame, [0, 50], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 30, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const orbs = useMemo(
    () => [
      { x: 15, y: 25, size: 500, color: "#7c3aed", speed: 0.12, phase: 0 },
      { x: 75, y: 20, size: 600, color: "#f59e0b", speed: 0.09, phase: 2 },
      { x: 85, y: 70, size: 450, color: "#8b5cf6", speed: 0.14, phase: 4 },
      { x: 25, y: 75, size: 550, color: "#d97706", speed: 0.1, phase: 1.5 },
      { x: 50, y: 50, size: 700, color: "#6d28d9", speed: 0.07, phase: 3 },
      { x: 10, y: 50, size: 400, color: "#e879f9", speed: 0.11, phase: 5 },
      { x: 60, y: 15, size: 350, color: "#60a5fa", speed: 0.13, phase: 0.8 },
      { x: 90, y: 45, size: 480, color: "#fbbf24", speed: 0.08, phase: 3.5 },
    ],
    []
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {orbs.map((orb, i) => {
        const ox =
          orb.x +
          Math.sin(time * orb.speed + orb.phase) * 8 +
          Math.sin(time * orb.speed * 0.4 + orb.phase * 2) * 3;
        const oy =
          orb.y +
          Math.cos(time * orb.speed * 0.8 + orb.phase * 0.7) * 6 +
          Math.cos(time * orb.speed * 0.3 + orb.phase) * 2;
        const breathe =
          1 + Math.sin(time * orb.speed * 0.5 + orb.phase) * 0.15;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${ox}%`,
              top: `${oy}%`,
              width: orb.size * breathe,
              height: orb.size * breathe,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${orb.color}18 0%, ${orb.color}08 40%, transparent 70%)`,
              filter: `blur(${40 + i * 5}px)`,
              transform: "translate(-50%, -50%)",
              opacity: fadeIn * fadeOut,
              mixBlendMode: "screen",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ==========================================
// SWEEPING LIGHT TRAIL
// ==========================================
const LightTrails: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const time = frame / fps;

  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 25, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const trails = [
    {
      y: 35,
      speed: 0.8,
      delay: 15,
      width: 900,
      color1: "rgba(167,139,250,0.2)",
      color2: "rgba(251,191,36,0.15)",
    },
    {
      y: 55,
      speed: 0.6,
      delay: 35,
      width: 1100,
      color1: "rgba(232,121,249,0.12)",
      color2: "rgba(96,165,250,0.1)",
    },
    {
      y: 68,
      speed: 0.5,
      delay: 50,
      width: 700,
      color1: "rgba(251,191,36,0.1)",
      color2: "rgba(167,139,250,0.08)",
    },
  ];

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {trails.map((trail, i) => {
        const localFrame = Math.max(0, frame - trail.delay);
        const sweep = interpolate(localFrame, [0, 80], [-60, 120], {
          extrapolateRight: "clamp",
        });
        const opacity = interpolate(
          localFrame,
          [0, 15, 60, 80],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${sweep}%`,
              top: `${trail.y}%`,
              width: trail.width,
              height: 3,
              background: `linear-gradient(90deg, transparent, ${trail.color1}, ${trail.color2}, transparent)`,
              filter: "blur(4px)",
              opacity: opacity * fadeIn * fadeOut,
              boxShadow: `0 0 40px 8px ${trail.color1.replace(/[\d.]+\)/, "0.08)")}`,
              mixBlendMode: "screen",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ==========================================
// SPARKLE PARTICLES (remotion-bits)
// ==========================================
const SparkleParticles: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 20, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ opacity: fadeOut, pointerEvents: "none" }}>
      {/* Ambient sparkles across screen */}
      <Particles startFrame={10}>
        <Spawner
          rate={1.2}
          max={60}
          position={{ x: 960, y: 540 }}
          area={{ width: 1920, height: 1080 }}
          velocity={{ x: 0, y: -0.2, varianceX: 0.5, varianceY: 0.4 }}
          lifespan={150}
          lifespanVariance={50}
        >
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "rgba(251,191,36,0.9)",
              boxShadow:
                "0 0 8px rgba(251,191,36,0.7), 0 0 20px rgba(251,191,36,0.3)",
            }}
          />
          <div
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: "rgba(167,139,250,0.85)",
              boxShadow:
                "0 0 7px rgba(167,139,250,0.6), 0 0 16px rgba(167,139,250,0.25)",
            }}
          />
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "rgba(232,121,249,0.75)",
              boxShadow:
                "0 0 10px rgba(232,121,249,0.5), 0 0 22px rgba(232,121,249,0.2)",
            }}
          />
          <div
            style={{
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: "rgba(96,165,250,0.8)",
              boxShadow: "0 0 6px rgba(96,165,250,0.5)",
            }}
          />
        </Spawner>
        <Behavior
          gravity={{ y: -0.008 }}
          drag={0.997}
          wiggle={{ magnitude: 0.25, frequency: 0.12 }}
          scale={{
            start: 0.3,
            end: 1.8,
            startVariance: 0.2,
            endVariance: 0.6,
          }}
          opacity={[0, 0.8, 1, 0.6, 0]}
        />
      </Particles>

      {/* Center burst on text reveal */}
      <Particles startFrame={20}>
        <Spawner
          burst={40}
          position={{ x: 960, y: 400 }}
          velocity={{ x: 0, y: 0, varianceX: 4, varianceY: 3 }}
          lifespan={70}
          lifespanVariance={25}
        >
          <div
            style={{
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.9)",
              boxShadow:
                "0 0 6px rgba(255,255,255,0.6), 0 0 15px rgba(167,139,250,0.3)",
            }}
          />
          <div
            style={{
              width: 2,
              height: 8,
              borderRadius: 2,
              background: "rgba(251,191,36,0.8)",
              boxShadow: "0 0 5px rgba(251,191,36,0.5)",
            }}
          />
        </Spawner>
        <Behavior
          gravity={{ y: 0.015 }}
          drag={0.96}
          scale={{ start: 1.5, end: 0 }}
          opacity={[0, 1, 0.7, 0]}
        />
      </Particles>
    </AbsoluteFill>
  );
};

// ==========================================
// HORIZONTAL DIVIDER LINE
// ==========================================
const AnimatedDivider: React.FC<{ delay: number }> = ({ delay }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const scaleX = spring({
    frame,
    fps,
    from: 0,
    to: 1,
    delay,
    config: { damping: 15, stiffness: 35 },
  });
  const opacity = spring({
    frame,
    fps,
    from: 0,
    to: 1,
    delay: delay - 3,
    config: { damping: 20 },
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 25, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        opacity: opacity * fadeOut,
        margin: "24px 0 30px",
      }}
    >
      <div
        style={{
          height: 1.5,
          width: 180 * scaleX,
          background:
            "linear-gradient(90deg, transparent, rgba(167,139,250,0.5), rgba(251,191,36,0.4))",
          borderRadius: 1,
          boxShadow: "0 0 8px rgba(167,139,250,0.2)",
        }}
      />
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(251,191,36,0.8), rgba(167,139,250,0.4))",
          boxShadow:
            "0 0 12px rgba(251,191,36,0.4), 0 0 25px rgba(167,139,250,0.2)",
          transform: `scale(${scaleX})`,
        }}
      />
      <div
        style={{
          height: 1.5,
          width: 180 * scaleX,
          background:
            "linear-gradient(90deg, rgba(251,191,36,0.4), rgba(167,139,250,0.5), transparent)",
          borderRadius: 1,
          boxShadow: "0 0 8px rgba(251,191,36,0.2)",
        }}
      />
    </div>
  );
};

// ==========================================
// MAIN COMPOSITION
// ==========================================

export const LofiIntroV2: React.FC<{
  channelName?: string;
  videoTitle?: string;
  transparent?: boolean;
}> = ({
  channelName = "Midnight Chill",
  videoTitle = "lofi beats to relax/study to",
  transparent = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const time = frame / fps;

  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 30, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const master = fadeIn * fadeOut;

  // Title entrance
  const titleVisible = frame >= 18;
  const subtitleVisible = frame >= 55;

  // Subtle zoom on whole scene
  const sceneScale = interpolate(frame, [0, durationInFrames], [1.02, 1], {
    extrapolateRight: "clamp",
  });

  // Title float
  const floatY = Math.sin(time * 0.35) * 6 + Math.sin(time * 0.8) * 2;

  // Title glow pulse
  const glowPulse = 0.7 + Math.sin(time * 0.6) * 0.3;

  return (
    <AbsoluteFill style={{ backgroundColor: transparent ? "transparent" : "#030014" }}>
      {/* Deep morphing gradient background */}
      {!transparent && (
        <AbsoluteFill style={{ opacity: master, transform: `scale(${sceneScale})` }}>
          <GradientTransition
            gradient={[
              "radial-gradient(ellipse at 25% 35%, #0f0530 0%, #050118 45%, #020010 100%)",
              "radial-gradient(ellipse at 65% 55%, #150835 0%, #08021a 40%, #010008 100%)",
              "radial-gradient(ellipse at 45% 65%, #0c0428 0%, #06011c 45%, #020010 100%)",
              "radial-gradient(ellipse at 55% 30%, #110630 0%, #070220 40%, #010006 100%)",
            ]}
            duration={durationInFrames}
            easing="easeInOutSine"
          />
        </AbsoluteFill>
      )}

      {/* Soft bokeh orbs */}
      <AbsoluteFill style={{ transform: `scale(${sceneScale})` }}>
        <FloatingOrbs />
      </AbsoluteFill>

      {/* Geometric accent lines */}
      <GeometricLines />

      {/* Expanding ring burst from center */}
      <ExpandingRings />

      {/* Sweeping light trails */}
      <LightTrails />

      {/* 2D particle sparkles */}
      <SparkleParticles />

      {/* ====== MAIN TEXT ====== */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
          transform: `translateY(${floatY}px)`,
        }}
      >
        {/* Channel name — LARGE */}
        <div
          style={{
            fontFamily: playfairFont,
            fontSize: 140,
            fontWeight: 700,
            color: "white",
            textAlign: "center",
            lineHeight: 1.0,
            textShadow: `
              0 0 60px rgba(167,139,250,${0.5 * glowPulse}),
              0 0 120px rgba(139,92,246,${0.25 * glowPulse}),
              0 0 200px rgba(109,40,217,${0.1 * glowPulse}),
              0 4px 12px rgba(0,0,0,0.6)
            `,
            position: "relative",
            minHeight: 160,
            opacity: master,
          }}
        >
          {titleVisible && (
            <AnimatedText
              transition={{
                split: "character",
                splitStagger: 2,
                y: [60, 0],
                opacity: [0, 1],
                scaleY: [1.4, 1],
                duration: 25,
                delay: 18,
                easing: "easeOutCubic",
              }}
            >
              {channelName}
            </AnimatedText>
          )}
        </div>

        {/* Animated divider */}
        <AnimatedDivider delay={45} />

        {/* Video title — medium */}
        <div
          style={{
            fontFamily: poppinsFont,
            fontSize: 38,
            fontWeight: 300,
            color: "rgba(200,185,240,0.8)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            textAlign: "center",
            textShadow:
              "0 0 30px rgba(167,139,250,0.2), 0 2px 6px rgba(0,0,0,0.4)",
            position: "relative",
            minHeight: 50,
            opacity: master,
          }}
        >
          {subtitleVisible && (
            <AnimatedText
              transition={{
                split: "character",
                splitStagger: 1,
                y: [20, 0],
                opacity: [0, 1],
                duration: 30,
                delay: 55,
                easing: "easeOutSine",
              }}
            >
              {videoTitle}
            </AnimatedText>
          )}
        </div>
      </AbsoluteFill>

      {/* Film grain — animated per frame */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.035 * master,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' seed='${frame % 10}' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: "256px 256px",
          mixBlendMode: "overlay",
          pointerEvents: "none",
        }}
      />

      {/* Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.5) 65%, rgba(0,0,0,0.85) 100%)",
          opacity: master,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
