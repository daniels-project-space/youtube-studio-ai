"use client";

import { useId } from "react";

/**
 * Hand-rolled SVG line chart — zero dependencies (mirrors v1's svgLineChart).
 * Renders one or more series over a shared x-axis (the data point index). Each
 * point is {label, value}; `label` drives sparse x-axis ticks. A soft gradient
 * area sits under the first series. Degrades cleanly: 0 points → a tasteful
 * "no data" note; 1 point → a single marker (no line).
 *
 * Pure presentational + responsive via a viewBox (the SVG scales to its box).
 */

export type ChartPoint = { label: string; value: number };
export type ChartSeries = {
  name: string;
  color: string;
  points: ChartPoint[];
};

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

export function Chart({
  series,
  title,
  height = H,
  formatValue = (n) => compact(n),
}: {
  series: ChartSeries[];
  title?: string;
  height?: number;
  formatValue?: (n: number) => string;
}) {
  const gid = useId().replace(/[:]/g, "");
  const allPoints = series.flatMap((s) => s.points);
  const hasData = allPoints.length > 0;

  if (!hasData) {
    return (
      <div className="glass" style={{ padding: "1.1rem 1.2rem" }}>
        {title && <ChartTitle title={title} series={series} />}
        <div
          style={{
            height: height - 60,
            display: "grid",
            placeItems: "center",
            color: "var(--color-faint)",
            fontSize: "0.85rem",
          }}
        >
          No data yet
        </div>
      </div>
    );
  }

  const maxLen = Math.max(...series.map((s) => s.points.length), 1);
  const maxVal = Math.max(...allPoints.map((p) => p.value), 0);
  const minVal = Math.min(...allPoints.map((p) => p.value), 0);
  // Pad the range so the line never hugs the top/bottom edge.
  const span = maxVal - minVal || 1;
  const lo = minVal - span * 0.08;
  const hi = maxVal + span * 0.08;

  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (maxLen <= 1 ? plotW / 2 : (i / (maxLen - 1)) * plotW);
  const y = (val: number) =>
    PAD.top + plotH - ((val - lo) / (hi - lo || 1)) * plotH;

  // Horizontal gridlines + y-axis labels (4 bands).
  const bands = 4;
  const gridVals = Array.from(
    { length: bands + 1 },
    (_, i) => lo + ((hi - lo) / bands) * i,
  );

  // Sparse x-axis ticks (first, middle, last) from the longest series labels.
  const labelSeries =
    series.find((s) => s.points.length === maxLen) ?? series[0];
  const tickIdx = [0, Math.floor((maxLen - 1) / 2), maxLen - 1].filter(
    (v, idx, arr) => arr.indexOf(v) === idx && v >= 0,
  );

  return (
    <div className="glass" style={{ padding: "1.1rem 1.2rem" }}>
      {title && <ChartTitle title={title} series={series} />}
      <svg
        viewBox={`0 0 ${W} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={title ?? "chart"}
      >
        <defs>
          <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={series[0]?.color ?? "var(--color-accent)"}
              stopOpacity="0.22"
            />
            <stop
              offset="100%"
              stopColor={series[0]?.color ?? "var(--color-accent)"}
              stopOpacity="0"
            />
          </linearGradient>
        </defs>

        {/* Gridlines + y labels */}
        {gridVals.map((gv, i) => {
          const gy = y(gv);
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={gy}
                y2={gy}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={gy + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--color-faint)"
                fontFamily="var(--font-mono)"
              >
                {formatValue(gv)}
              </text>
            </g>
          );
        })}

        {/* x ticks */}
        {tickIdx.map((ti) => {
          const lbl = labelSeries?.points[ti]?.label ?? "";
          if (!lbl) return null;
          return (
            <text
              key={ti}
              x={x(ti)}
              y={height - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-faint)"
              fontFamily="var(--font-mono)"
            >
              {lbl}
            </text>
          );
        })}

        {/* Area under the first series */}
        {series[0] && series[0].points.length > 1 && (
          <path
            d={
              areaPath(series[0].points, x, y, height - PAD.bottom) ?? undefined
            }
            fill={`url(#fill-${gid})`}
          />
        )}

        {/* Series lines + markers */}
        {series.map((s, si) => (
          <g key={si}>
            {s.points.length > 1 && (
              <path
                d={linePath(s.points, x, y)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {s.points.map((p, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(p.value)}
                r={s.points.length === 1 ? 4 : 2.5}
                fill={s.color}
              >
                <title>{`${s.name} · ${p.label}: ${formatValue(p.value)}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

function ChartTitle({
  title,
  series,
}: {
  title: string;
  series: ChartSeries[];
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        marginBottom: "0.5rem",
      }}
    >
      <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{title}</span>
      {series.length > 1 && (
        <div style={{ display: "flex", gap: "0.85rem", flexWrap: "wrap" }}>
          {series.map((s) => (
            <span
              key={s.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.72rem",
                color: "var(--color-muted)",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: s.color,
                }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function linePath(
  points: ChartPoint[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");
}

function areaPath(
  points: ChartPoint[],
  x: (i: number) => number,
  y: (v: number) => number,
  baseline: number,
): string | null {
  if (points.length < 2) return null;
  const top = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");
  const lastX = x(points.length - 1).toFixed(1);
  const firstX = x(0).toFixed(1);
  return `${top} L ${lastX} ${baseline.toFixed(1)} L ${firstX} ${baseline.toFixed(1)} Z`;
}

/** Compact number formatter (1.2K, 3.4M) for axis labels + tooltips. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
