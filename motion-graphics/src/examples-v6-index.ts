/**
 * Separate Remotion entry point for the V6 ITERATION-1 motion-craft demo
 * (CraftKineticLine, built on src/examples/v2/craft/*). Does not touch the
 * golden index.ts / Root.tsx registry, nor the V1 examples-index.ts /
 * ExamplesRoot, nor V2–V5 entries.
 */
import { registerRoot } from "remotion";
import { ExamplesV6Root } from "./ExamplesV6Root";

registerRoot(ExamplesV6Root);
