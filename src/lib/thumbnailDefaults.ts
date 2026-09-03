/**
 * SPREAD DEFAULTS.
 *
 * The metal-plaque convergence was not a one-off. Auditing the module for
 * `?? "constant"` fallbacks found the same pattern in seven places, and two of
 * them are direct causes of complaints already raised:
 *
 *   accentColor ?? "#ffd400"   — the amber bias, hard-coded. Any channel that
 *                                did not declare a second palette colour got
 *                                gold, forever, and every such channel looked
 *                                like every other one.
 *   textZone ?? "left"         — every unset headline goes to the same side, so
 *                                a catalogue's type never moves.
 *   background ?? "deep dark gradient"
 *   imageStyle ?? "premium cinematic editorial art"
 *   layoutMode ?? "split"
 *   font ?? "sans"
 *
 * A single constant fallback is invisible in review — it reads as a sensible
 * safety net — and it silently makes every channel that omits a field identical
 * to every other channel that omits it. That is the mechanism by which a
 * "capable" module produces a monoculture.
 *
 * The fix is not to remove defaults, which would break callers, but to make an
 * unset value resolve ACROSS the available range instead of collapsing onto one
 * point. Selection is a pure function of stable identity, so the same channel
 * always resolves the same way — a default that varied per call would make
 * renders irreproducible and defeat every cache and checkpoint in the pipeline.
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
 * Accent colours for a channel that never declared one.
 *
 * Deliberately spans the wheel. The previous single default was #ffd400, which
 * is why an audit of eleven renders found seven in the amber band.
 */
export const FALLBACK_ACCENTS = [
  "#E03131", // red
  "#F08C00", // orange
  "#2F9E44", // green
  "#1098AD", // teal
  "#3B5BDB", // indigo
  "#AE3EC9", // violet
  "#E8590C", // rust
  "#F1F3F5", // bone white
] as const;

/** Dark bases that are not all the same navy. */
export const FALLBACK_BASES = [
  "#111827", // navy-black
  "#1B1B1F", // neutral char
  "#0E1B14", // forest
  "#1A1210", // warm brown-black
  "#0C1520", // cold slate
] as const;

/**
 * Type zones. "left" was the constant, so an unset headline never moved. The
 * upper zones are included because a headline above the hero is a legitimate
 * and under-used composition, not merely a fallback.
 */
export const FALLBACK_TEXT_ZONES = [
  "left", "right", "upperLeft", "upperRight", "upperCenter",
] as const;

/**
 * Backgrounds. "deep dark gradient" is not a place; it is the absence of one,
 * and it produced the flat fields that the seam detector later had to catch.
 */
export const FALLBACK_BACKGROUNDS = [
  "a receding interior that falls away into real shadow",
  "an open sky with weather moving across it",
  "a working environment with its own light sources visible",
  "a landscape receding to a distant horizon",
  "a wall of the scene's own material, textured and lit from one side",
] as const;

/**
 * Type motifs for a channel that never declared one.
 *
 * The previous fallback chain terminated at "movie_poster", whose description
 * specifies metallic bevel — so every unregistered channel produced a metal
 * plaque, which is exactly the convergence that was reported after the
 * registered channels had already been diversified. Fixing the registered
 * channels and leaving the terminal default intact fixed nothing for any
 * channel the module had not met yet.
 *
 * The pool deliberately excludes the metal-leaning motifs so an unset value
 * cannot land back on the look it converged to.
 */
export const FALLBACK_TEXT_OBJECTS = [
  "torn_strip",
  "paint_smear",
  "censor_bar",
  "grunge_sticker",
  "spaced_elegant",
  "spray_paint",
  "stamp_ink",
  "ransom_note",
  "carved",
  "scene_forged",
] as const;

export function fallbackTextObject(seed: string): typeof FALLBACK_TEXT_OBJECTS[number] {
  return spreadDefault(seed, FALLBACK_TEXT_OBJECTS);
}

export function fallbackAccent(seed: string): string {
  return spreadDefault(seed, FALLBACK_ACCENTS);
}
export function fallbackBase(seed: string): string {
  return spreadDefault(seed, FALLBACK_BASES);
}
export function fallbackTextZone(seed: string): typeof FALLBACK_TEXT_ZONES[number] {
  return spreadDefault(seed, FALLBACK_TEXT_ZONES);
}
export function fallbackBackground(seed: string): string {
  return spreadDefault(seed, FALLBACK_BACKGROUNDS);
}
