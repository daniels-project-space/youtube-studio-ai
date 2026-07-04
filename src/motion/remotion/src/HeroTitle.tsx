import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont();

export type HeroTitleProps = { base: string; near?: string; kicker: string; lines: string[]; sub: string; accent?: string };
export const heroTitleDefaults: HeroTitleProps = { base: "hero.png", near: "", kicker: "CASE STATUS", lines: ["NEVER FULLY", "SOLVED"], sub: "THE HEIST OF THE CENTURY", accent: "#e8b23a" };

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

const Word: React.FC<{ word: string; delay: number; size: number }> = ({ word, delay, size }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: frame - delay, fps, config: { damping: 180, mass: 0.6 } });
  return <span style={{ display: "inline-block", opacity: e, transform: `translateY(${interpolate(e, [0, 1], [80, 0])}px)`, fontSize: size, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em", marginRight: size * 0.14, lineHeight: 0.98, textShadow: "0 6px 40px rgba(0,0,0,0.9)" }}>{word}</span>;
};

export const HeroTitle: React.FC<HeroTitleProps> = ({ base, near, kicker, lines, sub, accent = "#e8b23a" }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const z = interpolate(frame, [0, durationInFrames], [1.07, 1.22], { easing: Easing.inOut(Easing.cubic) });
  const dx = interpolate(frame, [0, durationInFrames], [18, -18]);
  const dy = interpolate(frame, [0, durationInFrames], [-9, 9]);
  const nz = interpolate(frame, [0, durationInFrames], [1.12, 1.36], { easing: Easing.inOut(Easing.cubic) });
  const fade = interpolate(frame, [0, 12, durationInFrames - 12, durationInFrames], [0, 1, 1, 0]);
  const sweep = interpolate(frame, [0, durationInFrames], [-25, 130]);
  const kIn = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  const lineW = interpolate(frame, [16, 34], [0, 380], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subIn = spring({ frame: frame - 60, fps, config: { damping: 200 } });
  let wd = 22;
  const bigSize = 132;
  return (
    <AbsoluteFill style={{ background: "#04060c", fontFamily, overflow: "hidden" }}>
      <AbsoluteFill style={{ opacity: fade }}>
        <Img src={staticFile(base)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z}) translate(${dx}px, ${dy}px)`, filter: "saturate(1.06) contrast(1.07) brightness(0.95)" }} />
        {near ? <Img src={staticFile(near)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", transform: `scale(${nz}) translate(${dx * 2.1}px, ${dy * 2.1}px)` }} /> : null}
        {/* cinematic light sweep */}
        <AbsoluteFill style={{ background: `linear-gradient(115deg, transparent ${sweep - 22}%, rgba(255,240,210,0.10) ${sweep}%, transparent ${sweep + 22}%)`, mixBlendMode: "screen", pointerEvents: "none" }} />
        {/* readability scrims (title sits lower-left) */}
        <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(3,5,11,0.88) 0%, rgba(3,5,11,0.5) 38%, transparent 64%)" }} />
        <AbsoluteFill style={{ background: "linear-gradient(0deg, rgba(3,5,11,0.78) 0%, transparent 42%)" }} />
        {/* title overlay (always on top of the cutout) */}
        <div style={{ position: "absolute", left: 110, bottom: 122 }}>
          <div style={{ opacity: kIn, transform: `translateY(${interpolate(kIn, [0, 1], [18, 0])}px)`, fontSize: 30, fontWeight: 600, letterSpacing: "0.4em", color: accent, textTransform: "uppercase" }}>{kicker}</div>
          <div style={{ width: lineW, height: 4, borderRadius: 2, background: accent, margin: "16px 0 22px", boxShadow: `0 0 16px ${accent}aa` }} />
          {lines.map((ln, li) => (
            <div key={li} style={{ lineHeight: 0.98 }}>{ln.split(" ").map((w, wi) => { wd += 4; return <Word key={wi} word={w} delay={wd} size={bigSize} />; })}</div>
          ))}
          <div style={{ opacity: subIn, transform: `translateY(${interpolate(subIn, [0, 1], [22, 0])}px)`, fontSize: 30, fontWeight: 600, letterSpacing: "0.24em", color: "#aebccb", marginTop: 22 }}>{sub}</div>
        </div>
        {/* grain */}
        <AbsoluteFill style={{ backgroundImage: GRAIN, backgroundSize: "220px 220px", opacity: 0.07, mixBlendMode: "overlay", pointerEvents: "none" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ boxShadow: "inset 0 0 420px 90px rgba(2,4,9,0.85)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
