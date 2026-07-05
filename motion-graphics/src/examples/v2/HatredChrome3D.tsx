/**
 * HatredChrome3D — REAL 3D chrome title card ("HATRED.") rebuilt with
 * @remotion/three (React-Three-Fiber 9 + drei 10). Replaces the prior
 * hand-rolled 2D SVG-gradient "brushed chrome" with a genuine extruded,
 * beveled 3D mesh wearing a metalness=1 standard material lit by a local
 * studio HDRI — so the reflections are physically real, not faked gradients.
 *
 * DETERMINISM (headless-safe) RULES followed exactly:
 *   - Every animated value is derived from useCurrentFrame() — NEVER useFrame().
 *     (frameloop is 'never' under `remotion render`, so useFrame never fires.)
 *   - Environment is a LOCAL .hdr via staticFile (no drei CDN preset strings).
 *   - The moving reflection sweep = environmentRotation driven by frame.
 *   - Postprocessing limited to deterministic effects (Bloom, ChromaticAberration,
 *     Vignette). No Glitch/Noise (those read Math.random/clock).
 *   - No Math.random / Date anywhere.
 *
 * Comp: 1920x1080, 30fps, 150 frames (~5s).
 * Render: remotion render ... --gl=angle --concurrency=1
 */
import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, staticFile, interpolate, Easing } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { Text3D, Environment } from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";

export const HATRED_CHROME_DURATION = 150; // 5s @ 30fps

const W = 1920;
const H = 1080;

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

/* ----------------------------------------------------------------- backdrop */
/**
 * Dark-red baroque backdrop as a large 3D plane set BACK in Z so the chrome
 * letters float in front of it with real depth. We paint a canvas texture
 * (radial dark-red gradient + a few baroque swirl strokes) once, memoised, and
 * map it onto an unlit plane. Kept deterministic (pure trig, no random).
 */
function useDamaskTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 576;
    const g = c.getContext("2d")!;
    // deep red radial base
    const rg = g.createRadialGradient(512, 230, 60, 512, 288, 760);
    rg.addColorStop(0, "#7d1518");
    rg.addColorStop(0.45, "#5a0f12");
    rg.addColorStop(1, "#23070a");
    g.fillStyle = rg;
    g.fillRect(0, 0, 1024, 576);
    // baroque swirl ornaments (brighter red strokes so they read on screen)
    g.strokeStyle = "rgba(225,75,75,0.4)";
    g.lineWidth = 9;
    g.lineCap = "round";
    const swirl = (cx: number, cy: number, scale: number) => {
      g.beginPath();
      for (let t = 0; t < Math.PI * 3.2; t += 0.08) {
        const r = scale * (1 - t / (Math.PI * 4));
        const x = cx + Math.cos(t) * r;
        const y = cy + Math.sin(t) * r;
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    swirl(660, 150, 120);
    swirl(330, 470, 95);
    swirl(880, 430, 80);
    swirl(180, 150, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/* -------------------------------------------------------------------- scene */
const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const damask = useDamaskTexture();

  // Slow camera push-in (real perspective dolly). Pulled further back so the
  // full "HATRED." word sits inside the 1.78 frame with breathing room.
  const camZ = interpolate(frame, [0, HATRED_CHROME_DURATION], [16.5, 14.6], {
    extrapolateRight: "clamp",
    easing: EASE,
  });
  // tiny vertical drift for life
  const camY = interpolate(frame, [0, HATRED_CHROME_DURATION], [0.15, -0.1], {
    extrapolateRight: "clamp",
  });

  // Reflection sweep: rotate the HDRI environment slowly by frame so the
  // specular highlight travels across the chrome faces. THIS is the headless-
  // safe replacement for a useFrame() animated reflection.
  const envRotY = frame * 0.012;

  // Rule lines (thin 3D bars) above & below sweep in from the sides.
  const ruleIn = interpolate(frame, [6, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const ruleW = 17 * ruleIn;

  // Bar-wipe reveal: a bright emissive plane sweeps left->right early, then
  // parks off-screen. Purely frame-driven.
  const wipeX = interpolate(frame, [0, 34], [-13, 16], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const wipeOpacity = interpolate(frame, [0, 6, 30, 36], [0, 0.9, 0.9, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // CA ramps up briefly at the very end (chromatic exit accent).
  const caOffset = interpolate(
    frame,
    [0, HATRED_CHROME_DURATION - 26, HATRED_CHROME_DURATION],
    [0.0012, 0.0012, 0.006],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <>
      <PerspectiveCameraRig z={camZ} y={camY} />

      {/* fill + key lights (HDRI does the heavy lifting, these add shape).
          A strong front-fill keeps the chrome reading bright silver rather
          than sinking dark against the red. */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[6, 8, 12]} intensity={1.8} />
      <directionalLight position={[-8, 2, 9]} intensity={1.1} color="#ffffff" />
      <directionalLight position={[0, -4, 8]} intensity={0.6} color="#ffd0d0" />
      {/* bright point near camera to throw a hot specular streak across faces */}
      <pointLight position={[-2, 3, 9]} intensity={40} distance={40} decay={2} />

      {/* Local HDRI — reflections + image-based lighting. background={false}
          so we keep our damask plane visible. environmentRotation sweeps. */}
      <Environment
        files={staticFile("hdri/studio.hdr")}
        background={false}
        environmentRotation={[0, envRotY, 0]}
        environmentIntensity={1.6}
      />

      {/* damask backdrop plane, set back in Z for depth */}
      <mesh position={[0, 0, -6]} scale={[1, 1, 1]}>
        <planeGeometry args={[46, 26]} />
        <meshBasicMaterial map={damask} toneMapped={false} />
      </mesh>

      {/* rule lines above & below the word (thin chrome bars), hugging it */}
      <RuleBar y={1.35} width={ruleW} />
      <RuleBar y={-1.45} width={ruleW} />

      {/* the hero: extruded, beveled chrome HATRED. */}
      <HatredText />

      {/* bright bar-wipe reveal plane */}
      <mesh position={[wipeX, 0, 1.2]}>
        <planeGeometry args={[2.4, 7]} />
        <meshBasicMaterial
          color="#fff4f4"
          transparent
          opacity={wipeOpacity}
          toneMapped={false}
        />
      </mesh>

      <EffectComposer>
        <Bloom
          luminanceThreshold={0.82}
          intensity={0.55}
          luminanceSmoothing={0.25}
          mipmapBlur
        />
        <ChromaticAberration
          offset={[caOffset, 0] as unknown as THREE.Vector2}
          blendFunction={BlendFunction.NORMAL}
          radialModulation={false}
          modulationOffset={0}
        />
        <Vignette eskil={false} offset={0.28} darkness={0.92} />
      </EffectComposer>
    </>
  );
};

/* camera rig — drives the EXISTING default camera created by <ThreeCanvas>.
   (Creating a new <perspectiveCamera makeDefault> proved unreliable headless;
   mutating the live default camera every frame is deterministic and works.) */
const PerspectiveCameraRig: React.FC<{ z: number; y: number }> = ({ z, y }) => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  React.useLayoutEffect(() => {
    camera.position.set(0, y, z);
    camera.lookAt(0, 0, 0);
    camera.fov = 32;
    camera.near = 0.1;
    camera.far = 100;
    camera.updateProjectionMatrix();
  });
  return null;
};

const RuleBar: React.FC<{ y: number; width: number }> = ({ y, width }) => {
  if (width <= 0.01) return null;
  return (
    <mesh position={[0, y, 0.2]}>
      <boxGeometry args={[width, 0.085, 0.085]} />
      <meshStandardMaterial
        color="#dfe2e6"
        metalness={1}
        roughness={0.12}
        envMapIntensity={2}
      />
    </mesh>
  );
};

const HatredText: React.FC = () => {
  return (
    <Text3D
      font={staticFile("fonts/helvetiker_bold.typeface.json")}
      size={1.5}
      height={0.4}
      bevelEnabled
      bevelThickness={0.06}
      bevelSize={0.04}
      bevelSegments={8}
      curveSegments={12}
      letterSpacing={0.02}
      position={[-4.75, -0.5, 0]}
    >
      HATRED.
      <meshStandardMaterial
        color="#e6e9ee"
        metalness={1}
        roughness={0.06}
        envMapIntensity={2.6}
      />
    </Text3D>
  );
};

/* --------------------------------------------------------------- composition */
export const HatredChrome3D: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#1a0608" }}>
      <ThreeCanvas
        width={W}
        height={H}
        gl={{ antialias: true }}
        camera={{ position: [0, 0, 9], fov: 32 }}
      >
        <Scene />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
