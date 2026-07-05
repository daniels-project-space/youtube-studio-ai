/**
 * Local render proof for the Speech-TV golden module (MotivationalSpeech).
 * Handcrafted fixture — no cloud calls, no copyrighted footage download.
 *
 *   npx tsx scripts/render-speech-proof.ts
 *
 * Pass 1: renders the look WITHOUT source footage (vintage dark bg) so every
 *         overlay/caption/cue is verifiable on its own → /tmp/speech-proof.mp4
 * Pass 2 (best-effort): generates an ffmpeg `testsrc` stand-in clip and renders
 *         a second pass with footage underneath → /tmp/speech-proof-footage.mp4
 * Then grabs stills at key cue moments for visual inspection.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { renderMotivationalSpeech } from "../src/lib/remotionRender";
import type {
  MotionCue,
  SpeechSegment,
  SpeechWord,
} from "../src/remotion/speech/types";

const OUT = "/tmp";

// ---- word-level transcript (ms) ------------------------------------------
const SENTENCE =
  "If you want to be wealthy and happy just learn to work harder on yourself than you do on your job"
    .split(" ");
let cursor = 400;
const words: SpeechWord[] = SENTENCE.map((text) => {
  const dur = 260 + text.length * 22;
  const w: SpeechWord = { text, start: cursor, end: cursor + dur };
  cursor += dur + 70;
  return w;
});
const lastWordEnd = words[words.length - 1].end; // ~9s

// ---- segments (drive the n/total channel bug) ----------------------------
const segments: SpeechSegment[] = [
  { index: 1, total: 3, start: 0, end: 6400 },
  { index: 2, total: 3, start: 6400, end: 13000 },
];

// ---- LLM-style cue track (each type at least once) -----------------------
const cues: MotionCue[] = [
  { type: "glitch", start: 0, end: 450 },
  { type: "lowerThird", start: 500, end: 3600, text: "Jim Rohn" },
  { type: "iconPop", start: 1500, end: 4200, icon: "money", text: "wealth" },
  { type: "lineGraph", start: 4300, end: 6300, points: [1, 1.4, 2, 6, 3, 2.2] },
  { type: "glitch", start: 6350, end: 6850 },
  { type: "wavyUnderline", start: 6900, end: 9800, text: "work harder on yourself" },
  {
    type: "stepBoxes",
    start: 9000,
    end: 12800,
    steps: ["Read", "Listen", "Watch"],
    highlightStep: 2,
  },
];

const fixture = { words, segments, cues, durationSec: 13 };

async function main() {
  console.log(`words: ${words.length} (last @ ${lastWordEnd}ms), cues: ${cues.length}`);

  // Pass 1 — look only (no footage)
  const out1 = join(OUT, "speech-proof.mp4");
  console.log("pass 1: rendering look (no footage)…");
  await renderMotivationalSpeech({
    ...fixture,
    outPath: out1,
    log: (m) => console.log("  " + m),
  });
  console.log("  →", out1);

  // Pass 2 — with an ffmpeg testsrc stand-in (best-effort)
  const standIn = join(OUT, "speech-stand-in.mp4");
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=13",
      "-pix_fmt", "yuv420p",
      standIn,
    ],
    { stdio: "ignore" },
  );
  let out2: string | null = null;
  if (ff.status === 0) {
    out2 = join(OUT, "speech-proof-footage.mp4");
    console.log("pass 2: rendering over stand-in footage…");
    try {
      await renderMotivationalSpeech({
        ...fixture,
        sourceVideoSrc: `file://${standIn}`,
        muteSource: true,
        outPath: out2,
        log: (m) => console.log("  " + m),
      });
      console.log("  →", out2);
    } catch (e) {
      console.log("  pass 2 skipped (footage load):", (e as Error).message);
      out2 = null;
    }
  } else {
    console.log("pass 2 skipped: ffmpeg not available");
  }

  // ---- stills at key cue moments (from pass 1) ---------------------------
  const grabs: [string, number][] = [
    ["still_lowerthird", 1.0],
    ["still_iconpop", 2.6],
    ["still_linegraph", 5.0],
    ["still_glitch", 6.6],
    ["still_underline", 8.0],
    ["still_stepboxes", 11.0],
  ];
  for (const [name, t] of grabs) {
    const png = join(OUT, `${name}.png`);
    spawnSync(
      "ffmpeg",
      ["-y", "-ss", String(t), "-i", out1, "-frames:v", "1", png],
      { stdio: "ignore" },
    );
    console.log("still:", png);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
