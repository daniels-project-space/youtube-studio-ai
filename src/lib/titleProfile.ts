/**
 * Runtime-safe title format policy shared by planning, metadata, and the
 * automatic whole-video plan. Keep this module free of provider/Node imports:
 * Convex stores the sealed profile alongside its preflight receipt.
 */
export type TitleProfileId =
  | "browse_long"
  | "searchable_long"
  | "serialized_lore"
  | "motivational"
  | "children_quiz"
  | "music_loop"
  | "short_form"
  | "general";

export interface TitleProfile {
  id: TitleProfileId;
  hardMinChars: number;
  hardMaxChars: number;
  targetMinChars: number;
  targetMaxChars: number;
  targetMinWords: number;
  targetMaxWords: number;
  discovery: "searchable" | "intriguing" | "hybrid";
  guidance: string;
}

export const TITLE_PROFILES: Record<TitleProfileId, TitleProfile> = {
  browse_long: { id: "browse_long", hardMinChars: 25, hardMaxChars: 76, targetMinChars: 40, targetMaxChars: 70, targetMinWords: 5, targetMaxWords: 12, discovery: "hybrid", guidance: "Lead with the subject, then one clear tension or consequence." },
  searchable_long: { id: "searchable_long", hardMinChars: 28, hardMaxChars: 76, targetMinChars: 38, targetMaxChars: 68, targetMinWords: 5, targetMaxWords: 11, discovery: "searchable", guidance: "Put the exact subject or problem first; add one differentiated payoff." },
  serialized_lore: { id: "serialized_lore", hardMinChars: 25, hardMaxChars: 74, targetMinChars: 36, targetMaxChars: 66, targetMinWords: 5, targetMaxWords: 11, discovery: "hybrid", guidance: "Name the canon subject first and tease one specific revelation; avoid episode filler." },
  motivational: { id: "motivational", hardMinChars: 24, hardMaxChars: 72, targetMinChars: 34, targetMaxChars: 64, targetMinWords: 4, targetMaxWords: 10, discovery: "intriguing", guidance: "State the emotional or behavioural turn plainly; promise a usable shift, not hype." },
  children_quiz: { id: "children_quiz", hardMinChars: 22, hardMaxChars: 72, targetMinChars: 30, targetMaxChars: 62, targetMinWords: 4, targetMaxWords: 10, discovery: "searchable", guidance: "Make the question or learning outcome obvious in the opening words." },
  music_loop: { id: "music_loop", hardMinChars: 20, hardMaxChars: 76, targetMinChars: 28, targetMaxChars: 60, targetMinWords: 4, targetMaxWords: 10, discovery: "searchable", guidance: "Lead with the mood/use case and keep duration or format suffixes at the end." },
  short_form: { id: "short_form", hardMinChars: 18, hardMaxChars: 65, targetMinChars: 24, targetMaxChars: 52, targetMinWords: 3, targetMaxWords: 9, discovery: "intriguing", guidance: "Deliver the subject and turn in one compact phrase; omit setup." },
  general: { id: "general", hardMinChars: 25, hardMaxChars: 76, targetMinChars: 40, targetMaxChars: 70, targetMinWords: 5, targetMaxWords: 12, discovery: "hybrid", guidance: "Be accurate, concise and immediately legible to a new viewer." },
};

/** Resolve a profile from an explicit route setting, then durable lane/family. */
export function resolveTitleProfile(
  explicit?: string,
  context: { family?: string; contentLane?: string; niche?: string } = {},
): TitleProfileId {
  if (explicit && Object.prototype.hasOwnProperty.call(TITLE_PROFILES, explicit)) return explicit as TitleProfileId;
  const key = `${context.contentLane ?? ""} ${context.family ?? ""} ${context.niche ?? ""}`.toLowerCase();
  if (/music_loop|lo-?fi|ambient|study beats|chillhop|sleep music/.test(key)) return "music_loop";
  if (/short_form|documentary_collage_short|\bshorts\b/.test(key)) return "short_form";
  if (/lore_micro_doc|loreshort|lore|fantasy canon|star wars|tolkien/.test(key)) return "serialized_lore";
  if (/children|quiz|trivia|learning/.test(key)) return "children_quiz";
  if (/motivat|self[- ]?improv|stoic|mindset|psychology/.test(key)) return "motivational";
  if (/search|explainer|documentary|history|finance|tax|invest/.test(key)) return "searchable_long";
  return "browse_long";
}
