/**
 * PALETTE AND CONTRAST GUARD.
 *
 * Measured across eleven renders produced during development, seven landed in
 * the 30-62 degree amber/gold hue band and almost all sat at 18-39% saturation.
 * The catalogue had quietly converged on the same muted warm look, and nothing
 * in the module could see it: every gate judged one frame in isolation, so a
 * channel drifting into a single colour temperature was invisible by
 * construction.
 *
 * Two sources fed it. The energy prose offered "golden hour blaze" as its
 * example of charged atmosphere, which biases every bold render warm
 * regardless of the channel's palette; and the channel palettes themselves were
 * authored warm. Prose fixes address the first. This measures the result, so a
 * drift back is caught rather than argued about.
 *
 * Calibration rejected two instruments before settling on one. A whole-image
 * max-minus-min contrast reading returned 229-255 for every frame, because any
 * image containing one black and one white pixel saturates it — the mobile
 * gate's percentile-on-downsample measure already does that job properly and
 * duplicating it worse helped nobody. A global saturation floor failed the
 * approved `rich` golden reference at 18%, because a deliberately desaturated
 * newsprint collage is a legitimate design, not a washed-out one.
 *
 * What survived is the thing actually complained about: MONOTONY. A single warm
 * frame is not a problem; a catalogue where every frame is the same warm is.
 * That cannot be seen one image at a time, which is exactly why it went
 * unnoticed — every existing gate judges a frame in isolation.
 *
 * Note the guard deliberately does NOT excuse monotony because the channel
 * declared a warm accent. Seven of seven channels here were authored with an
 * amber or gold accent, so "the palette said so" would excuse the entire
 * problem it exists to catch.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PaletteReading {
  /** Dominant hue in degrees, 0-360. */
  hue: number;
  /** Mean saturation, 0-100. */
  saturation: number;
}

export interface PaletteVerdict {
  reading: PaletteReading;
  /** Corrections for the art director. Empty when nothing is wrong. */
  issues: string[];
  /** The channel's recent frames occupy too narrow a hue range. */
  monotonous: boolean;
  /** How wide the channel's recent hue range actually is, in degrees. */
  hueSpread: number;
}

export async function readThumbnailPalette(imagePath: string): Promise<PaletteReading> {
  const { stdout } = await execFileAsync(
    "convert",
    [
      imagePath, "-resize", "80x45!", "-colorspace", "HSL",
      "-format", "%[fx:int(mean.r*360)] %[fx:int(mean.g*100)]", "info:",
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const [hue, saturation] = String(stdout).trim().split(/\s+/).map(Number);
  return {
    hue: Number.isFinite(hue) ? hue : 0,
    saturation: Number.isFinite(saturation) ? saturation : 0,
  };
}

/** Circular distance between two hues, in degrees. */
function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

/**
 * Judge the CHANNEL, not the frame.
 *
 * Takes this render's hue together with the channel's recent hues and asks
 * whether the catalogue has collapsed into one colour temperature. Contrast is
 * deliberately not measured here — `gradeThumbnailForMobile` owns that.
 */
export function gradeThumbnailPalette(args: {
  reading: PaletteReading;
  /** Dominant hues of this channel's recent renders, most recent first. */
  recentHues?: readonly number[];
  /** Frames to consider. A channel needs a run before monotony means anything. */
  window?: number;
  /** Minimum hue spread across the window before it reads as monotonous. */
  minHueSpread?: number;
}): PaletteVerdict {
  const window = args.window ?? 4;
  const minHueSpread = args.minHueSpread ?? 40;
  const hues = [args.reading.hue, ...(args.recentHues ?? [])].slice(0, window);

  // A channel without a run of frames cannot be monotonous yet.
  if (hues.length < window) {
    return { reading: args.reading, issues: [], monotonous: false, hueSpread: 360 };
  }

  let hueSpread = 0;
  for (const a of hues) for (const b of hues) hueSpread = Math.max(hueSpread, hueDistance(a, b));

  const issues: string[] = [];
  const monotonous = hueSpread < minHueSpread;
  if (monotonous) {
    issues.push(
      `this channel's last ${hues.length} thumbnails all sit within ${hueSpread} degrees of hue — the catalogue ` +
      `has collapsed into one colour temperature and every video is starting to look like the last. Build this ` +
      `frame around a DIFFERENT light source than the recent ones: if they were firelit and warm, use cold ` +
      `daylight, screen light, moonlight, sodium street light or overcast grey, and let that source pick the colour`,
    );
  }
  return { reading: args.reading, issues, monotonous, hueSpread };
}
