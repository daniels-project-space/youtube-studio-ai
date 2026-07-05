/**
 * ExamplesV4Root — STANDALONE preview registry for the V4 (camera-TURNS-the-
 * corner kinetic-typography) motion-graphics proof. Completely separate from
 * the golden Root.tsx, the V1 ExamplesRoot, V2 ExamplesV2Root and V3
 * ExamplesV3Root — imports ONLY the new CameraTurnTypography composition.
 * Nothing here is wired into the production pipeline.
 * Registered via ./examples-v4-index.ts.
 *
 * Comp: 1920x1080, 30fps, deterministic.
 */
import React from "react";
import { Composition } from "remotion";
import {
  CameraTurnTypography,
  CAMERA_TURN_DURATION,
} from "./examples/v2/CameraTurnTypography";

const COMMON = { fps: 30, width: 1920, height: 1080 } as const;

export const ExamplesV4Root: React.FC = () => {
  return (
    <>
      <Composition
        id="CameraTurnTypography"
        component={CameraTurnTypography}
        durationInFrames={CAMERA_TURN_DURATION}
        {...COMMON}
      />
    </>
  );
};
