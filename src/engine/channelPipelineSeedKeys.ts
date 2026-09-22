import { childrenShowBibleSeedKeys } from "./childrenShowBible";
import { parseChannelProgramRouteRunSeed } from "./channelProgramRoute";
import type { ContentLane } from "./contentLane";
import type { PipelineEntry } from "./types";

/**
 * Shared compile-time projection, not seed admission or a payload allowlist.
 * Callers first bind the route to its brief/identity and select the actual
 * frozen seed. Supervised children's packets retain their separate admission.
 */
export function channelPipelineValidationSeedKeys(
  contentLane: ContentLane,
  admittedRouteSeed?: unknown,
  pipeline: readonly PipelineEntry[] = [],
): string[] {
  const keys = ["contentLane", ...childrenShowBibleSeedKeys(contentLane)];
  if (pipeline.some(entry => entry.block === "scene_planner" &&
    ["2.0.0-grounded-deterministic", "3.0.0-bound-visual-plan"].includes(entry.version ?? ""))) {
    keys.push("styleDNA");
  }
  if (admittedRouteSeed !== undefined) {
    const route = parseChannelProgramRouteRunSeed(admittedRouteSeed);
    if (route.contentLaneKey !== contentLane.key || route.family !== contentLane.family) {
      throw new Error("pipeline validation route seed does not match its admitted content lane");
    }
    keys.push("channelProgramRoute");
  }
  return keys;
}
