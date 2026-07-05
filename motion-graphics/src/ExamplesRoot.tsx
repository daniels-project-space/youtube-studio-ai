/**
 * ExamplesRoot — STANDALONE preview registry for the 5 motion-graphics effect
 * demos. Completely separate from the golden Root.tsx — imports ONLY the new
 * example compositions under ./examples. Nothing here is wired into the
 * production pipeline. Registered via ./examples-index.ts.
 *
 * All comps: 1920x1080, 30fps, 150 frames (5s), deterministic.
 */
import React from "react";
import { Composition } from "remotion";
import { KtMetalSlice } from "./examples/KtMetalSlice";
import { KtSlideWords } from "./examples/KtSlideWords";
import { KtScrollUnfurl } from "./examples/KtScrollUnfurl";
import { MapArcRoutes } from "./examples/MapArcRoutes";
import { GlitchChroma } from "./examples/GlitchChroma";

const COMMON = { fps: 30, width: 1920, height: 1080 } as const;

export const ExamplesRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="KtMetalSlice"
        component={KtMetalSlice}
        durationInFrames={150}
        {...COMMON}
      />
      <Composition
        id="KtSlideWords"
        component={KtSlideWords}
        durationInFrames={150}
        {...COMMON}
      />
      <Composition
        id="KtScrollUnfurl"
        component={KtScrollUnfurl}
        durationInFrames={150}
        {...COMMON}
      />
      <Composition
        id="MapArcRoutes"
        component={MapArcRoutes}
        durationInFrames={150}
        {...COMMON}
      />
      <Composition
        id="GlitchChroma"
        component={GlitchChroma}
        durationInFrames={150}
        {...COMMON}
      />
    </>
  );
};
