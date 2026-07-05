/**
 * ExamplesV6Root — STANDALONE preview registry for the ITERATION-1 motion-craft
 * demo (CraftKineticLine). Completely separate from the golden Root.tsx, V1
 * ExamplesRoot, and V2–V5 roots — imports ONLY the one new craft comp. Nothing
 * here is wired into the production pipeline.
 * Registered via ./examples-v6-index.ts.
 *
 * 1920x1080, 30fps, deterministic (frame-driven).
 */
import React from "react";
import { Composition } from "remotion";
import {
  CraftKineticLine,
  CRAFT_KINETIC_DURATION,
} from "./examples/v2/craft/CraftKineticLine";

const COMMON = { fps: 30, width: 1920, height: 1080 } as const;

export const ExamplesV6Root: React.FC = () => {
  return (
    <>
      <Composition
        id="CraftKineticLine"
        component={CraftKineticLine}
        durationInFrames={CRAFT_KINETIC_DURATION}
        {...COMMON}
      />
    </>
  );
};
