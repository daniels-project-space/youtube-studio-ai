/**
 * Separate Remotion entry point for the standalone effect EXAMPLES.
 * Does not touch the golden index.ts / Root.tsx registry.
 */
import { registerRoot } from "remotion";
import { ExamplesRoot } from "./ExamplesRoot";

registerRoot(ExamplesRoot);
