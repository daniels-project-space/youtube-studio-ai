/**
 * Separate Remotion entry point for the V3 (cinematic camera-rig) effect proof.
 * Does not touch the golden index.ts / Root.tsx registry, nor the V1
 * examples-index.ts / ExamplesRoot, nor the V2 examples-v2-index.ts.
 */
import { registerRoot } from "remotion";
import { ExamplesV3Root } from "./ExamplesV3Root";

registerRoot(ExamplesV3Root);
