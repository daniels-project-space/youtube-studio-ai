/**
 * ExamplesV5Root — STANDALONE preview registry for the V5 REAL-3D motion-
 * graphics proofs (rebuilt with @remotion/three + React-Three-Fiber + drei
 * Environment HDRI + postprocessing). Completely separate from the golden
 * Root.tsx, V1 ExamplesRoot, V2/V3/V4 roots — imports ONLY the two new
 * 3D comps. Nothing here is wired into the production pipeline.
 * Registered via ./examples-v5-index.ts.
 *
 * Both comps: 1920x1080, 30fps, fully deterministic (frame-driven).
 */
import React from "react";
import { Composition } from "remotion";
import { HatredChrome3D, HATRED_CHROME_DURATION } from "./examples/v2/HatredChrome3D";
import {
  CameraTurnTypography3D,
  CAMERA_TURN_3D_DURATION,
} from "./examples/v2/CameraTurnTypography3D";

const COMMON = { fps: 30, width: 1920, height: 1080 } as const;

export const ExamplesV5Root: React.FC = () => {
  return (
    <>
      <Composition
        id="HatredChrome3D"
        component={HatredChrome3D}
        durationInFrames={HATRED_CHROME_DURATION}
        {...COMMON}
      />
      <Composition
        id="CameraTurnTypography3D"
        component={CameraTurnTypography3D}
        durationInFrames={CAMERA_TURN_3D_DURATION}
        {...COMMON}
      />
    </>
  );
};
