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
  | "business"
  | "lotus"
  | "seaside";

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
  const nicheKey = niche?.trim().toLowerCase() ?? "";
  // Named channels are allowed to refine a broad niche, but each refinement
  // must still describe the channel's actual subject. Keep the examples
  // deliberately explicit: Inked Histories is an opening/closing history
  // book, Drawn Past is the pen-drawn format, and Chalk & Compound is finance
  // ledger work rather than a generic sketch icon.
  if (/drawn\s*past|drawn/.test(name)) return "pen";
  if (/inked\s*histories|history|historical/.test(name)) return "book";
  if (/chalk/.test(name)) return nicheKey === "finance" ? "ledger" : "lesson";
  if (/whiteboard/.test(name)) return "lesson";
  if (/gratitude|serenity|sanctuary/.test(name)) return "lotus";
  if (/stoic|meditat/.test(name)) return "compass";
  if (/seaside|ghibli|coast|ocean/.test(name)) return "seaside";
  if (/lofi|rain|ambient|frequency/.test(name)) return "lofi";
  return NICHE_MOTIFS[nicheKey] ?? "lesson";
}
