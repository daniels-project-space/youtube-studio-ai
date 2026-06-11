import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * Transparent DATA-VIZ insert (alpha) — the channel-tailorable motion-graphics
 * layer. Three kinds, all branded by the channel's Style-DNA palette:
 *
 *   big_stat    — a huge number/percent/$ counting up + a label
 *   line_chart  — an animated draw-on curve (compound growth, drawdowns…)
 *   bar_compare — 2-4 labeled bars racing up (X vs Y comparisons)
 *
 * ffmpeg composites it over the (blurred) body exactly while the narration
 * speaks the underlying numbers. Self-contained (remotion core only) so it
 * bundles for cloud rendering.
 */
export type DataInsertProps = {
  kind: "big_stat" | "line_chart" | "bar_compare" | "annotated_line" | "lower_third";
  /** annotated_line: labeled event markers on the curve (idx into series). */
  events?: { idx: number; label: string }[];
  /** Short headline above the visual (≤ 8 words). */
  title?: string;
  /** big_stat: the display value, e.g. "$534,000", "87%", "1,2 Mio". */
  value?: string;
  /** big_stat: small label under the number. */
  label?: string;
  /** line_chart: the series to draw (2-32 points). */
  series?: number[];
  /** line_chart: x-axis end labels, e.g. ["2016", "2026"]. */
  xLabels?: string[];
  /** bar_compare: 2-4 bars. display defaults to the raw value. */
  bars?: { label: string; value: number; display?: string }[];
  /** Brand palette (dominant → accent); accent falls back to gold. */
  palette?: string[];
  accent?: string;
};

const FALLBACK_ACCENT = "#e3b341";
const INK = "#f3f1ea";

/** Animate a display value like "$534,000" / "87%" from 0 → final. */
function animateValue(display: string, t: number): string {
  const m = display.match(/-?\d[\d,.\s]*/);
  if (!m) return display;
  const numStr = m[0];
  const clean = numStr.replace(/[,\s]/g, "");
  const target = parseFloat(clean);
  if (!Number.isFinite(target)) return display;
  const hasDecimals = /\.\d/.test(clean);
  const cur = target * t;
  const formatted = hasDecimals
    ? cur.toFixed(Math.min(2, (clean.split(".")[1] ?? "").length))
    : Math.round(cur).toLocaleString("en-US");
  return display.replace(numStr, formatted);
}

export const DataInsert: React.FC<DataInsertProps> = ({
  kind: kindRaw,
  title,
  value,
  label,
  series,
  xLabels,
  bars,
  events,
  palette,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const ac = accent ?? (palette && palette.length > 2 ? palette[palette.length - 2] : FALLBACK_ACCENT);
  // annotated_line = line_chart + event markers (same chart machinery).
  const kind = kindRaw === "annotated_line" ? "line_chart" : kindRaw;

  // LOWER THIRD — a small bottom-left source-citation badge ("Source: Federal
  // Reserve, 2023"), composited WITHOUT background blur. The trust device of
  // data journalism: attribution appears the moment the stat is spoken.
  if (kind === "lower_third") {
    const lf = (a: number, b: number, c: [number, number]) =>
      interpolate(frame, [a, b], c, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const slideIn = lf(0, 14, [-40, 0]);
    const inA = lf(0, 12, [0, 1]);
    const outA = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
    return (
      <AbsoluteFill>
        <div
          style={{
            position: "absolute",
            left: Math.round(width * 0.045),
            bottom: Math.round(height * 0.16),
            transform: `translateX(${slideIn}px)`,
            opacity: Math.min(inA, outA),
            background: "rgba(8,10,18,0.82)",
            borderLeft: `4px solid ${ac}`,
            padding: `${Math.round(height * 0.012)}px ${Math.round(width * 0.014)}px`,
            borderRadius: 4,
            maxWidth: Math.round(width * 0.4),
          }}
        >
          <div style={{ fontSize: Math.round(width * 0.011), fontWeight: 700, letterSpacing: "0.22em", color: ac, textTransform: "uppercase" }}>
            {title ?? "Source"}
          </div>
          <div style={{ fontSize: Math.round(width * 0.015), fontWeight: 600, color: INK, marginTop: 4 }}>
            {value ?? label ?? ""}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  const scrim = interpolate(frame, [0, 24], [0, 0.5], { extrapolateRight: "clamp" });
  const appear = interpolate(frame, [6, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rise = interpolate(spring({ frame, fps, config: { damping: 200, stiffness: 60 } }), [0, 1], [36, 0]);
  const fadeOut = interpolate(frame, [durationInFrames - 30, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // The data animation runs ~1.6s after entry.
  const dataT = interpolate(frame, [16, 16 + Math.round(fps * 1.6)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleSize = Math.round(width * 0.022);
  const W = Math.round(width * 0.62);
  const H = Math.round(height * 0.42);

  let body: React.ReactNode = null;

  if (kind === "big_stat") {
    const valSize = Math.round(width * 0.085);
    body = (
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: valSize,
            fontWeight: 800,
            color: INK,
            letterSpacing: "-0.01em",
            textShadow: "0 6px 36px rgba(0,0,0,0.75)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {animateValue(value ?? "", dataT)}
        </div>
        <div style={{ height: 4, width: Math.round(width * 0.12), background: ac, margin: "18px auto", borderRadius: 2 }} />
        {label ? (
          <div style={{ fontSize: Math.round(width * 0.018), color: INK, opacity: 0.92, fontWeight: 500 }}>{label}</div>
        ) : null}
      </div>
    );
  } else if (kind === "line_chart") {
    const pts = (series ?? []).filter((n) => Number.isFinite(n));
    if (pts.length >= 2) {
      const min = Math.min(...pts);
      const max = Math.max(...pts);
      const span = max - min || 1;
      const px = (i: number) => (i / (pts.length - 1)) * W;
      const py = (v: number) => H - ((v - min) / span) * (H - 24) - 12;
      const dAttr = pts.map((v, i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
      // Draw-on via dash interpolation; generous length upper bound.
      const totalLen = W * 2.2;
      const drawn = totalLen * dataT;
      const endIdx = Math.max(0, Math.min(pts.length - 1, Math.round(dataT * (pts.length - 1))));
      body = (
        <div>
          <svg width={W} height={H} style={{ overflow: "visible" }}>
            {/* baseline + axis */}
            <line x1={0} y1={H} x2={W} y2={H} stroke={INK} strokeOpacity={0.35} strokeWidth={2} />
            <path
              d={dAttr}
              fill="none"
              stroke={ac}
              strokeWidth={Math.max(4, Math.round(width * 0.004))}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={totalLen}
              strokeDashoffset={totalLen - drawn}
              style={{ filter: "drop-shadow(0 4px 18px rgba(0,0,0,0.6))" }}
            />
            <circle cx={px(endIdx)} cy={py(pts[endIdx])} r={Math.max(6, Math.round(width * 0.005))} fill={ac} opacity={dataT > 0.05 ? 1 : 0} />
            {/* annotated_line: labeled event markers pop as the draw-on passes them */}
            {(events ?? [])
              .filter((e) => Number.isInteger(e.idx) && e.idx >= 0 && e.idx < pts.length && e.label)
              .slice(0, 4)
              .map((e, n) => {
                const reached = dataT * (pts.length - 1) >= e.idx;
                const above = py(pts[e.idx]) > H * 0.4;
                return (
                  <g key={n} opacity={reached ? 1 : 0}>
                    <circle cx={px(e.idx)} cy={py(pts[e.idx])} r={Math.max(5, Math.round(width * 0.004))} fill="none" stroke={ac} strokeWidth={3} />
                    <line x1={px(e.idx)} y1={py(pts[e.idx])} x2={px(e.idx)} y2={py(pts[e.idx]) + (above ? -26 : 26)} stroke={ac} strokeWidth={2} strokeOpacity={0.8} />
                    <text
                      x={px(e.idx)}
                      y={py(pts[e.idx]) + (above ? -34 : 44)}
                      textAnchor="middle"
                      fill={INK}
                      fontSize={Math.round(width * 0.0125)}
                      fontWeight={700}
                      style={{ filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.9))" }}
                    >
                      {e.label.slice(0, 26)}
                    </text>
                  </g>
                );
              })}
          </svg>
          {xLabels && xLabels.length >= 2 ? (
            <div style={{ display: "flex", justifyContent: "space-between", width: W, marginTop: 10 }}>
              <span style={{ color: INK, opacity: 0.8, fontSize: Math.round(width * 0.014) }}>{xLabels[0]}</span>
              <span style={{ color: INK, opacity: 0.8, fontSize: Math.round(width * 0.014) }}>{xLabels[xLabels.length - 1]}</span>
            </div>
          ) : null}
        </div>
      );
    }
  } else if (kind === "bar_compare") {
    const bs = (bars ?? []).slice(0, 4).filter((b) => b && Number.isFinite(b.value));
    if (bs.length >= 2) {
      const max = Math.max(...bs.map((b) => Math.abs(b.value))) || 1;
      const best = bs.reduce((a, b) => (b.value > a.value ? b : a), bs[0]);
      const rowH = Math.round(H / bs.length);
      body = (
        <div style={{ width: W }}>
          {bs.map((b, i) => {
            const frac = (Math.abs(b.value) / max) * dataT;
            const isBest = b === best;
            return (
              <div key={i} style={{ marginBottom: Math.round(rowH * 0.28) }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: INK, fontSize: Math.round(width * 0.016), fontWeight: 600 }}>{b.label}</span>
                  <span
                    style={{
                      color: isBest ? ac : INK,
                      fontSize: Math.round(width * 0.016),
                      fontWeight: 800,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {animateValue(b.display ?? String(b.value), dataT)}
                  </span>
                </div>
                <div style={{ height: Math.round(rowH * 0.34), background: "rgba(255,255,255,0.12)", borderRadius: 6, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.max(1.5, frac * 100)}%`,
                      height: "100%",
                      background: isBest ? ac : "rgba(255,255,255,0.55)",
                      borderRadius: 6,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      );
    }
  }

  if (!body) return <AbsoluteFill />;

  return (
    <AbsoluteFill style={{ opacity: fadeOut, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: scrim }} />
      <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `translateY(${rise}px)`, opacity: appear }}>
          {title ? (
            <div
              style={{
                color: INK,
                fontSize: titleSize,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                marginBottom: 26,
                textAlign: "center",
                textShadow: "0 4px 24px rgba(0,0,0,0.7)",
              }}
            >
              {title}
            </div>
          ) : null}
          {body}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
