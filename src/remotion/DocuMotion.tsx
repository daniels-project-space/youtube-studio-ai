import React, { createContext, useContext, useEffect, useState } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Series,
  continueRender,
  delayRender,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { noise2D } from "@remotion/noise";
import { type DocuTheme, type DocuShotKind, getStyle } from "./docuStyles";

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

/* ---------------------------------------------------------------- fonts -- */

const useDocuFonts = (fontCss: string, probe: [string, string, string]) => {
  const [handle] = useState(() => delayRender("documotion fonts"));
  useEffect(() => {
    const id = `docu-fonts-${btoa(fontCss).slice(0, 12)}`;
    if (!document.querySelector(`link[data-docu="${id}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = fontCss;
      link.setAttribute("data-docu", id);
      document.head.appendChild(link);
    }
    const started = Date.now();
    const checks = probe.map((f) => `700 64px "${f}"`);
    const tick = () => {
      const ready = checks.every((c) => document.fonts.check(c));
      if (ready || Date.now() - started > 8000) continueRender(handle);
      else setTimeout(tick, 120);
    };
    checks.forEach((c) => document.fonts.load(c).catch(() => undefined));
    tick();
  }, [handle, fontCss, probe]);
};

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

const cutoutFilter =
  "sepia(0.18) contrast(1.07) brightness(1.02) " +
  "drop-shadow(0 0 1.6px rgba(242,234,214,0.95)) drop-shadow(0 0 1.6px rgba(242,234,214,0.85)) " +
  "drop-shadow(22px 10px 44px rgba(0,0,0,0.65)) drop-shadow(0 4px 10px rgba(0,0,0,0.45))";

/* ----------------------------------------------------------------- shots -- */

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
  // autofit: title must fit between the hero cutout and the right margin.
  // available width ≈ 0.73w; glyph width is font-specific (Anton ≈ 0.52, Oswald ≈ 0.64).
  const titleSize = Math.min(width * 0.115 * boost, (width * 0.73) / Math.max(6, title.length * t.displayCharW));
  return (
    <AbsoluteFill>
      <ShotBg src={shot.bg} cam={cam} recede={Boolean(shot.fg)} />
      {title ? (
        <>
          <TextScrim cx={52} cy={46} w={70} h={42} opacity={0.46 * boost} />
          <AbsoluteFill style={{ justifyContent: "center", paddingLeft: width * 0.23, paddingBottom: height * 0.16 }}>
            <div style={{ whiteSpace: "nowrap", transform: camTransform(cam, 1.18), transformOrigin: "center" }}>
              <KineticTitle text={title} kicker={shot.kicker} size={Math.round(titleSize)} />
            </div>
          </AbsoluteFill>
        </>
      ) : null}
      {shot.fg ? (
        <AbsoluteFill>
          <Img
            src={shot.fg}
            style={{
              position: "absolute",
              left: "-1%",
              bottom: "-6%",
              height: "106%",
              maxWidth: "44%",
              objectFit: "contain",
              objectPosition: "left bottom",
              transform: camTransform(cam, 1.5),
              transformOrigin: "bottom left",
              filter: cutoutFilter,
            }}
          />
        </AbsoluteFill>
      ) : null}
      <LabelRail shot={shot} />
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

  // Camera path: wide → each node (cap 4) → wide. Center node at frame, zoom.
  const fitZoom = width / boardW; // shows full board width
  const visit = nodes.slice(0, Math.min(4, n));
  const stops = [
    { x: boardW / 2, y: boardH / 2, z: fitZoom * 1.02 },
    ...visit.map((node) => ({ x: node.cx, y: node.cy - node.w * 0.12, z: 1.16 })),
    { x: boardW / 2, y: boardH / 2, z: fitZoom * 1.06 },
  ];
  const segs = stops.length - 1;
  const tp = interpolate(frame, [0, dur], [0, segs], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const si = Math.min(segs - 1, Math.floor(tp));
  const local = Easing.inOut(Easing.cubic)(clamp01(tp - si));
  const a = stops[si];
  const b = stops[si + 1];
  const camX = a.x + (b.x - a.x) * local;
  const camY = a.y + (b.y - a.y) * local;
  const camZ = a.z + (b.z - a.z) * local;
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
  return (
    <AbsoluteFill style={{ backgroundColor: t.base }}>
      {shot.bg ? (
        <Img src={shot.bg} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.3, transform: camTransform(cam, 1), filter: `${t.plateFilter} brightness(0.62)` }} />
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

export const DocuMotion: React.FC<DocuMotionProps> = ({ shots, theme, fontCss, fontProbe }) => {
  const th = theme ?? DEFAULT_THEME;
  const arch = getStyle("archival_collage");
  useDocuFonts(fontCss ?? arch.fontCss, fontProbe ?? arch.fontProbe);
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
