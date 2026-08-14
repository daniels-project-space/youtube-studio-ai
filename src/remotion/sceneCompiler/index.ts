import { registerRoot } from "remotion";
import { SceneCompilerRoot } from "./Root";

/**
 * Isolated entrypoint for manifest-driven deterministic visuals. It intentionally
 * does not register the broad studio Remotion root or import any media provider.
 */
registerRoot(SceneCompilerRoot);
