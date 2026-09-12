/**
 * Apply the one allowed title transformation before judging and publishing.
 *
 * A channel name may appear as a legacy prefix/suffix even though it does not
 * help a viewer understand an individual video. Normalizing after a decision
 * was recorded created a split-brain package: the decision and alternate
 * described one title, while YouTube received another. Keeping the rule here
 * makes title selection, thumbnail promise, learning, and publication share
 * the exact same title string.
 */
export function normalizeTitleForPublication(title: string, channelName?: string): string {
  let normalized = title.trim();
  const name = channelName?.trim();
  if (!name || name === "this channel") return normalized;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  normalized = normalized
    .replace(new RegExp(`\\s*[|\\-–—:•]\\s*${escaped}\\s*$`, "i"), "")
    .replace(new RegExp(`^\\s*${escaped}\\s*[|\\-–—:•]\\s*`, "i"), "")
    .replace(new RegExp(`\\b${escaped}\\b`, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[|\-–—:•]\s*$/, "")
    .trim();
  return normalized;
}
