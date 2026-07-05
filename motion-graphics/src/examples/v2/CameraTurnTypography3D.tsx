/**
 * CameraTurnTypography3D — the HERO rebuild. Reproduces the 29:24–29:30
 * "camera turns the corner, the text keeps going along a bending line"
 * lyric move from the reference, now in REAL 3D with @remotion/three.
 *
 * HOW IT IS ACTUALLY 3D (not faked):
 *   - A THREE.CatmullRomCurve3 ("the rail") snakes through 3D space with real
 *     corners: a vertical climb, a turn, a long run across, a drop, another run.
 *   - The WORDS are troika <Text> planes positioned at sampled points along the
 *     curve and rotated to face the local tangent, with varied world sizes
 *     (small filler words -> GIANT "FEEL" / "PRO$PERITY").
 *   - A real PerspectiveCamera travels an offset of the SAME curve:
 *       pos = curve.getPointAt(easedP) + camera-offset
 *       lookAt(curve.getPointAt(easedP) + tangent)
 *     so as the rail bends in depth the camera physically TURNS each corner
 *     with true perspective — matching frames 29-26 -> 29-28.
 *   - Read-HOLDS: easedP pauses on each "hold" word so the viewer reads it,
 *     then accelerates to the next — exactly like the reference's beat.
 *
 * DETERMINISM (headless-safe): everything derives from useCurrentFrame() / props.
 * NEVER useFrame(). Local HDRI via staticFile. Post = Bloom + Vignette + CA only.
 * No Math.random / Date.
 *
 * Comp: 1920x1080, 30fps, 320 frames (~10.7s).
 * Render: remotion render ... --gl=angle --concurrency=1
 */
import React, { useMemo, Suspense } from "react";
import { AbsoluteFill, useCurrentFrame, staticFile, interpolate, Easing } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { Text3D, Center, Environment } from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";

export const CAMERA_TURN_3D_DURATION = 320; // ~10.7s @ 30fps

const W = 1920;
const H = 1080;
const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// drei <Text3D> needs a Facetype.js typeface JSON (loaded via Suspense, which
// Remotion's <ThreeCanvas> awaits — unlike troika's async load which silently
// no-ops under frameloop='never'). We use the bundled heavy helvetiker_bold for
// every word; size alone separates filler words from the GIANT ones.
const TYPEFACE = staticFile("fonts/helvetiker_bold.typeface.json");
const ANTON = TYPEFACE; // giant display words
const OSWALD = TYPEFACE; // filler words

/* --------------------------------------------------------------------- rail */
/**
 * The rail: an L/Z-bending path through 3D space. Designed so the camera
 * climbs (reading the small intro words vertically), TURNS right into the long
 * "FEEL" run, drops, then runs across again for "PRO$PERITY" — mirroring the
 * reference corner-turn. Points are in world units.
 */
const RAIL_POINTS: [number, number, number][] = [
  [-7.0, -5.2, 0.0], // start low-left (intro words climb from here)
  [-7.0, -1.2, 0.2],
  [-6.6, 1.8, 0.6], // top of the climb
  [-4.4, 3.0, 0.4], // round the first corner
  [-0.5, 3.0, -0.2], // long run across (FEEL lives along here)
  [4.6, 2.7, -0.6],
  [6.6, 1.0, -0.4], // round into the drop
  [6.4, -1.6, 0.0], // drop down
  [4.0, -2.6, 0.4], // round the second corner
  [-0.6, -2.6, 0.7], // run back across (PRO$PERITY / GOSPEL)
  [-4.8, -2.4, 0.9],
];

function useRail(): THREE.CatmullRomCurve3 {
  return useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        RAIL_POINTS.map((p) => new THREE.Vector3(...p)),
        false,
        "catmullrom",
        0.5
      ),
    []
  );
}

/* -------------------------------------------------------------------- words */
type Word = {
  text: string;
  p: number; // 0..1 position along the rail
  size: number; // world height of the text
  font: string;
  hold: boolean; // camera reads (pauses) here
  color?: string;
};

// Ported faithfully from the validated 2D word list (positions/sizes/holds),
// remapped onto the 3D rail's 0..1 parameter.
const WORDS: Word[] = [
  { text: "I", p: 0.02, size: 0.34, font: OSWALD, hold: false },
  { text: "DON'T", p: 0.075, size: 0.34, font: OSWALD, hold: false },
  { text: "KNOW", p: 0.13, size: 0.34, font: OSWALD, hold: false },
  { text: "WHAT", p: 0.185, size: 0.34, font: OSWALD, hold: false },
  { text: "YOU", p: 0.24, size: 0.34, font: OSWALD, hold: true },
  { text: "FEEL", p: 0.42, size: 1.25, font: ANTON, hold: true },
  { text: "ABOUT", p: 0.58, size: 0.42, font: OSWALD, hold: false },
  { text: "THE", p: 0.63, size: 0.36, font: OSWALD, hold: true },
  { text: "PRO$PERITY", p: 0.8, size: 1.0, font: ANTON, hold: true },
  { text: "GOSPEL", p: 0.92, size: 0.36, font: OSWALD, hold: false },
];

/**
 * Build the camera-progress timeline: glide along the rail, but HOLD (pause)
 * at each `hold` word so the viewer reads it, then accelerate to the next.
 * Returns easedP in [0,1] for a given frame. Pure / frame-driven.
 */
function buildProgress(): { keyFrames: number[]; keyP: number[] } {
  const holds = WORDS.filter((w) => w.hold);
  const ARRIVE = 26; // frames to glide between read points
  const READ = 22; // frames paused reading
  const keyFrames: number[] = [];
  const keyP: number[] = [];
  let f = 8; // small lead-in
  keyFrames.push(0);
  keyP.push(0);
  keyFrames.push(f);
  keyP.push(holds[0].p * 0.4); // start partway up the climb
  for (let i = 0; i < holds.length; i++) {
    f += ARRIVE;
    keyFrames.push(f);
    keyP.push(holds[i].p);
    f += READ;
    keyFrames.push(f);
    keyP.push(holds[i].p);
  }
  // tail glide to the end of the rail
  f += ARRIVE + 18;
  keyFrames.push(Math.min(f, CAMERA_TURN_3D_DURATION - 6));
  keyP.push(1.0);
  keyFrames.push(CAMERA_TURN_3D_DURATION);
  keyP.push(1.0);
  return { keyFrames, keyP };
}

const PROGRESS = buildProgress();

/* ------------------------------------------------------------- word billboard */
const RailWord: React.FC<{ word: Word; rail: THREE.CatmullRomCurve3; frame: number }> = ({
  word,
  rail,
  frame,
}) => {
  const { pos, quat } = useMemo(() => {
    const p = Math.min(Math.max(word.p, 0.0001), 0.9999);
    const pos = rail.getPointAt(p).clone();
    const tan = rail.getTangentAt(p).clone().normalize();
    // Keep text ALWAYS facing the viewer (+Z, never mirrored) and only rotate it
    // about Z so it banks along the rail's screen-space slope. We clamp the
    // angle to ±70° so a near-vertical rail tilts the words steeply (the intro
    // climb) without ever flipping them upside-down or mirror-reversed.
    let angle = Math.atan2(tan.y, tan.x);
    // fold leftward-running tangents back so text never reads right-to-left
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    const clamped = Math.max(-1.22, Math.min(1.22, angle)); // ±70°
    const quat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0, clamped)
    );
    return { pos, quat };
  }, [word, rail]);

  // each word fades/scales in as the camera approaches its p
  const appear = interpolate(
    frame,
    [progressFrameFor(word.p) - 30, progressFrameFor(word.p) - 6],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }
  );
  if (appear <= 0.001) return null;

  // Text3D size is in font units (~1.0 ≈ the typeface em). Normalise so `size`
  // means roughly the world height of a capital letter.
  const t3dSize = word.size * 1.35;
  // pop-in scale (Center handles XY centring; we scale the whole group)
  const popScale = 0.8 + 0.2 * appear;

  return (
    <group position={pos} quaternion={quat} scale={popScale}>
      <Center>
        <Text3D
          font={word.font}
          size={t3dSize}
          height={Math.max(0.04, t3dSize * 0.12)}
          bevelEnabled
          bevelThickness={t3dSize * 0.02}
          bevelSize={t3dSize * 0.014}
          bevelSegments={3}
          curveSegments={6}
          letterSpacing={-t3dSize * 0.02}
        >
          {word.text}
          <meshStandardMaterial
            color="#eef0f2"
            emissive={word.color ?? "#fff0e8"}
            emissiveIntensity={interpolate(appear, [0, 1], [0, 0.22])}
            metalness={0.35}
            roughness={0.4}
            toneMapped={false}
          />
        </Text3D>
      </Center>
    </group>
  );
};

// approximate the frame at which the camera reaches progress p (for word appear timing)
function progressFrameFor(p: number): number {
  const { keyFrames, keyP } = PROGRESS;
  for (let i = 0; i < keyP.length - 1; i++) {
    if (p >= keyP[i] && p <= keyP[i + 1] && keyP[i + 1] !== keyP[i]) {
      const t = (p - keyP[i]) / (keyP[i + 1] - keyP[i]);
      return keyFrames[i] + t * (keyFrames[i + 1] - keyFrames[i]);
    }
  }
  return keyFrames[keyFrames.length - 1] * p;
}

/* ----------------------------------------------------------------- rail tube */
const RailTube: React.FC<{ rail: THREE.CatmullRomCurve3 }> = ({ rail }) => {
  const geo = useMemo(() => new THREE.TubeGeometry(rail, 240, 0.035, 8, false), [rail]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial
        color="#ffffff"
        emissive="#ffd9d0"
        emissiveIntensity={2.2}
        metalness={0.3}
        roughness={0.4}
        toneMapped={false}
      />
    </mesh>
  );
};

/* ------------------------------------------------------------------ backdrop */
function useDamaskTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 1024;
    const g = c.getContext("2d")!;
    const rg = g.createRadialGradient(512, 420, 80, 512, 512, 760);
    rg.addColorStop(0, "#7d1518");
    rg.addColorStop(0.5, "#560e11");
    rg.addColorStop(1, "#1f060a");
    g.fillStyle = rg;
    g.fillRect(0, 0, 1024, 1024);
    g.strokeStyle = "rgba(190,55,55,0.2)";
    g.lineWidth = 8;
    g.lineCap = "round";
    const swirl = (cx: number, cy: number, scale: number) => {
      g.beginPath();
      for (let t = 0; t < Math.PI * 3.4; t += 0.08) {
        const r = scale * (1 - t / (Math.PI * 4.2));
        const x = cx + Math.cos(t) * r;
        const y = cy + Math.sin(t) * r;
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    swirl(700, 250, 150);
    swirl(300, 700, 120);
    swirl(820, 760, 95);
    swirl(220, 240, 85);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/* -------------------------------------------------------------- camera rig 3D */
const FlyingCamera: React.FC<{ rail: THREE.CatmullRomCurve3; frame: number }> = ({
  rail,
  frame,
}) => {
  // Drive the EXISTING default camera (mutating it every frame is deterministic
  // and headless-reliable; a freshly-created makeDefault camera was not picked
  // up under `remotion render`).
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  const easedP = interpolate(frame, PROGRESS.keyFrames, PROGRESS.keyP, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const p = Math.min(Math.max(easedP, 0.0001), 0.9999);

  React.useLayoutEffect(() => {
    const pos = rail.getPointAt(p).clone();
    const tan = rail.getTangentAt(p).clone().normalize();
    // pull the camera back off the rail toward the viewer (+Z) and slightly up
    const camPos = pos.clone().add(new THREE.Vector3(0, 0.2, 9.6));
    camera.position.copy(camPos);
    // look at a point a little ahead along the tangent so we "turn" into corners
    const target = pos.clone().add(tan.multiplyScalar(1.8));
    target.z = pos.z; // keep look roughly in the text plane depth
    camera.lookAt(target);
    camera.fov = 42;
    camera.near = 0.1;
    camera.far = 120;
    camera.updateProjectionMatrix();
  });

  return null;
};

/* -------------------------------------------------------------------- scene */
const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const rail = useRail();
  const damask = useDamaskTexture();

  const envRotY = frame * 0.008;

  // chromatic aberration ramps up at the exit (chromatic transition accent)
  const caOffset = interpolate(
    frame,
    [0, CAMERA_TURN_3D_DURATION - 34, CAMERA_TURN_3D_DURATION],
    [0.0008, 0.0008, 0.007],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <>
      <FlyingCamera rail={rail} frame={frame} />

      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 9, 8]} intensity={0.7} />
      <directionalLight position={[-7, -2, 5]} intensity={0.35} color="#ff9a9a" />

      <Environment
        files={staticFile("hdri/studio.hdr")}
        background={false}
        environmentRotation={[0, envRotY, 0]}
        environmentIntensity={0.8}
      />

      {/* damask backdrop — large plane, set well back, with parallax depth */}
      <mesh position={[0, 0, -9]}>
        <planeGeometry args={[60, 34]} />
        <meshBasicMaterial map={damask} toneMapped={false} />
      </mesh>
      {/* a second, even-further damask layer for parallax depth */}
      <mesh position={[0, 0, -16]}>
        <planeGeometry args={[90, 52]} />
        <meshBasicMaterial map={damask} toneMapped={false} opacity={0.5} transparent />
      </mesh>

      <RailTube rail={rail} />

      {/* Suspense boundary so Remotion's <ThreeCanvas> awaits the typeface JSON
          load (drei Text3D suspends) before capturing each frame. */}
      <Suspense fallback={null}>
        {WORDS.map((w) => (
          <RailWord key={w.text} word={w} rail={rail} frame={frame} />
        ))}
      </Suspense>

      <EffectComposer>
        <Bloom
          luminanceThreshold={0.9}
          intensity={0.42}
          luminanceSmoothing={0.2}
          mipmapBlur
        />
        <ChromaticAberration
          offset={[caOffset, caOffset * 0.5] as unknown as THREE.Vector2}
          blendFunction={BlendFunction.NORMAL}
          radialModulation={false}
          modulationOffset={0}
        />
        <Vignette eskil={false} offset={0.3} darkness={0.95} />
      </EffectComposer>
    </>
  );
};

/* --------------------------------------------------------------- composition */
export const CameraTurnTypography3D: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#170509" }}>
      <ThreeCanvas
        width={W}
        height={H}
        gl={{ antialias: true }}
        camera={{ position: [0, 0, 10], fov: 42 }}
      >
        <Scene />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
