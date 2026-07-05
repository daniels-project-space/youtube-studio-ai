/**
 * MapArcRoutes — ANIMATED WORLD MAP with great-circle arc routes.
 *
 * Muted dark map via react-simple-maps + world-atlas (110m). USA region
 * glows/pulses. 2 great-circle ARC routes draw on USA -> Nigeria and
 * USA -> India using d3-geo geoInterpolate (partial arc) + stroke-dashoffset
 * draw-on, with a moving dot at the arc head. "EXPORTED" label slides in.
 *
 * Deterministic: all motion from useCurrentFrame() + interpolate.
 */
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { geoInterpolate, geoMercator, geoPath } from "d3-geo";
import { loadFont } from "@remotion/google-fonts/Oswald";
// world-atlas TopoJSON shipped with the package.
import worldTopo from "world-atlas/countries-110m.json";

const { fontFamily } = loadFont();

const GEO_URL = worldTopo as unknown;

// [lon, lat]
const USA: [number, number] = [-98, 39];
const NIGERIA: [number, number] = [8, 9];
const INDIA: [number, number] = [79, 22];

// US country ids in world-atlas 110m (numeric ISO "840").
const US_IDS = new Set(["840"]);

// Projection matched to ComposableMap default (geoEqualEarth ~ but we use
// mercator-ish equalEarth). react-simple-maps default is geoEqualEarth; we
// build our own matching projection for the overlay arcs.
const WIDTH = 1920;
const HEIGHT = 1080;

const buildArc = (
  a: [number, number],
  b: [number, number],
  t: number,
  project: (c: [number, number]) => [number, number] | null
): { d: string; head: [number, number] | null } => {
  const interp = geoInterpolate(a, b);
  const steps = 64;
  const maxI = Math.max(1, Math.round(steps * t));
  const pts: string[] = [];
  let head: [number, number] | null = null;
  for (let i = 0; i <= maxI; i++) {
    const c = interp(i / steps);
    const p = project(c as [number, number]);
    if (p) {
      pts.push(`${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`);
      head = p;
    }
  }
  return { d: pts.join(" "), head };
};

export const MapArcRoutes: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Build a projection identical in spirit to react-simple-maps default so the
  // arc overlay lines up with the rendered map.
  const projection = useMemo(() => {
    const p = geoMercator()
      .scale(300)
      .translate([WIDTH / 2, HEIGHT / 2 + 140]);
    return p;
  }, []);

  const project = (c: [number, number]) => {
    const r = projection(c);
    return r ? ([r[0], r[1]] as [number, number]) : null;
  };

  // USA pulse glow.
  const pulse =
    0.5 + 0.5 * Math.sin((frame / fps) * Math.PI * 1.6);
  const usGlow = interpolate(pulse, [0, 1], [0.35, 1]);

  // Arc draw-on progress.
  const arc1T = interpolate(frame, [30, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const arc2T = interpolate(frame, [50, 115], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const arc1 = buildArc(USA, NIGERIA, arc1T, project);
  const arc2 = buildArc(USA, INDIA, arc2T, project);

  // EXPORTED label slide-in.
  const labelX = interpolate(frame, [70, 90], [-80, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const labelOpacity = interpolate(frame, [70, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#080a12", fontFamily }}>
      {/* vignette */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "radial-gradient(ellipse 90% 90% at 50% 50%, transparent 55%, rgba(0,0,0,0.7))",
          zIndex: 5,
          pointerEvents: "none",
        }}
      />

      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 300, center: [0, 0] }}
        width={WIDTH}
        height={HEIGHT}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: Array<{ rsmKey: string; id: string }> }) =>
            geographies.map((geo) => {
              const isUS = US_IDS.has(String(geo.id));
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo as never}
                  fill={isUS ? `rgba(200,40,40,${usGlow})` : "#1b2233"}
                  stroke="#2c3650"
                  strokeWidth={0.4}
                  style={{
                    default: { outline: "none" },
                    hover: { outline: "none" },
                    pressed: { outline: "none" },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Arc overlay drawn with our matched projection. */}
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ position: "absolute", inset: 0, zIndex: 4 }}
      >
        <defs>
          <filter id="arcGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[arc1, arc2].map((arc, i) =>
          arc.d ? (
            <g key={i} filter="url(#arcGlow)">
              <path
                d={arc.d}
                fill="none"
                stroke={i === 0 ? "#ff5252" : "#ffd0d0"}
                strokeWidth={3}
                strokeLinecap="round"
                opacity={0.95}
              />
              {arc.head && (
                <circle
                  cx={arc.head[0]}
                  cy={arc.head[1]}
                  r={6}
                  fill="#ffffff"
                />
              )}
            </g>
          ) : null
        )}
        {/* USA origin marker */}
        {(() => {
          const o = project(USA);
          return o ? (
            <circle cx={o[0]} cy={o[1]} r={7} fill="#ff5252" opacity={usGlow} />
          ) : null;
        })()}
      </svg>

      {/* EXPORTED label */}
      <div
        style={{
          position: "absolute",
          top: 110,
          left: 120,
          zIndex: 6,
          transform: `translateX(${labelX}px)`,
          opacity: labelOpacity,
          fontWeight: 700,
          fontSize: 84,
          letterSpacing: 8,
          color: "#fff",
          textShadow: "0 4px 18px rgba(0,0,0,0.7)",
          borderLeft: "8px solid #ff5252",
          paddingLeft: 24,
        }}
      >
        EXPORTED
      </div>
    </AbsoluteFill>
  );
};
