/**
 * CameraPathFollow.tsx — V3 PREVIEW PROOF (camera-follows-text-down-a-path).
 *
 * A virtual camera travels DOWN a connecting SVG thread, framing ornate
 * scroll-banner "promises" placed at points ALONG the path, then hard-cuts
 * to a silver beveled "...AT WHAT COST?" kicker.
 *
 * Core rig:
 *   - @remotion/paths getPointAtLength(path, p*len) gives the camera target
 *     (cx,cy) AND each node's anchor at its own length along the path.
 *   - An outer scene container is translated so the current path point stays
 *     centered: translate(W/2 - cx, H/2 - cy) scale(zoom).
 *   - Progress is interpolated with hold-frames at each node (read pauses) and
 *     a smooth Easing.bezier(0.16,1,0.3,1) accelerate/settle between nodes.
 *   - The thread DRAWS ON just ahead of the camera (evolvePath dashoffset).
 *   - Parallax: damask bg @0.3x, mid swirl @0.6x, nodes @1x of camera delta.
 *   - CameraMotionBlur (samples=5) blurs the whole moving scene.
 *
 * Deterministic only: no Math.random/Date — frame-driven noise2D + sin, and
 * feTurbulence seed=Math.floor(frame). Additive: imports _shared, touches
 * nothing in V1/V2/golden.
 *
 * 1920x1080, 30fps, 330 frames (~11s). Comp id `CameraPathFollow`.
 */
import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { getLength, getPointAtLength, evolvePath } from "@remotion/paths";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { noise2D } from "@remotion/noise";
import { loadFont as loadTangerine } from "@remotion/google-fonts/Tangerine";
import { loadFont as loadCinzel } from "@remotion/google-fonts/Cinzel";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { FilmGrain, Vignette, EASE_OUT } from "./_shared";

const { fontFamily: tangerine } = loadTangerine();
const { fontFamily: cinzel } = loadCinzel();
const { fontFamily: anton } = loadAnton();

export const CAMERA_PATH_DURATION = 330;

/* ---------------------------------------------------------------- palette */
const PARCHMENT = "#e7d9b0";
const PARCHMENT_DK = "#c9b482";
const INK = "#3a2412";
const SILVER_HI = "#f4f6f8";
const SILVER_MID = "#b9c0c7";
const SILVER_LO = "#6f7780";

/* ---------------------------------------------- virtual world coordinates */
// The scene lives in a tall virtual canvas. The camera pans down it. World is
// wider/taller than the viewport so parallax + travel have room.
const WORLD_W = 1920;
const WORLD_H = 4200;

// The connecting thread: vertical spine with gentle alternating S-curves.
// Drawn in WORLD space. Camera rides this path top -> bottom.
const THREAD =
  "M 960 120 " +
  "C 1180 460, 760 700, 960 1020 " +
  "C 1160 1320, 740 1560, 960 1880 " +
  "C 1180 2200, 760 2440, 960 2760 " +
  "C 1160 3060, 800 3320, 960 3640 " +
  "C 1060 3840, 980 3980, 960 4080";

const THREAD_LEN = getLength(THREAD);

/* ---------------------------------------------------------------- content */
// Each promise sits at a fraction of the thread length. Camera holds there.
type Node = {
  lines: string[];
  at: number; // 0..1 along thread where this node is anchored
  big?: boolean; // emphasise second line (like ref "Message")
};
const NODES: Node[] = [
  { lines: ["Believe This", "Message"], at: 0.04, big: true },
  { lines: ["your pigs", "won't die"], at: 0.225 },
  { lines: ["your wife won't", "have miscarriages"], at: 0.41 },
  { lines: ["rings on", "your fingers"], at: 0.595 },
  { lines: ["coats on", "your back"], at: 0.78 },
];

/* ----------------------------------------------------- camera keyframe rig */
// Build a progress timeline: travel between nodes, then HOLD at each node so
// the viewer can read. Returns camera progress 0..1 for a given frame.
const TRAVEL = 34; // frames to move between nodes
const HOLD = 24; // frames paused on a node
const INTRO = 10; // settle on first node

function buildSchedule() {
  // frames[] -> progress[] keyframes
  const frames: number[] = [];
  const progs: number[] = [];
  let f = 0;
  // start already framing node 0
  frames.push(0);
  progs.push(NODES[0].at);
  f = INTRO;
  frames.push(f);
  progs.push(NODES[0].at);
  for (let i = 1; i < NODES.length; i++) {
    // travel to node i
    f += TRAVEL;
    frames.push(f);
    progs.push(NODES[i].at);
    // hold on node i
    f += HOLD;
    frames.push(f);
    progs.push(NODES[i].at);
  }
  // final glide off the bottom of the thread toward the kicker hand-off
  f += TRAVEL;
  frames.push(f);
  progs.push(1.0);
  return { frames, progs, lastFrame: f };
}
const SCHED = buildSchedule();
// Frame at which we HARD CUT from the travel scene to the silver kicker.
const KICKER_CUT = 250;

/* --------------------------------------------------------- sub-components */

/** Animated baroque damask: tiled SVG swirl flourishes on dark-red ground. */
const Damask: React.FC<{ frame: number }> = ({ frame }) => {
  // slow breathing of the ornament colour
  const breathe = 0.5 + 0.5 * Math.sin(frame * 0.018);
  const orn = `rgba(40,6,10,${0.55 + 0.2 * breathe})`;
  // One flourish unit, tiled via SVG pattern across the whole tall world.
  return (
    <svg
      width={WORLD_W}
      height={WORLD_H}
      viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
      style={{ display: "block" }}
    >
      <defs>
        <radialGradient id="cpf-red" cx="50%" cy="30%" r="90%">
          <stop offset="0%" stopColor="#7e1922" />
          <stop offset="45%" stopColor="#5c1118" />
          <stop offset="100%" stopColor="#2c070b" />
        </radialGradient>
        <pattern
          id="cpf-damask"
          x="0"
          y="0"
          width="520"
          height="640"
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(0 ${Math.sin(frame * 0.02) * 8})`}
        >
          {/* big curling baroque flourish, mirrored for symmetry */}
          <g
            fill="none"
            stroke={orn}
            strokeWidth="26"
            strokeLinecap="round"
            opacity="0.9"
          >
            <path d="M 110 60 C 320 60, 300 300, 150 330 C 60 348, 70 200, 200 210 C 280 216, 270 300, 210 300" />
            <path d="M 410 360 C 200 360, 220 600, 370 630 C 460 648, 450 500, 320 510 C 240 516, 250 600, 310 600" />
            <path d="M 260 330 C 260 250, 260 430, 260 360" strokeWidth="14" />
          </g>
          <g
            fill={orn}
            opacity="0.5"
            transform="translate(60 120) scale(0.5)"
          >
            <circle cx="200" cy="200" r="40" />
          </g>
        </pattern>
      </defs>
      <rect width={WORLD_W} height={WORLD_H} fill="url(#cpf-red)" />
      <rect width={WORLD_W} height={WORLD_H} fill="url(#cpf-damask)" />
      {/* a couple of large hero swirls anchored near key nodes for depth */}
      <g
        fill="none"
        stroke="rgba(30,4,8,0.6)"
        strokeWidth="34"
        strokeLinecap="round"
      >
        <path d="M 1520 200 C 1900 320, 1500 720, 1760 980 C 1980 1180, 1560 1240, 1640 980" />
        <path d="M 300 1900 C -40 2040, 360 2420, 140 2680 C -20 2860, 360 2900, 300 2680" />
        <path d="M 1560 2700 C 1940 2840, 1540 3220, 1800 3480" />
      </g>
    </svg>
  );
};

/** A black horn-blower silhouette (callback to the reference), near the top. */
const HornBlower: React.FC = () => (
  <svg width="320" height="300" viewBox="0 0 320 300">
    <g fill="#0b0204">
      {/* crouched figure leaning forward */}
      <path
        d="M70 250
           C72 210 84 188 104 176
           C92 150 96 120 122 108
           C140 100 160 104 168 120
           C176 136 170 156 152 164
           C170 172 182 190 184 214
           L188 250
           L150 250 L148 214
           C146 198 138 190 126 190
           C118 206 112 230 116 250 Z"
      />
      {/* arm + horn */}
      <path
        d="M150 132
           C176 120 210 116 246 124
           C236 100 250 84 276 86
           C300 88 306 110 290 124
           C306 130 312 146 300 158
           C286 170 256 168 236 156
           C206 150 176 150 156 158 Z"
      />
      {/* bell of the horn flares out */}
      <path d="M276 86 C300 70 318 86 314 110 C300 104 286 100 276 102 Z" />
    </g>
  </svg>
);

/** An ornate parchment scroll-banner with curled ends, holding the promise. */
const ScrollBanner: React.FC<{
  node: Node;
  reveal: number; // 0..1 reveal driven by camera proximity
}> = ({ node, reveal }) => {
  const slide = interpolate(reveal, [0, 1], [34, 0], { easing: EASE_OUT });
  const scale = interpolate(reveal, [0, 1], [0.86, 1], { easing: EASE_OUT });
  // motion-blur-ish smear while revealing (extra horizontal scale on the body)
  const smear = interpolate(reveal, [0, 0.55, 1], [1.08, 1.02, 1]);
  return (
    <div
      style={{
        transform: `translateY(${slide}px) scale(${scale})`,
        opacity: reveal,
        filter: `drop-shadow(0 18px 30px rgba(0,0,0,0.55))`,
      }}
    >
      <svg width="760" height="320" viewBox="0 0 760 320">
        <defs>
          <linearGradient id="cpf-parch" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f2e7c4" />
            <stop offset="55%" stopColor={PARCHMENT} />
            <stop offset="100%" stopColor={PARCHMENT_DK} />
          </linearGradient>
          <filter id="cpf-rough">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.03"
              numOctaves={2}
              seed={2}
              result="n"
            />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="9" />
          </filter>
        </defs>
        <g
          transform={`scaleX(${smear})`}
          style={{ transformOrigin: "380px 160px" }}
        >
          {/* curled left end */}
          <g stroke={INK} strokeWidth="4" fill="url(#cpf-parch)">
            <path
              d="M150 90 C90 70 70 130 92 160 C70 196 96 250 150 234 L150 90 Z"
              filter="url(#cpf-rough)"
            />
            <path
              d="M150 234 C120 250 96 246 92 220"
              fill="none"
              opacity="0.6"
            />
          </g>
          {/* curled right end */}
          <g stroke={INK} strokeWidth="4" fill="url(#cpf-parch)">
            <path
              d="M610 90 C672 68 698 132 672 162 C700 198 668 252 610 234 L610 90 Z"
              filter="url(#cpf-rough)"
            />
          </g>
          {/* main body */}
          <path
            d="M150 80 C320 64 440 64 610 80 L610 244 C440 260 320 260 150 244 Z"
            fill="url(#cpf-parch)"
            stroke={INK}
            strokeWidth="4"
            filter="url(#cpf-rough)"
          />
          {/* faint inner rule lines */}
          <path
            d="M180 110 H580 M180 210 H580"
            stroke="rgba(58,36,18,0.18)"
            strokeWidth="2"
            fill="none"
          />
        </g>
        {/* the promise text in script ink */}
        <text
          x="380"
          y={node.lines.length > 1 ? "150" : "175"}
          textAnchor="middle"
          fontFamily={tangerine}
          fontWeight={700}
          fontSize="78"
          fill={INK}
        >
          {node.lines[0]}
        </text>
        {node.lines[1] && (
          <text
            x="380"
            y="232"
            textAnchor="middle"
            fontFamily={tangerine}
            fontWeight={700}
            fontSize={node.big ? "104" : "82"}
            fill={INK}
          >
            {node.lines[1]}
          </text>
        )}
      </svg>
    </div>
  );
};

/* ----------------------------------------------------- the moving scene */

const TravelScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // --- camera progress along the thread (with holds) ---
  const progress = interpolate(frame, SCHED.frames, SCHED.progs, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  // camera target point in WORLD space
  const cam = getPointAtLength(THREAD, progress * THREAD_LEN);

  // gentle zoom: punch in slightly while holding, ease out while travelling
  const zoom = interpolate(
    frame,
    [0, 40, KICKER_CUT],
    [1.04, 1.12, 1.18],
    { extrapolateRight: "clamp", easing: EASE_OUT }
  );

  // camera delta from world centre, used for parallax layers
  const camDX = width / 2 - cam.x * zoom;
  const camDY = height / 2 - cam.y * zoom;

  // thread draws on just AHEAD of the camera
  const drawAhead = Math.min(1, progress + 0.07);
  const evo = evolvePath(drawAhead, THREAD);

  // small frame-driven handheld jitter (deterministic via noise2D)
  const jx = noise2D("cpfx", frame * 0.05, 0) * 6;
  const jy = noise2D("cpfy", 0, frame * 0.05) * 6;

  return (
    <AbsoluteFill style={{ backgroundColor: "#2c070b", overflow: "hidden" }}>
      {/* ---- PARALLAX BACKGROUND damask @ 0.3x camera delta ---- */}
      <AbsoluteFill
        style={{
          transform: `translate(${camDX * 0.3 + jx * 0.4}px, ${
            camDY * 0.3 + jy * 0.4
          }px) scale(${zoom * 1.05})`,
          transformOrigin: "top left",
        }}
      >
        <Damask frame={frame} />
      </AbsoluteFill>

      {/* ---- MID swirl layer @ 0.6x for depth ---- */}
      <AbsoluteFill
        style={{
          transform: `translate(${camDX * 0.6}px, ${camDY * 0.6}px) scale(${zoom})`,
          transformOrigin: "top left",
          opacity: 0.5,
          mixBlendMode: "multiply",
        }}
      >
        <svg width={WORLD_W} height={WORLD_H}>
          <g
            fill="none"
            stroke="rgba(18,3,6,0.7)"
            strokeWidth="40"
            strokeLinecap="round"
          >
            <path d="M 1300 600 C 1700 760, 1300 1160, 1560 1420" />
            <path d="M 520 2200 C 140 2360, 540 2760, 300 3020" />
          </g>
        </svg>
      </AbsoluteFill>

      {/* ---- FOREGROUND camera layer @ 1x (thread + nodes + horn) ---- */}
      <AbsoluteFill
        style={{
          transform: `translate(${camDX + jx}px, ${camDY + jy}px) scale(${zoom})`,
          transformOrigin: "top left",
        }}
      >
        <div style={{ position: "absolute", width: WORLD_W, height: WORLD_H }}>
          {/* the connecting thread, drawing on ahead of the camera */}
          <svg
            width={WORLD_W}
            height={WORLD_H}
            style={{ position: "absolute", left: 0, top: 0 }}
          >
            {/* soft outer glow of the thread */}
            <path
              d={THREAD}
              fill="none"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={10}
              strokeDasharray={evo.strokeDasharray}
              strokeDashoffset={evo.strokeDashoffset}
            />
            <path
              d={THREAD}
              fill="none"
              stroke={PARCHMENT_DK}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={evo.strokeDasharray}
              strokeDashoffset={evo.strokeDashoffset}
              opacity={0.85}
            />
          </svg>

          {/* horn-blower silhouette near the very top, beside node 0 */}
          <div style={{ position: "absolute", left: 250, top: 120 }}>
            <HornBlower />
          </div>

          {/* the promise nodes, each anchored at its own path length */}
          {NODES.map((node, i) => {
            const anchor = getPointAtLength(THREAD, node.at * THREAD_LEN);
            // reveal keyed off how close camera progress is to this node
            const reveal = interpolate(
              progress,
              [node.at - 0.085, node.at - 0.01],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );
            // banners alternate left/right of the thread like the reference
            const side = i % 2 === 0 ? -40 : 40;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: anchor.x - 380 + side,
                  top: anchor.y - 160,
                  width: 760,
                }}
              >
                <ScrollBanner node={node} reveal={reveal} />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* ---- GRADE: vignette + grain ---- */}
      <Vignette strength={0.82} />
      <FilmGrain opacity={0.07} freq={0.85} />
    </AbsoluteFill>
  );
};

/* --------------------------------------------- the silver beveled kicker */

const KickerScene: React.FC = () => {
  const frame = useCurrentFrame();
  const local = frame - KICKER_CUT;
  const { width } = useVideoConfig();

  // beveled text reveals via a wipe + slight scale settle
  const scale = interpolate(local, [0, 16], [1.18, 1], {
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const wipe = interpolate(local, [0, 22], [0, 100], {
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const lineW = interpolate(local, [2, 26], [0, width * 0.86], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const glow = 0.4 + 0.6 * Math.abs(Math.sin(local * 0.12));

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* dark-red ground reused from the travel grade for continuity */}
      <AbsoluteFill>
        <svg width="100%" height="100%">
          <defs>
            <radialGradient id="cpf-kred" cx="50%" cy="40%" r="80%">
              <stop offset="0%" stopColor="#7a1620" />
              <stop offset="60%" stopColor="#4e0e15" />
              <stop offset="100%" stopColor="#230509" />
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#cpf-kred)" />
        </svg>
      </AbsoluteFill>
      <Damask frame={frame} />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* top + bottom silver rules sweeping out */}
        <div
          style={{
            width: lineW,
            height: 6,
            background: `linear-gradient(90deg, transparent, ${SILVER_MID}, ${SILVER_HI}, ${SILVER_MID}, transparent)`,
            boxShadow: `0 0 18px rgba(220,230,240,${0.5 * glow})`,
          }}
        />
        <div
          style={{
            transform: `scale(${scale})`,
            WebkitClipPath: `inset(0 ${100 - wipe}% 0 0)`,
            clipPath: `inset(0 ${100 - wipe}% 0 0)`,
          }}
        >
          <span
            style={{
              fontFamily: anton,
              fontSize: 168,
              letterSpacing: "-2px",
              textTransform: "uppercase",
              background: `linear-gradient(180deg, ${SILVER_HI} 0%, #d7dde3 38%, ${SILVER_LO} 52%, ${SILVER_MID} 60%, ${SILVER_HI} 100%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              filter: `drop-shadow(0 4px 2px rgba(0,0,0,0.6)) drop-shadow(0 0 ${
                10 * glow
              }px rgba(200,220,240,0.5))`,
            }}
          >
            ...at what cost?
          </span>
        </div>
        <div
          style={{
            width: lineW,
            height: 6,
            background: `linear-gradient(90deg, transparent, ${SILVER_MID}, ${SILVER_HI}, ${SILVER_MID}, transparent)`,
            boxShadow: `0 0 18px rgba(220,230,240,${0.5 * glow})`,
          }}
        />
        {/* small cinzel sub-line */}
        <div
          style={{
            marginTop: 18,
            fontFamily: cinzel,
            fontSize: 30,
            letterSpacing: "8px",
            color: SILVER_MID,
            opacity: interpolate(local, [18, 34], [0, 0.8], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            textTransform: "uppercase",
          }}
        >
          the prosperity gospel
        </div>
      </AbsoluteFill>

      <Vignette strength={0.86} />
      <FilmGrain opacity={0.06} freq={0.9} />
    </AbsoluteFill>
  );
};

/* --------------------------------------------------------- the composition */

export const CameraPathFollow: React.FC = () => {
  const frame = useCurrentFrame();
  const showKicker = frame >= KICKER_CUT;

  return (
    <AbsoluteFill style={{ backgroundColor: "#1a0407" }}>
      {showKicker ? (
        <KickerScene />
      ) : (
        // wrap the moving travel scene in CameraMotionBlur (low samples to keep
        // render cost sane — cost multiplies by `samples`).
        <CameraMotionBlur shutterAngle={180} samples={5}>
          <TravelScene />
        </CameraMotionBlur>
      )}
    </AbsoluteFill>
  );
};
