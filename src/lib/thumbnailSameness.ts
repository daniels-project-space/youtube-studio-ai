/**
 * THUMBNAIL SAMENESS.
 *
 * The module already states the rule — "Consistent per-channel styling lifts
 * subscriber CTR 15-20%: lock palette + text position family; VARY the hero
 * object and the number" — and already shows the symptom of not enforcing it.
 * Gratitude Springs' identity contract has to explicitly forbid "repeating
 * paired stones as the default thumbnail for unrelated meditations", which is a
 * rule written to patch a drift that nothing was measuring.
 *
 * This repo already solved the same problem for scripts in `scriptSelfDedup`.
 * There was no equivalent for thumbnails, so a channel could publish twelve
 * near-identical frames and every gate would pass each one individually.
 *
 * Two signals, but NOT equal ones. Calibration against real renders settled the
 * hierarchy, and it was not the one I expected:
 *
 *   same scene re-rendered by another model:  15, 26
 *   different videos on the SAME channel:     28, 28, 36
 *
 * Those bands OVERLAP. A channel with a locked palette and type position is
 * supposed to look like itself, so its genuinely different videos sit closer
 * together than two renders of one idea sit apart. A perceptual hash therefore
 * cannot be the primary detector at this granularity without either missing
 * real repeats or flagging the channel consistency the module deliberately
 * wants.
 *
 * So the hash is tuned for PRECISION, not recall — it fires only on a near
 * identical frame, where it is never wrong — and hero-vocabulary overlap does
 * the real detection work. In the calibration set that is exactly what
 * happened: the repeated gratitude scene scored 15 visually (below any safe
 * threshold) but 1.0 on hero overlap, and was caught.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Words that carry no subject meaning when comparing two hero descriptions. */
const HERO_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "with", "from",
  "into", "onto", "over", "under", "its", "his", "her", "their", "one", "two",
  "is", "are", "was", "were", "be", "being", "been", "as", "by", "for", "that",
  "this", "it", "hero", "prop", "frame", "shot", "scene", "image", "close",
  "dominant", "cropped", "background", "foreground", "left", "right", "centre",
  "center", "dark", "light", "deep", "soft", "hard", "large", "small", "big",
]);

export interface ThumbnailFingerprint {
  /** 64-bit difference hash, hex. */
  phash: string;
  /** Meaningful nouns from the hero description. */
  heroTokens: string[];
}

export interface SamenessVerdict {
  /** True when the candidate is too close to something recent. */
  tooSimilar: boolean;
  /** Closest perceptual distance found (0 = identical, 64 = opposite). */
  nearestVisualDistance: number;
  /** Highest hero-vocabulary overlap found, 0-1. */
  nearestHeroOverlap: number;
  reasons: string[];
}

/**
 * Difference hash: downsample to 9x8 greyscale and record, for each row,
 * whether each pixel is brighter than its right-hand neighbour. Robust to
 * scale, compression and mild colour grading, which is exactly what we want —
 * two renders of the same idea should collide even at different resolutions.
 */
export async function fingerprintThumbnail(args: {
  imagePath?: string;
  heroProp?: string;
}): Promise<ThumbnailFingerprint> {
  let phash = "";
  if (args.imagePath) {
    const { stdout } = await execFileAsync(
      process.env.FFMPEG_BIN ?? "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-i", args.imagePath,
        "-vf", "scale=9:8:flags=area,format=gray",
        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-",
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "buffer" },
    );
    const pixels = stdout as unknown as Buffer;
    // Built as hex nibbles directly: this project targets below ES2020, so
    // BigInt literals are unavailable and a 64-bit value cannot be held in a
    // JS number without losing the low bits.
    let bits = "";
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = pixels[row * 9 + col] ?? 0;
        const right = pixels[row * 9 + col + 1] ?? 0;
        bits += left > right ? "1" : "0";
      }
    }
    phash = (bits.match(/.{4}/g) ?? [])
      .map((nibble) => parseInt(nibble, 2).toString(16))
      .join("");
  }
  const heroTokens = [...new Set(
    (args.heroProp ?? "")
      .toLowerCase()
      .replace(/[^a-z]+/g, " ")
      .split(" ")
      .filter((word) => word.length > 3 && !HERO_STOPWORDS.has(word)),
  )];
  return { phash, heroTokens };
}

const NIBBLE_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * Compared nibble by nibble rather than as one integer: a 64-bit hash exceeds
 * the safe-integer range, and BigInt literals are not available at this
 * compile target.
 */
export function hammingDistance(left: string, right: string): number {
  if (!left || !right || left.length !== right.length) return 64;
  let distance = 0;
  for (let index = 0; index < left.length; index++) {
    const a = parseInt(left[index] ?? "0", 16);
    const b = parseInt(right[index] ?? "0", 16);
    if (Number.isNaN(a) || Number.isNaN(b)) return 64;
    distance += NIBBLE_BITS[(a ^ b) & 0xf] ?? 0;
  }
  return distance;
}

/** Jaccard overlap of the two hero vocabularies. */
export function heroOverlap(left: readonly string[], right: readonly string[]): number {
  if (!left.length || !right.length) return 0;
  const a = new Set(left);
  const b = new Set(right);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : Math.round((shared / union) * 100) / 100;
}

/**
 * Compare a candidate against the channel's recent thumbnails.
 *
 * Thresholds are deliberately permissive. A channel is SUPPOSED to look like
 * itself — locked palette, locked type position — so only a genuinely repeated
 * composition or a genuinely recycled idea should trip this. Set too tight, it
 * would fight the channel-consistency rule it sits next to.
 */
export function scoreThumbnailSameness(args: {
  candidate: ThumbnailFingerprint;
  recent: readonly ThumbnailFingerprint[];
  /**
   * Perceptual distance at or below which two frames are literally the same
   * picture. Deliberately conservative: measured, different videos on one
   * channel reach 28 and a re-rendered identical scene reached 26, so anything
   * near those numbers would punish channel consistency. 12 only catches a
   * frame that is visually a duplicate, where the signal is unambiguous.
   */
  maxVisualDistance?: number;
  /** Hero-vocabulary overlap at or above which two ideas are the same idea. */
  maxHeroOverlap?: number;
}): SamenessVerdict {
  const maxVisualDistance = args.maxVisualDistance ?? 12;
  const maxHeroOverlap = args.maxHeroOverlap ?? 0.6;
  const reasons: string[] = [];
  let nearestVisualDistance = 64;
  let nearestHeroOverlap = 0;

  for (const prior of args.recent) {
    if (args.candidate.phash && prior.phash) {
      nearestVisualDistance = Math.min(
        nearestVisualDistance,
        hammingDistance(args.candidate.phash, prior.phash),
      );
    }
    nearestHeroOverlap = Math.max(
      nearestHeroOverlap,
      heroOverlap(args.candidate.heroTokens, prior.heroTokens),
    );
  }
  if (!args.recent.length) nearestVisualDistance = 64;

  if (nearestVisualDistance <= maxVisualDistance) {
    reasons.push(
      `this is visually the same picture as a recent thumbnail (perceptual distance ` +
      `${nearestVisualDistance}, needs more than ${maxVisualDistance}) — vary the hero object, not just the copy`,
    );
  }
  if (nearestHeroOverlap >= maxHeroOverlap) {
    reasons.push(
      `the hero repeats a recent idea (${Math.round(nearestHeroOverlap * 100)}% shared subject vocabulary) — ` +
      `keep the channel's palette and type family, but invent a new subject`,
    );
  }
  return {
    tooSimilar: reasons.length > 0,
    nearestVisualDistance,
    nearestHeroOverlap,
    reasons,
  };
}
