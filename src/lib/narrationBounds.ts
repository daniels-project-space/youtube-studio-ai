/** Paid narration-input bounds shared by runtime and the cold cost envelope. */
export const NARRATION_COLD_OPEN_MAX_CHARS = 500;
export const NARRATION_MAX_CHAPTER_CARDS = 18;
export const NARRATION_CHAPTER_HEADING_MAX_CHARS = 120;

/** Normalize whitespace and retain only complete words within the character cap. */
export function boundCompleteWordText(text: string, maxCharacters: number): string {
  const limit = Math.max(1, Math.floor(maxCharacters));
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const kept: string[] = [];
  let characters = 0;
  for (const word of words) {
    // A malformed single token must not defeat the hard provider-input bound.
    if (word.length > limit) continue;
    const next = characters + (kept.length > 0 ? 1 : 0) + word.length;
    if (next > limit) break;
    kept.push(word);
    characters = next;
  }
  return kept.join(" ");
}

export function boundNarrationColdOpen(text: string): string {
  return boundCompleteWordText(text, NARRATION_COLD_OPEN_MAX_CHARS);
}

export function boundNarrationChapterHeading(text: string): string {
  return boundCompleteWordText(text, NARRATION_CHAPTER_HEADING_MAX_CHARS);
}

/** Preserve source order/mapping while bounding oversized model output. */
export function boundNarrationChapterHeadings(
  headings: readonly string[],
): string[] {
  return headings
    .slice(0, NARRATION_MAX_CHAPTER_CARDS)
    .map(boundNarrationChapterHeading);
}

/**
 * Exact extra TTS-character ceiling for `Chapter N: <heading>.` strings.
 * The digit-width calculation matters: cards 10–18 have one extra character.
 */
export function narrationChapterHeadingCharacterCeiling(
  cardCount = NARRATION_MAX_CHAPTER_CARDS,
): number {
  const count = Math.max(
    0,
    Math.min(NARRATION_MAX_CHAPTER_CARDS, Math.floor(cardCount)),
  );
  let total = 0;
  for (let index = 1; index <= count; index++) {
    total +=
      `Chapter ${index}: `.length +
      NARRATION_CHAPTER_HEADING_MAX_CHARS +
      1; // terminal period
  }
  return total;
}
