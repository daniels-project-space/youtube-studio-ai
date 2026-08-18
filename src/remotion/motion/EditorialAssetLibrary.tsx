import React from "react";
import { Easing, Img, interpolate, staticFile } from "remotion";

export const EDITORIAL_MOTION_LIBRARY = [
  { id: "depth-of-field", family: "camera", purpose: "Depth-driven blur and saturation falloff" },
  { id: "parallax-stage", family: "camera", purpose: "Independent z-plane drift" },
  { id: "camera-push", family: "camera", purpose: "Slow editorial punch-in" },
  { id: "rack-focus", family: "camera", purpose: "Attention pull between planes" },
  { id: "cutout-float", family: "layer", purpose: "Foreground subject with independent translation" },
  { id: "torn-matte", family: "layer", purpose: "Irregular paper edge reveal" },
  { id: "paper-shadow", family: "layer", purpose: "Physical cast-shadow separation" },
  { id: "tape-mount", family: "layer", purpose: "Taped paper attachment" },
  { id: "card-fan", family: "transition", purpose: "Staggered evidence-card arrival" },
  { id: "fold-open", family: "transition", purpose: "3D document reveal" },
  { id: "ink-stamp", family: "transition", purpose: "Stamped fact lock-up" },
  { id: "signal-thread", family: "connector", purpose: "Drawn causal link between assets" },
  { id: "focus-breath", family: "camera", purpose: "Subtle analogue focus settle" },
  { id: "film-grain", family: "treatment", purpose: "Fine moving film grain" },
  { id: "dust-pass", family: "treatment", purpose: "Floating dust and print wear" },
  { id: "gate-weave", family: "treatment", purpose: "Sub-pixel film registration movement" },
  { id: "shutter-shadow", family: "treatment", purpose: "Moving venetian-blind shadow" },
  { id: "halftone-wash", family: "treatment", purpose: "Editorial print texture" },
  { id: "light-leak", family: "treatment", purpose: "Warm analogue edge bloom" },
  { id: "lens-bloom", family: "treatment", purpose: "Soft practical-light glow" },
  { id: "luma-wipe", family: "transition", purpose: "Organic dark-to-light scene handoff" },
  { id: "handheld-drift", family: "camera", purpose: "Restrained documentary handhold" },
  { id: "hold-then-snap", family: "rhythm", purpose: "Editorial stillness before a fact lands" },
  { id: "posterized-step", family: "rhythm", purpose: "Deliberate stepped stop-motion cadence" },
] as const;

export type EditorialMotionId = (typeof EDITORIAL_MOTION_LIBRARY)[number]["id"];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const eased = (value: number): number => Easing.out(Easing.cubic)(clamp01(value));

export const depthOfField = (z: number, focus: number, maxBlur = 14): React.CSSProperties => {
  const delta = Math.min(1, Math.abs(z - focus));
  return {
    filter: `blur(${(delta * maxBlur).toFixed(2)}px) saturate(${(1 - delta * 0.28).toFixed(3)}) brightness(${(1 - delta * 0.13).toFixed(3)})`,
    opacity: 1 - delta * 0.16,
  };
};

export const parallaxTransform = (frame: number, z: number, amplitude = 18): string => {
  const x = Math.sin(frame / 59 + z * 7) * amplitude * z;
  const y = Math.cos(frame / 71 + z * 11) * amplitude * z * 0.65;
  const scale = 1 + z * 0.028;
  return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(4)})`;
};

export const cameraPush = (frame: number, start: number, duration: number, from = 1, to = 1.1): string => {
  const amount = eased((frame - start) / duration);
  return `scale(${interpolate(amount, [0, 1], [from, to]).toFixed(4)})`;
};

export const rackFocus = (frame: number, start: number, duration: number): number => eased((frame - start) / duration);

export const handheldDrift = (frame: number, intensity = 1): string => {
  const x = Math.sin(frame / 17) * intensity * 1.2 + Math.sin(frame / 43) * intensity * 0.8;
  const y = Math.cos(frame / 19) * intensity * 0.85;
  const rotate = Math.sin(frame / 29) * intensity * 0.08;
  return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rotate.toFixed(3)}deg)`;
};

export const holdThenSnap = (frame: number, holdUntil: number, duration: number): number => eased((frame - holdUntil) / duration);

export const posterizedFrame = (frame: number, fps = 12): number => Math.floor(frame / (30 / fps)) * (30 / fps);

export const fanTransform = (frame: number, index: number, start: number, spacing = 6): string => {
  const enter = eased((frame - start - index * spacing) / 14);
  const x = interpolate(enter, [0, 1], [(index - 1) * 240, 0]);
  const y = interpolate(enter, [0, 1], [180 + Math.abs(index - 1) * 60, 0]);
  const rotate = interpolate(enter, [0, 1], [(index - 1) * 18, (index - 1) * 4]);
  const scale = interpolate(enter, [0, 1], [0.76, 1]);
  return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rotate.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
};

export const foldTransform = (frame: number, start: number, duration = 18): string => {
  const open = eased((frame - start) / duration);
  return `perspective(900px) rotateY(${interpolate(open, [0, 1], [-84, 0]).toFixed(2)}deg)`;
};

export const inkStamp = (frame: number, start: number): React.CSSProperties => {
  const hit = holdThenSnap(frame, start, 7);
  return { opacity: hit, transform: `scale(${interpolate(hit, [0, 0.72, 1], [1.85, 0.91, 1]).toFixed(3)}) rotate(${interpolate(hit, [0, 1], [-10, 0]).toFixed(2)}deg)` };
};

export const lumaWipe = (frame: number, start: number, duration = 13): string => {
  const p = eased((frame - start) / duration) * 100;
  return `polygon(0 0, ${p.toFixed(2)}% 0, ${(p - 8).toFixed(2)}% 100%, 0 100%)`;
};

export const tornMatte = (seed = 0): string => {
  const r = (n: number) => Math.sin(seed * 31.7 + n * 12.3) * 2.8;
  return `polygon(0 ${r(0)}%, 19% ${r(1)}%, 38% ${r(2)}%, 57% ${r(3)}%, 78% ${r(4)}%, 100% ${r(5)}%, 100% ${100 + r(6)}%, 78% ${100 + r(7)}%, 57% ${100 + r(8)}%, 38% ${100 + r(9)}%, 19% ${100 + r(10)}%, 0 ${100 + r(11)}%)`;
};

export const paperShadow = (depth = 1): React.CSSProperties => ({
  boxShadow: `${Math.round(13 * depth)}px ${Math.round(18 * depth)}px ${Math.round(29 * depth)}px rgba(0,0,0,0.44), ${Math.round(2 * depth)}px ${Math.round(4 * depth)}px ${Math.round(6 * depth)}px rgba(0,0,0,0.34)`,
});

export const tapeMount = (left: number, top: number, width: number, rotate = -4): React.CSSProperties => ({
  position: "absolute",
  left,
  top,
  width,
  height: 34,
  background: "rgba(223,198,127,0.54)",
  border: "1px solid rgba(255,255,255,0.26)",
  transform: `rotate(${rotate}deg)`,
  mixBlendMode: "screen",
});

export const signalDashOffset = (frame: number, start: number, duration: number, length = 1200): number => length * (1 - eased((frame - start) / duration));

export const focusBreath = (frame: number, amount = 0.45): React.CSSProperties => ({
  filter: `blur(${(Math.sin(frame / 31) * 0.5 + 0.5) * amount}px)`,
});

export const gateWeave = (frame: number): string => `translate(${(Math.sin(frame / 21) * 0.9).toFixed(2)}px, ${(Math.cos(frame / 27) * 0.75).toFixed(2)}px)`;

export const FilmTreatment: React.FC<{ frame: number; opacity?: number }> = ({ frame, opacity = 1 }) => {
  const grainShift = (frame % 47) * 0.47;
  const leak = clamp01((Math.sin(frame / 42) + 1) / 2) * 0.13;
  return (
    <>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.2 * opacity, mixBlendMode: "soft-light", backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 1px, transparent 1px, transparent 4px)", backgroundPositionY: `${grainShift}px` }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.18 * opacity, mixBlendMode: "screen", backgroundImage: "radial-gradient(rgba(255,255,255,0.5) 0.72px, transparent 0.92px)", backgroundSize: "7px 7px", backgroundPosition: `${frame * 0.67}px ${frame * 0.31}px` }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.15 * opacity, mixBlendMode: "multiply", background: "repeating-linear-gradient(90deg, rgba(0,0,0,0.86) 0px, rgba(0,0,0,0.86) 12px, transparent 13px, transparent 54px)" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: leak * opacity, mixBlendMode: "screen", background: "radial-gradient(circle at 2% 24%, #d95221 0%, transparent 26%)" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 45%, transparent 38%, rgba(0,0,0,0.68) 100%)" }} />
    </>
  );
};

export const CutoutLayer: React.FC<{
  file: string;
  left: number;
  top: number;
  width: number;
  frame: number;
  z?: number;
  focus?: number;
  rotation?: number;
  opacity?: number;
  scale?: number;
}> = ({ file, left, top, width, frame, z = 0.5, focus = 0.5, rotation = 0, opacity = 1, scale = 1 }) => (
  <div style={{ position: "absolute", left, top, width, opacity, transform: `${parallaxTransform(frame, z, 16)} ${handheldDrift(frame, 0.32)} rotate(${rotation}deg) scale(${scale})`, transformOrigin: "center center", ...depthOfField(z, focus, 12), ...paperShadow(Math.max(0.55, z)) }}>
    <Img src={staticFile(file)} style={{ width: "100%", display: "block" }} />
  </div>
);

export const SignalThread: React.FC<{ frame: number; start: number; duration: number; path: string; color?: string; length?: number }> = ({ frame, start, duration, path, color = "#e7b74f", length = 1240 }) => (
  <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
    <path d={path} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="13" strokeLinecap="round" />
    <path d={path} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={length} strokeDashoffset={signalDashOffset(frame, start, duration, length)} />
  </svg>
);

export const TornPaperMatte: React.FC<{ children: React.ReactNode; seed?: number; style?: React.CSSProperties }> = ({ children, seed = 0, style }) => (
  <div style={{ clipPath: tornMatte(seed), ...style }}>{children}</div>
);
