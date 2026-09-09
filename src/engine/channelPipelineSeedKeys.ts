import { childrenShowBibleSeedKeys } from "./childrenShowBible";
import { parseChannelProgramRouteRunSeed } from "./channelProgramRoute";
import type { ContentLane } from "./contentLane";

/**
 * Shared compile-time projection, not seed admission or a payload allowlist.
 * Callers first bind the route to its brief/identity and select the actual
 * frozen seed. Supervised children's packets retain their separate admission.
 */
export function channelPipelineValidationSeedKeys(
  contentLane: ContentLane,
  admittedRouteSeed?: unknown,
): string[] {
  const keys = ["contentLane", ...childrenShowBibleSeedKeys(contentLane)];
  if (admittedRouteSeed !== undefined) {
    const route = parseChannelProgramRouteRunSeed(admittedRouteSeed);
    if (route.contentLaneKey !== contentLane.key || route.family !== contentLane.family) {
      throw new Error("pipeline validation route seed does not match its admitted content lane");
    }
    keys.push("channelProgramRoute");
  }
  return keys;
}
