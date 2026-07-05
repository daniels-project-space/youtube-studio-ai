/**
 * Separate Remotion entry point for the V4 (camera-turns-the-corner kinetic
 * typography) effect proof. Does not touch the golden index.ts / Root.tsx
 * registry, nor the V1 examples-index.ts / ExamplesRoot, nor the V2
 * examples-v2-index.ts, nor the V3 examples-v3-index.ts.
 */
import { registerRoot } from "remotion";
import { ExamplesV4Root } from "./ExamplesV4Root";

registerRoot(ExamplesV4Root);
