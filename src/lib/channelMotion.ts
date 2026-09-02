export type ChannelMotionMotif =
  | "lofi"
  | "lesson"
  | "ledger"
  | "circuit"
  | "heart"
  | "steam"
  | "compass"
  | "clapper"
  | "mind"
  | "casefile"
  | "book"
  | "pen"
  | "summit"
  | "health"
  | "business";

const NICHE_MOTIFS: Record<string, ChannelMotionMotif> = {
  lofi: "lofi",
  educational: "lesson",
  finance: "ledger",
  technology: "circuit",
  lifestyle: "heart",
  food: "steam",
  travel: "compass",
  entertainment: "clapper",
  psychology: "mind",
  crime: "casefile",
  history: "book",
  motivation: "summit",
  stories: "pen",
  health: "health",
  business: "business",
};

/**
 * Choose a reusable visual motif from a channel's subject. Specific channel
 * names can opt into a more expressive mark without making the caller encode
 * presentation knowledge or fall back to generic iconography.
 */
export function channelMotionMotifFor({
  niche,
  channelName,
}: {
  niche?: string | null;
  channelName?: string | null;
}): ChannelMotionMotif {
  const name = channelName?.toLowerCase() ?? "";
  if (/drawn|inked|whiteboard|chalk/.test(name)) return "pen";
  if (/stoic|meditat|gratitude/.test(name)) return "mind";
  if (/lofi|rain|ambient|frequency/.test(name)) return "lofi";
  return NICHE_MOTIFS[niche ?? ""] ?? "lesson";
}
