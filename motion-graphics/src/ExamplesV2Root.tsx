/**
 * ExamplesV2Root — STANDALONE preview registry for the V2 (broadcast-tier)
 * motion-graphics effect demos. Completely separate from the golden Root.tsx
 * and the V1 ExamplesRoot — imports ONLY the new v2 example compositions under
 * ./examples/v2. Nothing here is wired into the production pipeline.
 * Registered via ./examples-v2-index.ts.
 *
 * All comps: 1920x1080, 30fps, deterministic.
 */
import React from "react";
import { Composition } from "remotion";
import { KtSlideWordsV2 } from "./examples/v2/KtSlideWordsV2";
import { KtMetalSliceV2 } from "./examples/v2/KtMetalSliceV2";
import { KtScrollUnfurlV2 } from "./examples/v2/KtScrollUnfurlV2";
import { MapArcRoutesV2 } from "./examples/v2/MapArcRoutesV2";
import { GlitchChromaV2 } from "./examples/v2/GlitchChromaV2";
import {
  ShowcaseSegment,
  SHOWCASE_DURATION,
} from "./examples/v2/ShowcaseSegment";

const COMMON = { fps: 30, width: 1920, height: 1080 } as const;

export const ExamplesV2Root: React.FC = () => {
  return (
    <>
      <Composition
        id="KtMetalSliceV2"
        component={KtMetalSliceV2}
        durationInFrames={150}
        {...COMMON}
      />
      <Composition
        id="KtSlideWordsV2"
        component={KtSlideWordsV2}
        durationInFrames={165}
        {...COMMON}
      />
      <Composition
        id="KtScrollUnfurlV2"
        component={KtScrollUnfurlV2}
        durationInFrames={165}
        {...COMMON}
      />
      <Composition
        id="MapArcRoutesV2"
        component={MapArcRoutesV2}
        durationInFrames={150}
        {...COMMON}
      />
      <Composition
        id="GlitchChromaV2"
        component={GlitchChromaV2}
        durationInFrames={150}
        {...COMMON}
      />
      <Composition
        id="ShowcaseSegment"
        component={ShowcaseSegment}
        durationInFrames={SHOWCASE_DURATION}
        {...COMMON}
      />
    </>
  );
};
