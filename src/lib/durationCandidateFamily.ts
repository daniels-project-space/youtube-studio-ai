import { contentLaneForFamily, parseContentLane } from "@/engine/contentLane";
import { FAMILY_KEYS, type FamilyKey } from "@/engine/families";

/** Resolve only explicitly stored, mutually consistent identities; never infer from pipeline blocks. */
export function durationCandidateFamily(channel: { family?: unknown; contentLane?: unknown }): FamilyKey {
  const rawFamily = channel.family;
  if (rawFamily != null && (typeof rawFamily !== "string" || !(FAMILY_KEYS as readonly string[]).includes(rawFamily))) throw new Error("The saved channel format is invalid.");
  const family = rawFamily == null ? undefined : rawFamily as FamilyKey;
  if (channel.contentLane == null) {
    if (!family) throw new Error("The channel has no saved format or canonical content lane.");
    return family;
  }
  const lane = parseContentLane(channel.contentLane);
  const laneFamily = lane.family;
  const canonical = contentLaneForFamily(laneFamily);
  if (!canonical || lane.key !== canonical.key || lane.primaryRenderer !== canonical.primaryRenderer) throw new Error("The saved content lane does not identify a canonical channel format.");
  if (family && family !== laneFamily) throw new Error("The saved channel format conflicts with its content lane.");
  return laneFamily as FamilyKey;
}
