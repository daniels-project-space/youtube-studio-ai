import React, { createContext, useContext } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Series,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { noise2D } from "@remotion/noise";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadCaveat } from "@remotion/google-fonts/Caveat";
import { loadFont as loadSpecialElite } from "@remotion/google-fonts/SpecialElite";
import { type DocuTheme, type DocuShotKind, getStyle } from "./docuStyles";

// Load every face the styles use via Remotion's native loader — it ties font
// readiness into delayRender deterministically (no CDN race), so text NEVER
// renders before its font is ready. This replaced a hand-rolled loader that
// raced intermittently in the long-lived pipeline browser (invisible quotes).
loadAnton();
loadOswald("normal", { weights: ["500", "600", "700"], subsets: ["latin"] });
loadCaveat("normal", { weights: ["600", "700"], subsets: ["latin"] });
loadSpecialElite("normal", { weights: ["400"], subsets: ["latin"] });

/**
 * DOCUMOTION — the documentary-collage shot kit. A themeable kit of motion
 * "shots" (parallax portraits, map zooms, taped-photo slides, torn matte cuts,
 * collage pans, an investigation EVIDENCE BOARD with red string, object drops
 * and quote cards), recolored per channel "world" via a theme passed in props.
 *
 * VISUAL ENGINE ONLY — no audio. remotion core + @remotion/noise; all
 * randomness is seeded so renders are deterministic.
 */

export type { DocuShotKind } from "./docuStyles";

export type DocuCameraMove = "push_in" | "pull_back" | "pan_left" | "pan_right" | "drift";
export type DocuCameraIntensity = "subtle" | "medium" | "strong";

export interface DocuCamera {
  move: DocuCameraMove;
  intensity: DocuCameraIntensity;
}

export interface DocuLabel {
  text: string;
  sub?: string;
}

export type DocuLabelPos = "top_right" | "bottom_left" | "bottom_center";

/** A connection on the evidence board: indices into the shot's images. */
export interface DocuThread {
  from: number;
  to: number;
}

/** Projected real-world map geometry (from geoMap.ts) for the geo_map shot. */
export interface DocuGeo {
  label: string;
  pin: [number, number];
  kind?: "waterway" | "area" | "city";
  /** True centre [lat, lon] of the framed window (coordinate readout). */
  center?: [number, number];
  /** Degree span [latDeg, lonDeg] of the framed window (graticule + scale). */
  span?: [number, number];
  streets: { p: [number, number][]; m: boolean }[];
  buildings: [number, number][][];
  /** Filled water polygons (seas / lakes / bays). */
  water?: [number, number][][];
  /** Waterway lines (rivers / canals) — ambient texture. */
  waterways?: [number, number][][];
  /** The SUBJECT as line geometry (the hero route, e.g. a canal). */
  route?: [number, number][][];
  /** The SUBJECT as area polygons (country / lake / city outline). */
  area?: [number, number][][];
  synthetic?: boolean;
}

export interface DocuShotSpec {
  kind: DocuShotKind;
  durationInFrames: number;
  camera?: DocuCamera;
  bg?: string;
  fg?: string;
  images?: string[];
  cutouts?: string[];
  title?: string;
  kicker?: string;
  labels?: DocuLabel[];
  labelPos?: DocuLabelPos;
  annotations?: string[];
  circleLabel?: string;
  quote?: string;
  attribution?: string;
  accent?: string;
  titleBoost?: number;
  /** evidence_board: explicit connections (else auto-chained). */
  threads?: DocuThread[];
  /** geo_map: projected street/building geometry. */
  geo?: DocuGeo;
  /** quote_card: a Banana-designed type card (data URI) — overrides CSS type. */
  typeImage?: string;
  /** depth_parallax: animate a focus pull between the near and far planes. */
  rackFocus?: "near_to_far" | "far_to_near";
}

export type DocuMotionProps = {
  shots: DocuShotSpec[];
  /** Channel world theme — defaults to the archival style. */
  theme?: DocuTheme;
  /** Google Fonts URL + family probes for this theme. */
  fontCss?: string;
  fontProbe?: [string, string, string];
};

/* ---------------------------------------------------------------- theme -- */

const DEFAULT_THEME = getStyle("archival_collage").theme;
const ThemeCtx = createContext<DocuTheme>(DEFAULT_THEME);
const useTheme = () => useContext(ThemeCtx);

/* ----------------------------------------------------------------- utils -- */

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

/** Cork texture for the evidence board. */
const corkUri = (seed: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><rect width='100%' height='100%' fill='%238a5a2b'/><filter id='c'><feTurbulence type='fractalNoise' baseFrequency='0.045' numOctaves='5' seed='${seed}'/><feColorMatrix type='matrix' values='0 0 0 0 0.42  0 0 0 0 0.27  0 0 0 0 0.12  0 0 0 1 0'/></filter><rect width='100%' height='100%' filter='url(#c)' opacity='0.6'/></svg>`,
  )}`;

/* ---------------------------------------------------------------- camera -- */

interface CamState {
  scale: number;
  x: number;
  y: number;
}

const CAM_AMT: Record<DocuCameraIntensity, number> = { subtle: 0.045, medium: 0.085, strong: 0.14 };

const useCam = (camera: DocuCamera | undefined, dur: number, seed: number): CamState => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const move = camera?.move ?? "push_in";
  const amt = CAM_AMT[camera?.intensity ?? "medium"];
  const p = interpolate(frame, [0, Math.max(1, dur)], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  let scale = 1.03;
  let x = 0;
  let y = 0;
  switch (move) {
    case "push_in":
      scale = 1.03 + amt * p;
      break;
    case "pull_back":
      scale = 1.03 + amt * (1 - p);
      break;
    case "pan_left":
      scale = 1.04 + amt;
      x = width * amt * (p - 0.5) * 0.9;
      break;
    case "pan_right":
      scale = 1.04 + amt;
      x = width * amt * (0.5 - p) * 0.9;
      break;
    case "drift":
      scale = 1.05 + amt * 0.25 * p;
      break;
  }
  const driftAmp = move === "drift" ? 0.006 : 0.0032;
  x += noise2D(`dx${seed}`, frame * 0.016, 0) * width * driftAmp;
  y += noise2D(`dy${seed}`, frame * 0.013, 7) * height * driftAmp;
  return { scale, x, y };
};

const camTransform = (cam: CamState, depth: number) =>
  `translate(${(cam.x * depth).toFixed(2)}px, ${(cam.y * depth).toFixed(2)}px) scale(${(1 + (cam.scale - 1) * depth).toFixed(4)})`;

/* ----------------------------------------------------------------- grade -- */

const Grade: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = useTheme();
  const seed = frame % 4 < 2 ? 7 : 13;
  const flicker = 0.03 + 0.018 * Math.sin(frame * 1.71) * Math.sin(frame * 0.37);
  const rnd = mulberry32(frame * 7919 + 31);
  const dust = Array.from({ length: 4 }, () => ({ x: rnd() * width, y: rnd() * height, r: 1 + rnd() * 2, on: rnd() < 0.4 }));
  const scratchOn = rnd() < 0.07;
  const scratchX = rnd() * width;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `url("${grainUri(seed)}")`,
          backgroundRepeat: "repeat",
          opacity: t.grain,
          mixBlendMode: "overlay",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(rgba(20,16,10,0.22) 1px, transparent 1.7px)",
          backgroundSize: "7px 7px",
          opacity: 0.12,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(8,6,4,${t.vignette * 0.5}) 82%, rgba(8,6,4,${t.vignette}) 100%)`,
        }}
      />
      {dust.map((d, i) =>
        d.on ? (
          <div
            key={i}
            style={{ position: "absolute", left: d.x, top: d.y, width: d.r, height: d.r, borderRadius: "50%", backgroundColor: "rgba(235,228,210,0.55)", opacity: 0.5 }}
          />
        ) : null,
      )}
      {scratchOn ? (
        <div style={{ position: "absolute", left: scratchX, top: 0, width: 1.5, height: "100%", backgroundColor: "rgba(230,222,200,0.5)", opacity: 0.18 }} />
      ) : null}
      <AbsoluteFill style={{ backgroundColor: t.flickerTint, opacity: flicker, mixBlendMode: "multiply" }} />
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
}> = ({ text, kicker, delay = 6, align = "left", size }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = useTheme();
  const pop = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 120 } });
  const opacity = interpolate(frame, [delay, delay + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fontSize = size ?? Math.round(width * 0.1);
  return (
    <div style={{ textAlign: align, opacity }}>
      {kicker ? (
        <div
          style={{
            fontFamily: t.fontLabel,
            fontWeight: 600,
            fontSize: Math.round(fontSize * 0.2),
            letterSpacing: "0.5em",
            textTransform: "uppercase",
            color: t.paper,
            textShadow: "0 2px 8px rgba(0,0,0,0.95), 0 0 22px rgba(0,0,0,0.8)",
            marginBottom: Math.round(fontSize * 0.14),
          }}
        >
          {kicker}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: t.fontDisplay,
          fontWeight: 700,
          fontSize,
          lineHeight: 0.96,
          letterSpacing: "0.012em",
          textTransform: "uppercase",
          color: t.paper,
          WebkitTextStroke: `${Math.max(1.5, fontSize * 0.012)}px rgba(14,11,7,0.9)`,
          transform: `scale(${1.18 - 0.18 * pop}) rotate(-1.2deg)`,
          transformOrigin: align === "left" ? "left bottom" : "center bottom",
          textShadow: "0.05em 0.055em 0 rgba(10,8,5,0.92), 0 0.14em 1em rgba(0,0,0,0.65), 0 0 0.5em rgba(0,0,0,0.4)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

const HighlightLabel: React.FC<{ label: DocuLabel; delay: number; accent?: string; tilt?: number; scale?: number }> = ({
  label,
  delay,
  accent,
  tilt = -1.4,
  scale = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = useTheme();
  const acc = accent ?? t.accent;
  const grow = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 150 } });
  const textOpacity = interpolate(frame, [delay + 3, delay + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // dark accent boxes (deep red, etc.) need light text; bright accents need ink
  const onAccent = isDark(acc) ? t.paper : t.ink;
  return (
    <div style={{ marginBottom: Math.round(width * 0.016) }}>
      <div
        style={{
          display: "inline-block",
          backgroundColor: acc,
          transform: `rotate(${tilt}deg) scaleX(${grow})`,
          transformOrigin: "left center",
          padding: "0.16em 0.55em 0.2em",
          boxShadow: "0.14em 0.2em 0 rgba(10,8,5,0.6), 0 0.4em 1.6em rgba(0,0,0,0.45)",
        }}
      >
        <span
          style={{
            fontFamily: t.fontLabel,
            fontWeight: 700,
            fontSize: Math.round(width * 0.034 * scale),
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: onAccent,
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
            display: "inline-block",
            fontFamily: t.fontHand,
            fontWeight: 700,
            fontSize: Math.round(width * 0.029 * scale),
            color: t.paper,
            opacity: textOpacity,
            marginTop: "0.16em",
            padding: "0.02em 0.4em 0.08em",
            background: "rgba(12,10,7,0.45)",
            borderRadius: "0.3em",
            textShadow: "0 2px 6px rgba(0,0,0,0.95)",
          }}
        >
          {label.sub}
        </div>
      ) : null}
    </div>
  );
};

function isDark(hex: string): boolean {
  const m = hex.replace("#", "");
  if (m.length < 6) return false;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

const Annotation: React.FC<{ text: string; delay: number; size?: number }> = ({ text, delay, size }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const t = useTheme();
  const opacity = interpolate(frame, [delay, delay + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rise = interpolate(frame, [delay, delay + 12], [10, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        display: "inline-block",
        fontFamily: t.fontHand,
        fontWeight: 700,
        fontSize: size ?? Math.round(width * 0.03),
        color: t.paper,
        opacity,
        transform: `translateY(${rise}px) rotate(-2deg)`,
        padding: "0 0.4em 0.06em",
        background: "rgba(12,10,7,0.4)",
        borderRadius: "0.3em",
        textShadow: "0 2px 8px rgba(0,0,0,0.95)",
      }}
    >
      {text}
    </div>
  );
};

const TextScrim: React.FC<{ cx: number; cy: number; w: number; h: number; opacity?: number }> = ({ cx, cy, w, h, opacity = 0.5 }) => (
  <AbsoluteFill style={{ background: `radial-gradient(${w}% ${h}% at ${cx}% ${cy}%, rgba(8,6,4,${opacity}), rgba(8,6,4,${opacity * 0.55}) 55%, transparent 78%)` }} />
);

const LabelRail: React.FC<{ shot: DocuShotSpec; baseDelay?: number; scale?: number }> = ({ shot, baseDelay = 18, scale = 1 }) => {
  const { width, height } = useVideoConfig();
  if (!shot.labels?.length && !shot.annotations?.length) return null;
  const pos = shot.labelPos ?? "top_right";
  const style: React.CSSProperties =
    pos === "bottom_left"
      ? { alignItems: "flex-start", justifyContent: "flex-end", paddingLeft: width * 0.055, paddingBottom: height * 0.09 }
      : pos === "bottom_center"
        ? { alignItems: "center", justifyContent: "flex-end", paddingBottom: height * 0.07 }
        : { alignItems: "flex-end", justifyContent: "flex-start", paddingRight: width * 0.055, paddingTop: height * 0.1 };
  const scrim = pos === "bottom_left" ? { cx: 18, cy: 82 } : pos === "bottom_center" ? { cx: 50, cy: 86 } : { cx: 84, cy: 26 };
  return (
    <>
      <TextScrim cx={scrim.cx} cy={scrim.cy} w={46} h={52} opacity={0.42} />
      <AbsoluteFill style={style}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          {(shot.labels ?? []).map((l, i) => (
            <HighlightLabel key={i} label={l} delay={baseDelay + i * 12} accent={shot.accent} tilt={i % 2 ? 1.2 : -1.6} scale={scale} />
          ))}
          {(shot.annotations ?? []).map((a, i) => (
            <Annotation key={`a${i}`} text={a} delay={baseDelay + 12 + i * 13} />
          ))}
        </div>
      </AbsoluteFill>
    </>
  );
};

/* ---------------------------------------------------------------- photos -- */

const TapedPhoto: React.FC<{ src: string; width: number; rotate: number; sepia?: number; filter?: string }> = ({
  src,
  width,
  rotate,
  sepia = 0.35,
  filter,
}) => {
  const pad = Math.max(6, Math.round(width * 0.035));
  const tape = (cfg: { top?: number; bottom?: number; left?: number; right?: number; rot: number }) => (
    <div
      style={{
        position: "absolute",
        width: Math.round(width * 0.3),
        height: Math.round(width * 0.085),
        background: "rgba(228,216,182,0.82)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        transform: `rotate(${cfg.rot}deg)`,
        top: cfg.top,
        bottom: cfg.bottom,
        left: cfg.left,
        right: cfg.right,
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
        boxShadow: "0 26px 54px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.4)",
        transform: `rotate(${rotate}deg)`,
      }}
    >
      <Img src={src} style={{ width: "100%", display: "block", filter: filter ?? `sepia(${sepia}) contrast(1.04) brightness(0.97)` }} />
      {tape({ top: -10, left: -22, rot: -38 })}
      {tape({ top: -10, right: -22, rot: 36 })}
    </div>
  );
};

// Neutral die-cut separation: layered drop shadows only — NO pale halo (read as
// "glow") and NO sepia tint (let each style's own grade dominate).
const cutoutFilter =
  "contrast(1.05) " +
  "drop-shadow(0 2px 2px rgba(0,0,0,0.55)) " +
  "drop-shadow(22px 12px 42px rgba(0,0,0,0.62)) drop-shadow(0 4px 10px rgba(0,0,0,0.45))";

/* ----------------------------------------------------------------- shots -- */

/**
 * MODULE RULE — TEXT / CUTOUT SEPARATION (applies to EVERY shot):
 * foreground cutouts (hero portraits, dropped objects, pinned photos) render
 * BEFORE the title/label text, so headlines are ALWAYS on top and can never be
 * hidden by a cutout's parallax; and titles are positioned in a zone clear of
 * the hero (e.g. parallax_portrait starts the title ~0.41w, right of the ≤38%
 * hero). Keep this invariant when adding shots: render order = plate → cutouts
 * → text overlays, with text in a non-overlapping zone.
 */
const ShotBg: React.FC<{ src?: string; cam: CamState; dark?: number; recede?: boolean }> = ({ src, cam, dark = 0.3, recede }) => {
  const t = useTheme();
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: t.base }}>
        {src ? (
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: camTransform(cam, 1),
              filter: `${t.plateFilter} brightness(${recede ? 0.82 : 0.97})${recede ? " blur(1.6px)" : ""}`,
            }}
          />
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(10,8,5,${dark * 0.7}) 0%, rgba(10,8,5,0) 35%, rgba(10,8,5,${dark}) 100%)` }} />
    </>
  );
};

const ParallaxPortraitShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const { width, height } = useVideoConfig();
  const t = useTheme();
  const dur = shot.durationInFrames;
  const cam = useCam(shot.camera, dur, seed);
  const title = shot.title ?? "";
  const boost = shot.titleBoost ?? 1;
  // autofit: title sits between the hero cutout (~38% wide) and the right
  // margin. Starting at 0.28w keeps the payoff readable instead of swallowed.
  const titleSize = Math.min(width * 0.1 * boost, (width * 0.55) / Math.max(6, title.length * t.displayCharW));
  return (
    <AbsoluteFill>
      <ShotBg src={shot.bg} cam={cam} recede={Boolean(shot.fg)} />
      {/* hero cutout FIRST so the title renders ABOVE it (never hidden) */}
      {shot.fg ? (
        <AbsoluteFill>
          <Img
            src={shot.fg}
            style={{
              position: "absolute",
              left: "-2%",
              bottom: "-6%",
              height: "106%",
              maxWidth: "38%",
              objectFit: "contain",
              objectPosition: "left bottom",
              transform: camTransform(cam, 1.5),
              transformOrigin: "bottom left",
              filter: cutoutFilter,
            }}
          />
        </AbsoluteFill>
      ) : null}
      {title ? (
        // Title block: lower third, starting CLEAR of the hero (≈0.4w) and
        // rendered ON TOP of the cutout so it is never hidden by the parallax.
        <>
          <TextScrim cx={62} cy={74} w={70} h={40} opacity={0.52 * boost} />
          <AbsoluteFill style={{ justifyContent: "flex-end", paddingLeft: width * 0.41, paddingBottom: height * 0.1 }}>
            <div style={{ whiteSpace: "nowrap", transform: camTransform(cam, 1.12), transformOrigin: "left bottom" }}>
              <KineticTitle text={title} kicker={shot.kicker} size={Math.round(titleSize)} />
            </div>
          </AbsoluteFill>
        </>
      ) : null}
      <LabelRail shot={shot} />
    </AbsoluteFill>
  );
};

/**
 * DEPTH PARALLAX — turns ONE generated still into a living 2.5D shot. The
 * engine supplies images[0] = the full base plate and images[1..] = near depth
 * layers (alpha PNGs cut from the same image via its depth map). Each layer
 * parallaxes at a deeper rate than the base, so the camera appears to move
 * THROUGH the photograph. With no near layers it degrades to a clean Ken Burns.
 */
const DepthParallaxShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = useTheme();
  const dur = shot.durationInFrames;
  const cam = useCam(shot.camera ?? { move: "push_in", intensity: "medium" }, dur, seed);
  const layers = shot.images ?? [];
  const base = layers[0];
  const near = layers.slice(1);
  const title = shot.title ?? "";
  const boost = shot.titleBoost ?? 1;
  const titleSize = Math.min(width * 0.105 * boost, (width * 0.86) / Math.max(6, title.length * t.displayCharW));

  // RACK FOCUS — animate depth-of-field driven by the depth layers: hold focus,
  // then pull it from the near plane to the far plane (or vice-versa). Needs a
  // near layer; parallax is gentled while racking so the planes stay aligned.
  const canRack = Boolean(shot.rackFocus) && near.length > 0;
  const maxBlur = width * 0.011;
  const fp = interpolate(frame, [dur * 0.22, dur * 0.62], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const focusFar = shot.rackFocus === "far_to_near" ? 1 - fp : fp; // 0 = focus near, 1 = focus far
  const nearBlur = canRack ? maxBlur * focusFar : 0;
  const baseBlur = canRack ? maxBlur * (1 - focusFar) : 0;
  const nearDepth = canRack ? 1.3 : 1.55;
  const blur = (px: number) => (px > 0.2 ? ` blur(${px.toFixed(2)}px)` : "");

  return (
    <AbsoluteFill style={{ backgroundColor: t.base, overflow: "hidden" }}>
      {base ? (
        <Img src={base} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", transform: camTransform(cam, 1.0), filter: `${t.plateFilter}${blur(baseBlur)}` }} />
      ) : null}
      {near.map((src, i) => (
        <Img
          key={i}
          src={src}
          style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", transform: camTransform(cam, nearDepth + i * 0.45), filter: `${t.plateFilter}${blur(nearBlur)}` }}
        />
      ))}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(8,8,6,0.28) 0%, rgba(8,8,6,0) 34%, rgba(8,8,6,0.5) 100%)" }} />
      {title ? (
        <>
          <TextScrim cx={50} cy={76} w={82} h={40} opacity={0.5 * boost} />
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: height * 0.09 }}>
            <div style={{ transform: camTransform(cam, 1.1), whiteSpace: "nowrap" }}>
              <KineticTitle text={title} kicker={shot.kicker} delay={12} align="center" size={Math.round(titleSize)} />
            </div>
          </AbsoluteFill>
        </>
      ) : null}
      <LabelRail shot={shot} baseDelay={18} />
    </AbsoluteFill>
  );
};

/** Largest "nice" degree step that yields ~3-4 graticule lines across a span. */
const niceDegStep = (range: number) => {
  for (const s of [0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]) if (range / s <= 4.5) return s;
  return 30;
};
/** Round down to 1/2/5 ×10ⁿ — for the scale bar. */
const niceMetres = (x: number) => {
  const e = Math.pow(10, Math.floor(Math.log10(Math.max(1, x))));
  const f = x / e;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e;
};

/**
 * GEO MAP — a cinematic CARTOGRAPHIC reveal of a real place. Not a street grid:
 * the SUBJECT is the hero. A canal/river draws on as a glowing channel between
 * its endpoints; a country/lake/city reveals its outline. Around it sit real
 * water bodies, a true lat/lon graticule with coordinate labels, a GPS-lock
 * readout that settles onto the actual coordinates, a sweeping radar, a compass
 * and a metric scale bar — over a deep map base with grain + vignette. Layers
 * parallax as the camera pushes in. Geometry + coords come from geoMap.ts.
 */
const GeoMapShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = useTheme();
  const dur = shot.durationInFrames;
  const geo = shot.geo;
  const accent = shot.accent ?? t.accent;

  const streets = geo?.streets ?? [];
  const water = geo?.water ?? [];
  const waterways = geo?.waterways ?? [];
  const route = geo?.route ?? [];
  const area = geo?.area ?? [];
  const pinX = geo?.pin?.[0] ?? 0.5;
  const pinY = geo?.pin?.[1] ?? 0.5;

  // ---- geometry helpers (normalized → px) ----
  const X = (x: number) => x * width;
  const Y = (y: number) => y * height;
  const toPath = (p: [number, number][]) => p.map(([x, y], i) => `${i ? "L" : "M"} ${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join(" ");
  const toPoly = (p: [number, number][]) => p.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" ");
  const segLen = (p: [number, number][]) => {
    let L = 0;
    for (let i = 1; i < p.length; i++) L += Math.hypot((p[i][0] - p[i - 1][0]) * width, (p[i][1] - p[i - 1][1]) * height);
    return Math.max(1, L);
  };

  // ---- camera: establish, then slow push toward the pin with layered parallax ----
  const push = interpolate(frame, [0, dur], [1.015, 1.15], { easing: Easing.inOut(Easing.cubic), extrapolateRight: "clamp" });
  const driftX = noise2D(`gx${seed}`, frame * 0.01, 0) * width * 0.005;
  const driftY = noise2D(`gy${seed}`, frame * 0.009, 5) * height * 0.005;
  const origin = `${pinX * 100}% ${pinY * 100}%`;
  const layer = (depth: number): React.CSSProperties => ({
    transformOrigin: origin,
    transform: `translate(${(driftX * depth).toFixed(1)}px, ${(driftY * depth).toFixed(1)}px) scale(${(1 + (push - 1) * depth).toFixed(4)})`,
  });

  // ---- timeline ----
  const tWater = 4;
  const tGrid = 10;
  const tRoute = Math.round(dur * 0.16);
  const tPin = Math.min(dur * 0.46, 64);
  const lock = interpolate(frame, [tPin, tPin + 24], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const labelOp = interpolate(frame, [tPin + 10, tPin + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const introWipe = interpolate(frame, [0, 18], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateRight: "clamp" });

  // ---- real coordinates → graticule, readout, scale bar ----
  const center = geo?.center;
  const span = geo?.span;
  const grat: { o: "lat" | "lon"; at: number; label: string }[] = [];
  let scaleFrac = 0.16;
  let scaleLabel = "";
  if (center && span && span[0] > 0 && span[1] > 0) {
    const [cLat, cLon] = center;
    const [sLat, sLon] = span;
    const yOf = (lat: number) => 0.5 - (lat - cLat) / sLat;
    const xOf = (lon: number) => 0.5 + (lon - cLon) / sLon;
    const stepLat = niceDegStep(sLat);
    const stepLon = niceDegStep(sLon);
    const dp = (s: number) => (s < 0.1 ? 2 : s < 1 ? 1 : 0);
    for (let v = Math.ceil((cLat - sLat / 2) / stepLat) * stepLat, k = 0; v <= cLat + sLat / 2 && k < 8; v += stepLat, k++) {
      const y = yOf(v);
      if (y > 0.04 && y < 0.96) grat.push({ o: "lat", at: y, label: `${Math.abs(v).toFixed(dp(stepLat))}°${v >= 0 ? "N" : "S"}` });
    }
    for (let v = Math.ceil((cLon - sLon / 2) / stepLon) * stepLon, k = 0; v <= cLon + sLon / 2 && k < 8; v += stepLon, k++) {
      const x = xOf(v);
      if (x > 0.04 && x < 0.96) grat.push({ o: "lon", at: x, label: `${Math.abs(v).toFixed(dp(stepLon))}°${v >= 0 ? "E" : "W"}` });
    }
    const winWm = sLon * 111320 * (Math.cos((cLat * Math.PI) / 180) || 1);
    const barM = niceMetres(winWm / 4);
    scaleFrac = Math.max(0.05, Math.min(0.34, barM / winWm));
    scaleLabel = barM >= 1000 ? `${barM % 1000 ? (barM / 1000).toFixed(1) : barM / 1000} km` : `${Math.round(barM)} m`;
  }
  // GPS-lock readout: scrambles, then settles on the true coordinates
  const fmtCoord = (real: number, hemis: [string, string], settle: number, salt: number) => {
    const jitter = noise2D(`co${seed}_${salt}`, frame * 0.4, salt) * 0.06;
    const v = real + (1 - settle) * jitter;
    return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? hemis[0] : hemis[1]}`;
  };

  const px = pinX * width;
  const py = pinY * height;
  const radarR = Math.min(width, height) * 0.42;
  const sweepDeg = interpolate(frame, [tPin, tPin + Math.min(dur - tPin, 120)], [-90, 270], { extrapolateRight: "clamp" });
  const isWater = (geo?.kind ?? "city") === "waterway";

  return (
    <AbsoluteFill style={{ overflow: "hidden", background: `radial-gradient(125% 100% at ${pinX * 100}% ${pinY * 100}%, #16242f 0%, #0d1820 52%, #070d12 100%)` }}>
      {/* deep land texture — faint topographic dot field */}
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(120,150,170,0.06) 1px, transparent 1.6px)", backgroundSize: "13px 13px", opacity: introWipe }} />

      {/* ---------- WATER + WATERWAYS (deepest parallax) ---------- */}
      <AbsoluteFill style={layer(0.55)}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <linearGradient id={`wf${seed}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#21536f" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#0f2f44" stopOpacity="0.62" />
            </linearGradient>
          </defs>
          {water.map((w, i) => {
            const op = interpolate(frame, [tWater + i * 0.6, tWater + i * 0.6 + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            if (op <= 0) return null;
            return <polygon key={i} points={toPoly(w)} fill={`url(#wf${seed})`} stroke="#5aa6c8" strokeWidth={1} strokeOpacity={0.5} opacity={op} />;
          })}
          {waterways.map((w, i) => {
            const L = segLen(w);
            const prog = interpolate(frame, [tWater + 4 + i * 0.8, tWater + 4 + i * 0.8 + 20], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            if (prog <= 0) return null;
            return <path key={i} d={toPath(w)} fill="none" stroke="#5aa6c8" strokeWidth={2} strokeOpacity={0.55} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - prog)} />;
          })}
        </svg>
      </AbsoluteFill>

      {/* ---------- GRATICULE (mid parallax) ---------- */}
      <AbsoluteFill style={layer(0.7)}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: interpolate(frame, [tGrid, tGrid + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          {grat.map((g, i) =>
            g.o === "lat" ? (
              <line key={i} x1={0} y1={Y(g.at)} x2={width} y2={Y(g.at)} stroke={accent} strokeWidth={1} strokeOpacity={0.14} strokeDasharray="2 10" />
            ) : (
              <line key={i} x1={X(g.at)} y1={0} x2={X(g.at)} y2={height} stroke={accent} strokeWidth={1} strokeOpacity={0.14} strokeDasharray="2 10" />
            ),
          )}
        </svg>
      </AbsoluteFill>

      {/* ---------- ROADS + SUBJECT (front parallax) ---------- */}
      <AbsoluteFill style={layer(0.85)}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          {/* roads draw on — quiet, the route is the hero */}
          {streets.map((s, i) => {
            const L = segLen(s.p);
            const d = tGrid + 4 + i * 0.7;
            const prog = interpolate(frame, [d, d + 20], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            if (prog <= 0) return null;
            return (
              <path key={i} d={toPath(s.p)} fill="none" stroke={s.m ? accent : "#9fb0bd"} strokeWidth={s.m ? 2.4 : 1.2} strokeOpacity={s.m ? 0.65 : 0.34} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - prog)} />
            );
          })}
          {/* subject AREA outline (country / lake / city) */}
          {area.map((a, i) => {
            const L = segLen(a);
            const prog = interpolate(frame, [tRoute, tRoute + 32], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const fillOp = interpolate(frame, [tRoute + 20, tRoute + 44], [0, 0.14], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            if (prog <= 0) return null;
            return (
              <g key={i}>
                <polygon points={toPoly(a)} fill={accent} opacity={fillOp} />
                <path d={`${toPath(a)} Z`} fill="none" stroke={accent} strokeWidth={3} strokeOpacity={0.95} strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - prog)} style={{ filter: `drop-shadow(0 0 7px ${accent}cc)` }} />
              </g>
            );
          })}
          {/* subject ROUTE — the hero channel traced as ONE continuous stroke,
              segments drawn sequentially north→south, only the true endpoints marked */}
          {(() => {
            if (!route.length) return null;
            const ordered = route.map((rl) => ({ rl, midY: rl.reduce((a, p) => a + p[1], 0) / rl.length, len: segLen(rl) })).sort((a, b) => a.midY - b.midY);
            const totalLen = ordered.reduce((a, s) => a + s.len, 0) || 1;
            const drawSpan = Math.min(48, dur - tRoute - 6);
            // global endpoints: northernmost (min y) + southernmost (max y) point across all segments
            const allPts = route.flat();
            const north = allPts.reduce((a, p) => (p[1] < a[1] ? p : a), allPts[0]);
            const south = allPts.reduce((a, p) => (p[1] > a[1] ? p : a), allPts[0]);
            let acc = 0;
            const seg = ordered.map((s) => {
              const start = tRoute + (acc / totalLen) * drawSpan;
              const end = tRoute + ((acc + s.len) / totalLen) * drawSpan + 2;
              acc += s.len;
              return { ...s, start, end };
            });
            return (
              <g>
                {seg.map((s, i) => {
                  const prog = interpolate(frame, [s.start, s.end], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                  if (prog <= 0) return null;
                  const d = toPath(s.rl);
                  return (
                    <g key={i}>
                      <path d={d} fill="none" stroke={accent} strokeWidth={11} strokeOpacity={0.18} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.len} strokeDashoffset={s.len * (1 - prog)} style={{ filter: `blur(4px)` }} />
                      <path d={d} fill="none" stroke={accent} strokeWidth={4.2} strokeOpacity={0.98} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.len} strokeDashoffset={s.len * (1 - prog)} style={{ filter: `drop-shadow(0 0 6px ${accent})` }} />
                      <path d={d} fill="none" stroke="#ffffff" strokeWidth={1.3} strokeOpacity={0.85} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.len} strokeDashoffset={s.len * (1 - prog)} />
                    </g>
                  );
                })}
                {north && frame > tRoute + 2 ? <circle cx={X(north[0])} cy={Y(north[1])} r={6} fill={t.base} stroke={accent} strokeWidth={2.5} /> : null}
                {south && frame > tRoute + drawSpan * 0.85 ? <circle cx={X(south[0])} cy={Y(south[1])} r={6} fill={t.base} stroke={accent} strokeWidth={2.5} /> : null}
              </g>
            );
          })()}
        </svg>
      </AbsoluteFill>

      {/* ---------- RADAR SWEEP + PIN (tracks the location) ---------- */}
      <AbsoluteFill style={layer(1)}>
        <div style={{ position: "absolute", left: px, top: py, width: 0, height: 0 }}>
          {/* radar wedge */}
          {frame > tPin ? (
            <div
              style={{
                position: "absolute",
                left: -radarR,
                top: -radarR,
                width: radarR * 2,
                height: radarR * 2,
                borderRadius: "50%",
                background: `conic-gradient(from ${sweepDeg.toFixed(1)}deg, ${accent}00 0deg, ${accent}26 26deg, ${accent}00 56deg)`,
                WebkitMaskImage: "radial-gradient(circle, #000 0%, #000 62%, transparent 100%)",
                maskImage: "radial-gradient(circle, #000 0%, #000 62%, transparent 100%)",
                opacity: lock * 0.9,
              }}
            />
          ) : null}
          {/* expanding pulse rings */}
          {[0, 1, 2].map((k) => {
            const t0 = tPin + 4 + k * 16;
            const ring = ((frame - t0) % 52) / 52;
            const show = frame > t0 && ring >= 0;
            const sz = interpolate(ring, [0, 1], [0, width * 0.18]);
            return show ? (
              <div key={k} style={{ position: "absolute", left: -sz / 2, top: -sz / 2, width: sz, height: sz, borderRadius: "50%", border: `1.5px solid ${accent}`, opacity: (1 - ring) * 0.5 }} />
            ) : null;
          })}
          {/* crosshair + core */}
          {(["h", "v"] as const).map((o) => (
            <div
              key={o}
              style={{
                position: "absolute",
                left: o === "h" ? -18 : -1,
                top: o === "h" ? -1 : -18,
                width: o === "h" ? 36 : 2,
                height: o === "h" ? 2 : 36,
                background: accent,
                opacity: lock * 0.8,
              }}
            />
          ))}
          <div
            style={{
              position: "absolute",
              left: -width * 0.011,
              top: -width * 0.011,
              width: width * 0.022,
              height: width * 0.022,
              borderRadius: "50%",
              background: accent,
              transform: `scale(${spring({ frame: frame - tPin, fps, config: { damping: 11, stiffness: 95 } })})`,
              boxShadow: `0 0 ${width * 0.024}px ${accent}, 0 0 ${width * 0.05}px ${accent}88`,
            }}
          />
          {/* GPS-lock coordinate chip */}
          {center ? (
            <div
              style={{
                position: "absolute",
                left: width * 0.02,
                top: -height * 0.02,
                opacity: interpolate(frame, [tPin + 2, tPin + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                fontFamily: t.fontLabel,
                fontSize: Math.round(width * 0.0125),
                letterSpacing: "0.18em",
                color: accent,
                background: "rgba(7,13,18,0.72)",
                border: `1px solid ${accent}66`,
                borderRadius: 3,
                padding: "5px 9px",
                whiteSpace: "nowrap",
                lineHeight: 1.5,
              }}
            >
              <div>{fmtCoord(center[0], ["N", "S"], lock, 1)}</div>
              <div>{fmtCoord(center[1], ["E", "W"], lock, 2)}</div>
            </div>
          ) : null}
        </div>
      </AbsoluteFill>

      {/* horizontal scan line during establish (data-load feel) */}
      {frame < 30 ? (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: `${interpolate(frame, [0, 26], [0, 100], { extrapolateRight: "clamp" })}%`, height: 2, background: `linear-gradient(90deg, transparent, ${accent}aa, transparent)`, opacity: interpolate(frame, [22, 30], [0.7, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} />
        </AbsoluteFill>
      ) : null}

      {/* ---------- HUD: graticule labels, compass, scale bar (fixed) ---------- */}
      <AbsoluteFill style={{ pointerEvents: "none", opacity: interpolate(frame, [tGrid + 4, tGrid + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        {grat.map((g, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              ...(g.o === "lat"
                ? { left: width * 0.014, top: Y(g.at) - 7 }
                : { left: X(g.at) - 22, top: height * 0.018 }),
              fontFamily: t.fontLabel,
              fontSize: Math.round(width * 0.0092),
              letterSpacing: "0.14em",
              color: `${accent}`,
              opacity: 0.66,
              textShadow: "0 1px 3px rgba(0,0,0,0.9)",
            }}
          >
            {g.label}
          </div>
        ))}
        {/* compass rose */}
        <div style={{ position: "absolute", right: width * 0.035, top: height * 0.06, width: width * 0.05, height: width * 0.05 }}>
          <svg width="100%" height="100%" viewBox="-56 -62 112 124">
            <circle r="44" fill="rgba(7,13,18,0.45)" stroke={`${accent}55`} strokeWidth="1.5" />
            <polygon points="0,-38 7,4 0,-6 -7,4" fill={accent} />
            <polygon points="0,38 7,-4 0,6 -7,-4" fill={`${accent}55`} />
            <text x="0" y="-48" fill={accent} fontSize="13" textAnchor="middle" fontFamily={t.fontLabel} style={{ letterSpacing: "0.1em" }}>N</text>
          </svg>
        </div>
        {/* scale bar */}
        {scaleLabel ? (
          <div style={{ position: "absolute", left: width * 0.035, bottom: height * 0.07 }}>
            <div style={{ width: scaleFrac * width, height: 9, borderTop: `3px solid ${accent}`, borderLeft: `2px solid ${accent}`, borderRight: `2px solid ${accent}`, opacity: 0.85 }} />
            <div style={{ fontFamily: t.fontLabel, fontSize: Math.round(width * 0.01), letterSpacing: "0.16em", color: accent, marginTop: 5, textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>{scaleLabel}</div>
          </div>
        ) : null}
      </AbsoluteFill>

      {/* location title */}
      {(shot.circleLabel || geo?.label) ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: height * 0.11, pointerEvents: "none" }}>
          <div style={{ opacity: labelOp, transform: `translateY(${interpolate(labelOp, [0, 1], [16, 0])}px)`, textAlign: "center" }}>
            <div style={{ fontFamily: t.fontLabel, fontWeight: 600, fontSize: Math.round(width * 0.015), letterSpacing: "0.5em", textTransform: "uppercase", color: accent, marginBottom: 8 }}>
              {isWater ? "◉ WATERWAY" : "◉ LOCATION"}
            </div>
            <div style={{ fontFamily: t.fontDisplay, fontWeight: 700, fontSize: Math.round(width * 0.056), letterSpacing: "0.04em", textTransform: "uppercase", color: t.paper, WebkitTextStroke: `1.5px rgba(8,6,4,0.6)`, textShadow: `0 2px 18px rgba(0,0,0,0.85), 0 0 30px ${accent}55` }}>
              {shot.circleLabel || geo?.label}
            </div>
          </div>
        </AbsoluteFill>
      ) : null}

      {/* film grade: vignette + grain to match the documentary plates */}
      <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(125% 100% at 50% 45%, transparent 52%, rgba(0,0,0,0.55) 100%)" }} />
      <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.05 + (t.grain ?? 0.06) * 0.5, backgroundImage: "radial-gradient(rgba(255,255,255,0.5) 0.5px, transparent 0.5px)", backgroundSize: "3px 3px", mixBlendMode: "overlay", transform: `translate(${(noise2D(`gn${seed}`, frame * 0.7, 0) * 4).toFixed(1)}px, ${(noise2D(`gn${seed}`, 0, frame * 0.7) * 4).toFixed(1)}px)` }} />
      <LabelRail shot={shot} baseDelay={26} />
    </AbsoluteFill>
  );
};

const MapZoomShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = useTheme();
  const dur = shot.durationInFrames;
  const cam = useCam(shot.camera ?? { move: "push_in", intensity: "medium" }, dur, seed);
  const ring = spring({ frame: frame - 8, fps, config: { damping: 13, stiffness: 90 } });
  const accent = shot.accent ?? t.accent2;
  const size = Math.round(height * 0.58);
  return (
    <AbsoluteFill>
      <ShotBg src={shot.bg} cam={cam} dark={0.2} />
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(12,10,6,0.4) 1.1px, transparent 1.9px)", backgroundSize: "9px 9px", opacity: 0.4 }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            border: `${Math.max(5, Math.round(width * 0.0055))}px solid ${accent}`,
            background: "rgba(120,160,140,0.12)",
            boxShadow: `0 0 ${Math.round(width * 0.045)}px ${accent}77, inset 0 0 ${Math.round(width * 0.032)}px ${accent}55`,
            transform: `scale(${ring})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {shot.circleLabel ? (
            <div
              style={{
                fontFamily: t.fontDisplay,
                fontWeight: 700,
                fontSize: Math.round(size * 0.22),
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: t.paper,
                WebkitTextStroke: `${Math.max(1.5, size * 0.005)}px rgba(14,11,7,0.85)`,
                textShadow: "0.05em 0.06em 0 rgba(10,8,5,0.9), 0 0 0.6em rgba(0,0,0,0.55)",
                opacity: interpolate(frame, [13, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              }}
            >
              {shot.circleLabel}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
      <LabelRail shot={shot} baseDelay={22} />
    </AbsoluteFill>
  );
};

const PhotoSlideShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const dur = shot.durationInFrames;
  const cam = useCam(shot.camera ?? { move: "drift", intensity: "subtle" }, dur, seed);
  const photos = shot.images ?? [];
  const slots = [
    { left: 0.045, top: 0.13, w: 0.33, rot: -5 },
    { left: 0.36, top: 0.07, w: 0.31, rot: 3.4 },
    { left: 0.66, top: 0.17, w: 0.3, rot: -2.2 },
  ];
  return (
    <AbsoluteFill>
      <ShotBg src={shot.bg} cam={cam} dark={0.46} recede />
      {photos.slice(0, 3).map((src, i) => {
        const slot = slots[i % slots.length];
        const enter = spring({ frame: frame - i * 12, fps, config: { damping: 15, stiffness: 92 } });
        const fromX = (i % 2 === 0 ? -1.3 : 1.3) * width;
        const x = interpolate(enter, [0, 1], [fromX, 0]);
        return (
          <div key={i} style={{ position: "absolute", left: width * slot.left, top: height * slot.top, transform: `translateX(${x}px) ${camTransform(cam, 1.22)}` }}>
            <TapedPhoto src={src} width={width * slot.w} rotate={slot.rot} />
          </div>
        );
      })}
      <LabelRail shot={shot} baseDelay={photos.length * 12 + 10} />
    </AbsoluteFill>
  );
};

const MatteSequenceShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = useTheme();
  const dur = shot.durationInFrames;
  const cam = useCam(shot.camera ?? { move: "drift", intensity: "subtle" }, dur, seed);
  const images = shot.images ?? [];
  const n = Math.max(1, images.length);
  const per = Math.floor(dur / n);
  const WIPE = 16;
  const teeth = (i: number) => {
    const rnd = mulberry32(seed * 31 + i * 7 + 11);
    return Array.from({ length: 9 }, () => (rnd() - 0.5) * 14);
  };
  return (
    <AbsoluteFill style={{ backgroundColor: t.base }}>
      {images.map((src, i) => {
        const start = i * per;
        if (frame < start) return null;
        const local = frame - start;
        const lin = i === 0 ? 1 : clamp01(local / WIPE);
        const p = lin * lin * (3 - 2 * lin);
        const tt = teeth(i);
        const edge = -12 + p * 130;
        const dirDown = i % 2 === 1;
        const pts = dirDown
          ? [`0% ${edge + tt[0]}%`, `14% ${edge + tt[1]}%`, `28% ${edge + tt[2]}%`, `42% ${edge + tt[3]}%`, `56% ${edge + tt[4]}%`, `70% ${edge + tt[5]}%`, `84% ${edge + tt[6]}%`, `100% ${edge + tt[7]}%`, "100% -20%", "0% -20%"]
          : [`${edge + tt[0]}% 0%`, `${edge + tt[1]}% 14%`, `${edge + tt[2]}% 28%`, `${edge + tt[3]}% 42%`, `${edge + tt[4]}% 56%`, `${edge + tt[5]}% 70%`, `${edge + tt[6]}% 84%`, `${edge + tt[7]}% 100%`, "-20% 100%", "-20% 0%"];
        const settle = interpolate(local, [0, WIPE + 6], [1.07, 1.0], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const zoom = interpolate(local, [0, per + WIPE], [1.05, 1.13]);
        const rim = 1.8;
        const rimPts = dirDown
          ? pts.map((pt, k) => (k < 8 ? `${pt.split(" ")[0]} ${parseFloat(pt.split(" ")[1]) + rim}%` : pt))
          : pts.map((pt, k) => (k < 8 ? `${parseFloat(pt.split(" ")[0]) + rim}% ${pt.split(" ")[1]}` : pt));
        return (
          <React.Fragment key={i}>
            {p > 0 && p < 1 ? <AbsoluteFill style={{ clipPath: `polygon(${rimPts.join(", ")})`, backgroundColor: "rgba(236,226,204,0.9)" }} /> : null}
            <AbsoluteFill style={{ clipPath: p >= 1 ? undefined : `polygon(${pts.join(", ")})` }}>
              <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${(zoom * settle).toFixed(4)}) translate(${cam.x.toFixed(1)}px, ${cam.y.toFixed(1)}px)`, filter: t.plateFilter }} />
            </AbsoluteFill>
          </React.Fragment>
        );
      })}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(10,8,5,0.18) 0%, rgba(10,8,5,0) 40%, rgba(10,8,5,0.3) 100%)" }} />
      <LabelRail shot={{ ...shot, labelPos: shot.labelPos ?? "bottom_left" }} baseDelay={10} />
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
  const dir = shot.camera?.move === "pan_left" ? -1 : 1;
  const p = interpolate(frame, [0, dur], [0, 1], { easing: Easing.inOut(Easing.quad), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const panX = dir > 0 ? -p * (boardW - width) : -(boardW - width) * (1 - p);
  const panY = -p * (boardH - height) * 0.75;
  const nx = noise2D(`cpx${seed}`, frame * 0.014, 0) * width * 0.003;
  const ny = noise2D(`cpy${seed}`, frame * 0.012, 3) * height * 0.003;
  return (
    <AbsoluteFill style={{ backgroundColor: "#2a241c", overflow: "hidden" }}>
      <div style={{ position: "absolute", width: boardW, height: boardH, transform: `translate(${(panX + nx).toFixed(1)}px, ${(panY + ny).toFixed(1)}px)` }}>
        {shot.bg ? <Img src={shot.bg} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", filter: "sepia(0.4) brightness(0.72)" }} /> : null}
        <div style={{ position: "absolute", width: "100%", height: "100%", backgroundImage: `url("${paperUri(3)}")`, opacity: 0.5 }} />
        {photos.map((src, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const cellW = boardW / cols;
          const jx = (rnd() - 0.5) * cellW * 0.18;
          const jy = (rnd() - 0.5) * boardH * 0.05;
          const rot = (rnd() - 0.5) * 10;
          return (
            <div key={i} style={{ position: "absolute", left: col * cellW + cellW * 0.09 + jx, top: row * (boardH / 2) + boardH * 0.06 + jy }}>
              <TapedPhoto src={src} width={cellW * 0.8} rotate={rot} sepia={0.45} />
            </div>
          );
        })}
      </div>
      <LabelRail shot={{ ...shot, labelPos: shot.labelPos ?? "bottom_left" }} baseDelay={16} />
    </AbsoluteFill>
  );
};

/* ----------------------------------------------------- EVIDENCE BOARD --- */

const ObjectDropShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const dur = shot.durationInFrames;
  const cam = useCam(shot.camera ?? { move: "push_in", intensity: "medium" }, dur, seed);
  const t = useTheme();
  const cutouts = shot.cutouts ?? [];
  const boost = shot.titleBoost ?? 1;
  const slots = [
    { left: 0.07, top: 0.03, w: 0.21, rot: -9 },
    { left: 0.72, top: 0.01, w: 0.23, rot: 7 },
    { left: 0.42, top: 0.0, w: 0.18, rot: -4 },
  ];
  const title = shot.title ?? "";
  const titleSize = Math.min(width * 0.105 * boost, (width * 0.9) / Math.max(6, title.length * t.displayCharW));
  return (
    <AbsoluteFill>
      <ShotBg src={shot.bg} cam={cam} />
      {shot.fg ? (
        <Img
          src={shot.fg}
          style={{ position: "absolute", left: "-1%", bottom: "-6%", height: "104%", maxWidth: "42%", objectFit: "contain", objectPosition: "left bottom", transform: camTransform(cam, 1.4), transformOrigin: "bottom left", filter: cutoutFilter }}
        />
      ) : null}
      {cutouts.slice(0, 3).map((src, i) => {
        const slot = slots[i % slots.length];
        const drop = spring({ frame: frame - 8 - i * 9, fps, config: { damping: 11, stiffness: 68 } });
        const yPos = interpolate(drop, [0, 1], [-height * 0.7, 0]);
        const sway = drop >= 0.99 ? Math.sin((frame - 8 - i * 9) * 0.09 + i) * 1.4 : 0;
        const rot = interpolate(drop, [0, 1], [slot.rot * 3, slot.rot]) + sway;
        return (
          <Img key={i} src={src} style={{ position: "absolute", left: width * slot.left, top: height * slot.top, width: width * slot.w, transform: `translateY(${yPos}px) rotate(${rot}deg) ${camTransform(cam, 1.25)}`, filter: cutoutFilter }} />
        );
      })}
      {title ? (
        <>
          <TextScrim cx={50} cy={78} w={80} h={40} opacity={0.5 * boost} />
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: height * 0.1 }}>
            <div style={{ transform: camTransform(cam, 1.12), whiteSpace: "nowrap" }}>
              <KineticTitle text={title} kicker={shot.kicker} delay={12} align="center" size={Math.round(titleSize)} />
            </div>
          </AbsoluteFill>
        </>
      ) : null}
      <LabelRail shot={shot} baseDelay={20} />
    </AbsoluteFill>
  );
};

/**
 * EVIDENCE BOARD — the investigation showpiece. Photographs pinned to a cork
 * board larger than the frame, connected by taut red string, while the camera
 * prowls from clue to clue and pushes in on the key node. Index-card labels
 * pin near nodes.
 */
const EvidenceBoardShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = useTheme();
  const dur = shot.durationInFrames;
  const photos = (shot.images ?? []).slice(0, 6);
  const n = Math.max(1, photos.length);
  const rnd = mulberry32(seed * 131 + 17);

  const boardW = width * 1.85;
  const boardH = height * 1.7;

  // Scatter nodes on a loose grid across the board (board fractions 0-1).
  const cols = n <= 3 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / cols);
  const nodes = photos.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const fx = (col + 0.5) / cols + (rnd() - 0.5) * 0.12;
    const fy = (row + 0.5) / rows + (rnd() - 0.5) * 0.14;
    const w = boardW * (0.2 + rnd() * 0.04);
    const rot = (rnd() - 0.5) * 9;
    return { fx: clamp01(fx), fy: clamp01(fy), w, rot, cx: 0, cy: 0 };
  });
  // pin point (top centre of each photo, board px)
  for (const node of nodes) {
    node.cx = node.fx * boardW;
    node.cy = node.fy * boardH;
  }

  // Threads: explicit, else chain consecutive + one cross-link.
  const threads = shot.threads?.length
    ? shot.threads
    : [
        ...nodes.slice(1).map((_, i) => ({ from: i, to: i + 1 })),
        ...(n >= 4 ? [{ from: 0, to: n - 1 }] : []),
      ];

  // Camera path: open WIDE, then visit a FEW clues — but HOLD on each one long
  // enough to read its index card before moving on (prowl, don't strobe).
  const fitZoom = width / boardW; // shows full board width
  const visit = nodes.slice(0, Math.min(3, n));
  const stops = [
    { x: boardW / 2, y: boardH / 2, z: fitZoom * 1.02 },
    ...visit.map((node) => ({ x: node.cx, y: node.cy + node.w * 0.18, z: 1.06 })),
    { x: boardW / 2, y: boardH / 2, z: fitZoom * 1.04 },
  ];
  // Build a hold/travel timeline. Holds are weighted heavier than travels so
  // the camera lingers on each clue. Easing only applies to travel phases.
  const HOLD_W = 2.0;
  const TRAVEL_W = 1.1;
  const phases: { a: (typeof stops)[number]; b: (typeof stops)[number]; hold: boolean; w: number }[] = [];
  for (let i = 0; i < stops.length; i++) {
    phases.push({ a: stops[i], b: stops[i], hold: true, w: HOLD_W });
    if (i < stops.length - 1) phases.push({ a: stops[i], b: stops[i + 1], hold: false, w: TRAVEL_W });
  }
  const totalW = phases.reduce((s, p) => s + p.w, 0);
  let cursor = 0;
  let camX = stops[0].x;
  let camY = stops[0].y;
  let camZ = stops[0].z;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const segLen = (p.w / totalW) * dur;
    if (frame < cursor + segLen || i === phases.length - 1) {
      const lp = clamp01((frame - cursor) / segLen);
      const e = p.hold ? 0 : Easing.inOut(Easing.cubic)(lp);
      camX = p.a.x + (p.b.x - p.a.x) * e;
      camY = p.a.y + (p.b.y - p.a.y) * e;
      camZ = p.a.z + (p.b.z - p.a.z) * e;
      break;
    }
    cursor += segLen;
  }
  const nx = noise2D(`ebx${seed}`, frame * 0.013, 0) * width * 0.004;
  const ny = noise2D(`eby${seed}`, frame * 0.011, 5) * height * 0.004;
  const tx = width / 2 - camX * camZ + nx;
  const ty = height / 2 - camY * camZ + ny;

  const threadOpacity = interpolate(frame, [6, 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#1a1206", overflow: "hidden" }}>
      <div style={{ position: "absolute", width: boardW, height: boardH, transformOrigin: "0 0", transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${camZ.toFixed(4)})` }}>
        {/* cork */}
        {shot.bg ? (
          <Img src={shot.bg} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", filter: "saturate(0.7) brightness(0.6)" }} />
        ) : (
          <AbsoluteFill style={{ backgroundImage: `url("${corkUri(seed)}")`, backgroundSize: "520px 520px" }} />
        )}
        <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.5) 100%)" }} />

        {/* red string */}
        <svg width={boardW} height={boardH} style={{ position: "absolute", left: 0, top: 0, opacity: threadOpacity }}>
          {threads.map((th, i) => {
            const A = nodes[th.from];
            const B = nodes[th.to];
            if (!A || !B) return null;
            const mx = (A.cx + B.cx) / 2 + (rnd() - 0.5) * 40;
            const my = (A.cy + B.cy) / 2 + Math.abs(B.cx - A.cx) * 0.06 + 30;
            return (
              <path
                key={i}
                d={`M ${A.cx} ${A.cy} Q ${mx} ${my} ${B.cx} ${B.cy}`}
                stroke={shot.accent ?? t.accent}
                strokeWidth={Math.max(3, boardW * 0.0024)}
                fill="none"
                strokeLinecap="round"
                style={{ filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.55))" }}
              />
            );
          })}
        </svg>

        {/* pinned photos + index cards + pushpins */}
        {nodes.map((node, i) => {
          const enter = spring({ frame: frame - 4 - i * 5, fps: 30, config: { damping: 16, stiffness: 110 } });
          const card = shot.labels?.[i];
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: node.cx,
                top: node.cy,
                width: node.w,
                transform: `translate(-50%, -50%) rotate(${node.rot}deg) scale(${interpolate(enter, [0, 1], [0.8, 1])})`,
                opacity: enter,
              }}
            >
              <div style={{ position: "relative", padding: node.w * 0.04, paddingBottom: node.w * 0.13, background: "#efe6d0", boxShadow: "0 18px 40px rgba(0,0,0,0.6), 0 4px 10px rgba(0,0,0,0.5)" }}>
                <Img src={photos[i]} style={{ width: "100%", display: "block", filter: "saturate(0.78) contrast(1.1) brightness(0.95)" }} />
              </div>
              {/* pushpin */}
              <div style={{ position: "absolute", top: -node.w * 0.05, left: "50%", width: node.w * 0.1, height: node.w * 0.1, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, #ff6a6a, ${shot.accent ?? t.accent} 70%)`, transform: "translateX(-50%)", boxShadow: "0 4px 6px rgba(0,0,0,0.6)" }} />
              {card ? (
                <div
                  style={{
                    position: "absolute",
                    top: "104%",
                    left: "50%",
                    transform: "translateX(-50%) rotate(-2deg)",
                    background: "#f3ecd8",
                    color: "#1c1813",
                    fontFamily: t.fontLabel,
                    fontSize: node.w * 0.085,
                    letterSpacing: "0.02em",
                    padding: `${node.w * 0.03}px ${node.w * 0.06}px`,
                    whiteSpace: "nowrap",
                    boxShadow: "0 8px 18px rgba(0,0,0,0.5)",
                  }}
                >
                  {card.text}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* fixed title overlay at TOP — clear of the board's bottom index cards */}
      {shot.title ? (
        <>
          <TextScrim cx={50} cy={14} w={82} h={34} opacity={0.52} />
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: height * 0.06 }}>
            <KineticTitle text={shot.title} kicker={shot.kicker} align="center" size={Math.round(width * 0.07)} />
          </AbsoluteFill>
        </>
      ) : null}
    </AbsoluteFill>
  );
};

const QuoteCardShot: React.FC<{ shot: DocuShotSpec; seed: number }> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = useTheme();
  const dur = shot.durationInFrames;
  const cam = useCam(shot.camera ?? { move: "drift", intensity: "subtle" }, dur, seed);
  const words = (shot.quote ?? "").split(/\s+/).filter(Boolean);
  const fadeOut = interpolate(frame, [dur - 18, dur - 2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // BANANA-DESIGNED end card: a bespoke typographic image, slow push + fade.
  if (shot.typeImage) {
    const zoom = interpolate(frame, [0, dur], [1.04, 1.12], { easing: Easing.inOut(Easing.cubic), extrapolateRight: "clamp" });
    const fin = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <AbsoluteFill style={{ backgroundColor: t.base }}>
        <Img src={shot.typeImage} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom.toFixed(4)})`, opacity: fin }} />
        <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(6,6,4,0.5) 100%)" }} />
        <AbsoluteFill style={{ backgroundColor: "#000", opacity: fadeOut }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: t.base }}>
      {shot.bg ? (
        <Img src={shot.bg} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.5, transform: camTransform(cam, 1.04), filter: `${t.plateFilter} brightness(0.92)` }} />
      ) : (
        <AbsoluteFill style={{ backgroundImage: `url("${paperUri(9)}")`, opacity: 0.35 }} />
      )}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start" }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: Math.round(height * 0.62), lineHeight: 1, color: "rgba(247,241,226,0.09)", marginTop: -height * 0.06, opacity: interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          &ldquo;
        </div>
      </AbsoluteFill>
      <TextScrim cx={50} cy={50} w={74} h={56} opacity={0.55} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: `0 ${width * 0.11}px`, transform: camTransform(cam, 1.06) }}>
        {/* dark panel so the quote reads on ANY plate */}
        <div
          style={{
            fontFamily: t.fontHand,
            fontWeight: 700,
            fontSize: Math.round(width * 0.058),
            lineHeight: 1.3,
            color: t.paper,
            textAlign: "center",
            padding: `${height * 0.05}px ${width * 0.05}px`,
            background: "rgba(8,7,5,0.5)",
            borderRadius: width * 0.02,
            boxShadow: "0 0 0 1px rgba(247,241,226,0.08), 0 20px 60px rgba(0,0,0,0.6)",
            WebkitTextStroke: "0.6px rgba(8,6,4,0.55)",
            textShadow: "0 4px 26px rgba(0,0,0,0.98), 0 2px 6px rgba(0,0,0,0.9)",
          }}
        >
          {words.map((w, i) => (
            <span key={i} style={{ color: i >= words.length - 2 ? (shot.accent ?? t.accent) : t.paper, opacity: interpolate(frame, [6 + i * 2, 12 + i * 2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
              {w}{" "}
            </span>
          ))}
        </div>
        <div style={{ width: interpolate(frame, [10 + words.length * 2, 26 + words.length * 2], [0, width * 0.16], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), height: 3, marginTop: height * 0.035, backgroundColor: shot.accent ?? t.accent, opacity: 0.85 }} />
        {shot.attribution ? (
          <div style={{ marginTop: height * 0.035, fontFamily: t.fontLabel, fontWeight: 600, fontSize: Math.round(width * 0.021), letterSpacing: "0.5em", textTransform: "uppercase", color: shot.accent ?? t.accent, textShadow: "0 2px 10px rgba(0,0,0,0.9)", opacity: interpolate(frame, [Math.min(40, dur - 30), Math.min(52, dur - 18)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            {shot.attribution}
          </div>
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: fadeOut }} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- master -- */

const CutIn: React.FC<{ first: boolean; children: React.ReactNode }> = ({ first, children }) => {
  const frame = useCurrentFrame();
  const flash = first ? 0 : interpolate(frame, [0, 3], [0.16, 0], { extrapolateRight: "clamp" });
  return (
    <>
      {children}
      {flash > 0 ? <AbsoluteFill style={{ backgroundColor: "#f4ecd9", opacity: flash, pointerEvents: "none" }} /> : null}
    </>
  );
};

const renderShot = (shot: DocuShotSpec, i: number) => {
  switch (shot.kind) {
    case "parallax_portrait":
      return <ParallaxPortraitShot shot={shot} seed={i + 1} />;
    case "depth_parallax":
      return <DepthParallaxShot shot={shot} seed={i + 1} />;
    case "geo_map":
      return <GeoMapShot shot={shot} seed={i + 1} />;
    case "map_zoom":
      return <MapZoomShot shot={shot} seed={i + 1} />;
    case "photo_slide":
      return <PhotoSlideShot shot={shot} seed={i + 1} />;
    case "matte_sequence":
      return <MatteSequenceShot shot={shot} seed={i + 1} />;
    case "collage_pan":
      return <CollagePanShot shot={shot} seed={i + 1} />;
    case "evidence_board":
      return <EvidenceBoardShot shot={shot} seed={i + 1} />;
    case "object_drop":
      return <ObjectDropShot shot={shot} seed={i + 1} />;
    case "quote_card":
      return <QuoteCardShot shot={shot} seed={i + 1} />;
    default:
      return <AbsoluteFill style={{ backgroundColor: "#171410" }} />;
  }
};

export const DocuMotion: React.FC<DocuMotionProps> = ({ shots, theme }) => {
  const th = theme ?? DEFAULT_THEME;
  return (
    <ThemeCtx.Provider value={th}>
      <AbsoluteFill style={{ backgroundColor: th.base }}>
        <Series>
          {shots.map((s, i) => (
            <Series.Sequence key={i} durationInFrames={Math.max(1, s.durationInFrames)}>
              <CutIn first={i === 0}>{renderShot(s, i)}</CutIn>
            </Series.Sequence>
          ))}
        </Series>
        <Grade />
      </AbsoluteFill>
    </ThemeCtx.Provider>
  );
};
