/**
 * IDENTITY SPREAD — resolve an unset creative value across a range, not onto a
 * point.
 *
 * Generalised from src/lib/thumbnailDefaults.ts, where it fixed a measured
 * defect: `accentColor ?? "#ffd400"` had put seven of eleven audited renders in
 * the same amber band, because every channel that never declared an accent got
 * the identical one. The convergence audit found the same shape elsewhere — a
 * fallback art style, a narrator persona, an accent colour — each quietly
 * acting as the house identity for every channel that omitted the field.
 *
 * THE RULE. A creative default must be a RANGE resolved by stable identity, not
 * a constant. Selection is a pure function of the channel's own name, so:
 *
 *   - the same channel always resolves the same way, which keeps renders
 *     reproducible and every cache, checkpoint and seed downstream valid;
 *   - different channels land on different options, so an unset field stops
 *     being a house style;
 *   - nothing varies per call, which a random default would, breaking
 *     reproducibility and making a regression impossible to bisect.
 *
 * WHERE THIS MUST NOT BE USED. Only for values that are genuinely unset. A
 * channel that has already published under a look has an established identity,
 * and spreading it later would change that channel's appearance mid-catalogue —
 * the exact drift the golden reference exists to prevent. Callers pass the
 * declared value when there is one; this decides only what "unset" means.
 */

/** Stable, order-independent hash of an identity string. */
export function stableIndex(seed: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let hash = 0;
  for (const char of seed.trim().toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  }
  return hash % modulo;
}

/** Pick deterministically from a set, so unset values spread across it. */
export function spreadDefault<T>(seed: string, options: readonly T[]): T {
  return options[stableIndex(seed, options.length)] as T;
}

/**
 * Line-art looks for a drawn/whiteboard channel that never declared one.
 *
 * The previous single fallback was "clean editorial black-marker line art,
 * bold simple silhouettes, uniform stroke weight, sparse red accents" — so
 * every undeclared drawn channel was the same channel. These are all
 * legitimately WHITEBOARD looks: the range widens within the format's identity
 * rather than escaping it, because a scribe channel must not become a painted
 * one just because nobody filled in a field.
 */
export const FALLBACK_LINE_ART_STYLES = [
  "clean editorial black-marker line art, bold simple silhouettes, uniform stroke weight, sparse red accents",
  "loose ink-sketch line art with visible construction strokes, confident single-weight outlines, one cool accent",
  "technical-drawing line art, fine even hairlines, precise geometry, faint blueprint-grid ground, restrained accent",
  "chalk-on-slate line art, soft chalky edges and dusty texture, high-contrast white on dark, one warm accent",
  "woodcut-flavoured line art, thick-to-thin tapering strokes and hatched shadow blocks, single deep accent",
  "architect's marker line art, broad flat strokes with dry-edge texture, generous white space, one muted accent",
] as const;

/**
 * Narrator personas for a channel that never declared one.
 *
 * Two separate blocks each hard-coded the identical 100-character "weathered
 * chronicler" string, so every undeclared narrated channel shared one
 * character. Voice is identity as much as palette is.
 */
export const FALLBACK_NARRATOR_PERSONAS = [
  "a weathered chronicler who witnessed these events first-hand and speaks of them plainly, without boast",
  "a careful archivist who has read every surviving account and reports only what the record will support",
  "a former insider recounting what they saw, still weighing how much of it they are willing to say",
  "a patient teacher who assumes intelligence and never condescends, explaining as if to one attentive person",
  "a dry, unhurried witness who finds the absurdity in events without ever mocking the people caught in them",
] as const;

/**
 * Accent colours for anything that never declared one. Deliberately spans the
 * wheel; the prior single default was amber, which is how the thumbnail
 * catalogue drifted into one colour band in the first place.
 */
export const FALLBACK_ACCENT_COLOURS = [
  "#E03131", "#F08C00", "#2F9E44", "#1098AD", "#3B5BDB", "#AE3EC9", "#E8590C", "#F1F3F5",
] as const;

/**
 * Show-bible fallbacks, used when generation fails and a channel would
 * otherwise be created with no identity at all.
 *
 * The single previous pair — "calm, consistent, on-brand" and "a single bold,
 * recurring central subject" — meant every channel that hit the failure path
 * received the same creative doctrine. The show bible drives crew, register and
 * look, so that is the most consequential place in the system for a shared
 * default, not the least.
 */
export const FALLBACK_CHANNEL_VIBES = [
  "calm, consistent, on-brand",
  "unhurried and exact, never raising its voice to be believed",
  "warm and plainspoken, explaining as if to one attentive person",
  "dry and observant, finding the absurd without mocking anyone",
  "grave and deliberate, treating the subject as it deserves",
] as const;

/**
 * Motifs, kept deliberately abstract. A concrete motif — a lantern, a ledger —
 * would be wrong for most channels; these describe a COMPOSITIONAL habit that
 * any subject can satisfy.
 */
export const FALLBACK_CHANNEL_MOTIFS = [
  "a single bold, recurring central subject",
  "one object held in frame while its context shifts around it",
  "a repeated wide-to-close move that ends on a detail",
  "a recurring hard division of the frame into before and after",
  "a subject seen against a much larger space that dwarfs it",
] as const;

/**
 * Comic-illustration looks for a channel that never declared one.
 *
 * Same collapse as the drawn-channel line art: one hard-coded phrase made every
 * undeclared comic channel draw in an identical hand. Every option is still
 * comic illustration, so the range widens inside the format rather than
 * escaping it.
 */
/**
 * Instrumental beds for a narrated channel that has declared no sound of its own.
 *
 * The music block's last-resort prompt was a single LOFI HIP-HOP brief — Rhodes
 * piano, boom-bap drums, vinyl crackle — left over from when the block served
 * only the lofi family. It now serves twelve channels, most of which are not
 * lofi, so a finance or philosophy channel with no styleDNA audio and no
 * composer brief would have been scored as lofi.
 *
 * These are written to be usable under narration: no percussion that competes
 * with speech, no build-ups, low dynamics. They differ in register rather than
 * in quality, so which one a channel receives changes its character without
 * making any channel worse. The lofi family keeps its own brief and never draws
 * from this list.
 */
export const FALLBACK_UNDERSCORE_BRIEFS = [
  "sparse solo piano underscore, wide spacing between phrases, soft felt hammers, warm room tone, " +
  "contemplative and unhurried, very low dynamics, no percussion, no build-ups, purely instrumental",
  "sustained string underscore, slow bowed swells, gentle cello underneath, warm and reflective, " +
  "minimal movement, no percussion, no drums, no build-ups, purely instrumental",
  "soft ambient underscore, layered analogue pads and faint tape hiss, slow harmonic drift, " +
  "calm and spacious, no rhythm section, no build-ups, purely instrumental",
  "quiet acoustic guitar underscore, fingerpicked and close-mic'd, occasional low sustained note, " +
  "warm and grounded, unobtrusive, no percussion, no build-ups, purely instrumental",
  "muted brass and low woodwind underscore, long held notes, distant and documentary, " +
  "restrained and serious, no percussion, no build-ups, purely instrumental",
] as const;

export const FALLBACK_COMIC_STYLES = [
  "clean controlled comic illustration",
  "inked comic illustration with heavy spot blacks and confident contour lines",
  "flat-colour comic illustration with limited palette and crisp panel edges",
  "painterly comic illustration with soft edges and visible brush texture",
  "high-contrast noir comic illustration built from shadow shapes",
] as const;

export function fallbackChannelVibe(seed: string): string {
  return spreadDefault(seed, FALLBACK_CHANNEL_VIBES);
}
export function fallbackChannelMotif(seed: string): string {
  return spreadDefault(seed, FALLBACK_CHANNEL_MOTIFS);
}
export function fallbackComicStyle(seed: string): string {
  return spreadDefault(seed, FALLBACK_COMIC_STYLES);
}

export function fallbackLineArtStyle(seed: string): string {
  return spreadDefault(seed, FALLBACK_LINE_ART_STYLES);
}
export function fallbackNarratorPersona(seed: string): string {
  return spreadDefault(seed, FALLBACK_NARRATOR_PERSONAS);
}
export function fallbackAccentColour(seed: string): string {
  return spreadDefault(seed, FALLBACK_ACCENT_COLOURS);
}
