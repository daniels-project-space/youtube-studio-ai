/**
 * ExamplesV3Root — STANDALONE preview registry for the V3 (cinematic camera-rig)
 * motion-graphics proof. Completely separate from the golden Root.tsx, the V1
 * ExamplesRoot and the V2 ExamplesV2Root — imports ONLY the new CameraPathFollow
 * composition. Nothing here is wired into the production pipeline.
 * Registered via ./examples-v3-index.ts.
 *
 * Comp: 1920x1080, 30fps, deterministic.
 */
import React from "react";
import { Composition } from "remotion";
import {
  CameraPathFollow,
  CAMERA_PATH_DURATION,
} from "./examples/v2/CameraPathFollow";

const COMMON = { fps: 30, width: 1920, height: 1080 } as const;

export const ExamplesV3Root: React.FC = () => {
  return (
    <>
      <Composition
        id="CameraPathFollow"
        component={CameraPathFollow}
        durationInFrames={CAMERA_PATH_DURATION}
        {...COMMON}
      />
    </>
  );
};
