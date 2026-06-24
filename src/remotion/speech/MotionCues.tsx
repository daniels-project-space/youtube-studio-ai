import React from "react";
import {
  interpolate,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { frameToMs } from "./types";
import type { IconId, MotionCue, SpeechTheme } from "./types";

/**
 * Motion-graphic cue renderers. Each cue is mounted ONLY within its [start,end]
 * ms window (see MotionCueLayer), so a graphic is on screen for exactly as long
 * as it is script-relevant. Local progress `p` runs 0→1 across that window.
 */

// ---------------------------------------------------------------- icons
const ICON_PATHS: Record<IconId, React.ReactNode> = {
  // simple white silhouette glyphs on a 0..100 viewBox
  money: (
    <g>
      <path d="M35 30 L65 30 L72 18 L28 18 Z" fill="currentColor" />
      <path
        d="M30 32 C12 48 12 86 50 90 C88 86 88 48 70 32 Z"
        fill="currentColor"
      />
      <text
        x="50"
        y="70"
        textAnchor="middle"
        fontSize="34"
        fontWeight="800"
        fill="#000"
        fontFamily="Arial"
      >
        $
      </text>
    </g>
  ),
  person: (
    <g fill="currentColor">
      <circle cx="50" cy="32" r="18" />
      <path d="M18 92 C18 64 82 64 82 92 Z" />
    </g>
  ),
  lightbulb: (
    <g fill="currentColor">
      <path d="M50 10 C28 10 18 28 28 48 C33 58 38 60 38 70 L62 70 C62 60 67 58 72 48 C82 28 72 10 50 10 Z" />
      <rect x="40" y="74" width="20" height="7" rx="2" />
      <rect x="43" y="84" width="14" height="6" rx="2" />
    </g>
  ),
  book: (
    <g fill="currentColor">
      <path d="M50 24 C38 16 20 16 14 20 L14 80 C20 76 38 76 50 84 Z" />
      <path d="M50 24 C62 16 80 16 86 20 L86 80 C80 76 62 76 50 84 Z" />
    </g>
  ),
  eye: (
    <g>
      <path
        d="M10 50 C30 22 70 22 90 50 C70 78 30 78 10 50 Z"
        fill="currentColor"
      />
      <circle cx="50" cy="50" r="14" fill="#000" />
      <circle cx="50" cy="50" r="6" fill="currentColor" />
    </g>
  ),
  ear: (
    <g fill="currentColor">
      <path d="M38 16 C18 18 18 50 30 64 C36 72 34 84 46 88 C58 90 58 78 52 70 C46 62 64 62 64 40 C64 22 54 14 38 16 Z" />
    </g>
  ),
  growth: (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="14,78 38,52 56,64 86,24" />
      <polyline points="66,22 88,22 88,44" />
    </g>
  ),
};

const IconPop: React.FC<{ cue: MotionCue; p: number; theme: SpeechTheme }> = ({
  cue,
  p,
  theme,
}) => {
  // p-driven pop so the animation is independent of absolute frame / window length
  const scale = interpolate(p, [0, 0.18], [0.2, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const out = interpolate(p, [0.85, 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const float = Math.sin(p * Math.PI * 2) * 6;
  const size = 180;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: "30%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        opacity: out,
        transform: `translateY(${float}px) scale(${scale})`,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{ color: theme.accent, filter: "drop-shadow(0 6px 24px rgba(0,0,0,0.6))" }}
      >
        {ICON_PATHS[cue.icon ?? "lightbulb"]}
      </svg>
      {cue.text && (
        <span
          style={{
            color: theme.captionColor,
            fontFamily: theme.fontFamily,
            fontSize: 30,
            fontWeight: 700,
            textShadow: "0 2px 12px rgba(0,0,0,0.8)",
          }}
        >
          {cue.text}
        </span>
      )}
    </div>
  );
};

const WavyUnderline: React.FC<{ cue: MotionCue; p: number; theme: SpeechTheme }> = ({
  cue,
  p,
  theme,
}) => {
  const { width } = useVideoConfig();
  const out = interpolate(p, [0.9, 1], [1, 0], { extrapolateLeft: "clamp" });
  const draw = interpolate(p, [0, 0.5], [0, 1], { extrapolateRight: "clamp" });
  const fontSize = Math.round(width * 0.034);
  const w = 760;
  const h = 40;
  // a gentle sine wave path
  const pts: string[] = [];
  for (let x = 0; x <= w; x += 8) {
    const y = h / 2 + Math.sin((x / w) * Math.PI * 8) * 6;
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: "42%",
        textAlign: "center",
        opacity: out,
        fontFamily: theme.fontFamily,
      }}
    >
      {cue.text && (
        <div
          style={{
            color: theme.captionColor,
            fontSize,
            fontWeight: 800,
            textShadow: "0 2px 14px rgba(0,0,0,0.85)",
            marginBottom: 4,
          }}
        >
          {cue.text}
        </div>
      )}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: "80%" }}>
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={theme.accent}
          strokeWidth={4}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
        />
      </svg>
    </div>
  );
};

const LineGraphCue: React.FC<{ cue: MotionCue; p: number; theme: SpeechTheme }> = ({
  cue,
  p,
  theme,
}) => {
  const pts = cue.points && cue.points.length >= 2 ? cue.points : [1, 2, 8, 3, 2];
  const W = 420;
  const H = 200;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = Math.max(1e-6, max - min);
  const coords = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - ((v - min) / span) * (H * 0.82) - H * 0.09;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const draw = interpolate(p, [0.05, 0.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const out = interpolate(p, [0.88, 1], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: "32%",
        display: "flex",
        justifyContent: "center",
        opacity: out,
      }}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <line x1={0} y1={H - 1} x2={W} y2={H - 1} stroke="rgba(255,255,255,0.25)" strokeWidth={2} />
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke={theme.accent}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
          style={{ filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.5))" }}
        />
      </svg>
    </div>
  );
};

const StepBoxes: React.FC<{ cue: MotionCue; p: number; theme: SpeechTheme }> = ({
  cue,
  p,
  theme,
}) => {
  const steps = (cue.steps ?? []).slice(0, 3);
  const out = interpolate(p, [0.92, 1], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "6%",
        display: "flex",
        justifyContent: "center",
        gap: 22,
        padding: "0 6%",
        opacity: out,
        fontFamily: theme.fontFamily,
      }}
    >
      {steps.map((s, i) => {
        const reveal = interpolate(p, [0.05 + i * 0.12, 0.35 + i * 0.12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const active = cue.highlightStep === i + 1;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              maxWidth: 360,
              minHeight: 96,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "18px 22px",
              borderRadius: 10,
              border: `2px solid ${active ? theme.accent : "rgba(255,255,255,0.4)"}`,
              background: "rgba(0,0,0,0.3)",
              boxShadow: active
                ? `0 0 26px ${theme.accent}, inset 0 0 14px rgba(255,255,255,0.25)`
                : "none",
              color: theme.captionColor,
              fontSize: 26,
              fontWeight: 700,
              // pixelated→sharp resolve approximated by blur lift
              filter: `blur(${(1 - reveal) * 9}px)`,
              opacity: 0.25 + reveal * 0.75,
            }}
          >
            {s}
          </div>
        );
      })}
    </div>
  );
};

const LowerThird: React.FC<{ cue: MotionCue; p: number; theme: SpeechTheme }> = ({
  cue,
  p,
  theme,
}) => {
  const x = interpolate(p, [0, 0.12], [-60, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const out = interpolate(p, [0.88, 1], [1, 0], { extrapolateLeft: "clamp" });
  const appear = interpolate(p, [0, 0.12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: 56,
        bottom: "12%",
        opacity: out * appear,
        transform: `translateX(${x}px)`,
        fontFamily: theme.fontFamily,
      }}
    >
      <div
        style={{
          display: "inline-block",
          padding: "12px 26px",
          background: "rgba(10,12,18,0.72)",
          borderLeft: `5px solid ${theme.accent}`,
          color: theme.captionColor,
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: 0.4,
          textShadow: "0 2px 10px rgba(0,0,0,0.8)",
        }}
      >
        {cue.text}
      </div>
    </div>
  );
};

const GlitchBurst: React.FC<{ cue: MotionCue; p: number; theme: SpeechTheme }> = ({
  cue,
  p,
}) => {
  // brief VHS burst: a few displaced horizontal bands with cyan/red fringe + scanlines
  const intensity = Math.sin(p * Math.PI); // 0→1→0 across the window
  const bands = 7;
  const seedBase = Math.round(cue.start);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: intensity }}>
      {Array.from({ length: bands }).map((_, i) => {
        const r = random(`${seedBase}-${i}`);
        const top = r * 100;
        const height = 4 + random(`${seedBase}-h-${i}`) * 10;
        const dx = (random(`${seedBase}-x-${i}`) - 0.5) * 60 * intensity;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${top}%`,
              height,
              transform: `translateX(${dx}px)`,
              background:
                "linear-gradient(90deg, rgba(255,0,80,0.35), rgba(255,255,255,0.12), rgba(0,200,255,0.35))",
              mixBlendMode: "screen",
            }}
          />
        );
      })}
      {/* scanlines */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 2px, transparent 4px)",
        }}
      />
    </div>
  );
};

const CUE_COMPONENTS: Record<
  MotionCue["type"],
  React.FC<{ cue: MotionCue; p: number; theme: SpeechTheme }>
> = {
  iconPop: IconPop,
  wavyUnderline: WavyUnderline,
  lineGraph: LineGraphCue,
  stepBoxes: StepBoxes,
  lowerThird: LowerThird,
  glitch: GlitchBurst,
};

/**
 * Mounts every cue whose [start,end] window contains the current time and hands
 * each renderer its local progress `p` (0→1 across the window).
 */
export const MotionCueLayer: React.FC<{
  cues: MotionCue[];
  theme: SpeechTheme;
}> = ({ cues, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frameToMs(frame, fps);

  return (
    <>
      {cues.map((cue, i) => {
        if (t < cue.start || t >= cue.end) return null;
        const p = Math.max(0, Math.min(1, (t - cue.start) / Math.max(1, cue.end - cue.start)));
        const Comp = CUE_COMPONENTS[cue.type];
        if (!Comp) return null;
        return <Comp key={i} cue={cue} p={p} theme={theme} />;
      })}
    </>
  );
};
