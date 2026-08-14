import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  clampOutroSeconds,
  clampSecondsPerRow,
  type ChartBeat,
  type ChartMode,
  type ChartRow,
  type ChartSpec,
} from "../../lib/chartSpec";

/**
 * RankChart — ONE job: animate numbers that someone else already verified.
 *
 * It renders three motions of the same idea:
 *   • bar_race    — bars re-order and grow along a shared time axis
 *   • count_up    — a "Top N" countdown, one row revealed at a time with a
 *                   rolling counter (the classic ranking-video beat)
 *   • line_series — one continuous playthrough of a shared axis, used by the
 *                   dramatized-simulation lane for a population/fitness curve
 *
 * This component NEVER decides what a number is, never sorts a "winner" into
 * existence and never suppresses a source. It prints what the ChartSpec says.
 * In particular `spec.disclosure` is rendered as a persistent banner whenever
 * `spec.speculative` is true — the honesty label is part of the picture, not a
 * caption someone can forget to add in the description box.
 *
 * Dependency-free (plain SVG + divs) so the isolated bundle stays small and a
 * sibling composition's dependency can never break a chart render.
 */

const FPS = 30;

const DEFAULT_PALETTE = ["#0b1020", "#4cc9f0", "#f8f9fb"];
const SERIES_COLORS = ["#4cc9f0", "#f72585", "#ffd166", "#06d6a0", "#b388ff", "#ff9f1c"];

export interface RankChartProps {
  /**
   * Optional so the type stays assignable to Remotion's
   * `LooseComponentType<Record<string, unknown>>` when registered in Root.tsx —
   * the same shape the quiz root uses. An absent spec renders an empty frame.
   */
  spec?: ChartSpec;
  /** Channel palette; [bg, accent, ink] with sensible fallbacks. */
  palette?: string[];
  title?: string;
  width?: number;
  height?: number;
}

/** Shared with chartSpec.ts's chartDurationSeconds — one clamp, two consumers. */
function perRowSeconds(spec: ChartSpec): number {
  return clampSecondsPerRow(spec.secondsPerRow);
}

function outroSeconds(spec: ChartSpec): number {
  return clampOutroSeconds(spec.outroSeconds);
}

/**
 * Frame budget. Deliberately mirrors `chartDurationSeconds()` in
 * src/lib/chartSpec.ts — the block reports seconds from there and the
 * composition sizes itself from here, so the two must agree exactly.
 */
export function totalFrames(spec: ChartSpec | undefined): number {
  if (!spec || !Array.isArray(spec.rows) || spec.rows.length === 0) return FPS;
  const perRow = perRowSeconds(spec);
  const outro = outroSeconds(spec);
  if (spec.mode === "line_series") {
    const steps = spec.rows[0]?.series?.length ?? 0;
    const seconds = Math.max(6, Math.min(600, steps * (perRow / 6)));
    return Math.max(1, Math.round((seconds + outro) * FPS));
  }
  return Math.max(1, Math.round((spec.rows.length * perRow + outro) * FPS));
}

function formatValue(spec: ChartSpec, value: number): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${spec.valuePrefix ?? ""}${rounded.toLocaleString("en-US")}${spec.unit ?? ""}`;
}

/** Value of a row at a fractional position along the shared time axis. */
function seriesValueAt(row: ChartRow, progress: number): number {
  const series = row.series ?? [];
  if (series.length === 0) return row.value;
  const exact = progress * (series.length - 1);
  const lower = Math.max(0, Math.min(series.length - 1, Math.floor(exact)));
  const upper = Math.max(0, Math.min(series.length - 1, Math.ceil(exact)));
  const t = exact - lower;
  return series[lower].value + (series[upper].value - series[lower].value) * t;
}

/** Persistent honesty banner. Rendered whenever the spec declares itself speculative. */
const DisclosureBanner: React.FC<{ text: string; ink: string }> = ({ text, ink }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      padding: "18px 56px",
      background: "rgba(0,0,0,0.55)",
      borderTop: "3px solid #ffd166",
      color: ink,
      fontSize: 26,
      fontWeight: 700,
      letterSpacing: 0.4,
      fontFamily: "Inter, Helvetica, Arial, sans-serif",
      textAlign: "center",
    }}
  >
    {text}
  </div>
);

const SourceStrip: React.FC<{ rows: ChartRow[]; ink: string }> = ({ rows }) => {
  const labels = [...new Set(rows.map((r) => r.sourceLabel).filter(Boolean))] as string[];
  if (labels.length === 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 56,
        bottom: 26,
        fontSize: 22,
        opacity: 0.6,
        fontFamily: "Inter, Helvetica, Arial, sans-serif",
      }}
    >
      {`Source: ${labels.join(" · ")}`}
    </div>
  );
};

const BeatCaption: React.FC<{ beat: ChartBeat | undefined; accent: string; frame: number }> = ({
  beat,
  accent,
  frame,
}) => {
  if (!beat) return null;
  const pop = interpolate(frame % FPS, [0, 8], [0.9, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        top: 150,
        left: 56,
        right: 56,
        fontSize: 34,
        fontWeight: 700,
        color: accent,
        transform: `scale(${pop})`,
        transformOrigin: "left center",
        fontFamily: "Inter, Helvetica, Arial, sans-serif",
      }}
    >
      {beat.caption}
    </div>
  );
};

const Header: React.FC<{ spec: ChartSpec; ink: string; accent: string }> = ({ spec, ink, accent }) => (
  <div style={{ position: "absolute", top: 48, left: 56, right: 56 }}>
    <div
      style={{
        fontSize: 58,
        fontWeight: 900,
        color: ink,
        letterSpacing: -1,
        fontFamily: "Inter, Helvetica, Arial, sans-serif",
      }}
    >
      {spec.title}
    </div>
    {spec.subtitle ? (
      <div
        style={{
          marginTop: 8,
          fontSize: 28,
          color: accent,
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
        }}
      >
        {spec.subtitle}
      </div>
    ) : null}
  </div>
);

const BarRows: React.FC<{
  spec: ChartSpec;
  rows: { row: ChartRow; value: number }[];
  accent: string;
  ink: string;
  revealed: number;
  mode: ChartMode;
  frame: number;
  fps: number;
}> = ({ spec, rows, accent, ink, revealed, mode, frame, fps }) => {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const ordered =
    mode === "bar_race" ? [...rows].sort((a, b) => b.value - a.value) : rows;
  const rowHeight = Math.min(84, Math.floor(760 / Math.max(1, ordered.length)));
  return (
    <div style={{ position: "absolute", top: 210, left: 56, right: 56 }}>
      {ordered.map((entry, index) => {
        // count_up reveals one row at a time (the ranking-video beat);
        // bar_race shows the whole field and lets it re-order.
        const visible = mode === "count_up" ? index < revealed : true;
        if (!visible) return null;
        const enter = spring({
          frame: frame - index * Math.round(fps * 0.15),
          fps,
          config: { damping: 200 },
        });
        const width = (Math.abs(entry.value) / max) * 100;
        return (
          <div
            key={entry.row.id}
            style={{
              display: "flex",
              alignItems: "center",
              height: rowHeight,
              marginBottom: 10,
              opacity: enter,
              transform: `translateY(${(1 - enter) * 24}px)`,
              fontFamily: "Inter, Helvetica, Arial, sans-serif",
            }}
          >
            <div style={{ width: 380, fontSize: 30, fontWeight: 700, color: ink, paddingRight: 18 }}>
              {entry.row.label}
            </div>
            <div style={{ flex: 1, height: rowHeight - 24, background: "rgba(255,255,255,0.07)", borderRadius: 8 }}>
              <div
                style={{
                  width: `${Math.max(1, width * enter)}%`,
                  height: "100%",
                  background: SERIES_COLORS[index % SERIES_COLORS.length] ?? accent,
                  borderRadius: 8,
                }}
              />
            </div>
            <div style={{ width: 240, textAlign: "right", fontSize: 34, fontWeight: 800, color: ink }}>
              {formatValue(spec, entry.value * enter)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const LineSeries: React.FC<{
  spec: ChartSpec;
  progress: number;
  accent: string;
  ink: string;
}> = ({ spec, progress, accent, ink }) => {
  const width = 1760;
  const height = 620;
  const rows = spec.rows;
  const steps = rows[0]?.series?.length ?? 0;
  const allValues = rows.flatMap((r) => (r.series ?? []).map((p) => p.value));
  const max = Math.max(1, ...allValues);
  const min = Math.min(0, ...allValues);
  const visible = Math.max(2, Math.round(progress * steps));
  const x = (index: number) => (index / Math.max(1, steps - 1)) * width;
  const y = (value: number) => height - ((value - min) / Math.max(1e-6, max - min)) * height;
  return (
    <svg width={width} height={height} style={{ position: "absolute", top: 230, left: 80 }}>
      <line x1={0} y1={height} x2={width} y2={height} stroke={ink} strokeOpacity={0.25} strokeWidth={2} />
      <line x1={0} y1={0} x2={0} y2={height} stroke={ink} strokeOpacity={0.25} strokeWidth={2} />
      {rows.map((row, rowIndex) => {
        const points = (row.series ?? [])
          .slice(0, visible)
          .map((point, index) => `${x(index)},${y(point.value)}`)
          .join(" ");
        const color = SERIES_COLORS[rowIndex % SERIES_COLORS.length] ?? accent;
        const last = (row.series ?? [])[visible - 1];
        return (
          <g key={row.id}>
            <polyline points={points} fill="none" stroke={color} strokeWidth={5} strokeLinejoin="round" />
            {last ? <circle cx={x(visible - 1)} cy={y(last.value)} r={9} fill={color} /> : null}
            {last ? (
              <text
                x={Math.min(width - 200, x(visible - 1) + 16)}
                y={y(last.value) - 16}
                fill={color}
                fontSize={28}
                fontWeight={800}
                fontFamily="Inter, Helvetica, Arial, sans-serif"
              >
                {`${row.label} ${formatValue(spec, last.value)}`}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

export const RankChart: React.FC<RankChartProps> = ({ spec, palette, width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [bg, accent, ink] = [
    palette?.[0] || DEFAULT_PALETTE[0],
    palette?.[1] || DEFAULT_PALETTE[1],
    palette?.[2] || DEFAULT_PALETTE[2],
  ];

  if (!spec || !Array.isArray(spec.rows) || spec.rows.length === 0) {
    return <AbsoluteFill style={{ backgroundColor: bg }} />;
  }

  const perRow = perRowSeconds(spec);
  const bodyFrames = Math.max(
    1,
    totalFrames(spec) - Math.round(outroSeconds(spec) * fps),
  );
  const progress = Math.max(0, Math.min(1, frame / bodyFrames));

  const revealed =
    spec.mode === "count_up"
      ? Math.max(0, Math.min(spec.rows.length, Math.floor(frame / Math.max(1, perRow * fps)) + 1))
      : spec.rows.length;

  const valuedRows = spec.rows.map((row) => ({
    row,
    value:
      spec.mode === "count_up"
        ? row.value
        : seriesValueAt(row, progress),
  }));

  const step = Math.round(progress * Math.max(0, (spec.rows[0]?.series?.length ?? 1) - 1));
  const activeBeat = (spec.beats ?? [])
    .filter((beat) => beat.step <= step)
    .sort((a, b) => b.step - a.step)[0];

  return (
    <AbsoluteFill style={{ backgroundColor: bg, color: ink, width, height }}>
      <Header spec={spec} ink={ink} accent={accent} />
      {spec.stepLabel ? (
        <div
          style={{
            position: "absolute",
            top: 52,
            right: 56,
            fontSize: 32,
            fontWeight: 800,
            color: accent,
            fontFamily: "Inter, Helvetica, Arial, sans-serif",
          }}
        >
          {`${spec.stepLabel} ${spec.rows[0]?.series?.[step]?.step ?? step}`}
        </div>
      ) : null}

      {spec.mode === "line_series" ? (
        <>
          <LineSeries spec={spec} progress={progress} accent={accent} ink={ink} />
          <BeatCaption beat={activeBeat} accent={accent} frame={frame} />
        </>
      ) : (
        <BarRows
          spec={spec}
          rows={valuedRows}
          accent={accent}
          ink={ink}
          revealed={revealed}
          mode={spec.mode}
          frame={frame}
          fps={fps}
        />
      )}

      {spec.speculative && spec.disclosure ? (
        <DisclosureBanner text={spec.disclosure} ink={ink} />
      ) : (
        <SourceStrip rows={spec.rows} ink={ink} />
      )}
    </AbsoluteFill>
  );
};
