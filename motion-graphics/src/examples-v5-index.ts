/**
 * Separate Remotion entry point for the V5 REAL-3D effect proofs
 * (HatredChrome3D + CameraTurnTypography3D, built on @remotion/three).
 * Does not touch the golden index.ts / Root.tsx registry, nor the V1
 * examples-index.ts / ExamplesRoot, nor V2/V3/V4 entries.
 */
import { registerRoot } from "remotion";
import { ExamplesV5Root } from "./ExamplesV5Root";

registerRoot(ExamplesV5Root);
