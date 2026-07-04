import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont();
const PALETTE = ["#e8b23a", "#5fe0cf", "#4a9eff", "#ff5050", "#b08bff"];

export type Stat = { prefix?: string; value: number; suffix?: string; label: string; frac: number; color?: string };
export type DataStatsProps = { kicker: string; titlePre: string; titleHi: string; stats: Stat[]; tagline: string; taglineNote: string };

export const dataStatsDefaults: DataStatsProps = {
  kicker: "THE 2003 ANTWERP DIAMOND HEIST",
  titlePre: "BY THE ", titleHi: "NUMBERS",
  stats: [
    { prefix: "$", value: 100, suffix: "M+", label: "STOLEN IN DIAMONDS & GOLD", frac: 0.94, color: "#e8b23a" },
    { value: 10, label: "SECURITY LAYERS BYPASSED", frac: 1.0, color: "#5fe0cf" },
    { value: 2, label: "FLOORS UNDERGROUND", frac: 0.42, color: "#4a9eff" },
    { value: 0, label: "ALARMS TRIGGERED", frac: 0.0, color: "#ff5050" },
  ],
  tagline: "THE HEIST OF THE CENTURY", taglineNote: "NEVER FULLY SOLVED",
};

const StatRow: React.FC<{ s: Stat; delay: number; color: string }> = ({ s, delay, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.7 } });
  const x = interpolate(e, [0, 1], [70, 0]);
  const count = Math.round(interpolate(frame - delay, [6, 46], [0, s.value], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const barW = interpolate(frame - delay, [14, 60], [0, s.frac], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const zp = s.value === 0 ? 1 + 0.06 * Math.sin((frame - delay) / 6) : 1;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 60, opacity: e, transform: `translateX(${x}px)`, marginBottom: 6 }}>
      <div style={{ width: 420, textAlign: "right", fontWeight: 800, fontSize: 104, lineHeight: 1, color, letterSpacing: "-0.02em", textShadow: `0 0 40px ${color}40`, transform: `scale(${zp})`, transformOrigin: "right center" }}>
        {s.prefix || ""}{count}{s.suffix || ""}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 27, letterSpacing: "0.22em", color: "#eef4fa", fontWeight: 600, marginBottom: 14 }}>{s.label}</div>
        <div style={{ height: 12, borderRadius: 8, background: "#16202e", overflow: "hidden", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.6)" }}>
          <div style={{ height: "100%", width: `${barW * 100}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)`, borderRadius: 8, boxShadow: `0 0 18px ${color}aa` }} />
        </div>
      </div>
    </div>
  );
};

export const DataStats: React.FC<DataStatsProps> = ({ kicker, titlePre, titleHi, stats, tagline, taglineNote }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const titleIn = spring({ frame, fps, config: { damping: 200 } });
  const kIn = interpolate(frame, [4, 20], [0, 1], { extrapolateRight: "clamp" });
  const tag = spring({ frame: frame - 168, fps, config: { damping: 200 } });
  const fade = interpolate(frame, [0, 12, durationInFrames - 12, durationInFrames], [0, 1, 1, 0]);
  return (
    <AbsoluteFill style={{ fontFamily, background: "radial-gradient(120% 120% at 30% 20%, #0d1726 0%, #060a12 60%, #04060c 100%)" }}>
      <AbsoluteFill style={{ opacity: 0.5, backgroundImage: "linear-gradient(#13243a 1px, transparent 1px), linear-gradient(90deg, #13243a 1px, transparent 1px)", backgroundSize: "64px 64px", transform: `translateY(${(frame * 0.2) % 64}px)`, maskImage: "radial-gradient(120% 90% at 50% 40%, black 30%, transparent 80%)" as React.CSSProperties["maskImage"] }} />
      <AbsoluteFill style={{ opacity: fade, padding: "92px 130px", display: "flex", flexDirection: "column" }}>
        <div style={{ opacity: kIn, fontSize: 24, letterSpacing: "0.5em", color: "#5fe0cf", fontWeight: 600 }}>{kicker}</div>
        <div style={{ opacity: titleIn, transform: `translateY(${interpolate(titleIn, [0, 1], [40, 0])}px)`, fontSize: 96, fontWeight: 800, color: "#eef4fa", letterSpacing: "-0.01em", marginTop: 6, marginBottom: 54 }}>
          {titlePre}<span style={{ color: "#e8b23a" }}>{titleHi}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 30, flex: 1, justifyContent: "center" }}>
          {stats.map((s, i) => (<StatRow key={i} s={s} delay={26 + i * 16} color={s.color || PALETTE[i % PALETTE.length]} />))}
        </div>
        <div style={{ opacity: tag, transform: `translateY(${interpolate(tag, [0, 1], [30, 0])}px)`, borderTop: "1px solid #1c2a3c", paddingTop: 26, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 40, fontWeight: 800, color: "#eef4fa", letterSpacing: "0.02em" }}>{tagline}</div>
          <div style={{ fontSize: 22, letterSpacing: "0.34em", color: "#7d8ea0" }}>{taglineNote}</div>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ boxShadow: "inset 0 0 420px 80px rgba(2,4,9,0.85)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
