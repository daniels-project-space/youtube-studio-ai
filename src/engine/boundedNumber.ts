/**
 * Clamping a number that came from configuration.
 *
 * `Math.max(0, Math.min(6, Number(value)))` looks like a clamp and is not one.
 * NaN loses every comparison it takes part in, so `Math.min(6, NaN)` is NaN and
 * `Math.max(0, NaN)` is NaN — the clamp passes it straight through, and so does
 * the `if (k <= 0) return` guard underneath it, because `NaN <= 0` is false too.
 *
 * Block params are `Record<string, unknown>` fed from channel configuration, so
 * a string where a number belongs is an ordinary configuration mistake, not an
 * exotic one. A repo scan found 48 clamps written around an unchecked Number().
 * What NaN then does varies by site and NONE of it is what the author intended:
 *
 *   signature_clips   NaN slipped past BOTH the block's `k <= 0` guard and the
 *                     generator's, into a paid path, to plan zero scenes
 *   trackCount        Math.max(1, NaN) is NaN, so the music loop runs zero times
 *                     and the video has no tracks, silently
 *   minNotability     `score >= NaN` is false for every candidate
 *   width / height    ffmpeg receives NaN and the render fails loudly, which is
 *                     the only one of these that announces itself
 *
 * The same defect had already been fixed by hand in length_check, where a
 * malformed maxSeconds removed the ceiling from a hard Stage-4 gate.
 *
 * This is the pattern visualMatterBlocks already had right, promoted so the rest
 * of the codebase can use it rather than re-deriving it — and tightened, because
 * its own test caught that Number("") is 0 rather than NaN, so an empty param
 * would have resolved to zero instead of to the caller's default.
 */

/**
 * A finite number inside [min, max], or `fallback` when the value is missing or
 * not a finite number.
 *
 * The fallback is applied BEFORE the clamp, so a caller's documented default is
 * what a malformed value resolves to — not whatever the clamp does to NaN.
 */
export function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, isUsableNumber(value) ? Number(value) : fallback));
}

/** {@link boundedNumber}, floored to an integer. */
export function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(boundedNumber(value, fallback, min, max));
}

/**
 * Whether a value is usable as a number at all.
 *
 * For the sites that must REFUSE rather than substitute — a gate cannot quietly
 * adopt a default for a threshold it was configured with, because that hides a
 * misconfiguration behind a plausible result.
 */
export function isUsableNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  // Number("") and Number(" ") and Number([]) are all 0, not NaN. For a config
  // value that is the same defect wearing a friendlier face: `maxSeconds: ""`
  // would become a ceiling of zero and fail every video, which is exactly the
  // kind of plausible-looking result a fallback exists to prevent. An empty
  // value means UNSET.
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return Number.isFinite(Number(trimmed));
}
