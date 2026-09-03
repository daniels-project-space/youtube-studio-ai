/**
 * FLAT-PANEL DETECTOR.
 *
 * The module kept solving "give the headline clean space" by pasting a flat
 * colour rectangle over one side of the frame and putting the type on it. That
 * is two images sitting next to each other, and it reads as a template.
 *
 * The instinct was to write a longer rule describing the banner, plate or
 * standard the type should be instead. That approach has repeatedly failed in
 * this module: prose describing a desired outcome competes with every other
 * sentence in a 6,000-byte brief and the model satisfies whichever it weighs
 * most. What has actually worked, every time, is MEASURING the failure and
 * feeding it back — the contrast floor did not improve because the prompt
 * described contrast, it improved because a number rejected the frame and the
 * critique loop handed that number to the next attempt.
 *
 * So this measures the thing rather than describing its cure. It reports THAT
 * the frame is two images butted together and leaves the model free to solve it
 * however the scene wants — snow, sky, fog, a wall, a hanging standard, deep
 * shadow. The module is not told what to draw; it is told what is wrong.
 *
 * Calibration rejected the obvious instrument first. Measuring flatness fails,
 * because the headline sits ON the panel and fills those cells with
 * high-contrast letters, and because the panels are usually gradients rather
 * than true flat fills — every candidate and every golden reference scored
 * identically. The signature that actually separates them is the SEAM: a pasted
 * panel meets the photograph along one hard vertical line running most of the
 * frame height, which no real scene produces.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PanelVerdict {
  /** True when the frame appears to be two images butted along a seam. */
  hasFlatPanel: boolean;
  /** Strength of the strongest vertical seam, relative to typical column edges. */
  seamStrength: number;
  /** Where it sits, as a fraction of frame width. */
  seamPosition: number;
  issues: string[];
}

/** Mean edge energy per column strip, via a sobel pass. */
async function columnEdgeEnergy(imagePath: string, strips: number): Promise<number[]> {
  const out: number[] = [];
  for (let index = 0; index < strips; index++) {
    const { stderr } = await execFileAsync(
      process.env.FFMPEG_BIN ?? "ffmpeg",
      [
        "-hide_banner", "-nostats", "-i", imagePath,
        "-vf",
        `format=gray,sobel,crop=iw/${strips}:ih:${index}*iw/${strips}:0,signalstats,metadata=mode=print`,
        "-f", "null", "-",
      ],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    ).catch((error: { stderr?: string }) => ({ stderr: error?.stderr ?? "" }));
    const text = String(stderr ?? "");
    out.push(Number(/lavfi\.signalstats\.YAVG=([\d.]+)/.exec(text)?.[1] ?? "0"));
  }
  return out;
}

/**
 * A pasted side panel meets the photograph along one hard vertical line. That
 * seam concentrates edge energy into a single narrow column far above the
 * frame's typical column edge energy; an ordinary scene spreads its edges
 * around instead.
 */
export async function detectFlatPanel(args: {
  imagePath: string;
  /** How many times the typical column a seam column must exceed. */
  maxSeamStrength?: number;
}): Promise<PanelVerdict> {
  const maxSeamStrength = args.maxSeamStrength ?? 2.2;
  const strips = 16;
  const energy = await columnEdgeEnergy(args.imagePath, strips);
  const sorted = [...energy].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;

  let seamStrength = 0;
  let seamIndex = 0;
  // Ignore the outermost strips: frame edges and the channel badge live there.
  for (let index = 2; index < strips - 2; index++) {
    const ratio = (energy[index] ?? 0) / (median || 1);
    if (ratio > seamStrength) {
      seamStrength = ratio;
      seamIndex = index;
    }
  }
  seamStrength = Math.round(seamStrength * 100) / 100;
  const seamPosition = Math.round((seamIndex / strips) * 100) / 100;

  const issues: string[] = [];
  const hasFlatPanel = seamStrength > maxSeamStrength;
  if (hasFlatPanel) {
    issues.push(
      `there is a hard vertical seam ${Math.round(seamPosition * 100)}% across the frame — the headline is sitting ` +
      `on a panel butted against the picture rather than inside it. The scene has to continue edge to edge, and ` +
      `whatever the type rests on must be a real surface in this world carrying its own light, depth and grain`,
    );
  }
  return { hasFlatPanel, seamStrength, seamPosition, issues };
}
