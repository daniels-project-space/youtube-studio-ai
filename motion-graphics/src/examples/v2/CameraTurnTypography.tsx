/**
 * CameraTurnTypography.tsx — V4 PREVIEW PROOF
 * "CAMERA TURNS THE CORNER, TEXT CONTINUES ALONG A BENDING LINE".
 *
 * Reproduces the kinetic-typography move from the reference (hTfKpAWkgJY, the
 * "Prosperity Gospel" lyric video): small filler words run UP a vertical white
 * RAIL, the rail TURNS A CORNER, and a GIANT key word runs HORIZONTALLY. The
 * virtual CAMERA PANS *and ROTATES* to follow the rail around each bend, so the
 * active segment always reads roughly horizontal & upright while the rest of
 * the rail visibly bends away — exactly like frames 29-26 -> 29-28.
 *
 * Rig (extends V3 CameraPathFollow's getPointAtLength camera with ROTATION):
 *   - A single SVG "RAIL" polyline with ~90 deg corners ROUNDED via quadratic
 *     curves (rounded corner => continuous tangent => smooth camera rotation).
 *   - WORDS are placed at increasing arc-length s_i (getPointAtLength) and each
 *     is rotated to its local TANGENT angle so text follows the line direction.
 *   - Camera progress p(frame) advances along arc-length with eased HOLDS at
 *     each word (read pauses), Easing.bezier(0.16,1,0.3,1).
 *   - The ENTIRE world (rail + words + bg swirl) lives in ONE container whose
 *     transform is:
 *        translate(W/2,H/2) rotate(-camAngle) scale(zoom) translate(-camX,-camY)
 *     => the current segment becomes horizontal & centred; the rail bends away
 *     through the corners as the camera turns.
 *   - Background: dark-red radial + BaroqueDamask that PARTIALLY follows the
 *     camera (parallax ~0.4 + a slice of the shared rotation) so it "reacts to
 *     perspective." Vignette + film grain. Subtle CameraMotionBlur on turns.
 *   - Ends on a brief chromatic-aberration fade-out (the blurred $-bill + cross
 *     exit, frame 29-30).
 *
 * Deterministic only: no Math.random/Date — frame-driven noise2D + sin, and
 * feTurbulence seed=Math.floor(frame). Additive: imports _shared, touches
 * nothing in V1/V2/V3/golden.
 *
 * 1920x1080, 30fps, 360 frames (12s). Comp id `CameraTurnTypography`.
 */
import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { getLength, getPointAtLength } from "@remotion/paths";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { noise2D } from "@remotion/noise";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import {
  BaroqueDamask,
  ChromaSplit,
  FilmGrain,
  Vignette,
  EASE_OUT,
} from "./_shared";

const { fontFamily: anton } = loadAnton();
const { fontFamily: oswald } = loadOswald();

export const CAMERA_TURN_DURATION = 360; // 12s @ 30fps

/* ---------------------------------------------------------------- palette */
const RAIL_WHITE = "#f1ece2";
const TEXT_WHITE = "#f4efe6";

/* ------------------------------------------------ virtual world + the rail */
// The rail lives in a big virtual world (the camera roams it). It goes:
//   UP a tall vertical run -> turn RIGHT -> long horizontal run -> turn DOWN a
//   short drop -> turn RIGHT -> another horizontal run -> a final small turn.
// Corners are ROUNDED with quadratic (Q) curves so the tangent is continuous,
// which makes the camera-rotation that tracks the tangent smooth (no snap).
//
// Coordinates chosen so segments are long enough to host giant words.
const R = 120; // corner rounding radius

// Anchor points of the underlying polyline (before rounding):
//   A bottom of vertical run  -> B top (pre-corner) -> C after right turn
//   -> D end of first horizontal -> E after dropping down -> F end horizontal2
const RAIL =
  // start low, run UP (note: smaller y = up)
  `M 700 2600 ` +
  `L 700 ${1500 + R} ` +
  // rounded corner turning RIGHT (up -> right)
  `Q 700 1500 ${700 + R} 1500 ` +
  // long horizontal run to the right (the "FEEL" segment)
  `L ${2600 - R} 1500 ` +
  // rounded corner turning DOWN (right -> down)
  `Q 2600 1500 2600 ${1500 + R} ` +
  // short drop down
  `L 2600 ${2050 - R} ` +
  // rounded corner turning RIGHT again (down -> right)
  `Q 2600 2050 ${2600 + R} 2050 ` +
  // final horizontal run (the "PROSPERITY" segment)
  `L ${4500 - R} 2050 ` +
  // gentle final corner turning slightly DOWN for the exit
  `Q 4500 2050 4500 ${2050 + R} ` +
  `L 4500 2400`;

const RAIL_LEN = getLength(RAIL);

/* tangent angle (degrees) at arc-length s, via finite difference. */
function tangentDeg(s: number): number {
  const eps = 1.5;
  const a = getPointAtLength(RAIL, Math.max(0, s - eps));
  const b = getPointAtLength(RAIL, Math.min(RAIL_LEN, s + eps));
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/* ---------------------------------------------------------------- content */
// Each WORD sits at a fraction of the rail length. Filler words are small and
// closely spaced (so several stack along the vertical run); key words are GIANT
// and own a whole horizontal segment. `s` is fraction 0..1 along the rail.
type Word = {
  text: string;
  s: number; // 0..1 arc-length position
  size: number; // font px (in world space)
  weight: number;
  family: string;
  hold: boolean; // camera pauses (reads) when arriving here
  letterSpacing?: number;
};

// Positions hand-tuned against the rounded rail above so:
//  - "I DON'T KNOW WHAT YOU" climb the VERTICAL run (small),
//  - "FEEL" owns the first HORIZONTAL run (GIANT),
//  - "ABOUT/THE" sit around the drop,
//  - "PRO$PERITY" owns the second HORIZONTAL run (GIANT),
//  - "GOSPEL" tails out small.
const WORDS: Word[] = [
  { text: "I", s: 0.045, size: 150, weight: 700, family: oswald, hold: false },
  { text: "DON'T", s: 0.105, size: 150, weight: 700, family: oswald, hold: false },
  { text: "KNOW", s: 0.175, size: 150, weight: 700, family: oswald, hold: false },
  { text: "WHAT", s: 0.245, size: 150, weight: 700, family: oswald, hold: false },
  { text: "YOU", s: 0.31, size: 150, weight: 700, family: oswald, hold: true },
  { text: "FEEL", s: 0.45, size: 560, weight: 400, family: anton, hold: true, letterSpacing: 8 },
  { text: "ABOUT", s: 0.6, size: 190, weight: 700, family: oswald, hold: false },
  { text: "THE", s: 0.655, size: 160, weight: 700, family: oswald, hold: true },
  { text: "PRO$PERITY", s: 0.82, size: 470, weight: 400, family: anton, hold: true, letterSpacing: 4 },
  { text: "GOSPEL", s: 0.93, size: 150, weight: 700, family: oswald, hold: false },
];

/* ----------------------------------------------------- camera keyframe rig */
// Build a progress timeline: glide along the rail, HOLD at "hold" words so the
// viewer can read, then continue. Returns keyframe arrays for interpolate().
const INTRO = 12; // settle at the start
const TRAVEL = 30; // frames to glide between successive read-stops
const HOLD = 22; // frames paused on a read-stop

function buildSchedule() {
  const frames: number[] = [];
  const progs: number[] = [];
  let f = 0;

  // start framing the first word
  frames.push(0);
  progs.push(WORDS[0].s);
  f = INTRO;
  frames.push(f);
  progs.push(WORDS[0].s);

  // advance through the words; pause (HOLD) on each `hold` word
  for (let i = 1; i < WORDS.length; i++) {
    f += TRAVEL;
    frames.push(f);
    progs.push(WORDS[i].s);
    if (WORDS[i].hold) {
      f += HOLD;
      frames.push(f);
      progs.push(WORDS[i].s);
    }
  }

  // final glide off the end of the rail toward the exit
  f += TRAVEL;
  frames.push(f);
  progs.push(1.0);

  return { frames, progs, lastFrame: f };
}
const SCHED = buildSchedule();

// Exit (chromatic fade-out) begins a bit before the end.
const EXIT_START = CAMERA_TURN_DURATION - 42; // ~38f tail

/* --------------------------------------------------------- the icon exit */
// The blurred $-bill + maroon cross orb from frame 29-30, drifting + chromatic.
const ExitIcons: React.FC<{ local: number }> = ({ local }) => {
  // local = frames since EXIT_START
  const t = interpolate(local, [0, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const drift = interpolate(t, [0, 1], [60, -40]);
  const scale = interpolate(t, [0, 1], [0.86, 1.22], { easing: EASE_OUT });
  const blur = interpolate(t, [0, 0.6, 1], [10, 4, 16]);
  const opacity = interpolate(t, [0, 0.18, 0.8, 1], [0, 1, 1, 0]);
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity,
        filter: `blur(${blur}px)`,
        transform: `translateX(${drift}px) scale(${scale})`,
      }}
    >
      <svg width="780" height="460" viewBox="0 0 780 460">
        {/* green dollar bill, slightly rotated */}
        <g transform="rotate(-14 250 230)">
          <rect
            x="70"
            y="150"
            width="320"
            height="180"
            rx="22"
            fill="#3f6f49"
            stroke="#2c5236"
            strokeWidth="6"
          />
          <text
            x="230"
            y="270"
            textAnchor="middle"
            fontFamily={anton}
            fontSize="150"
            fill="#e9f3ea"
          >
            $
          </text>
        </g>
        {/* maroon orb with a white cross */}
        <g transform="translate(470 250)">
          <circle r="120" fill="#5a1d24" />
          <circle r="120" fill="url(#ctt-orbshine)" />
          <g fill="#f1ece2">
            <rect x="-22" y="-80" width="44" height="190" rx="8" />
            <rect x="-64" y="-30" width="128" height="44" rx="8" />
          </g>
        </g>
        <defs>
          <radialGradient id="ctt-orbshine" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="rgba(255,210,210,0.55)" />
            <stop offset="55%" stopColor="rgba(120,40,48,0.1)" />
            <stop offset="100%" stopColor="rgba(20,4,8,0.4)" />
          </radialGradient>
        </defs>
      </svg>
    </AbsoluteFill>
  );
};

/* ----------------------------------------------------- the moving scene */

const TurnScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // --- camera progress along the rail (with read-holds) ---
  const progress = interpolate(frame, SCHED.frames, SCHED.progs, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const camS = progress * RAIL_LEN;
  const cam = getPointAtLength(RAIL, camS);
  const camAngle = tangentDeg(camS); // rail direction (deg) at the camera

  // gentle push-in over the whole shot
  const zoom = interpolate(frame, [0, 60, CAMERA_TURN_DURATION], [0.62, 0.66, 0.7], {
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  // subtle deterministic handheld jitter
  const jx = noise2D("cttx", frame * 0.05, 0) * 5;
  const jy = noise2D("ctty", 0, frame * 0.05) * 5;

  // THE camera transform: rotate the world by -camAngle so the active rail
  // segment reads horizontal, scale by zoom, translate so cam point is centred.
  // Order matters — compose as one string applied LEFT->RIGHT:
  //   move world so the camera point lands at screen centre, then rotate &
  //   scale about that centre.
  const worldTransform =
    `translate(${width / 2 + jx}px, ${height / 2 + jy}px) ` +
    `rotate(${-camAngle}deg) ` +
    `scale(${zoom}) ` +
    `translate(${-cam.x}px, ${-cam.y}px)`;

  // Background partially follows the camera ("reacts to perspective"):
  // parallax fraction of the translation + a slice of the rotation.
  const bgPar = 0.4;
  const bgTransform =
    `translate(${width / 2 + jx * 0.4}px, ${height / 2 + jy * 0.4}px) ` +
    `rotate(${-camAngle * 0.45}deg) ` +
    `scale(${zoom * 1.25}) ` +
    `translate(${-cam.x * bgPar - width * 0.25}px, ${-cam.y * bgPar - height * 0.25}px)`;

  return (
    <AbsoluteFill style={{ backgroundColor: "#2a060b", overflow: "hidden" }}>
      {/* ---- dark-red radial ground (screen-fixed) ---- */}
      <AbsoluteFill>
        <svg width="100%" height="100%">
          <defs>
            <radialGradient id="ctt-red" cx="42%" cy="40%" r="85%">
              <stop offset="0%" stopColor="#8a1a24" />
              <stop offset="48%" stopColor="#5c1018" />
              <stop offset="100%" stopColor="#250609" />
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#ctt-red)" />
        </svg>
      </AbsoluteFill>

      {/* ---- baroque swirl that PARTIALLY follows the camera (perspective) ---- */}
      <AbsoluteFill
        style={{
          transform: bgTransform,
          transformOrigin: "0 0",
          opacity: 0.55,
        }}
      >
        <div style={{ width: 1920, height: 1080 }}>
          <BaroqueDamask
            color="rgba(150,30,38,0.5)"
            accent="rgba(180,40,50,0.55)"
            opacity={0.9}
            drift
            frame={frame}
            tile={360}
          />
        </div>
      </AbsoluteFill>

      {/* =========================================================== WORLD ===
          rail + words live in ONE container; the rotating camera transform is
          applied here, so the rail visibly BENDS through corners as we turn. */}
      <AbsoluteFill
        style={{ transform: worldTransform, transformOrigin: "0 0" }}
      >
        {/* the visible white RAIL line (world space, rotates with camera) */}
        <svg
          width={5000}
          height={3000}
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
        >
          {/* soft glow underlay */}
          <path
            d={RAIL}
            fill="none"
            stroke="rgba(255,235,225,0.35)"
            strokeWidth={20}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: "blur(7px)" }}
          />
          {/* crisp rail */}
          <path
            d={RAIL}
            fill="none"
            stroke={RAIL_WHITE}
            strokeWidth={9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* the WORDS, each oriented along its local tangent */}
        {WORDS.map((w, i) => {
          const ws = w.s * RAIL_LEN;
          const p = getPointAtLength(RAIL, ws);
          const ang = tangentDeg(ws);

          // reveal keyed off how close the camera progress is to this word
          const reveal = interpolate(
            progress,
            [w.s - 0.07, w.s - 0.005],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          // slide in ALONG the line direction (in the word's local frame: -x)
          const slide = interpolate(reveal, [0, 1], [70, 0], {
            easing: EASE_OUT,
          });
          // fade the word back out once the camera has passed well beyond it
          const fadeOut = interpolate(
            progress,
            [w.s + 0.085, w.s + 0.16],
            [1, 0.12],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const opacity = Math.min(reveal, fadeOut);

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: p.x,
                top: p.y,
                transform:
                  `translate(-50%, -50%) rotate(${ang}deg) ` +
                  `translateX(${-slide}px)`,
                transformOrigin: "center center",
                opacity,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  fontFamily: w.family,
                  fontWeight: w.weight,
                  fontSize: w.size,
                  lineHeight: 1,
                  color: TEXT_WHITE,
                  letterSpacing: w.letterSpacing ?? -2,
                  textTransform: "uppercase",
                  display: "inline-block",
                  // subtle bevel: bright top edge + dark drop for depth
                  textShadow:
                    "0 2px 0 rgba(255,255,255,0.25), 0 6px 14px rgba(0,0,0,0.55), 0 0 30px rgba(255,210,210,0.15)",
                  WebkitTextStroke: "0.5px rgba(0,0,0,0.15)",
                }}
              >
                {w.text}
              </span>
            </div>
          );
        })}
      </AbsoluteFill>

      {/* ---- GRADE: vignette + grain ---- */}
      <Vignette strength={0.82} />
      <FilmGrain opacity={0.07} freq={0.85} />
    </AbsoluteFill>
  );
};

/* --------------------------------------------------------- the composition */

export const CameraTurnTypography: React.FC = () => {
  const frame = useCurrentFrame();

  // chromatic aberration ramps up during the exit tail
  const exitLocal = frame - EXIT_START;
  const ca = interpolate(exitLocal, [0, 20, 42], [0, 6, 14], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const showExitIcons = frame >= EXIT_START;

  return (
    <AbsoluteFill style={{ backgroundColor: "#1a0407" }}>
      {/* wrap the moving scene in motion blur (low samples to keep render sane;
          cost multiplies by `samples`). */}
      <ChromaSplit amount={ca}>
        <CameraMotionBlur shutterAngle={180} samples={4}>
          <TurnScene />
        </CameraMotionBlur>
      </ChromaSplit>

      {/* the blurred $-bill + cross orb exit, fading over the chromatic tail */}
      {showExitIcons && <ExitIcons local={exitLocal} />}
    </AbsoluteFill>
  );
};
