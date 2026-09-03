/**
 * THE 120px SQUINT TEST AND SAFE ZONES, EXECUTED.
 *
 * Both of these are already stated as law in this module:
 *
 *   "THE 120px SQUINT TEST: most first views are ~120px wide on mobile — mood,
 *    subject, and text must all survive there; if it's a muddy blur, the design
 *    is wrong."
 *   "SAFE ZONES: never place HEADLINE text or key story elements in the
 *    bottom-right (duration timestamp) or bottom-left (chapter markers)."
 *
 * Neither was ever measured. They existed only as sentences in the prompt, so a
 * candidate that failed both could still pass every gate — the vision reviewer
 * reads a full-resolution image and OCR reads deliberately stylized type badly,
 * which is precisely the wrong instrument for "does this survive at browse
 * size". This measures the pixels instead.
 *
 * Deliberately cheap and deterministic: two ffmpeg passes and some luma
 * statistics, no model call, so it can run on every candidate.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The width a first impression actually happens at. */
export const MOBILE_BROWSE_WIDTH = 120;

/**
 * YouTube's own chrome, as fractions of the frame. The duration pill sits
 * bottom-right; chapter and progress markers sit along the bottom edge.
 */
export const YOUTUBE_OVERLAY_ZONES = [
  { name: "duration pill (bottom-right)", x: 0.72, y: 0.80, w: 0.28, h: 0.20 },
  { name: "chapter markers (bottom-left)", x: 0.00, y: 0.86, w: 0.22, h: 0.14 },
] as const;

export interface MobileGateVerdict {
  /** Every hard check passed. */
  passed: boolean;
  /** Detail contrast surviving the downsample, 0-100. */
  squintContrast: number;
  /** Distinct tonal separation between the busiest and calmest thirds. */
  squintSeparation: number;
  /** Zones where meaningful ink lands under YouTube's own overlays. */
  occludedZones: string[];
  failures: string[];
}

/**
 * signalstats exposes percentiles rather than a standard deviation, and the
 * 10th-to-90th spread is the better instrument anyway: it measures the contrast
 * a viewer actually perceives and ignores a few blown highlights or crushed
 * blacks that would inflate a stdev.
 */
async function lumaSpread(path: string, filter: string): Promise<{ avg: number; spread: number }> {
  const { stderr } = await execFileAsync(
    process.env.FFMPEG_BIN ?? "ffmpeg",
    [
      "-hide_banner", "-nostats", "-i", path,
      "-vf", `${filter ? `${filter},` : ""}signalstats,metadata=mode=print`,
      "-f", "null", "-",
    ],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  ).catch((error: { stderr?: string }) => ({ stderr: error?.stderr ?? "" }));
  const text = String(stderr ?? "");
  const read = (key: string) => Number(new RegExp(`lavfi\\.signalstats\\.${key}=([\\d.]+)`).exec(text)?.[1] ?? "0");
  const low = read("YLOW");
  const high = read("YHIGH");
  return { avg: read("YAVG"), spread: Math.max(0, high - low) };
}

/**
 * Measure a finished candidate the way a viewer first meets it.
 *
 * `squintContrast` is the luma spread that SURVIVES being scaled to browse
 * width — a design that only reads because of fine detail collapses here, which
 * is exactly the "muddy blur" the rule warns about. `squintSeparation` compares
 * the busiest and calmest thirds: a frame with no separation has no focal
 * hierarchy left at 120px even if its overall contrast looks fine.
 */
export async function gradeThumbnailForMobile(args: {
  imagePath: string;
  /**
   * Minimum surviving contrast. Calibrated against this repo's own approved
   * golden references (147, 186, 193) and the weakest real candidate produced
   * during development (88, a Nano Banana 1 frame that reads as mush at browse
   * size). 110 sits below every golden and above the failure.
   */
  minContrast?: number;
  /** Advisory only — see the note on separation below. */
  minSeparation?: number;
  /** Local contrast spread above which an overlay zone is reported as busy. */
  overlayInkSpread?: number;
}): Promise<MobileGateVerdict> {
  const minContrast = args.minContrast ?? 110;
  const minSeparation = args.minSeparation ?? 0;
  const overlayInkSpread = args.overlayInkSpread ?? 34;
  const failures: string[] = [];
  const scratch = await mkdtemp(join(tmpdir(), "thumb-mobile-"));
  try {
    // The whole point is to judge the DOWNSAMPLED image, so scale first and
    // measure the result rather than measuring full resolution.
    const squint = join(scratch, "squint.png");
    await execFileAsync(
      process.env.FFMPEG_BIN ?? "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y", "-i", args.imagePath,
        "-vf", `scale=${MOBILE_BROWSE_WIDTH}:-2:flags=area,format=gray`,
        "-frames:v", "1", squint,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );

    const whole = await lumaSpread(squint, "");
    const squintContrast = Math.round(whole.spread * 10) / 10;
    if (squintContrast < minContrast) {
      failures.push(
        `at ${MOBILE_BROWSE_WIDTH}px the image retains only ${squintContrast} luma contrast ` +
        `(needs ${minContrast}) — it reads as a muddy blur at browse size`,
      );
    }

    // Focal hierarchy: the busiest third against the calmest third.
    const thirds = await Promise.all([0, 1, 2].map((index) =>
      lumaSpread(squint, `crop=iw/3:ih:${index}*iw/3:0`),
    ));
    const devs = thirds.map((t) => t.spread);
    const squintSeparation = Math.round((Math.max(...devs) - Math.min(...devs)) * 10) / 10;
    // NOT a gate. Measured against the golden set, third-to-third separation
    // does not discriminate: the approved `scandal` reference scores lowest of
    // all (12) because a full-bleed collage is deliberately busy edge to edge.
    // Reported for the critique loop, never used to reject.
    if (minSeparation > 0 && squintSeparation < minSeparation) {
      failures.push(
        `no focal hierarchy survives the downsample (third-to-third spread ${squintSeparation}, needs ${minSeparation})`,
      );
    }

    // Safe zones, measured rather than asserted. Ink under YouTube's own chrome
    // is ink the viewer never sees.
    const occludedZones: string[] = [];
    for (const zone of YOUTUBE_OVERLAY_ZONES) {
      const stats = await lumaSpread(
        args.imagePath,
        `crop=iw*${zone.w}:ih*${zone.h}:iw*${zone.x}:ih*${zone.y}`,
      );
      if (stats.spread >= overlayInkSpread) occludedZones.push(zone.name);
    }

    return {
      passed: failures.length === 0,
      squintContrast,
      squintSeparation,
      occludedZones,
      failures,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
