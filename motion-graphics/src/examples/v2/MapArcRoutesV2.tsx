/**
 * MapArcRoutesV2 — animated world map, broadcast tier. Matches frame at_29-42.
 *
 * WHITE THIN-OUTLINE countries on BLACK (react-simple-maps; fill none, white
 * stroke), inside a light-grey ROUNDED "quote-window" frame (rounded rect, soft
 * drop shadow, faint vertical sidebar of grey thumbnail rects at right to evoke
 * YouTube). 3-4 thin white great-circle ARCS fanning from USA -> UK / Nigeria /
 * India via d3-geo geoInterpolate, drawn on progressively led by a bright
 * glowing HEAD DOT. Soft pulsing red glow on the USA region. Big grey caps
 * overlay with RED accent words ("...TO AFRICA AND ASIA") sliding in per-word
 * with motion blur. Slight map perspective via rotateX.
 *
 * Native Remotion path. Deterministic.
 */
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { geoInterpolate, geoMercator } from "d3-geo";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { FilmGrain, Vignette, EASE_OUT } from "./_shared";
import worldTopo from "world-atlas/countries-110m.json";

const { fontFamily: oswald } = loadOswald();
const GEO_URL = worldTopo as unknown;

const USA: [number, number] = [-98, 39];
const UK: [number, number] = [-1, 52];
const NIGERIA: [number, number] = [8, 9];
const INDIA: [number, number] = [79, 22];

// Inner map drawing area (inside the quote-window frame).
const MW = 1480;
const MH = 880;

const buildArc = (
  a: [number, number],
  b: [number, number],
  t: number,
  project: (c: [number, number]) => [number, number] | null
): { d: string; head: [number, number] | null; trail: [number, number][] } => {
  const interp = geoInterpolate(a, b);
  const steps = 72;
  const maxI = Math.max(1, Math.round(steps * t));
  const pts: string[] = [];
  const projected: [number, number][] = [];
  let head: [number, number] | null = null;
  for (let i = 0; i <= maxI; i++) {
    const p = project(interp(i / steps) as [number, number]);
    if (p) {
      pts.push(`${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`);
      projected.push(p);
      head = p;
    }
  }
  // short comet trail = the last ~8 projected points behind the head
  const trail = projected.slice(Math.max(0, projected.length - 8));
  return { d: pts.join(" "), head, trail };
};

const CaptionWord: React.FC<{
  children: React.ReactNode;
  index: number;
  start: number;
  red?: boolean;
}> = ({ children, index, start, red }) => {
  const frame = useCurrentFrame();
  const t = frame - start - index * 4;
  const p = interpolate(t, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const mb = interpolate(p, [0, 0.6, 1], [9, 3, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <span
      style={{
        display: "inline-block",
        transform: `translateX(${interpolate(p, [0, 1], [-50, 0])}px)`,
        opacity: p,
        marginRight: "0.28em",
        color: red ? "#e02424" : "#bdbdbd",
        textShadow: "0 5px 12px rgba(0,0,0,0.7)",
        filter: mb > 0.1 ? `blur(${mb}px)` : "none",
      }}
    >
      {children}
    </span>
  );
};

export const MapArcRoutesV2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const projection = useMemo(
    () => geoMercator().scale(255).translate([MW / 2 - 60, MH / 2 + 150]),
    []
  );
  const project = (c: [number, number]) => {
    const r = projection(c);
    return r ? ([r[0], r[1]] as [number, number]) : null;
  };

  // each arc draws on with a stagger
  const routes = [
    { to: UK, start: 18 },
    { to: NIGERIA, start: 30 },
    { to: INDIA, start: 42 },
    { to: [40, 55] as [number, number], start: 54 }, // toward eurasia, fans the spread
  ];

  // pulsing red glow on USA
  const usPt = project(USA);
  const pulse = 0.5 + 0.5 * Math.sin((frame / fps) * 2 * Math.PI * 0.8);
  const glowR = interpolate(pulse, [0, 1], [60, 95]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#cfcfcf", fontFamily: oswald }}>
      {/* outer light-grey backdrop with faint sidebar thumbnails on the right */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(135deg, #d9d9d9 0%, #c2c2c2 60%, #b3b3b3 100%)",
        }}
      />
      {/* faint YouTube-like sidebar thumbnails at right */}
      <div
        style={{
          position: "absolute",
          right: 30,
          top: 60,
          bottom: 60,
          width: 150,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          opacity: 0.5,
        }}
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ flex: 3, background: "#9a9a9a", borderRadius: 6 }} />
            <div style={{ height: 8, width: "80%", background: "#a8a8a8", borderRadius: 3 }} />
            <div style={{ height: 7, width: "55%", background: "#b0b0b0", borderRadius: 3 }} />
          </div>
        ))}
      </div>

      {/* quote-window: rounded black map panel with soft drop shadow + slight perspective */}
      <div
        style={{
          position: "absolute",
          left: 60,
          top: 80,
          width: MW,
          height: MH,
          borderRadius: 22,
          background: "#000",
          boxShadow: "0 30px 80px rgba(0,0,0,0.55), 0 8px 22px rgba(0,0,0,0.4)",
          overflow: "hidden",
          transform: "perspective(2200px) rotateX(3deg) rotateY(-1.4deg)",
          transformOrigin: "center 40%",
        }}
      >
        {/* white-outline world */}
        <svg width={MW} height={MH} style={{ position: "absolute", inset: 0 }}>
          {/* pulsing red region glow under USA */}
          {usPt && (
            <g>
              <circle
                cx={usPt[0]}
                cy={usPt[1]}
                r={glowR}
                fill="rgba(224,36,36,0.22)"
                style={{ filter: "blur(18px)" }}
              />
              <circle cx={usPt[0]} cy={usPt[1]} r={glowR * 0.45} fill="rgba(255,60,60,0.32)" style={{ filter: "blur(10px)" }} />
            </g>
          )}
        </svg>
        <ComposableMap
          width={MW}
          height={MH}
          projection={projection as never}
          style={{ position: "absolute", inset: 0 }}
        >
          <Geographies geography={GEO_URL as never}>
            {({ geographies }: { geographies: { rsmKey: string }[] }) =>
              geographies.map((geo) => (
                <Geography
                  key={(geo as { rsmKey: string }).rsmKey}
                  geography={geo as never}
                  style={{
                    default: { fill: "none", stroke: "rgba(255,255,255,0.85)", strokeWidth: 0.6, outline: "none" },
                    hover: { fill: "none", stroke: "rgba(255,255,255,0.85)", strokeWidth: 0.6, outline: "none" },
                    pressed: { fill: "none", stroke: "rgba(255,255,255,0.85)", strokeWidth: 0.6, outline: "none" },
                  }}
                />
              ))
            }
          </Geographies>
        </ComposableMap>

        {/* drawn-on arcs with glowing head dots */}
        <svg width={MW} height={MH} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <filter id="arc-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* brighter bloom for the comet head dot */}
            <filter id="head-glow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="7" result="hb" />
              <feMerge>
                <feMergeNode in="hb" />
                <feMergeNode in="hb" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {routes.map((r, i) => {
            const t = interpolate(frame, [r.start, r.start + 34], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE_OUT,
            });
            if (t <= 0) return null;
            const { d, head, trail } = buildArc(USA, r.to, t, project);
            const flying = t < 1;
            return (
              <g key={i}>
                <path d={d} fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth={1.6} strokeLinecap="round" filter="url(#arc-glow)" />
                {/* short comet trail behind the head: fading thickening segments */}
                {flying &&
                  trail.map((p, j) => {
                    if (j === 0) return null;
                    const prev = trail[j - 1];
                    const frac = j / trail.length; // 0..1 toward head
                    return (
                      <line
                        key={j}
                        x1={prev[0]}
                        y1={prev[1]}
                        x2={p[0]}
                        y2={p[1]}
                        stroke={`rgba(255,255,255,${0.15 + 0.7 * frac})`}
                        strokeWidth={0.8 + 3.2 * frac}
                        strokeLinecap="round"
                        filter="url(#arc-glow)"
                      />
                    );
                  })}
                {/* bright glowing head dot */}
                {head && flying && (
                  <g filter="url(#head-glow)">
                    <circle cx={head[0]} cy={head[1]} r={7} fill="#fff" />
                    <circle cx={head[0]} cy={head[1]} r={3} fill="#fff" />
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* faint map grain over the black panel */}
        <svg width="0" height="0" style={{ position: "absolute" }}>
          <filter id="map-grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.8"
              numOctaves={2}
              seed={Math.floor(frame)}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            filter: "url(#map-grain)",
            opacity: 0.05,
            mixBlendMode: "screen",
            pointerEvents: "none",
          }}
        />
        {/* faint scanlines over the quote-window */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 1px, transparent 2px, transparent 3px)",
            opacity: 0.18,
            mixBlendMode: "multiply",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* caption overlay — big grey caps with red accents, stacked at bottom */}
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 110,
        }}
      >
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
            lineHeight: 1.02,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div style={{ whiteSpace: "nowrap" }}>
            <CaptionWord index={0} start={48}>IT'S BEING</CaptionWord>
            <CaptionWord index={1} start={48}>EXPORTED</CaptionWord>
          </div>
          <div style={{ whiteSpace: "nowrap" }}>
            <CaptionWord index={2} start={48}>FROM THIS COUNTRY</CaptionWord>
          </div>
          <div style={{ whiteSpace: "nowrap" }}>
            <CaptionWord index={3} start={66}>TO</CaptionWord>
            <CaptionWord index={4} start={66} red>AFRICA</CaptionWord>
            <CaptionWord index={5} start={66}>AND</CaptionWord>
            <CaptionWord index={6} start={66} red>ASIA</CaptionWord>
          </div>
        </div>
      </AbsoluteFill>

      <Vignette strength={0.5} />
      <FilmGrain opacity={0.045} />
    </AbsoluteFill>
  );
};
