import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont();

export type KineticTitleProps = { kicker: string; lines: string[]; sub: string };
export const kineticTitleDefaults: KineticTitleProps = { kicker: "ANTWERP · 2003", lines: ["THE HEIST", "OF THE CENTURY"], sub: "$100 MILLION · GONE IN ONE NIGHT" };

const Word: React.FC<{ word: string; delay: number; size: number; color: string }> = ({ word, delay, size, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: frame - delay, fps, config: { damping: 180, mass: 0.6 } });
  return <span style={{ display: "inline-block", opacity: e, transform: `translateY(${interpolate(e, [0, 1], [90, 0])}px)`, fontSize: size, fontWeight: 800, color, letterSpacing: "-0.01em", marginRight: size * 0.16, lineHeight: 1.0 }}>{word}</span>;
};

export const KineticTitle: React.FC<KineticTitleProps> = ({ kicker, lines, sub }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const kIn = spring({ frame, fps, config: { damping: 200 } });
  const line = interpolate(frame, [10, 26], [0, 640], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const subIn = spring({ frame: frame - 70, fps, config: { damping: 200 } });
  const fade = interpolate(frame, [0, 12, durationInFrames - 14, durationInFrames], [0, 1, 1, 0]);
  let wd = 16;
  return (
    <AbsoluteFill style={{ fontFamily, background: "radial-gradient(130% 130% at 50% 35%, #0c1626 0%, #060a12 60%, #04060c 100%)", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
      <AbsoluteFill style={{ opacity: 0.4, backgroundImage: "linear-gradient(#13243a 1px, transparent 1px), linear-gradient(90deg, #13243a 1px, transparent 1px)", backgroundSize: "64px 64px", maskImage: "radial-gradient(120% 90% at 50% 45%, black 25%, transparent 78%)" as React.CSSProperties["maskImage"] }} />
      <AbsoluteFill style={{ opacity: fade, justifyContent: "center", alignItems: "center" }}>
        <div style={{ opacity: kIn, transform: `translateY(${interpolate(kIn, [0, 1], [20, 0])}px)`, fontSize: 36, fontWeight: 600, letterSpacing: "0.34em", color: "#5fe0cf", marginBottom: 14 }}>{kicker}</div>
        <div style={{ width: line, height: 4, borderRadius: 2, background: "#e8b23a", marginBottom: 30, boxShadow: "0 0 18px #e8b23a99" }} />
        {lines.map((ln, li) => (
          <div key={li} style={{ lineHeight: 0.98 }}>
            {ln.split(" ").map((w, wi) => { wd += 4; return <Word key={wi} word={w} delay={wd} size={li === 0 ? 168 : 168} color="#eef4fa" />; })}
          </div>
        ))}
        <div style={{ opacity: subIn, transform: `translateY(${interpolate(subIn, [0, 1], [30, 0])}px)`, fontSize: 36, fontWeight: 600, letterSpacing: "0.22em", color: "#9fb0c0", marginTop: 30 }}>{sub}</div>
      </AbsoluteFill>
      <AbsoluteFill style={{ boxShadow: "inset 0 0 440px 90px rgba(2,4,9,0.85)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
