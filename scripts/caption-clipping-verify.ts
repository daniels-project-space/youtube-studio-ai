/**
 * Portrait caption-clipping verification (Phase 152).
 *
 * Renders the SAME cue that exposed the defect ("The key did not fit any door")
 * onto a clean 1080x1920 portrait clip AND a 1920x1080 landscape clip using the
 * REAL burnCaptions() code path, then extracts a frame from each for direct
 * visual inspection.
 *
 * Run: npx tsx scripts/caption-clipping-verify.ts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { burnCaptions, captionGeometry } from "@/lib/ffmpeg";

const execFileP = promisify(execFile);
const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const OUT = "/tmp/capfix";

const CUE_TEXT = "The key did not fit any door";
const CUE = [{ startSec: 0.5, endSec: 4.0, text: CUE_TEXT }];
const GRAB_AT = "2.0";

async function makeClip(w: number, h: number, path: string) {
  // Mid-grey test card with a visible 1px border so the frame edges are obvious.
  await execFileP(FFMPEG, [
    "-y", "-f", "lavfi", "-i", `color=c=0x3a4a5a:s=${w}x${h}:d=5:r=25`,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-vf", `drawbox=x=0:y=0:w=${w}:h=${h}:color=red@1.0:t=4`,
    "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
    "-pix_fmt", "yuv420p", "-c:a", "aac", path,
  ]);
}

async function grab(video: string, png: string) {
  await execFileP(FFMPEG, ["-y", "-ss", GRAB_AT, "-i", video, "-frames:v", "1", png]);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  for (const [label, W, H] of [["portrait", 1080, 1920], ["landscape", 1920, 1080]] as const) {
    const tmp = join(OUT, `tmp_${label}`);
    await mkdir(tmp, { recursive: true });
    const src = join(OUT, `src_${label}.mp4`);
    const burned = join(OUT, `burned_${label}.mp4`);
    const png = join(OUT, `frame_${label}.png`);

    await makeClip(W, H, src);
    await burnCaptions(src, CUE, burned, { tmpDir: tmp, width: W, height: H });
    await grab(burned, png);

    const g = captionGeometry(W, H);
    // Rough DejaVu Sans advance ≈ 0.55em averaged over mixed-case text.
    const estWidth = Math.round(CUE_TEXT.length * g.fontSize * 0.55);
    console.log(
      `${label.padEnd(9)} ${W}x${H} font=${g.fontSize} sideM=${g.sideM} ` +
      `avail=${g.availableWidth} estCueWidth=${estWidth} ` +
      `lines≈${Math.max(1, Math.ceil(estWidth / g.availableWidth))} -> ${png}`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
