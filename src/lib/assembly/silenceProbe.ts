/**
 * Silence probe — the I/O half of the editor's silence-trim (auto-editor). ffmpeg's
 * built-in `silencedetect` filter finds dead-air gaps in the narration; we parse its
 * stderr into typed intervals that feed the PURE planTimeline (which decides what to
 * carve, given the editor's thresholds). No new binary: ffmpeg is already the renderer.
 *
 * Split on purpose: `parseSilenceDetect` is pure + unit-tested; `detectNarrationSilence`
 * is the thin ffmpeg shell. planTimeline stays pure by receiving the intervals as input.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface SilenceInterval {
  startSec: number;
  endSec: number;
}

/**
 * Parse `ffmpeg -af silencedetect` stderr → ordered silence intervals. Pairs each
 * `silence_start` with the following `silence_end`. A dangling start (file ends mid
 * silence) is closed at `fallbackEndSec` when provided, else dropped.
 */
export function parseSilenceDetect(stderr: string, fallbackEndSec?: number): SilenceInterval[] {
  const out: SilenceInterval[] = [];
  let openStart: number | null = null;
  // tokens appear in order: "silence_start: 12.34" … "silence_end: 14.56 | silence_duration: 2.2"
  const re = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const kind = m[1];
    const t = parseFloat(m[2]);
    if (!Number.isFinite(t)) continue;
    if (kind === "start") {
      openStart = Math.max(0, t);
    } else if (openStart !== null) {
      if (t > openStart) out.push({ startSec: openStart, endSec: t });
      openStart = null;
    }
  }
  if (openStart !== null && fallbackEndSec !== undefined && fallbackEndSec > openStart) {
    out.push({ startSec: openStart, endSec: fallbackEndSec });
  }
  return out;
}

export interface DetectOpts {
  /** Noise floor below which audio counts as silence. ffmpeg default -30dB; lower = stricter. */
  noiseDb?: number;
  /** Minimum gap ffmpeg reports (kept sensitive — the editor's minSilenceSec does the real filtering downstream). */
  minGapSec?: number;
  /** Narration length, used to close a silence that runs to EOF. */
  durationSec?: number;
}

/**
 * Run `silencedetect` over a local audio/video file → silence intervals. Detects
 * sensitively (small min gap); the editor's `minSilenceSec`/`padSec` shape the actual
 * trim in computeKeepRanges. Returns [] on any ffmpeg failure (fail soft → no trim,
 * never a crash that loses the whole render).
 */
export async function detectNarrationSilence(localPath: string, opts: DetectOpts = {}): Promise<SilenceInterval[]> {
  const noiseDb = opts.noiseDb ?? -30;
  const minGapSec = opts.minGapSec ?? 0.2;
  const bin = process.env.FFMPEG_BIN ?? "ffmpeg";
  try {
    // ffmpeg prints silencedetect events to stderr; `-f null -` discards the decode output.
    const { stderr } = await execFileP(bin, [
      "-hide_banner", "-nostats",
      "-i", localPath,
      "-af", `silencedetect=noise=${noiseDb}dB:d=${minGapSec}`,
      "-f", "null", "-",
    ], { maxBuffer: 8 * 1024 * 1024 });
    return parseSilenceDetect(stderr, opts.durationSec);
  } catch {
    return [];
  }
}
