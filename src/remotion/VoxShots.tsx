/**
 * VOX EXPLAINER SHOT KIT — the "documentary path" for the Vox-style explainer
 * look (canvas + faint grid, film grain, orange accent system, halftone
 * desaturated cutout characters with an offset marker-stroke, 3-layer parallax,
 * self-drawing data cards, ticking counters, speech bubbles, typewriter titles).
 *
 * Additive to DocuMotion.tsx: these are extra `DocuShotKind`s dispatched by
 * renderShot(). They live in their own file so the shipped composition stays
 * tiny (import + 6 switch cases). They read the channel theme via the SAME
 * ThemeCtx that DocuMotion provides (useTheme is imported from DocuMotion), so a
 * `vox_explainer` DocuStyleDef.theme fully drives the palette/fonts.
 *
 * Motion is local + deterministic (seeded phase, no Math.random at render).
 * Only fonts available at render are Anton / Oswald / Caveat / Special Elite
 * (loaded at the top of DocuMotion.tsx) — Vox uses Special Elite (typewriter
 * titles) + Oswald (callouts/stats) + Caveat (hand notes).
 */
import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Loop,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Trail } from "@remotion/motion-blur";
import { useTheme } from "./DocuMotion";
import type { DocuShotSpec } from "./DocuMotion";

/* --------------------------------------------------------------- types -- */

export type VoxFrom = "left" | "right" | "top" | "bottom" | "none";

/** A halftone cutout character/object that slides into a scene. */
export interface VoxCutout {
  /** Image data-URI (alpha PNG for the halftone/stroke to read the silhouette). */
  src: string;
  from?: VoxFrom;
  /** Centre X as % of frame width. */
  xPct?: number;
  /** Baseline (bottom) Y as % of frame height. Default 100 (sits on floor). */
  yPct?: number;
  /** Height as % of frame height. */
  hPct?: number;
  delay?: number;
  stroke?: boolean;
  halftone?: boolean;
  flip?: boolean;
}

/** A pop-in speech bubble. */
export interface VoxBubble {
  text: string;
  xPct: number;
  yPct: number;
  delay?: number;
  tail?: "left" | "right" | "down" | "none";
  bg?: string;
  color?: string;
  /** The speaker's mouth (% of frame) — the tail aims here. */
  pointXPct?: number;
  pointYPct?: number;
}

export interface VoxChartCallout {
  title: string;
  value: string;
}

/* ---- compositional scene layers (the vox_scene engine) ---- */
export type VoxLayerType =
  | "plate"
  | "character"
  | "video"
  | "water"
  | "fire"
  | "highlight"
  | "underline"
  | "stat"
  | "label"
  | "counter"
  | "chart"
  | "bubble"
  | "typewriter";

export type VoxEnter = "rise" | "slideL" | "slideR" | "slideDown" | "pop" | "fade" | "none";

/** One layer in a vox_scene. Array order = paint order = z (first is back). */
export interface VoxLayer {
  type: VoxLayerType;
  src?: string;
  /** Vertical anchor; x is always a centre unless a *Left/*Right anchor is used. */
  anchor?: "bottom" | "top" | "center" | "bottomLeft" | "bottomRight" | "topLeft" | "topRight";
  xPct?: number;
  yPct?: number;
  wPct?: number;
  hPct?: number;
  enter?: VoxEnter;
  delay?: number;
  idle?: "bob" | "none";
  parallax?: number;
  halftone?: boolean;
  stroke?: boolean;
  flip?: boolean;
  /** video layer: "screen" drops black (fire/smoke over paper). */
  blend?: "screen" | "normal";
  /** wrap the entrance in a motion-blur Trail (snappy). */
  blur?: boolean;
  /** video layer: clip length in frames, for seamless <Loop>. */
  loopFrames?: number;
  text?: string;
  lines?: string[];
  size?: number;
  color?: string;
  from?: number;
  to?: number;
  steps?: (number | string)[];
  prefix?: string;
  suffix?: string;
  sublabel?: string;
  series?: number[];
  seriesPrev?: number[];
  xLabels?: string[];
  yMax?: number;
  callout?: VoxChartCallout;
  chartTitle?: string;
  bubble?: { tail?: "down" | "left" | "right" | "none"; bg?: string; color?: string; pointXPct?: number; pointYPct?: number };
  fireW?: number;
}

/** Structured payload for the Vox shot kinds (carried on DocuShotSpec.vox). */
export interface VoxShotData {
  kicker?: string;
  /* vox_scene — ordered layer stack (paint order = z) + scene options */
  layers?: VoxLayer[];
  push?: number;
  fadeOut?: boolean;
  /* vox_reveal / vox_dialogue */
  anchor?: string;
  anchorHPct?: number;
  midground?: string;
  cutouts?: VoxCutout[];
  /* vox_chart */
  chartTitle?: string;
  series?: number[];
  seriesPrev?: number[];
  xLabels?: string[];
  yMax?: number;
  callout?: VoxChartCallout;
  /* vox_counter */
  counterFrom?: number;
  counterTo?: number;
  counterPrefix?: string;
  counterSuffix?: string;
  counterLabel?: string;
  /* vox_map */
  slideBg?: string;
  stat?: string;
  statLabel?: string;
  statDelay?: number;
  /* vox_dialogue */
  bubbles?: VoxBubble[];
  /* vox_typewriter */
  typeLines?: string[];
  hero?: string;
  heroHPct?: number;
}

type ShotProps = { shot: DocuShotSpec; seed: number };

/* --------------------------------------------------------------- utils -- */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Gentle push-in + seeded sinusoidal drift shared by the layered scenes. */
const useVoxCam = (dur: number, seed: number, amt = 0.05) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, Math.max(1, dur)], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = 1.02 + amt * p;
  const ph = (seed % 7) * 0.9;
  const x = Math.sin(frame * 0.01 + ph) * 6;
  const y = Math.cos(frame * 0.008 + ph) * 5;
  return { scale, x, y };
};

/** Per-layer transform: deeper layers (higher depth) move/scale more → parallax. */
const voxLayer = (cam: { scale: number; x: number; y: number }, depth: number) =>
  `translate(${(cam.x * depth).toFixed(2)}px, ${(cam.y * depth).toFixed(2)}px) scale(${(
    1 +
    (cam.scale - 1) * depth
  ).toFixed(4)})`;

/** Slide displacement (px) for a spring progress p∈[0,1] (0 = off-frame). */
const slideOffset = (from: VoxFrom | undefined, p: number, w: number, h: number) => {
  const d = 1 - clamp(p, 0, 1);
  switch (from) {
    case "left":
      return { x: -w * 0.6 * d, y: 0 };
    case "right":
      return { x: w * 0.6 * d, y: 0 };
    case "top":
      return { x: 0, y: -h * 0.6 * d };
    case "bottom":
      return { x: 0, y: h * 0.6 * d };
    default:
      return { x: 0, y: 0 };
  }
};

/** Faint engineering-grid tile (the constant Vox background texture). */
const gridUri = (cell = 84, stroke = "rgba(40,36,30,0.07)") =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${cell}' height='${cell}'><path d='M${cell} 0 V${cell} M0 ${cell} H${cell}' stroke='${stroke}' stroke-width='1.25' fill='none'/></svg>`,
  )}`;

/* -------------------------------------------------------------- stage -- */

/** The consistent Vox scene frame: canvas + grid + paper sheen + brand tab. */
const VoxStage: React.FC<{ children?: React.ReactNode; accent?: string; grid?: boolean }> = ({
  children,
  accent,
  grid = true,
}) => {
  const t = useTheme();
  const acc = accent ?? t.accent;
  return (
    <AbsoluteFill style={{ backgroundColor: t.base, overflow: "hidden" }}>
      {grid ? (
        <AbsoluteFill
          style={{
            backgroundImage: `url("${gridUri()}")`,
            backgroundRepeat: "repeat",
            backgroundSize: "84px 84px",
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 36%, rgba(255,255,255,0.35), rgba(255,255,255,0) 62%)",
        }}
      />
      {children}
      {/* brand frame — persistent orange bottom bar + corner tab */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: 9, backgroundColor: acc }} />
        <div style={{ position: "absolute", left: 0, bottom: 0, width: 30, height: 34, backgroundColor: acc }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------ halftone -- */

/**
 * A desaturated cutout with a halftone dot shade and an offset accent-coloured
 * silhouette behind it (the "marker stroke" sticker look). The stroke + dots are
 * painted with a CSS mask of the image's own alpha, so they hug the subject.
 */
const Halftone: React.FC<{
  src: string;
  stroke?: boolean;
  halftone?: boolean;
  strokeColor?: string;
  dx?: number;
  dy?: number;
  flip?: boolean;
  style?: React.CSSProperties;
}> = ({ src, stroke = true, halftone = true, strokeColor, dx = 12, dy = 14, flip, style }) => {
  const t = useTheme();
  const sc = strokeColor ?? t.accent2;
  const mask: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    WebkitMaskImage: `url("${src}")`,
    maskImage: `url("${src}")`,
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center bottom",
    maskPosition: "center bottom",
  };
  return (
    <div
      style={{
        position: "absolute",
        ...style,
        transform: `${style?.transform ?? ""}${flip ? " scaleX(-1)" : ""}`,
      }}
    >
      {stroke ? (
        <div style={{ ...mask, backgroundColor: sc, transform: `translate(${dx}px, ${dy}px) scale(1.05)`, transformOrigin: "center bottom" }} />
      ) : null}
      <Img
        src={src}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          objectPosition: "center bottom",
          filter: "grayscale(1) contrast(1.16) brightness(1.03)",
        }}
      />
      {halftone ? (
        <div
          style={{
            ...mask,
            backgroundImage: "radial-gradient(rgba(0,0,0,0.55) 1px, transparent 1.6px)",
            backgroundSize: "4px 4px",
            mixBlendMode: "multiply",
            opacity: 0.6,
          }}
        />
      ) : null}
    </div>
  );
};

/* --------------------------------------------------------- text/number -- */

/** Typewriter reveal + blinking block caret. */
const TypeOn: React.FC<{
  text: string;
  startFrame: number;
  cps?: number;
  caret?: boolean;
  style?: React.CSSProperties;
}> = ({ text, startFrame, cps = 26, caret = true, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = Math.max(0, frame - startFrame);
  const n = Math.min(text.length, Math.floor((elapsed / fps) * cps));
  const done = n >= text.length;
  const blink = Math.floor(frame / 15) % 2 === 0;
  const showCaret = frame >= startFrame && (!done || (caret && blink));
  return (
    <span style={style}>
      {text.slice(0, n)}
      {showCaret ? <span style={{ opacity: 0.85 }}>&#9608;</span> : null}
    </span>
  );
};

/** Number ticking up with easing. */
const Counter: React.FC<{
  from: number;
  to: number;
  startFrame: number;
  dur?: number;
  prefix?: string;
  suffix?: string;
  style?: React.CSSProperties;
}> = ({ from, to, startFrame, dur = 34, prefix = "", suffix = "", style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [startFrame, startFrame + dur], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const val = Math.round(from + (to - from) * p);
  return (
    <span style={style}>
      {prefix}
      {val.toLocaleString("en-US")}
      {suffix}
    </span>
  );
};

const SpeechBubble: React.FC<{ b: VoxBubble }> = ({ b }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const t = useTheme();
  const delay = b.delay ?? 0;
  const pop = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 170 } });
  const opacity = interpolate(frame, [delay, delay + 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bg = b.bg ?? t.paper;
  const color = b.color ?? t.ink;
  const scale = 0.55 + 0.45 * pop;
  // tail aims from the bubble's bottom-centre at the speaker's mouth (pointPct)
  const bx = (b.xPct / 100) * W;
  const by = (b.yPct / 100) * H;
  const mx = ((b.pointXPct ?? b.xPct) / 100) * W;
  const my = ((b.pointYPct ?? b.yPct + 12) / 100) * H;
  const rootY = by + 34 * scale;
  const beta = (Math.atan2(my - rootY, mx - bx) * 180) / Math.PI; // 90 = straight down
  return (
    <>
      <div style={{ position: "absolute", left: bx, top: by, transform: `translate(-50%, -50%) scale(${scale})`, opacity }}>
        <div
          style={{
            backgroundColor: bg,
            color,
            fontFamily: t.fontLabel,
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: "0.02em",
            padding: "16px 26px",
            borderRadius: 18,
            border: `3px solid ${t.ink}`,
            boxShadow: "5px 6px 0 rgba(20,18,14,0.18)",
            whiteSpace: "nowrap",
          }}
        >
          {b.text}
        </div>
      </div>
      {b.tail !== "none" ? (
        <div
          style={{
            position: "absolute",
            left: bx,
            top: rootY,
            width: 0,
            height: 0,
            borderLeft: "13px solid transparent",
            borderRight: "13px solid transparent",
            borderTop: `26px solid ${t.ink}`,
            transformOrigin: "top center",
            transform: `translate(-50%, 0) rotate(${beta - 90}deg) scale(${scale})`,
            opacity,
          }}
        />
      ) : null}
    </>
  );
};

/* --------------------------------------------------------------- shots -- */

/** vox_reveal — grid + rising anchor + halftone cutouts sliding in, 3-layer parallax. */
export const VoxRevealShot: React.FC<ShotProps> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = useTheme();
  const v = shot.vox ?? {};
  const dur = shot.durationInFrames;
  const cam = useVoxCam(dur, seed, 0.05);
  const anchorPop = spring({ frame: frame - 4, fps, config: { damping: 16, stiffness: 90 } });
  const anchorH = ((v.anchorHPct ?? 62) / 100) * height;

  return (
    <VoxStage accent={shot.accent}>
      {v.midground ? (
        <Img
          src={v.midground}
          style={{
            position: "absolute",
            left: "50%",
            top: "42%",
            width: "70%",
            transform: `translate(-50%,-50%) ${voxLayer(cam, 0.5)}`,
            filter: "grayscale(0.15) contrast(1.02)",
            opacity: 0.92,
          }}
        />
      ) : null}

      {(v.cutouts ?? []).map((c, i) => {
        const delay = c.delay ?? 10 + i * 6;
        const p = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 80 } });
        const off = slideOffset(c.from ?? (i % 2 ? "right" : "left"), p, width, height);
        const h = ((c.hPct ?? 52) / 100) * height;
        const w = h * 0.8;
        const cx = ((c.xPct ?? (i % 2 ? 66 : 34)) / 100) * width;
        const baseY = ((c.yPct ?? 100) / 100) * height;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx - w / 2 + off.x,
              top: baseY - h + off.y,
              width: w,
              height: h,
              transform: voxLayer(cam, 1.3),
            }}
          >
            <Halftone
              src={c.src}
              stroke={c.stroke !== false}
              halftone={c.halftone !== false}
              flip={c.flip}
              style={{ inset: 0, width: "100%", height: "100%" }}
            />
          </div>
        );
      })}

      {v.anchor ? (
        <Img
          src={v.anchor}
          style={{
            position: "absolute",
            left: "50%",
            bottom: 12 - anchorH * (1 - anchorPop),
            height: anchorH,
            width: "auto",
            objectFit: "contain",
            transform: `translateX(-50%) ${voxLayer(cam, 1.6)}`,
            transformOrigin: "bottom center",
            filter: "contrast(1.02)",
          }}
        />
      ) : null}

      {v.kicker ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.06,
            top: height * 0.1,
            fontFamily: t.fontLabel,
            fontWeight: 700,
            fontSize: 26,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: shot.accent ?? t.accent,
            opacity: interpolate(frame, [6, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          {v.kicker}
        </div>
      ) : null}

      {shot.title ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.06,
            bottom: height * 0.12,
            maxWidth: "72%",
            fontFamily: t.fontLabel,
            fontWeight: 700,
            fontSize: 60,
            lineHeight: 1.0,
            color: t.ink,
            textTransform: "uppercase",
            opacity: interpolate(frame, [14, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          {shot.title}
        </div>
      ) : null}
    </VoxStage>
  );
};

/** vox_chart — paper card pop + self-drawing line(s) + axis + orange callout. */
export const VoxChartShot: React.FC<ShotProps> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = useTheme();
  const v = shot.vox ?? {};
  const acc = shot.accent ?? t.accent;
  const cardPop = spring({ frame: frame - 3, fps, config: { damping: 15, stiffness: 110 } });
  const series = v.series ?? [];
  const prev = v.seriesPrev ?? [];
  const yMax = v.yMax ?? Math.max(1, ...series, ...prev) * 1.15;

  const cardW = width * 0.62;
  const cardH = height * 0.62;
  const cardX = (width - cardW) / 2;
  const cardY = (height - cardH) / 2 - height * 0.02;
  const padL = 74;
  const padR = 60;
  const padT = 88;
  const padB = 72;
  const plotW = cardW - padL - padR;
  const plotH = cardH - padT - padB;

  const toXY = (val: number, i: number, n: number): [number, number] => [
    padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW),
    padT + plotH - (val / yMax) * plotH,
  ];
  const pathFor = (arr: number[]) =>
    arr
      .map((val, i) => {
        const [x, y] = toXY(val, i, arr.length);
        return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");

  const draw = interpolate(frame, [14, 54], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const calloutPop = spring({ frame: frame - 46, fps, config: { damping: 13, stiffness: 150 } });
  const lastPt = series.length ? toXY(series[series.length - 1], series.length - 1, series.length) : null;

  return (
    <VoxStage accent={shot.accent}>
      <div
        style={{
          position: "absolute",
          left: cardX,
          top: cardY,
          width: cardW,
          height: cardH,
          transform: `scale(${0.86 + 0.14 * cardPop})`,
          transformOrigin: "center",
          opacity: interpolate(frame, [3, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: t.paper,
            borderRadius: 20,
            boxShadow: "8px 10px 0 rgba(20,18,14,0.10)",
            border: "1px solid rgba(20,18,14,0.08)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: padL,
            top: 30,
            fontFamily: t.fontLabel,
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: t.ink,
          }}
        >
          {v.chartTitle ?? shot.title ?? ""}
        </div>
        <svg width={cardW} height={cardH} style={{ position: "absolute", inset: 0 }}>
          {[0, 0.25, 0.5, 0.75, 1].map((g, i) => {
            const y = padT + plotH - g * plotH;
            return <line key={i} x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="rgba(20,18,14,0.10)" strokeWidth={1} />;
          })}
          {prev.length ? (
            <path
              d={pathFor(prev)}
              fill="none"
              stroke="rgba(20,18,14,0.30)"
              strokeWidth={5}
              strokeLinejoin="round"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
            />
          ) : null}
          {series.length ? (
            <path
              d={pathFor(series)}
              fill="none"
              stroke={acc}
              strokeWidth={6}
              strokeLinejoin="round"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
            />
          ) : null}
          {lastPt && draw > 0.98 ? (
            <circle cx={lastPt[0]} cy={lastPt[1]} r={9} fill={t.paper} stroke={t.ink} strokeWidth={3} />
          ) : null}
        </svg>
        {(v.xLabels ?? []).map((lb, i) => {
          const [x] = toXY(0, i, (v.xLabels ?? []).length);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x - 24,
                top: cardH - padB + 18,
                width: 48,
                textAlign: "center",
                fontFamily: t.fontLabel,
                fontSize: 16,
                color: "rgba(20,18,14,0.6)",
              }}
            >
              {lb}
            </div>
          );
        })}
        {v.callout ? (
          <div
            style={{
              position: "absolute",
              right: 42,
              top: padT + 8,
              transform: `scale(${0.4 + 0.6 * calloutPop})`,
              transformOrigin: "top right",
              opacity: interpolate(frame, [46, 52], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            <div style={{ border: `3px solid ${acc}`, borderRadius: 12, padding: "10px 18px", backgroundColor: t.paper }}>
              <div style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: 18, letterSpacing: "0.1em", color: t.ink }}>
                {v.callout.title}
              </div>
              <div style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: 36, color: acc }}>{v.callout.value}</div>
            </div>
          </div>
        ) : null}
      </div>
    </VoxStage>
  );
};

/** vox_counter — a big number ticking up over the grid. */
export const VoxCounterShot: React.FC<ShotProps> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const v = shot.vox ?? {};
  const pop = spring({ frame: frame - 4, fps, config: { damping: 14, stiffness: 120 } });
  return (
    <VoxStage accent={shot.accent}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        {v.kicker ? (
          <div
            style={{
              fontFamily: t.fontLabel,
              fontWeight: 700,
              fontSize: 28,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: shot.accent ?? t.accent,
              marginBottom: 18,
              opacity: interpolate(frame, [4, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            {v.kicker}
          </div>
        ) : null}
        <div style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: 210, lineHeight: 1, transform: `scale(${0.82 + 0.18 * pop})` }}>
          <Counter
            from={v.counterFrom ?? 0}
            to={v.counterTo ?? 100}
            startFrame={8}
            dur={Math.min(40, Math.max(12, shot.durationInFrames - 12))}
            prefix={v.counterPrefix ?? ""}
            suffix={v.counterSuffix ?? ""}
            style={{ color: shot.accent ?? t.accent }}
          />
        </div>
        {v.counterLabel ? (
          <div
            style={{
              fontFamily: t.fontLabel,
              fontWeight: 700,
              fontSize: 40,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: t.ink,
              marginTop: 6,
            }}
          >
            {v.counterLabel}
          </div>
        ) : null}
      </AbsoluteFill>
    </VoxStage>
  );
};

/** vox_map — a plate slides in from the right, a big stat pops, figures rise. */
export const VoxMapShot: React.FC<ShotProps> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = useTheme();
  const v = shot.vox ?? {};
  const slide = spring({ frame: frame - 2, fps, config: { damping: 20, stiffness: 70 } });
  const statDelay = v.statDelay ?? 20;
  const statPop = spring({ frame: frame - statDelay, fps, config: { damping: 13, stiffness: 140 } });
  const cam = useVoxCam(shot.durationInFrames, seed, 0.04);
  return (
    <VoxStage accent={shot.accent}>
      {v.slideBg ? (
        <Img
          src={v.slideBg}
          style={{
            position: "absolute",
            left: "50%",
            top: "54%",
            width: "62%",
            transform: `translate(${(1 - slide) * width * 0.7}px,0) translate(-50%,-50%) ${voxLayer(cam, 0.7)}`,
            filter: "grayscale(0.2) contrast(1.03)",
          }}
        />
      ) : null}
      {(v.cutouts ?? []).map((c, i) => {
        const delay = c.delay ?? 18 + i * 6;
        const p = spring({ frame: frame - delay, fps, config: { damping: 17, stiffness: 90 } });
        const h = ((c.hPct ?? 30) / 100) * height;
        const w = h * 0.8;
        const cx = ((c.xPct ?? (i % 2 ? 78 : 22)) / 100) * width;
        const y = (1 - p) * height * 0.5;
        return (
          <div key={i} style={{ position: "absolute", left: cx - w / 2, top: height - h + y, width: w, height: h }}>
            <Halftone src={c.src} flip={c.flip} style={{ inset: 0, width: "100%", height: "100%" }} />
          </div>
        );
      })}
      {v.stat ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: height * 0.15,
            textAlign: "center",
            transform: `scale(${0.6 + 0.4 * statPop})`,
            opacity: interpolate(frame, [statDelay, statDelay + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          <div style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: 132, lineHeight: 1, color: shot.accent ?? t.accent }}>
            {v.stat}
          </div>
          {v.statLabel ? (
            <div style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: 34, letterSpacing: "0.16em", textTransform: "uppercase", color: t.ink }}>
              {v.statLabel}
            </div>
          ) : null}
        </div>
      ) : null}
    </VoxStage>
  );
};

/** vox_dialogue — two halftone cutouts + sequential speech-bubble pops. */
export const VoxDialogueShot: React.FC<ShotProps> = ({ shot, seed }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const v = shot.vox ?? {};
  const cam = useVoxCam(shot.durationInFrames, seed, 0.04);
  return (
    <VoxStage accent={shot.accent}>
      {v.midground ? (
        <Img
          src={v.midground}
          style={{
            position: "absolute",
            left: "50%",
            bottom: 0,
            height: "46%",
            transform: `translateX(-50%) ${voxLayer(cam, 0.6)}`,
            filter: "contrast(1.03)",
          }}
        />
      ) : null}
      {(v.cutouts ?? []).map((c, i) => {
        const delay = c.delay ?? 6 + i * 5;
        const p = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 85 } });
        const off = slideOffset(c.from ?? (i % 2 ? "right" : "left"), p, width, height);
        const h = ((c.hPct ?? 60) / 100) * height;
        const w = h * 0.8;
        const cx = ((c.xPct ?? (i % 2 ? 64 : 36)) / 100) * width;
        return (
          <div key={i} style={{ position: "absolute", left: cx - w / 2 + off.x, top: height - h, width: w, height: h, transform: voxLayer(cam, 1.2) }}>
            <Halftone src={c.src} flip={c.flip} style={{ inset: 0, width: "100%", height: "100%" }} />
          </div>
        );
      })}
      {(v.bubbles ?? []).map((b, i) => (
        <SpeechBubble key={i} b={b} />
      ))}
    </VoxStage>
  );
};

/** vox_typewriter — typewriter title lines over the grid + optional hero object. */
export const VoxTypewriterShot: React.FC<ShotProps> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = useTheme();
  const v = shot.vox ?? {};
  const lines = v.typeLines ?? (shot.title ? [shot.title] : []);
  let acc = 10;
  const starts: number[] = [];
  for (const ln of lines) {
    starts.push(acc);
    acc += Math.round((ln.length / 26) * fps) + 14;
  }
  const heroPop = spring({ frame: frame - 4, fps, config: { damping: 16, stiffness: 90 } });
  return (
    <VoxStage accent={shot.accent}>
      <div style={{ position: "absolute", left: width * 0.075, top: height * 0.32, right: width * 0.1 }}>
        {lines.map((ln, i) => (
          <div key={i} style={{ marginBottom: 18 }}>
            <TypeOn
              text={ln}
              startFrame={starts[i]}
              caret={i === lines.length - 1}
              style={{
                fontFamily: t.fontDisplay,
                fontWeight: 700,
                fontSize: 56,
                letterSpacing: "0.05em",
                color: t.ink,
                textTransform: "uppercase",
              }}
            />
          </div>
        ))}
      </div>
      {v.hero ? (
        <Img
          src={v.hero}
          style={{
            position: "absolute",
            left: "50%",
            bottom: height * 0.08,
            height: ((v.heroHPct ?? 22) / 100) * height,
            transform: `translateX(-50%) scale(${0.9 + 0.1 * heroPop})`,
            filter: "contrast(1.03)",
          }}
        />
      ) : null}
    </VoxStage>
  );
};

/* ================================================================ SCENE == */
/* Compositional layer engine — an ordered layers[] stack (paint order = z, so
 * occlusion is explicit and layer-order bugs are impossible), with overshoot
 * entrances, stagger, parallax and secondary motion (bob / water / fire). The
 * faithful reproduction is authored as vox_scene layer stacks. */

const SPRING_POP = { damping: 9, stiffness: 170, mass: 0.8 };
const SPRING_RISE = { damping: 12, stiffness: 90, mass: 1 };

const useEnter = (enter: VoxEnter, delay: number, W: number, H: number, fps: number) => {
  const frame = useCurrentFrame();
  const f = frame - delay;
  const s = spring({ frame: f, fps, config: enter === "pop" ? SPRING_POP : SPRING_RISE });
  const op = interpolate(f, [0, 7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let tx = 0;
  let ty = 0;
  let scale = 1;
  let opacity = 1;
  switch (enter) {
    case "rise": ty = (1 - s) * H * 0.55; opacity = op; break;
    case "slideL": tx = (1 - s) * -W * 0.8; opacity = op; break;
    case "slideR": tx = (1 - s) * W * 0.8; opacity = op; break;
    case "slideDown": ty = (1 - s) * -H * 0.55; opacity = op; break;
    case "pop": scale = 0.55 + 0.45 * s; opacity = op; break;
    case "fade": opacity = interpolate(f, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }); break;
    default: break;
  }
  return { tx, ty, scale, opacity };
};

const Water: React.FC<{ src?: string; topPct: number }> = ({ src, topPct }) => {
  const frame = useCurrentFrame();
  const { height: H } = useVideoConfig();
  const wob = Math.sin(frame * 0.06) * 5;
  const scroll = (frame * 0.5) % 80;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: `${topPct}%`, bottom: 0, overflow: "hidden" }}>
      {src ? (
        <Img src={src} style={{ position: "absolute", left: -40 - scroll * 0.2, top: wob - 10, width: "125%", height: "118%", objectFit: "cover", filter: "grayscale(0.35) contrast(1.06) brightness(0.97)" }} />
      ) : (
        <AbsoluteFill style={{ background: "linear-gradient(180deg,#8a8f93,#5f6468)" }} />
      )}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: Math.max(3, H * 0.006), background: "rgba(255,255,255,0.4)" }} />
    </div>
  );
};

const Fire: React.FC<{ cxPct: number; cyPct: number; wPct?: number }> = ({ cxPct, cyPct, wPct = 12 }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const cx = (cxPct / 100) * W;
  const cy = (cyPct / 100) * H;
  const w = (wPct / 100) * W;
  const flames = Array.from({ length: 34 }, (_, i) => {
    const seed = i * 1.37;
    const life = (frame * 0.05 + seed) % 1;
    const x = cx + Math.sin(seed * 5 + frame * 0.12) * w * 0.5 * (0.3 + life);
    const y = cy - life * H * 0.15;
    const size = (1 - life) * 32 + 8;
    const col = life < 0.4 ? "#ffc23a" : life < 0.72 ? "#ff6a1a" : "#d8351a";
    return { x, y, size, col, op: (1 - life) * 0.9 };
  });
  const smoke = Array.from({ length: 9 }, (_, i) => {
    const seed = i * 2.1;
    const life = (frame * 0.02 + seed) % 1;
    const x = cx + Math.sin(seed * 3 + frame * 0.05) * w * 0.6;
    const y = cy - H * 0.1 - life * H * 0.14;
    const s = 10 + life * 34;
    return { x, y, s, op: 0.22 * (1 - life) };
  });
  return (
    <>
      {smoke.map((p, i) => (
        <div key={`sm${i}`} style={{ position: "absolute", left: p.x - p.s / 2, top: p.y - p.s / 2, width: p.s, height: p.s, borderRadius: "50%", background: `rgba(70,64,58,${p.op})`, filter: "blur(5px)" }} />
      ))}
      {flames.map((p, i) => (
        <div key={`fl${i}`} style={{ position: "absolute", left: p.x - p.size / 2, top: p.y - p.size / 2, width: p.size, height: p.size * 1.5, borderRadius: "50% 50% 50% 50% / 62% 62% 38% 38%", background: p.col, opacity: p.op, filter: "blur(0.8px)" }} />
      ))}
    </>
  );
};

const CounterPops: React.FC<{ steps: string[]; startFrame: number; hold?: number; style?: React.CSSProperties }> = ({ steps, startFrame, hold = 20, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = Math.max(0, Math.min(steps.length - 1, Math.floor((frame - startFrame) / hold)));
  const local = frame - startFrame - k * hold;
  const pop = spring({ frame: local, fps, config: SPRING_POP });
  const scale = 0.7 + 0.3 * Math.min(1.12, pop);
  return <span style={{ ...style, display: "inline-block", transform: `scale(${scale})` }}>{steps[Math.max(0, k)]}</span>;
};

const SceneChart: React.FC<{ L: VoxLayer; accent: string }> = ({ L, accent }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const t = useTheme();
  const series = L.series ?? [];
  const prev = L.seriesPrev ?? [];
  const yMax = L.yMax ?? Math.max(1, ...series, ...prev) * 1.15;
  const cardW = ((L.wPct ?? 46) / 100) * W;
  const cardH = ((L.hPct ?? 56) / 100) * H;
  const padL = 64;
  const padR = 46;
  const padT = 72;
  const padB = 56;
  const plotW = cardW - padL - padR;
  const plotH = cardH - padT - padB;
  const toXY = (v: number, i: number, n: number): [number, number] => [padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW), padT + plotH - (v / yMax) * plotH];
  const pathFor = (a: number[]) => a.map((v, i) => { const [x, y] = toXY(v, i, a.length); return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(" ");
  const draw = interpolate(frame, [10, 46], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cPop = spring({ frame: frame - 40, fps, config: SPRING_POP });
  const last = series.length ? toXY(series[series.length - 1], series.length - 1, series.length) : null;
  return (
    <div style={{ width: cardW, height: cardH, position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, backgroundColor: t.paper, borderRadius: 18, boxShadow: "7px 9px 0 rgba(20,18,14,0.10)", border: "1px solid rgba(20,18,14,0.08)" }} />
      <div style={{ position: "absolute", left: padL, top: 26, fontFamily: t.fontLabel, fontWeight: 700, fontSize: 26, letterSpacing: "0.1em", textTransform: "uppercase", color: t.ink }}>{L.chartTitle ?? ""}</div>
      <svg width={cardW} height={cardH} style={{ position: "absolute", inset: 0 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((g, i) => { const y = padT + plotH - g * plotH; return <line key={i} x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="rgba(20,18,14,0.10)" strokeWidth={1} />; })}
        {prev.length ? <path d={pathFor(prev)} fill="none" stroke="rgba(20,18,14,0.3)" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} /> : null}
        {series.length ? <path d={pathFor(series)} fill="none" stroke={accent} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} /> : null}
        {last && draw > 0.98 ? <circle cx={last[0]} cy={last[1]} r={8} fill={t.paper} stroke={t.ink} strokeWidth={3} /> : null}
      </svg>
      {(L.xLabels ?? []).map((lb, i) => { const [x] = toXY(0, i, (L.xLabels ?? []).length); return <div key={i} style={{ position: "absolute", left: x - 22, top: cardH - padB + 14, width: 44, textAlign: "center", fontFamily: t.fontLabel, fontSize: 15, color: "rgba(20,18,14,0.6)" }}>{lb}</div>; })}
      {L.callout ? (
        <div style={{ position: "absolute", right: 30, top: padT, transform: `scale(${0.4 + 0.6 * cPop})`, transformOrigin: "top right", opacity: interpolate(frame, [40, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          <div style={{ border: `3px solid ${accent}`, borderRadius: 10, padding: "8px 14px", backgroundColor: t.paper }}>
            <div style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", color: t.ink }}>{L.callout.title}</div>
            <div style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: 30, color: accent }}>{L.callout.value}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** Wrap a moving element in a motion-blur Trail (only visible while it moves). */
const maybeBlur = (node: React.ReactNode, on?: boolean): React.ReactNode =>
  on ? (
    <Trail layers={3} lagInFrames={1.6} trailOpacity={0.4}>
      {node}
    </Trail>
  ) : (
    node
  );

const VoxLayerView: React.FC<{ L: VoxLayer; W: number; H: number; fps: number; push: number; accent: string }> = ({ L, W, H, fps, push, accent }) => {
  const frame = useCurrentFrame();
  const t = useTheme();
  const enter = L.enter ?? "pop";
  const delay = L.delay ?? 0;
  const e = useEnter(enter, delay, W, H, fps);
  const par = L.parallax ?? (L.type === "character" ? 1.25 : L.type === "plate" ? 1.0 : 0.35);
  const pScale = 1 + (push - 1) * par;
  const idleY = L.idle === "bob" ? Math.sin((frame - delay) * 0.07) * H * 0.006 : 0;
  const anim = `translate(${e.tx.toFixed(1)}px, ${(e.ty + idleY).toFixed(1)}px) scale(${(e.scale * pScale).toFixed(4)})`;
  const x = L.xPct ?? 50;
  const anchor = L.anchor ?? "bottom";
  const isBottom = anchor.startsWith("bottom");
  const vert: React.CSSProperties = isBottom ? { bottom: `${L.yPct ?? 0}%` } : { top: `${L.yPct ?? 50}%` };
  const baseT = isBottom ? "translateX(-50%)" : "translate(-50%,-50%)";
  const origin = isBottom ? "center bottom" : "center";
  const transform = `${baseT} ${anim}`;

  if (L.type === "water") return <Water src={L.src} topPct={L.yPct ?? 75} />;
  if (L.type === "fire") return <Fire cxPct={x} cyPct={L.yPct ?? 88} wPct={L.fireW} />;

  if (L.type === "video") {
    const vsrc = /^https?:\/\//.test(L.src!) ? L.src! : staticFile(L.src!);
    return maybeBlur(
      <Loop durationInFrames={Math.max(1, L.loopFrames ?? 150)}>
        <OffthreadVideo
          src={vsrc}
          muted
          style={{ position: "absolute", left: `${x}%`, ...vert, width: L.wPct ? `${L.wPct}%` : undefined, height: L.hPct ? `${L.hPct}%` : undefined, transform, transformOrigin: origin, opacity: e.opacity, objectFit: "cover", mixBlendMode: L.blend === "screen" ? "screen" : undefined }}
        />
      </Loop>,
      L.blur,
    );
  }
  if (L.type === "highlight" || L.type === "underline") {
    const grow = interpolate(frame, [delay, delay + (L.type === "highlight" ? 12 : 9)], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const wPx = ((L.wPct ?? 20) / 100) * W * grow;
    const hPx = L.type === "highlight" ? ((L.hPct ?? 5) / 100) * H : L.size ?? 8;
    const col = L.color ?? (L.type === "highlight" ? "rgba(240,205,50,0.55)" : accent);
    // left-anchored: grows rightward from xPct
    return (
      <div style={{ position: "absolute", left: `${x}%`, ...vert, transform: isBottom ? undefined : "translateY(-50%)" }}>
        <div style={{ width: wPx, height: hPx, backgroundColor: col, borderRadius: L.type === "underline" ? hPx / 2 : 3 }} />
      </div>
    );
  }

  if (L.type === "plate") {
    return maybeBlur(
      <Img
        src={L.src!}
        style={{ position: "absolute", left: `${x}%`, ...vert, width: L.wPct ? `${L.wPct}%` : undefined, height: L.hPct ? `${L.hPct}%` : undefined, transform, transformOrigin: origin, opacity: e.opacity, filter: t.plateFilter, objectFit: "contain" }}
      />,
      L.blur,
    );
  }
  if (L.type === "character") {
    const boxH = ((L.hPct ?? 55) / 100) * H;
    const boxW = L.wPct ? (L.wPct / 100) * W : boxH * 0.72;
    return maybeBlur(
      <div style={{ position: "absolute", left: `${x}%`, ...vert, width: boxW, height: boxH, transform, transformOrigin: origin, opacity: e.opacity }}>
        <Halftone src={L.src!} stroke={L.stroke !== false} halftone={L.halftone !== false} flip={L.flip} style={{ inset: 0, width: "100%", height: "100%" }} />
      </div>,
      L.blur,
    );
  }

  const wrap = (child: React.ReactNode): React.ReactNode => (
    <div style={{ position: "absolute", left: `${x}%`, ...vert, transform, transformOrigin: origin, opacity: e.opacity }}>{child}</div>
  );
  if (L.type === "stat") return wrap(<div style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: L.size ?? 120, lineHeight: 1, color: L.color ?? t.ink, textShadow: "3px 4px 0 rgba(20,18,14,0.12)", whiteSpace: "nowrap" }}>{L.text}</div>);
  if (L.type === "label") return wrap(<div style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: L.size ?? 30, letterSpacing: "0.14em", textTransform: "uppercase", color: L.color ?? accent, whiteSpace: "nowrap" }}>{L.text}</div>);
  if (L.type === "counter") {
    const steps = (L.steps ?? [L.to ?? 0]).map((n) => `${L.prefix ?? ""}${typeof n === "number" ? n.toLocaleString("en-US") : n}${L.suffix ?? ""}`);
    return wrap(
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {L.src ? <Img src={L.src} style={{ height: (L.size ?? 90) * 0.9, width: "auto" }} /> : null}
        <div style={{ textAlign: "left" }}>
          <CounterPops steps={steps} startFrame={delay + 6} style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: L.size ?? 96, color: L.color ?? accent, textShadow: "2px 3px 0 rgba(20,18,14,0.12)" }} />
          {L.sublabel ? <div style={{ fontFamily: t.fontLabel, fontWeight: 700, fontSize: (L.size ?? 96) * 0.28, letterSpacing: "0.12em", textTransform: "uppercase", color: t.ink }}>{L.sublabel}</div> : null}
        </div>
      </div>,
    );
  }
  if (L.type === "chart") return wrap(<SceneChart L={L} accent={accent} />);
  if (L.type === "typewriter") {
    const lines = L.lines ?? (L.text ? [L.text] : []);
    let acc = delay;
    const starts: number[] = [];
    for (const ln of lines) { starts.push(acc); acc += Math.round((ln.length / 26) * fps) + 12; }
    return wrap(
      <div style={{ minWidth: W * 0.7 }}>
        {lines.map((ln, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <TypeOn text={ln} startFrame={starts[i]} caret={i === lines.length - 1} style={{ fontFamily: t.fontDisplay, fontWeight: 700, fontSize: L.size ?? 54, letterSpacing: "0.05em", color: t.ink, textTransform: "uppercase" }} />
          </div>
        ))}
      </div>,
    );
  }
  if (L.type === "bubble") {
    return <SpeechBubble b={{ text: L.text ?? "", xPct: x, yPct: L.yPct ?? 30, delay, tail: L.bubble?.tail ?? "down", bg: L.bubble?.bg, color: L.bubble?.color, pointXPct: L.bubble?.pointXPct, pointYPct: L.bubble?.pointYPct }} />;
  }
  return null;
};

export const VoxSceneShot: React.FC<ShotProps> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const data = shot.vox ?? {};
  const layers = data.layers ?? [];
  const dur = shot.durationInFrames;
  const p = interpolate(frame, [0, dur], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateRight: "clamp" });
  const push = 1 + (data.push ?? 0.035) * p;
  const fade = data.fadeOut ? interpolate(frame, [dur - 16, dur - 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  return (
    <VoxStage accent={shot.accent}>
      {layers.map((L, i) => (
        <VoxLayerView key={i} L={L} W={W} H={H} fps={fps} push={push} accent={shot.accent ?? "#e8641a"} />
      ))}
      {fade > 0 ? <AbsoluteFill style={{ backgroundColor: "#000", opacity: fade }} /> : null}
    </VoxStage>
  );
};
