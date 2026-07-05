/**
 * Separate Remotion entry point for the V2 (broadcast-tier) effect EXAMPLES.
 * Does not touch the golden index.ts / Root.tsx registry, nor the V1
 * examples-index.ts / ExamplesRoot.
 */
import { registerRoot } from "remotion";
import { ExamplesV2Root } from "./ExamplesV2Root";

registerRoot(ExamplesV2Root);
