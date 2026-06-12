import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Img,
  Series,
  continueRender,
  delayRender,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * DOCUMOTION — the documentary-collage shot kit. Recreates the "archival
 * explainer" motion language: 2.5D parallax portraits over illustrated plates,
 * Ken-Burns map zooms, taped photo slide-ins, rough-edge matte sequences,
 * rostrum collage pans, spring object drops and a hand-written quote card —
 * all unified by a film grade (grain / halftone / vignette / flicker).
 *
 * Self-contained (remotion core only) so it bundles for cloud rendering.
 * Every randomness source is a seeded PRNG — renders are deterministic.
 */

export type DocuShotKind =
  | "parallax_portrait"
  | "map_zoom"
  | "photo_slide"
  | "matte_sequence"
  | "collage_pan"
  | "object_drop"
  | "quote_card";

export interface DocuLabel {
  text: string;
  sub?: string;
}

export interface DocuShotSpec {
  kind: DocuShotKind;
  durationInFrames: number;
  /** Background plate (data URI or URL). */
  bg?: string;
  /** Foreground cutout PNG with alpha (parallax / object_drop hero). */
  fg?: string;
  /** Photo set (photo_slide 2-3, matte_sequence 3-4, collage_pan 6-10). */
  images?: string[];
  /** Object cutout PNGs that drop into frame (object_drop). */
  cutouts?: string[];
  /** Big kinetic headline (≤3 words reads best). */
  title?: string;
  /** Small letterspaced line above the title. */
  kicker?: string;
  /** Highlight-box callouts (yellow box slides in behind each). */
  labels?: DocuLabel[];
  /** Hand-written margin notes. */
  annotations?: string[];
  /** map_zoom ring label. */
  circleLabel?: string;
  /** quote_card content. */
  quote?: string;
  attribution?: string;
  /** Accent override for this shot (default documentary yellow). */
  accent?: string;
}

export type DocuMotionProps = {
  shots: DocuShotSpec[];
};

const PAPER = "#f2ead8";
const INK = "#15130f";
const YELLOW = "#f2c230";

/* ---------------------------------------------------------------- fonts -- */

const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;600;700&family=Caveat:wght@600;700&display=block";

/** Inject Google Fonts and hold rendering until they're usable (8s cap). */
const useDocuFonts = () => {
  const [handle] = useState(() => delayRender("documotion fonts"));
  useEffect(() => {
    if (!document.querySelector("link[data-docu-fonts]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_CSS;
      link.setAttribute("data-docu-fonts", "1");
      document.head.appendChild(link);
    }
    const started = Date.now();
    const tick = () => {
      const ready =
        document.fonts.check("700 64px Anton") &&
        document.fonts.check("600 64px Oswald") &&
        document.fonts.check("700 64px Caveat");
      if (ready || Date.now() - started > 8000) {
        continueRender(handle);
      } else {
        setTimeout(tick, 120);
      }
    };
    // Nudge the lazy loader, then poll.
    document.fonts.load("700 64px Anton").catch(() => undefined);
    document.fonts.load("600 64px Oswald").catch(() => undefined);
    document.fonts.load("700 64px Caveat").catch(() => undefined);
    tick();
  }, [handle]);
};

/* ----------------------------------------------------------------- utils -- */

/** Deterministic PRNG — Math.random would break render reproducibility. */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const grainUri = (seed: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='280' height='280'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='${seed}' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  )}`;

const paperUri = (seed: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><filter id='p'><feTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='4' seed='${seed}'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#p)' opacity='0.5'/></svg>`,
  )}`;

/* ----------------------------------------------------------------- grade -- */

/** Film grade laid over everything: animated grain, halftone, vignette, flicker. */
const Grade: React.FC = () => {
  const frame = useCurrentFrame();
  // Two alternating turbulence seeds = cheap animated grain.
  const seed = frame % 4 < 2 ? 7 : 13;
  const flicker = 0.035 + 0.02 * Math.sin(frame * 1.71) * Math.sin(frame * 0.37);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `url("${grainUri(seed)}")`,
          backgroundRepeat: "repeat",
          opacity: 0.09,
          mixBlendMode: "overlay",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "radial-gradient(rgba(20,16,10,0.22) 1px, transparent 1.7px)",
          backgroundSize: "7px 7px",
          opacity: 0.16,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 48%, rgba(8,6,4,0.34) 82%, rgba(8,6,4,0.62) 100%)",
        }}
      />
      <AbsoluteFill style={{ backgroundColor: "#1a1408", opacity: flicker, mixBlendMode: "multiply" }} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------ typography -- */

const KineticTitle: React.FC<{
  text: string;
  kicker?: string;
  delay?: number;
  align?: "left" | "center";
  size?: number;
  color?: string;
}> = ({ text, kicker, delay = 6, align = "left", size, color = PAPER }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 110 } });
  const opacity = interpolate(frame, [delay, delay + 7], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fontSize = size ?? Math.round(width * 0.088);
  return (
    <div style={{ textAlign: align, opacity }}>
      {kicker ? (
        <div
          style={{
            fontFamily: "Oswald, sans-serif",
            fontWeight: 600,
            fontSize: Math.round(fontSize * 0.18),
            letterSpacing: "0.55em",
            textTransform: "uppercase",
            color: "rgba(242,234,216,0.85)",
            marginBottom: Math.round(fontSize * 0.12),
          }}
        >
          {kicker}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: "Anton, sans-serif",
          fontSize,
          lineHeight: 0.96,
          letterSpacing: "0.01em",
          textTransform: "uppercase",
          color,
          transform: `scale(${1.22 - 0.22 * pop}) rotate(-1.2deg)`,
          transformOrigin: align === "left" ? "left bottom" : "center bottom",
          textShadow:
            "0.045em 0.05em 0 rgba(10,8,5,0.82), 0 0.16em 0.9em rgba(0,0,0,0.55)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

const HighlightLabel: React.FC<{
  label: DocuLabel;
  delay: number;
  accent?: string;
  tilt?: number;
}> = ({ label, delay, accent = YELLOW, tilt = -1.4 }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const grow = spring({ frame: frame - delay, fps, config: { damping: 17, stiffness: 130 } });
  const textOpacity = interpolate(frame, [delay + 4, delay + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ marginBottom: Math.round(width * 0.014) }}>
      <div
        style={{
          display: "inline-block",
          backgroundColor: accent,
          transform: `rotate(${tilt}deg) scaleX(${grow})`,
          transformOrigin: "left center",
          padding: "0.18em 0.55em 0.22em",
          boxShadow: "0.12em 0.18em 0 rgba(10,8,5,0.55)",
        }}
      >
        <span
          style={{
            fontFamily: "Oswald, sans-serif",
            fontWeight: 700,
            fontSize: Math.round(width * 0.03),
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: INK,
            opacity: textOpacity,
            whiteSpace: "nowrap",
          }}
        >
          {label.text}
        </span>
      </div>
      {label.sub ? (
        <div
          style={{
            fontFamily: "Caveat, cursive",
            fontWeight: 600,
            fontSize: Math.round(width * 0.024),
            color: "rgba(242,234,216,0.92)",
            opacity: textOpacity,
            marginTop: "0.18em",
            textShadow: "0 2px 10px rgba(0,0,0,0.8)",
          }}
        >
          {label.sub}
        </div>
      ) : null}
    </div>
  );
};

const Annotation: React.FC<{ text: string; delay: number; size?: number }> = ({
  text,
  delay,
  size,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const opacity = interpolate(frame, [delay, delay + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frame, [delay, delay + 12], [10, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        fontFamily: "Caveat, cursive",
        fontWeight: 700,
        fontSize: size ?? Math.round(width * 0.027),
        color: "rgba(244,238,222,0.95)",
        opacity,
        transform: `translateY(${rise}px) rotate(-2deg)`,
        textShadow: "0 2px 12px rgba(0,0,0,0.85)",
      }}
    >
      {text}
    </div>
  );
};

/* ---------------------------------------------------------------- photos -- */

const TapedPhoto: React.FC<{
  src: string;
  width: number;
  rotate: number;
  sepia?: number;
}> = ({ src, width, rotate, sepia = 0.35 }) => {
  const pad = Math.max(6, Math.round(width * 0.035));
  const tape = (t: { top?: number; bottom?: number; left?: number; right?: number; rot: number }) => (
    <div
      style={{
        position: "absolute",
        width: Math.round(width * 0.3),
        height: Math.round(width * 0.085),
        background: "rgba(228,216,182,0.8)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        transform: `rotate(${t.rot}deg)`,
        top: t.top,
        bottom: t.bottom,
        left: t.left,
        right: t.right,
      }}
    />
  );
  return (
    <div
      style={{
        position: "relative",
        width,
        padding: pad,
        paddingBottom: Math.round(pad * 2.4),
        background: "#efe6d0",
        boxShadow: "0 22px 48px rgba(0,0,0,0.5)",
        transform: `rotate(${rotate}deg)`,
      }}
    >
      <Img
        src={src}
        style={{
          width: "100%",
          display: "block",
          filter: `sepia(${sepia}) contrast(1.04) brightness(0.97)`,
        }}
      />
      {tape({ top: -10, left: -22, rot: -38 })}
      {tape({ top: -10, right: -22, rot: 36 })}
    </div>
  );
};

/* ----------------------------------------------------------------- shots -- */

const ShotBg: React.FC<{ src?: string; from?: number; to?: number; dur: number; dark?: number }> = ({
  src,
  from = 1.05,
  to = 1.16,
  dur,
  dark = 0.28,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, dur], [from, to]);
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: "#171410" }}>
        {src ? (
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${scale})`,
              filter: "sepia(0.3) contrast(1.05) saturate(0.85)",
            }}
          />
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(10,8,5,${dark * 0.7}) 0%, rgba(10,8,5,0) 35%, rgba(10,8,5,${dark}) 100%)`,
        }}
      />
    </>
  );
};

const ParallaxPortraitShot: React.FC<{ shot: DocuShotSpec }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const dur = shot.durationInFrames;
  const fgScale = interpolate(frame, [0, dur], [1.0, 1.13]);
  return (
    <AbsoluteFill>
      <ShotBg src={shot.bg} dur={dur} />
      {/* headline sits BETWEEN plate and hero — the hero overlaps the type */}
      {shot.title ? (
        <AbsoluteFill style={{ justifyContent: "center", paddingLeft: width * 0.3, paddingBottom: height * 0.22 }}>
          <KineticTitle text={shot.title} kicker={shot.kicker} size={Math.round(width * 0.105)} />
        </AbsoluteFill>
      ) : null}
      {shot.fg ? (
        <AbsoluteFill>
          <Img
            src={shot.fg}
            style={{
              position: "absolute",
              left: "-2%",
              bottom: "-6%",
              height: "108%",
              transform: `scale(${fgScale})`,
              transformOrigin: "bottom left",
              filter: "sepia(0.25) contrast(1.06) drop-shadow(18px 0 50px rgba(0,0,0,0.6))",
            }}
          />
        </AbsoluteFill>
      ) : null}
      {shot.labels?.length ? (
        <AbsoluteFill
          style={{
            alignItems: "flex-end",
            justifyContent: "center",
            paddingRight: width * 0.06,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            {shot.labels.map((l, i) => (
              <HighlightLabel key={i} label={l} delay={18 + i * 13} accent={shot.accent} tilt={i % 2 ? 1.2 : -1.6} />
            ))}
            {shot.annotations?.map((a, i) => (
              <Annotation key={`a${i}`} text={a} delay={30 + i * 14} />
            ))}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

const MapZoomShot: React.FC<{ shot: DocuShotSpec }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const dur = shot.durationInFrames;
  const ring = spring({ frame: frame - 8, fps, config: { damping: 13, stiffness: 90 } });
  const accent = shot.accent ?? "#5ad27e";
  const size = Math.round(height * 0.52);
  return (
    <AbsoluteFill>
      <ShotBg src={shot.bg} dur={dur} from={1.0} to={1.2} dark={0.2} />
      {/* heavier halftone — the satellite-map treatment */}
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(rgba(12,10,6,0.4) 1.1px, transparent 1.9px)",
          backgroundSize: "9px 9px",
          opacity: 0.4,
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            border: `${Math.max(4, Math.round(width * 0.005))}px solid ${accent}`,
            background: "rgba(70,200,110,0.13)",
            boxShadow: `0 0 ${Math.round(width * 0.04)}px rgba(90,210,126,0.45), inset 0 0 ${Math.round(width * 0.03)}px rgba(90,210,126,0.3)`,
            transform: `scale(${ring})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {shot.circleLabel ? (
            <div
              style={{
                fontFamily: "Anton, sans-serif",
                fontSize: Math.round(size * 0.2),
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: PAPER,
                textShadow: "0.05em 0.06em 0 rgba(10,8,5,0.8)",
                opacity: interpolate(frame, [14, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              }}
            >
              {shot.circleLabel}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
      {shot.labels?.length ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", padding: `0 0 ${height * 0.08}px ${width * 0.06}px` }}>
          <div>
            {shot.labels.map((l, i) => (
              <HighlightLabel key={i} label={l} delay={20 + i * 12} accent={shot.accent ?? YELLOW} />
            ))}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

const PhotoSlideShot: React.FC<{ shot: DocuShotSpec }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const dur = shot.durationInFrames;
  const photos = shot.images ?? [];
  const slots = [
    { left: 0.055, top: 0.16, w: 0.3, rot: -5 },
    { left: 0.37, top: 0.1, w: 0.28, rot: 3.4 },
    { left: 0.665, top: 0.2, w: 0.27, rot: -2.2 },
  ];
  return (
    <AbsoluteFill>
      <ShotBg src={shot.bg} dur={dur} from={1.02} to={1.1} dark={0.42} />
      {photos.slice(0, 3).map((src, i) => {
        const slot = slots[i % slots.length];
        const enter = spring({ frame: frame - i * 13, fps, config: { damping: 16, stiffness: 90 } });
        const fromX = (i % 2 === 0 ? -1.3 : 1.3) * width;
        const x = interpolate(enter, [0, 1], [fromX, 0]);
        const drift = interpolate(frame, [0, dur], [0, (i % 2 === 0 ? -1 : 1) * width * 0.012]);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: width * slot.left,
              top: height * slot.top,
              transform: `translateX(${x + drift}px)`,
            }}
          >
            <TapedPhoto src={src} width={width * slot.w} rotate={slot.rot} />
          </div>
        );
      })}
      {shot.labels?.length ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.06 }}>
          <div>
            {shot.labels.map((l, i) => (
              <HighlightLabel key={i} label={l} delay={26 + i * 12} accent={shot.accent} />
            ))}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

/** Rough torn-edge wipe between full-frame images — the analog matte cut. */
const MatteSequenceShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const dur = shot.durationInFrames;
  const images = shot.images ?? [];
  const n = Math.max(1, images.length);
  const per = Math.floor(dur / n);
  const WIPE = 11;

  const teeth = (i: number) => {
    const rnd = mulberry32(seed * 31 + i * 7 + 11);
    return Array.from({ length: 9 }, () => (rnd() - 0.5) * 14);
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#171410" }}>
      {images.map((src, i) => {
        const start = i * per;
        if (frame < start) return null;
        const local = frame - start;
        const p = i === 0 ? 1 : clamp01(local / WIPE);
        const t = teeth(i);
        const edge = -12 + p * 130; // percent across, overshoots so teeth clear
        const dirDown = i % 2 === 1;
        // Jagged reveal edge: vertical sweep on even, horizontal on odd cuts.
        const pts = dirDown
          ? [
              `0% ${edge + t[0]}%`, `14% ${edge + t[1]}%`, `28% ${edge + t[2]}%`, `42% ${edge + t[3]}%`,
              `56% ${edge + t[4]}%`, `70% ${edge + t[5]}%`, `84% ${edge + t[6]}%`, `100% ${edge + t[7]}%`,
              "100% -20%", "0% -20%",
            ]
          : [
              `${edge + t[0]}% 0%`, `${edge + t[1]}% 14%`, `${edge + t[2]}% 28%`, `${edge + t[3]}% 42%`,
              `${edge + t[4]}% 56%`, `${edge + t[5]}% 70%`, `${edge + t[6]}% 84%`, `${edge + t[7]}% 100%`,
              "-20% 100%", "-20% 0%",
            ];
        const zoom = interpolate(local, [0, per + WIPE], [1.04, 1.13]);
        return (
          <AbsoluteFill key={i} style={{ clipPath: p >= 1 ? undefined : `polygon(${pts.join(", ")})` }}>
            <Img
              src={src}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `scale(${zoom})`,
                filter: "sepia(0.3) contrast(1.05) saturate(0.85)",
              }}
            />
          </AbsoluteFill>
        );
      })}
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, rgba(10,8,5,0.18) 0%, rgba(10,8,5,0) 40%, rgba(10,8,5,0.3) 100%)",
        }}
      />
      {shot.labels?.length ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", padding: `0 0 ${height * 0.07}px ${width * 0.06}px` }}>
          <div>
            {shot.labels.map((l, i) => (
              <HighlightLabel key={i} label={l} delay={10 + i * per} accent={shot.accent} />
            ))}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

const CollagePanShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const dur = shot.durationInFrames;
  const photos = shot.images ?? [];
  const rnd = mulberry32(seed * 97 + 5);
  const cols = Math.max(3, Math.ceil(photos.length / 2));
  const boardW = width * 1.55;
  const boardH = height * 1.5;
  const x = interpolate(frame, [0, dur], [0, -(boardW - width)]);
  const y = interpolate(frame, [0, dur], [0, -(boardH - height) * 0.75]);
  const cellW = boardW / cols;
  return (
    <AbsoluteFill style={{ backgroundColor: "#2a241c", overflow: "hidden" }}>
      <div style={{ position: "absolute", width: boardW, height: boardH, transform: `translate(${x}px, ${y}px)` }}>
        {shot.bg ? (
          <Img
            src={shot.bg}
            style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", filter: "sepia(0.4) brightness(0.75)" }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            backgroundImage: `url("${paperUri(3)}")`,
            opacity: 0.5,
          }}
        />
        {photos.map((src, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const jx = (rnd() - 0.5) * cellW * 0.3;
          const jy = (rnd() - 0.5) * boardH * 0.07;
          const rot = (rnd() - 0.5) * 11;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: col * cellW + cellW * 0.08 + jx,
                top: row * (boardH / 2) + boardH * 0.07 + jy,
              }}
            >
              <TapedPhoto src={src} width={cellW * 0.82} rotate={rot} sepia={0.45} />
            </div>
          );
        })}
        {shot.annotations?.map((a, i) => (
          <div
            key={`an${i}`}
            style={{
              position: "absolute",
              left: boardW * (0.16 + 0.3 * i + rnd() * 0.06),
              top: boardH * (i % 2 === 0 ? 0.475 : 0.02) + boardH * 0.46 * 0,
            }}
          >
            <Annotation text={a} delay={14 + i * 24} size={Math.round(width * 0.034)} />
          </div>
        ))}
      </div>
      {shot.labels?.length ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", padding: `0 0 ${height * 0.07}px ${width * 0.06}px` }}>
          <div>
            {shot.labels.map((l, i) => (
              <HighlightLabel key={i} label={l} delay={16 + i * 14} accent={shot.accent} />
            ))}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

const ObjectDropShot: React.FC<{ shot: DocuShotSpec }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const dur = shot.durationInFrames;
  const cutouts = shot.cutouts ?? [];
  const slots = [
    { left: 0.08, top: 0.04, w: 0.17, rot: -9 },
    { left: 0.74, top: 0.02, w: 0.19, rot: 7 },
    { left: 0.43, top: 0.0, w: 0.15, rot: -4 },
  ];
  return (
    <AbsoluteFill>
      <ShotBg src={shot.bg} dur={dur} />
      {shot.fg ? (
        <Img
          src={shot.fg}
          style={{
            position: "absolute",
            left: "-2%",
            bottom: "-6%",
            height: "106%",
            transform: `scale(${interpolate(frame, [0, dur], [1, 1.1])})`,
            transformOrigin: "bottom left",
            filter: "sepia(0.25) contrast(1.06) drop-shadow(18px 0 50px rgba(0,0,0,0.6))",
          }}
        />
      ) : null}
      {cutouts.slice(0, 3).map((src, i) => {
        const slot = slots[i % slots.length];
        const drop = spring({ frame: frame - 8 - i * 9, fps, config: { damping: 12, stiffness: 70 } });
        const yPos = interpolate(drop, [0, 1], [-height * 0.6, 0]);
        const rot = interpolate(drop, [0, 1], [slot.rot * 3, slot.rot]);
        return (
          <Img
            key={i}
            src={src}
            style={{
              position: "absolute",
              left: width * slot.left,
              top: height * slot.top,
              width: width * slot.w,
              transform: `translateY(${yPos}px) rotate(${rot}deg)`,
              filter: "sepia(0.2) contrast(1.05) drop-shadow(0 24px 40px rgba(0,0,0,0.55))",
            }}
          />
        );
      })}
      {shot.title ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: height * 0.12 }}>
          <KineticTitle text={shot.title} kicker={shot.kicker} delay={14} align="center" size={Math.round(width * 0.095)} />
        </AbsoluteFill>
      ) : null}
      {shot.labels?.length ? (
        <AbsoluteFill style={{ alignItems: "flex-end", justifyContent: "center", paddingRight: width * 0.06 }}>
          <div>
            {shot.labels.map((l, i) => (
              <HighlightLabel key={i} label={l} delay={20 + i * 12} accent={shot.accent} />
            ))}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

const QuoteCardShot: React.FC<{ shot: DocuShotSpec }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const dur = shot.durationInFrames;
  const words = (shot.quote ?? "").split(/\s+/).filter(Boolean);
  const zoom = interpolate(frame, [0, dur], [1, 1.05]);
  const fadeOut = interpolate(frame, [dur - 18, dur - 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: "#14110d" }}>
      {shot.bg ? (
        <Img
          src={shot.bg}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.22,
            transform: `scale(${zoom})`,
            filter: "sepia(0.4) brightness(0.7)",
          }}
        />
      ) : (
        <AbsoluteFill style={{ backgroundImage: `url("${paperUri(9)}")`, opacity: 0.35 }} />
      )}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: `0 ${width * 0.14}px`,
          transform: `scale(${zoom})`,
        }}
      >
        <div
          style={{
            fontFamily: "Caveat, cursive",
            fontWeight: 700,
            fontSize: Math.round(width * 0.052),
            lineHeight: 1.25,
            color: PAPER,
            textAlign: "center",
            textShadow: "0 4px 24px rgba(0,0,0,0.9)",
          }}
        >
          {words.map((w, i) => (
            <span
              key={i}
              style={{
                opacity: interpolate(frame, [6 + i * 2, 12 + i * 2], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              {w}{" "}
            </span>
          ))}
        </div>
        {shot.attribution ? (
          <div
            style={{
              marginTop: height * 0.05,
              fontFamily: "Oswald, sans-serif",
              fontWeight: 600,
              fontSize: Math.round(width * 0.018),
              letterSpacing: "0.5em",
              textTransform: "uppercase",
              color: shot.accent ?? YELLOW,
              opacity: interpolate(frame, [Math.min(40, dur - 30), Math.min(52, dur - 18)], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {shot.attribution}
          </div>
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: fadeOut }} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- master -- */

const renderShot = (shot: DocuShotSpec, i: number) => {
  switch (shot.kind) {
    case "parallax_portrait":
      return <ParallaxPortraitShot shot={shot} />;
    case "map_zoom":
      return <MapZoomShot shot={shot} />;
    case "photo_slide":
      return <PhotoSlideShot shot={shot} />;
    case "matte_sequence":
      return <MatteSequenceShot shot={shot} seed={i + 1} />;
    case "collage_pan":
      return <CollagePanShot shot={shot} seed={i + 1} />;
    case "object_drop":
      return <ObjectDropShot shot={shot} />;
    case "quote_card":
      return <QuoteCardShot shot={shot} />;
    default:
      return <AbsoluteFill style={{ backgroundColor: "#171410" }} />;
  }
};

export const DocuMotion: React.FC<DocuMotionProps> = ({ shots }) => {
  useDocuFonts();
  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0c0a" }}>
      <Series>
        {shots.map((s, i) => (
          <Series.Sequence key={i} durationInFrames={Math.max(1, s.durationInFrames)}>
            {renderShot(s, i)}
          </Series.Sequence>
        ))}
      </Series>
      <Grade />
    </AbsoluteFill>
  );
};
